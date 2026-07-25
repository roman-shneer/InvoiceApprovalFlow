process.env.GROQ_API_KEY = "";
process.env.GEMINI_API_KEY = "";
process.env.NODE_ENV = 'test';
process.env.DAPR_HTTP_HOST = "127.0.0.1";
process.env.DAPR_HTTP_PORT = "3505";
process.env.OLLAMA_API_URL = "http://127.0.0.1:11434";
//process.env.AI_MODEL_NAME = "qwen2.5:3b-instruct-q4_K_M";
process.env.AI_MODEL_NAME = "qwen2.5:7b-instruct-q3_K_M";
const { aiManager, anonymizeInvoice } = require('../../managers/aiManager');
const { getPolicies } = require('../../resources/db');
const { RagEngine } = require('../../resources/ragEngine');
const ragEngine = new RagEngine();

async function checkInvoice(invoice) {

    const activeRules = await getPolicies();

    const rate = 1;
    const anonymizedInvoice = anonymizeInvoice(invoice, rate);

    const dynamicPolicyContext = await ragEngine.retrieveRelevantPolicies(invoice, activeRules);
    const provider = await aiManager();
    return await provider.requestModel(invoice.id, anonymizedInvoice, dynamicPolicyContext);
}

describe('aiManager Handler', () => {

    test('testing aiResponses via RAG', async () => {

        const invoice = {
            "id": "INV-1015",
            "submitter": "dana.cohen@northwind.example",
            "department": "sales-2026Q2",
            "vendor": "Bistro 19",
            "vendorKnown": true,
            "invoiceNumber": "NW-INV-7820",
            "currency": "USD",
            "category": "meals",
            "attendees": 2,
            "lineItems": [
                {
                    "description": "Alcohol-only bar tab",
                    "quantity": 1,
                    "unitPrice": 60.0
                }
            ],
            "taxAmount": 0.0,
            "total": 60.0,
            "receiptPresent": true,
            "date": "2026-05-18",
            "notes": "Alcohol-only receipt; use this to exercise the reject route.",
            "scenario": "reject:not-reimbursable",
            "expected": {
                "route": "reject",
                "violations": [
                    "MEAL-03"
                ],
                "reason": "Alcohol-only receipts are not reimbursable. Reject regardless of amount."
            }
        };

        const aiResponse = await checkInvoice(invoice);
        expect(aiResponse.recommendation.toLowerCase()).toBe('human_review');
    }, 120000);
});