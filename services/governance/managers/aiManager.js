const { groqProvider } = require('../resources/groqProvider');
const { ollamaProvider } = require('../resources/ollamaProvider');
const { geminiProvider } = require('../resources/geminiProvider');

function anonymizeInvoice(invoice, rate) {
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

    cleanInvoice.calculatedLineItemsSum = cleanInvoice.lineItems?.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    cleanInvoice.discrepancy = cleanInvoice.calculatedLineItemsSum + (cleanInvoice.taxAmount || 0) - (cleanInvoice.total || 0);

    if (invoice.currency != 'USD') {
        cleanInvoice.amountInUSD = cleanInvoice.total * rate;
    }

    return cleanInvoice;
}


async function aiManager(tracking_id, invoice, dynamicPolicyContext) {
    const userPrompt = `Analyze this invoice payload: ` + JSON.stringify(invoice);


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
    console.log(`[${tracking_id}]SystemPrompt: ${systemPrompt}` + "\n");
    console.log(`[${tracking_id}]UserPrompt: ${userPrompt}` + "\n");
    const result = await provider.requestModel(systemPrompt, userPrompt);
    console.log(`[${tracking_id}] AI Model Result: ${JSON.stringify(result)}` + "\n");
    return result;
}

module.exports = { aiManager, anonymizeInvoice };
