const { Ollama } = require('ollama');

const ollama = new Ollama({ host: 'http://ollama-service:11434' });

/**
 * Invoice auditing using a local AI model based on live corporate rules
 * @param {Object} invoice — invoice object (total, category, vendor_id, etc.)
 * @param {Array} rules  — rules from PostgreSQL via Dapr
 * @returns {Promise<Object>} — { recommendation: "AUTO_APPROVE"|"HUMAN_REVIEW", reason: "..." }
 */
async function classifyInvoiceWithLocalAI(invoice, rules) {


    const formattedRules = rules
        .map((r, index) => `${index + 1}. [${r.rule_id}] Category: ${r.category} -> Requirement: ${r.rule_text}`)
        .join('\n');

    const systemPrompt = `You are an expert corporate FinOps Compliance Auditor. 
Your task is to analyze the user's invoice payload against the following active corporate policies.

ACTIVE CORPORATE POLICIES:
${formattedRules || "No specific rules provided. Follow general financial guidelines."}

CRITICAL INSTRUCTIONS:
- Evaluate if the invoice violates any of the active policies (check amounts, category constraints, and vendor names).
- If no rules are violated and the metadata looks normal, recommend "AUTO_APPROVE".
- If any corporate rule is violated, or if the data feels anomalous, recommend "HUMAN_REVIEW".
- You MUST respond strictly in valid JSON format. Do not write any conversational intro/outro text.

The JSON object MUST follow this exact schema:
{
  "recommendation": "AUTO_APPROVE",
  "reason": "Clear English explanation mentioning which specific rule ID was evaluated or violated."
}`;

    let userPrompt = `Analyze this invoice payload:
- Tracking ID: ${invoice.tracking_id || 'N/A'}
- Category: ${invoice.category || 'General'}
- Total: ${invoice.currency || 'USD'} ${invoice.total || 0}
- Vendor: ${invoice.vendor || 'Unknown'}
- Receipt Present: ${invoice.receiptPresent ? 'Yes' : 'No'}`;

    invoice.lineItems.map((item, index) => {
        userPrompt += `\n- Line Item ${index + 1}: Description: ${item.description || 'N/A'},Quantity: ${item.quantity || 0}, Amount: ${invoice.currency || 'USD'}${item.unitPrice || 0}`;
    });
    console.log("systemPrompt", systemPrompt);
    console.log("User Prompt for AI:", userPrompt);
    try {
        const response = await ollama.chat({
            model: 'llama3',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            options: {
                temperature: 0.1 // Keeps response deterministic
            },
            format: 'json' // Forces Ollama to enforce JSON syntax structure
        });

        let rawContent = response.message.content.trim();
        console.log("rawContent", rawContent);
        // FIX 2: Defensive regex to strip markdown block ticks if Llama 3 hallucinates them
        if (rawContent.startsWith("```")) {
            rawContent = rawContent.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        }

        const aiResult = JSON.parse(rawContent);

        // Fallback guardrail for schema properties validation
        if (!['AUTO_APPROVE', 'HUMAN_REVIEW'].includes(aiResult.recommendation)) {
            aiResult.recommendation = 'HUMAN_REVIEW';
        }

        return {
            recommendation: aiResult.recommendation,
            reason: aiResult.reason || "Evaluated by local AI engine successfully."
        };

    } catch (err) {
        // Safe failover to human queue if JSON parsing or connection fails
        return {
            recommendation: "HUMAN_REVIEW",
            reason: `Local AI Analysis failed or timed out: ${err.message}. Forced routing to manual queue.`
        };
    }
}

module.exports = { classifyInvoiceWithLocalAI };
