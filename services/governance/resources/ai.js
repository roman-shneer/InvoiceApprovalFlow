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
        return ['global rules', 'autonomy'].includes(ruleCategory) || ruleCategory.includes(category);
    });
    const formattedRules = relevantRules
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
- You are a rigid compliance validator, NOT a decision-maker. You have ZERO authority to make assumptions, exceptions, or compromises.
- If an invoice amount is even $1 higher than a threshold specified in a rule, it is an AUTOMATIC VIOLATION.
- DO NOT apply "safe assumptions" based on the vendor name (like DataDog) or receipt presence if a numeric limit is breached.
- If ANY rule is violated, you MUST strictly recommend "HUMAN_REVIEW". "AUTO_APPROVE" is ONLY allowed if there are absolutely zero rule mismatches.
- GLOBAL-RECEIPT LOGIC EXCLUSION: The "GLOBAL-RECEIPT" rule states that a receipt is required for expenses over $25. If the invoice "Total" is higher than $25, but "Receipt Present" is explicitly equal to "Yes" or true, this is a PERFECT COMPLIANCE MATCH. It is NOT a violation. You MUST recommend "AUTO_APPROVE" if no other rules are broken.


The JSON object MUST follow this exact schema:
{
"recommendation": "AUTO_APPROVE" or "HUMAN_REVIEW",
"confidence": 0.95,
"reason": "Clear English explanation mentioning which specific rule ID was evaluated or violated."
"triggered_rules": ["RULE_ID_1", "RULE_ID_2"] // List of rule IDs that were violated, if any. Empty array if none.
}`;

    const userPrompt = `Analyze this invoice payload: ` + JSON.stringify(invoice);

    console.log("***systemPrompt", systemPrompt);
    console.log("***userPrompt", userPrompt);
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

        let rawContent = response.message.content.trim();

        // FIX 2: Defensive regex to strip markdown block ticks if Llama 3 hallucinates them
        if (rawContent.startsWith("```")) {
            rawContent = rawContent.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        }

        const aiResult = JSON.parse(rawContent);
        console.log("***AI answer", invoice.tracking_id, aiResult);
        // Fallback guardrail for schema properties validation
        if (!['AUTO_APPROVE', 'HUMAN_REVIEW'].includes(aiResult.recommendation)) {
            aiResult.recommendation = 'HUMAN_REVIEW';
        }

        return {
            recommendation: aiResult.recommendation,
            reason: aiResult.reason || "Evaluated by local AI engine successfully.",
            confidence: parseFloat(aiResult.confidence || 0),
            triggered_rules: Array.isArray(aiResult.triggered_rules) ? aiResult.triggered_rules : []
        };

    } catch (err) {
        // Safe failover to human queue if JSON parsing or connection fails
        return {
            recommendation: "HUMAN_REVIEW",
            reason: `Local AI Analysis failed or timed out: ${err.message}. Forced routing to manual queue.`,
            confidence: 0,
            triggered_rules: []
        };
    }
}

module.exports = { classifyInvoiceWithLocalAI };
