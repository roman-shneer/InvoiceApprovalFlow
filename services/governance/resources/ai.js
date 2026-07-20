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
    const excessFields = [
        'notes',
        'note',
        'audit_metadata',
        'scenario',
        'expected',
        'status',
        'idempotency_key',
        'submitted_at',
        'correlation_id',
        'tracking_id',
        'createdAt',
        'date'];
    excessFields.forEach(field => {
        if (typeof cleanInvoice[field] !== 'undefined') {
            delete cleanInvoice[field];
        }
    });
    return cleanInvoice;
}

/**
 * Invoice auditing using a local AI model backed by a dynamic RAG context window
 * @param {Object} invoice - invoice object (total, category, vendor, etc.)
 * @param {String} dynamicPolicyContext - text segments retrieved dynamically from policy documents by the RAG engine
 * @returns {Promise<Object>} - { recommendation: "AUTO_APPROVE"|"HUMAN_REVIEW"|"REJECT", reason: "..." }
 */
async function classifyInvoiceWithLocalAI(invoice, dynamicPolicyContext) {

    // Construct system prompt embedding the dynamic text segments fetched via the RAG retrieval cursor   

    const systemPrompt = `You are an expert corporate FinOps Compliance Auditor. 
        Your task is to analyze the user's invoice payload against the following corporate policies extracted dynamically from the company's official handbook.
        
        ACTIVE CORPORATE POLICIES (RETRIEVED VIA RAG):
        ${dynamicPolicyContext || "No specific policy sections matched the query. Follow general financial guidelines."}
        
        STRICT EVALUATION RULES:
        1. Category Mapping: Policy rules starting with the prefix "MEAL-" (such as MEAL-01, MEAL-02, MEAL-03) belong directly to the "meals" invoice category. Treat this as a valid category match.
        2. Rule MEAL-03 Enforcement: If the invoice payload contains any indicators of alcohol, you MUST immediately add "MEAL-03" to the "triggered_rules" array.
        
        CRITICAL INSTRUCTIONS:
        - Evaluate if the invoice violates any of the active policies (check amounts, category constraints, and vendor names).
        - If an invoice amount is even $1 higher than a threshold specified in a rule, it is an AUTOMATIC VIOLATION.
        - You MUST respond strictly in valid JSON format. Do not write any conversational intro/outro text.
        - You have ZERO authority to make assumptions, exceptions, or compromises.
        - If ANY rule is violated or triggered, you MUST strictly recommend "HUMAN_REVIEW". "AUTO_APPROVE" is ONLY allowed if there are absolutely zero rule mismatches.
        - Never invent fictional rule IDs (like RULE-ID-101). Use ONLY the exact IDs found in the ACTIVE CORPORATE POLICIES text.
        
        The JSON object MUST follow this exact schema:
        {
          "recommendation": "AUTO_APPROVE" or "HUMAN_REVIEW",
          "reason": "Clear English explanation mentioning which specific rule ID or policy segment was evaluated or violated.",
          "confidence": 0.95,
          "triggered_rules": ["RULE-ID-1", "RULE-ID-2"]
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
                temperature: 0.1,
                top_p: 0.1,
                num_predict: 250,    // JSON-answer

                num_ctx: 512, //memory buffer
                num_thread: 4,//cpu count
            },
            format: 'json'
        });

        let rawContent = response.message.content.trim();
        console.log("Raw AI Response:", rawContent);

        // Defensive regex to strip markdown block ticks if Llama 3 hallucinates them
        if (rawContent.startsWith("```")) {
            rawContent = rawContent.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        }

        const aiResult = JSON.parse(rawContent);

        // Fallback guardrail for schema properties validation
        if (!['AUTO_APPROVE', 'HUMAN_REVIEW', 'REJECT'].includes(aiResult.recommendation)) {
            aiResult.recommendation = 'HUMAN_REVIEW';
        }

        // Custom override for critical workflow logic constraints
        if (aiResult.triggered_rules && aiResult.triggered_rules.includes('MEAL-03')) {
            aiResult.recommendation = 'REJECT';
        }

        return {
            aiRecommendation: aiResult.recommendation,
            recommendation: aiResult.recommendation,
            aiReason: aiResult.reason || "Evaluated by local RAG-augmented AI engine successfully.",
            reason: aiResult.reason || "Evaluated by local RAG-augmented AI engine successfully.",
            confidence: parseFloat(aiResult.confidence || 0),
            triggered_rules: Array.isArray(aiResult.triggered_rules) ? aiResult.triggered_rules : []
        };

    } catch (err) {
        // Safe failover to human queue if JSON parsing or connection fails
        return {
            recommendation: "HUMAN_REVIEW",
            reason: `Local RAG AI Analysis failed or timed out: ${err.message}. Forced routing to manual queue.`,
            confidence: 0,
            triggered_rules: []
        };
    }
}

module.exports = { classifyInvoiceWithLocalAI };
