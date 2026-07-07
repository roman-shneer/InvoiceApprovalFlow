const { Ollama } = require('ollama');

const ollama = new Ollama({ host: 'http://ollama-service:11434' });

/**
 * Invoice auditing using a local AI model based on live corporate rules
 * @param {Object} invoice — invoice object (total, category, vendor_id, etc.)
 * @param {Array} rules  — rules from PostgreSQL via Dapr
 * @returns {Promise<Object>} — { recommendation: "AUTO_APPROVE"|"HUMAN_REVIEW", reason: "..." }
 */
async function classifyInvoiceWithLocalAI(invoice, rules) {
    const category = String(invoice.category || '').toLowerCase();
    const relevantRules = rules.filter(rule => {
        const ruleCategory = String(rule.category || '').toLowerCase();
        return ruleCategory === 'global rules' || ruleCategory.includes(category);
    });
    const formattedRules = relevantRules
        .map((r, index) => `${index + 1}. [${r.rule_id}] Category: ${r.category} -> Requirement: ${r.rule_text}`)
        .join('\n');
    /*const systemPrompt = `You are an expert corporate FinOps Compliance Auditor. 
Your task is to analyze the user's invoice payload against the following active corporate policies.

ACTIVE CORPORATE POLICIES:
${formattedRules || "No specific rules provided. Follow general financial guidelines."}

CRITICAL INSTRUCTIONS:
- Evaluate if the invoice violates any of the active policies (check amounts, category constraints, and vendor names).
- LINE ITEM AUDIT MANDATE: You MUST closely read the "Description" field of every single row inside the "lineItems" array.
- UNALLOWABLE EXPENSES DETECTOR: If any line item description contains explicit restricted corporate keywords like "Alcohol", "Bar tab", "Liquor", "Wine", "Beer", "Gift", "Casino", or "Luxury", this is an AUTOMATIC VIOLATION regardless of the overall category or amount. You MUST return "HUMAN_REVIEW".
- If no rules are violated, line item descriptions contain zero prohibited items, and the metadata looks normal, recommend "AUTO_APPROVE".
- If any corporate rule is violated, or if the data feels anomalous, recommend "HUMAN_REVIEW".
- You MUST respond strictly in valid JSON format. Do not write any conversational intro/outro text.
- You are a rigid compliance validator, NOT a decision-maker. You have ZERO authority to make assumptions, exceptions, or compromises.
- If an invoice amount is even $1 higher than a threshold specified in a rule, it is an AUTOMATIC VIOLATION.
- DO NOT apply "safe assumptions" based on the vendor name or receipt presence if a numeric limit or prohibited item description is breached.
- If ANY rule is violated or any restricted line item text is detected, you MUST strictly recommend "HUMAN_REVIEW".
- You MUST evaluate your own data alignment certainty and provide a numeric confidence level score between 0.00 and 1.00.

The JSON object MUST follow this exact schema structure:
{
  "recommendation": "AUTO_APPROVE",
  "confidence": 0.95,
  "reason": "Clear English explanation mentioning which specific rule ID or line item text restriction was evaluated or violated."
}`;*/

    const systemPrompt = `You are an expert corporate FinOps Compliance Auditor. 
Your task is to analyze the user's invoice payload against the following active corporate policies.

ACTIVE CORPORATE POLICIES:
${formattedRules || "No specific rules provided. Follow general financial guidelines."}

CRITICAL INSTRUCTIONS:
- Evaluate if the invoice violates any of the active policies (check amounts, category constraints, and vendor names).
- If no rules are violated and the metadata looks normal, recommend "AUTO_APPROVE".
- If any corporate rule is violated, or if the data feels anomalous, recommend "HUMAN_REVIEW".
- You MUST respond strictly in valid JSON format. Do not write any conversational intro/outro text.
- You are a rigid compliance validator, NOT a decision-maker. You have ZERO authority to make assumptions, exceptions, or compromises.
- If an invoice amount is even $1 higher than a threshold specified in a rule, it is an AUTOMATIC VIOLATION.
- DO NOT apply "safe assumptions" based on the vendor name (like DataDog) or receipt presence if a numeric limit is breached.
- If ANY rule is violated, you MUST strictly recommend "HUMAN_REVIEW". "AUTO_APPROVE" is ONLY allowed if there are absolutely zero rule mismatches.

The JSON object MUST follow this exact schema:
{
"recommendation": "AUTO_APPROVE" or "HUMAN_REVIEW",
"confidence": 0.95,
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
    console.log("****AI working:", process.env.AI_MODEL_NAME);
    console.log("systemPrompt", systemPrompt);
    console.log("User Prompt for AI:", userPrompt);
    try {
        const response = await ollama.chat({
            model: process.env.AI_MODEL_NAME || 'qwen2.5:0.5b',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            options: {
                temperature: 0.1 // Keeps response deterministic
            },
            format: 'json' // Forces Ollama to enforce JSON syntax structure
        });
        console.log("response", response);
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
            reason: aiResult.reason || "Evaluated by local AI engine successfully.",
            confidence: parseFloat(aiResult.confidence || 0),
        };

    } catch (err) {
        // Safe failover to human queue if JSON parsing or connection fails
        return {
            recommendation: "HUMAN_REVIEW",
            reason: `Local AI Analysis failed or timed out: ${err.message}. Forced routing to manual queue.`,
            confidence: 0
        };
    }
}

module.exports = { classifyInvoiceWithLocalAI };
