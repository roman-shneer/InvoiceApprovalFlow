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
    if (cleanInvoice.status) {
        delete cleanInvoice.status;
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


    const systemPrompt = `You are a rigid corporate FinOps Compliance Auditor. 
Analyze the invoice JSON and output strictly valid JSON matching the schema. No conversational text. Do not duplicate your thoughts.

ACTIVE POLICIES:
${formattedRules || "No specific rules provided. Follow general financial guidelines."}

RULES FOR RECOMMENDATION (Apply strictly from top to bottom):

- EXPLICIT ALCOHOL DETECTOR: Closely read the "description" field of every row inside "lineItems". If any description contains any of these exact words: "Alcohol", "Bar tab", "Liquor", "Wine", "Beer" -> You MUST immediately return "REJECT" and log ["GLOBAL-FRAUD"] in triggered_rules.

- CRITICAL ALLOWED SOFTWARE: Common corporate IT and SaaS tool names (such as "Jira", "Atlassian", "DataDog", "Slack", "AWS", "Zoom", "Github") are fully ALLOWED. Do NOT flag them as violations under any circumstances.

- ELSE IF vendorKnown == false OR receiptPresent == false OR math fails -> Return "HUMAN_REVIEW" and list ALL broken rule IDs in "triggered_rules".

- ELSE -> Return "AUTO_APPROVE" and [].

OUTPUT FORMAT (Strict JSON only, no trailing commas):
{
  "recommendation": "AUTO_APPROVE" | "HUMAN_REVIEW" | "REJECT",
  "confidence": 0.99,
  "reason": "One concise sentence explaining the exact rule matching.",
  "triggered_rules": []
}
`;


    //notes, scenario,expected

    const invoiceDetails = anonymizeInvoice(invoice);

    const userPrompt = `Analyze this invoice payload: ` + JSON.stringify(invoiceDetails);

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
