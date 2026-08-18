process.env.GROQ_API_KEY = "";
process.env.GEMINI_API_KEY = "";
process.env.NODE_ENV = 'test';
process.env.DAPR_HTTP_HOST = "127.0.0.1";
process.env.DAPR_HTTP_PORT = "3505";
process.env.OLLAMA_API_URL = "http://127.0.0.1:11434";
//process.env.AI_MODEL_NAME = "phi3:3.8b";
process.env.AI_MODEL_NAME = "qwen2.5:7b-instruct-q5_K_M";
const { aiManager, anonymizeInvoice } = require('../../managers/aiManager');
const { getPolicies, getFxRate } = require('../../resources/db');
const { RagEngine } = require('../../resources/ragEngine');
const ragEngine = new RagEngine();
async function resolveFxRate(invoice) {
    if (invoice.currency !== 'USD') {
        const rateEntry = await getFxRate(invoice.currency, invoice.date);
        if (rateEntry && rateEntry.rate) {
            return rateEntry.rate;
        }
    }

    return 1;
}
async function checkInvoice(invoice) {

    const activeRules = await getPolicies();

    const rate = await resolveFxRate(invoice);
    const anonymizedInvoice = anonymizeInvoice(invoice, rate);

    const dynamicPolicyContext = await ragEngine.retrieveRelevantPolicies(invoice, activeRules);
    const provider = await aiManager();
    return await provider.requestModel(invoice.id, anonymizedInvoice, dynamicPolicyContext);
}

describe('aiManager Handler', () => {

    test('testing aiResponses via RAG', async () => {

        const invoice = {
            "id": "INV-1005",
            "submitter": "omar.farouk@northwind.example",
            "department": "sales-2026Q2",
            "vendor": "Trattoria Verde",
            "vendorKnown": true,
            "invoiceNumber": "NW-INV-7801",
            "currency": "USD",
            "category": "meals",
            "attendees": 4,
            "lineItems": [
                {
                    "description": "Team dinner",
                    "quantity": 4,
                    "unitPrice": 30.0
                }
            ],
            "taxAmount": 0.0,
            "total": 120.0,
            "receiptPresent": false,
            "date": "2026-05-14",
            "notes": "Receipt not attached.",
            "expected": {
                "route": "human_review",
                "violations": [
                    "GLOBAL-RECEIPT"
                ],
                "reason": "Missing required receipt (> $25). Missing info -> escalate; never auto-approve."
            }
        };

        const aiResponse = await checkInvoice(invoice);
        expect(aiResponse.route.toLowerCase()).toBe(invoice.expected.route.toLowerCase());
    }, 200000);
});