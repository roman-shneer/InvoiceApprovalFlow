const { groqProvider } = require('../resources/groqProvider');
const { ollamaProvider } = require('../resources/ollamaProvider');

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
        'invoiceNumber',
        'submitter',
        'department',
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


async function aiManager(invoice, dynamicPolicyContext) {
    const cleanInvoice = anonymizeInvoice(invoice);
    /*
     const systemPrompt = `You are an expert corporate FinOps Compliance Auditor. 
Your task is to analyze the user's invoice payload against the following corporate policies extracted dynamically from the company's official handbook.

[ACTIVE CORPORATE POLICIES (RETRIEVED VIA RAG)]
<policies>
${dynamicPolicyContext || "No specific policy sections matched the query. Follow general financial guidelines."}
</policies>

STRICT EVALUATION RULES:
1. Category Mapping: Policy rules starting with the prefix "MEAL-" (such as MEAL-01, MEAL-02, MEAL-03) belong directly to the "meals" invoice category. Treat this as a valid category match.
2. Rule MEAL-03 Enforcement: If the invoice payload contains any indicators of alcohol, you MUST immediately add "MEAL-03" to the "triggered_rules" array.

CRITICAL INSTRUCTIONS:
- Evaluate if the invoice violates any of the active policies (check amounts, category constraints, and vendor names).
- If an invoice amount is even $1 higher than a threshold specified in a rule, it is an AUTOMATIC VIOLATION.
- You MUST respond strictly in valid JSON format. Do not write any conversational intro/outro text.
- You have ZERO authority to make assumptions, exceptions, or compromises.
- If ANY rule is violated or triggered, you MUST strictly recommend "HUMAN_REVIEW". "AUTO_APPROVE" is ONLY allowed if there are absolutely zero rule mismatches.
- Use ONLY the exact IDs found in the ACTIVE CORPORATE POLICIES text.

The JSON object MUST follow this exact schema:
{
    "thought_process": "Step-by-step math comparison. Example: 1. Invoice category is 'hardware', which matches Rule HW-02. 2. Total is 1400. 3. Rule HW-02 threshold is 1000. 4. 1400 > 1000 is TRUE, so HW-02 is triggered.",
    "recommendation": "AUTO_APPROVE" or "HUMAN_REVIEW",
    "reason": "Clear English explanation mentioning which specific rule ID or policy segment was evaluated or violated.",
    "confidence": 0.80,// A float between 0 and 1 indicating your confidence in the recommendation.
    "triggered_rules": []// An array of rule IDs that were triggered or violated. If none, return an empty array.
}`;
*/
    const systemPrompt = `You are an expert corporate FinOps Compliance Auditor. 
Your task is to analyze the user's invoice payload against the following corporate policies extracted dynamically from the company's official handbook.

[ACTIVE CORPORATE POLICIES (RETRIEVED VIA RAG)]
<policies>
${dynamicPolicyContext || "No specific policy sections matched the query. Follow general financial guidelines."}
</policies>

[STRICT EVALUATION RULES]
1. CASE-INSENSITIVITY: Treat category names as case-insensitive.
2. TRUST THE PAYLOAD: Do not recalculate or validate if (quantity * unitPrice + tax) equals the total. Strictly use the provided "total" field value as the absolute truth for all rule evaluations.
3. ALCOHOL DETECTION: If any line item description contains "Alcohol", "bar tab", "wine", or "beer", trigger Rule MEAL-03.
4. UNKNOWN CATEGORIES: If the invoice contains a category that is NOT explicitly mentioned or mapped in the <policies> block, you MUST treat it as a violation, add "UNKNOWN_CATEGORY" to the "triggered_rules" array, and route it to human review.

[STRICT VERDICT MAPPING]
You must apply this absolute mathematical logic for the final recommendation:
- If "triggered_rules" IS EMPTY -> "recommendation" MUST BE "AUTO_APPROVE".
- If "triggered_rules" HAS ANY ELEMENTS -> "recommendation" MUST BE "HUMAN_REVIEW".
There are zero exceptions. A non-empty array strictly locks the verdict to "HUMAN_REVIEW".

[JSON SCHEMA]
You MUST respond strictly in valid JSON format. Do not wrap the JSON in markdown blocks. Output raw JSON only. 
CRITICAL: The "thought_process" field MUST contain ONLY the rule IDs evaluated. Maximum 5 words. Do not write math explanations.

{
    "thought_process": "Evaluating MEAL-03 and GLOBAL-VENDOR",
    "triggered_rules": [],
    "reason": "Short 1-sentence compliance verdict.",
    "confidence": 1.0,
    "recommendation": "Either 'AUTO_APPROVE' or 'HUMAN_REVIEW'"
}
`;

    console.log(`[${invoice.tracking_id}]SystemPrompt: ${systemPrompt}`);

    const userPrompt = `Analyze this invoice payload: ` + JSON.stringify(cleanInvoice);
    console.log(`[${invoice.tracking_id}]UserPrompt: ${userPrompt}`);

    let result;

    if (process.env.GROQ_API_KEY != null && process.env.GROQ_API_KEY.trim() !== "") {
        result = await groqProvider(systemPrompt, userPrompt);
    } else {
        result = await ollamaProvider(systemPrompt, userPrompt);
    }
    if (result.triggered_rules && result.triggered_rules.includes('MEAL-03')) {
        result.recommendation = 'REJECT';
    }

    console.log("aiManager", result);
    return result;
}

module.exports = { aiManager };
