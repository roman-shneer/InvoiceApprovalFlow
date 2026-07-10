const { Ollama } = require('ollama');

const ollama = new Ollama({ host: 'http://ollama-service:11434' });


/**
 * Anonymizes sensitive data in an invoice object.
 * 
 * @param {Object} invoice - Original invoice object
 * @returns {Object} new object with sensitive fields anonymized or removed
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
    const excessFields = ['notes', 'note', 'scenario', 'expected', 'status', 'idempotency_key', 'submitted_at', 'correlation_id', 'tracking_id', 'createdAt', 'date'];
    excessFields.forEach(field => {
        if (typeof cleanInvoice[field] !== 'undefined') {
            delete cleanInvoice[field];
        }
    });
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
        return ['global rules', 'autonomy'].includes(ruleCategory) || ruleCategory.includes(category);
        // return ruleCategory.includes(category);
    });
    const formattedRules = relevantRules
        //.map((r, index) => `${index + 1}. [${r.rule_id}] Category: ${r.category} -> Requirement: ${r.rule_text}`)
        .map((r, index) => `[${r.rule_id}] Category: ${r.category} -> Requirement: ${r.rule_text}`)
        .join('\n');
    /*
      const systemPrompt = `You are a rigid corporate FinOps Compliance Auditor for Northwind Components Ltd. 
  Your task is to analyze the provided invoice JSON against the official corporate policies and output a strictly valid JSON response. 
      
  ### CRITICAL PROCESSING STEP (Chain of Thought Validation):
  Before generating the final recommendation, you MUST evaluate the invoice using this exact 3-step logic:
  1. Hard-Stops Check: Is the vendor unknown? Is currency non-USD and total > 1000? Does math fail? Is a required receipt missing? If ANY is true, it is an AUTOMATIC violation.
  2. Category Limits Check: Check specific category rules (e.g., SAAS-01 max \$200, MEAL-01 max \$75/attendee, HW-01 max \$1000). If a limit is breached, it is an AUTOMATIC violation.
  3. Autonomy Ceiling Check: Look at the invoice "total" amount. If (total > 250), you MUST recommend "HUMAN_REVIEW", even if confidence is 1.0 and the vendor is well-known. No exceptions.
  
  ### ACTIVE CORPORATE POLICIES:
  
  ${formattedRules || ""}
  
  [GLOBAL-RECEIPT] A receipt is required for any expense over \$25. (If total > 25 AND receiptPresent is false, flag this rule).
  [GLOBAL-VENDOR] A new / unknown vendor (vendorKnown == false) is ALWAYS reviewed by a human, regardless of amount.
  [GLOBAL-FX] Converted foreign-currency items over \$1,000 force a human stop.
  [GLOBAL-MATH] The line items + taxAmount must reconcile exactly to total. (Sum of all lineItems quantity * unitPrice) + taxAmount == total.
  [GLOBAL-FRAUD] Fraud-pattern signals (round-numbers to brand-new vendors, no line-item detail) are a hard stop.
  
  [AUTONOMY-CEILING] Maximum total amount allowed for automatic approval is \$250. If total > 250, recommend HUMAN_REVIEW.
  [AUTONOMY-CONFIDENCE] Minimum required evaluation confidence threshold is 0.80.
  
  ### STRICT COMPLIANCE RULES:
  - You are a validator, NOT a decision-maker. You have ZERO authority to make assumptions or exceptions.
  - If an amount is even \$1 higher than a threshold, it is an AUTOMATIC VIOLATION.
  - If ANY rule is violated or the total > 250, you MUST return "recommendation": "HUMAN_REVIEW" and list the broken rule IDs in "triggered_rules".
  - "AUTO_APPROVE" is only allowed if absolutely ZERO rules are broken AND total <= 250 AND confidence >= 0.80.
  
  ### OUTPUT FORMAT (Strict JSON only, no trailing commas):
  {
    "recommendation": "AUTO_APPROVE" or "HUMAN_REVIEW",
    "confidence": 1.0,
    "reason": "Clear English explanation mentioning which specific rule ID was evaluated or violated.",
    "triggered_rules": ["RULE-ID-1", "RULE-ID-2"]
  }`;
  */

    const systemPrompt = `You are a rigid corporate FinOps Compliance Auditor. 
Analyze the invoice JSON and output strictly valid JSON matching the schema. No conversational text. Do not duplicate your thoughts.

ACTIVE POLICIES:
${formattedRules || "No specific rules provided. Follow general financial guidelines."}

OUTPUT FORMAT (Strict JSON only, no trailing commas):
{
  "recommendation": "AUTO_APPROVE" | "HUMAN_REVIEW" | "REJECT",
  "confidence": 0.99,
  "reason": "One concise sentence explaining the exact rule matching.",
  "triggered_rules": []
}`;
    console.log("SystemPrompt:", systemPrompt);
    const invoiceDetails = anonymizeInvoice(invoice);
    const userPrompt = `Analyze this invoice payload: ` + JSON.stringify(invoiceDetails);
    console.log("UserPrompt:", userPrompt);
    try {
        const response = await ollama.chat({
            model: process.env.AI_MODEL_NAME || 'llama3',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            options: {
                temperature: 0.0,
                top_p: 0.1,
                num_predict: 400,
            },
            format: 'json'
        });

        let rawContent = response.message.content.trim();
        console.log("Raw AI Response:", rawContent);
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
