const { groqProvider } = require('../resources/groqProvider');
const { ollamaProvider } = require('../resources/ollamaProvider');
const { geminiProvider } = require('../resources/geminiProvider');

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

    const userPrompt = `Analyze this invoice payload: ` + JSON.stringify(cleanInvoice);


    let provider;
    if (process.env.GROQ_API_KEY != null && process.env.GROQ_API_KEY.trim() !== "") {
        provider = new groqProvider();
    } else if (process.env.GEMINI_API_KEY != null && process.env.GEMINI_API_KEY.trim() !== "") {
        provider = new geminiProvider();
    }
    else {
        provider = new ollamaProvider();
    }
    const systemPrompt = provider.generateSystemPrompt(dynamicPolicyContext);
    console.log(`[${invoice.tracking_id}]SystemPrompt: ${systemPrompt}`);
    console.log(`[${invoice.tracking_id}]UserPrompt: ${userPrompt}`);
    const result = await provider.requestModel(systemPrompt, userPrompt);
    if (result.triggered_rules && result.triggered_rules.includes('MEAL-03')) {
        result.recommendation = 'REJECT';
    }

    console.log("aiManager", result);
    return result;
}

module.exports = { aiManager };
