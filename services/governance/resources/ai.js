const { Ollama } = require('ollama');

const ollama = new Ollama({ host: 'http://ollama-service:11434' });


/**
 * Anonymizes sensitive data in an invoice object.
 * 
 * @param {Object} invoice - Исходный объект инвойса
 * @returns {Object} Абсолютно новый объект с замаскированными данными
 */
function anonymizeInvoice(invoice) {
    if (!invoice || typeof invoice !== 'object') return invoice;

    let cleanInvoice = JSON.parse(JSON.stringify(invoice));

    if (cleanInvoice.submitter && typeof cleanInvoice.submitter === 'string') {
        cleanInvoice.submitter = cleanInvoice.submitter.replace(
            /([^@]{1,2})[^@]*([^@]{1,2})@(.*)/,
            (match, first, last, domain) => `${first}***${last}@${domain}`
        );
    }

    const maskId = (id) => id ? `MASKED-${btoa(String(id)).substring(0, 8)}` : id;

    if (cleanInvoice.id) cleanInvoice.id = maskId(cleanInvoice.id);
    if (cleanInvoice.invoiceNumber) cleanInvoice.invoiceNumber = maskId(cleanInvoice.invoiceNumber);
    if (cleanInvoice.notes) {
        delete cleanInvoice.notes;
    }
    if (cleanInvoice.note) {
        delete cleanInvoice.note;
    }
    if (cleanInvoice.scenario) {
        delete cleanInvoice.scenario;
    }
    if (cleanInvoice.expected) {
        delete cleanInvoice.expected;
    }

    return cleanInvoice;
}


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
        return ruleCategory == 'global rules' || ruleCategory.includes(category);
    });
    const formattedRules = relevantRules
        .map((r, index) => `${index + 1}. [${r.rule_id}] Category: ${r.category} -> Requirement: ${r.rule_text}`)
        .join('\n');


    const systemPrompt = `You are an expert corporate FinOps Compliance Auditor. 
Your task is to analyze the user's invoice payload against the active corporate policies.

ACTIVE CORPORATE POLICIES:
${formattedRules || "No specific rules provided. Follow general financial guidelines."}

CRITICAL INSTRUCTIONS:
- Evaluate if the invoice violates any of the active policies (check amounts, category constraints, and vendor names).
- LINE ITEM AUDIT MANDATE: You MUST closely read the "Description" field of every single row inside the "lineItems" array.
- UNALLOWABLE EXPENSES DETECTOR: If any line item description contains explicit restricted corporate keywords like "Alcohol", "Bar tab", "Liquor", "Wine", "Beer", "Gift", "Casino", or "Luxury", this is an AUTOMATIC VIOLATION (MEAL-03) regardless of the overall category or amount. You MUST return "REJECT".
- If no rules are violated and the metadata looks normal, recommend "AUTO_APPROVE".
- If any corporate rule is violated, or if the data feels anomalous, recommend "HUMAN_REVIEW".
- You MUST respond strictly in valid JSON format. Do not write any conversational intro/outro text.
- You are a rigid compliance validator, NOT a decision-maker. You have ZERO authority to make assumptions, exceptions, or compromises.
- If an invoice amount is even $1 higher than a threshold specified in a rule, it is an AUTOMATIC VIOLATION.
- DO NOT apply "safe assumptions" based on the vendor name or receipt presence if a numeric limit is breached.

## GLOBAL-RECEIPT LOGIC EXCLUSION (CRITICAL):
The "GLOBAL-RECEIPT" rule states that a receipt is required for expenses over $25. 
If the invoice "total" is higher than $25, but "receiptPresent" is explicitly equal to true (or "Yes"), this is a PERFECT COMPLIANCE MATCH. It is NOT a violation. 
In this exact scenario, do NOT trigger any violations, and recommend "AUTO_APPROVE" (assuming no other rules are broken). Keep math accurate: $42 is LESS than $75, so MEAL-01 is compliant.

The JSON object MUST follow this exact schema:
{
  "recommendation": "AUTO_APPROVE" | "HUMAN_REVIEW" | "REJECT",
  "confidence": 0.95,
  "reason": "Clear English explanation mentioning which specific rule ID was evaluated or violated.",
  "triggered_rules": ["RULE_ID_1", "RULE_ID_2"]
}`;
    //notes, scenario,expected

    const invoiceDetails = anonymizeInvoice(invoice);

    const userPrompt = `Analyze this invoice payload: ` + JSON.stringify(invoiceDetails);

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
        if (!['AUTO_APPROVE', 'HUMAN_REVIEW', 'REJECT'].includes(aiResult.recommendation)) {
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
