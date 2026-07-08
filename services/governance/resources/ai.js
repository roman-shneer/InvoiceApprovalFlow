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
Analyze the invoice JSON and output strictly valid JSON matching the schema. No conversational text.

ACTIVE POLICIES:
${formattedRules || "No specific rules provided. Follow general financial guidelines."}

CRITICAL TEXT BLACKLIST:
Prohibited keywords: "Alcohol", "Bar tab", "Liquor", "Wine", "Beer", "Gift", "Casino", "Luxury".

RULES FOR RECOMMENDATION (Apply strictly):

- IF any line item description contains a word from the CRITICAL TEXT BLACKLIST -> Return "REJECT" and ["GLOBAL-FRAUD"].

- ELSE IF the total amount is higher than the policy limit ($200 for saas, $250 for travel) -> Return "HUMAN_REVIEW" and ["SAAS-01"] or ["TRAVEL-01"].

- ELSE IF vendorKnown == false OR math fails OR receipt is missing -> Return "HUMAN_REVIEW" and the broken rule ID.

- ELSE -> Return "AUTO_APPROVE" and [].

OUTPUT FORMAT (Strict JSON only):
{
  "recommendation": "AUTO_APPROVE" | "HUMAN_REVIEW" | "REJECT",
  "confidence": 0.99,
  "reason": "Clear explanation of the rule status.",
  "triggered_rules": []
}
`;
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
