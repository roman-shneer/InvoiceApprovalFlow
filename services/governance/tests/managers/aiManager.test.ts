jest.mock('../../resources/db', () => ({
    getPolicies: jest.fn().mockResolvedValue([]),
    getFxRate: jest.fn().mockResolvedValue({ rate: 1 }),
}));

jest.mock('../../resources/ragEngine', () => ({
    RagEngine: jest.fn().mockImplementation(() => ({
        retrieveRelevantPolicies: jest.fn().mockResolvedValue([]),
        close: jest.fn()
    }))
}));

process.env.GROQ_API_KEY = "";
process.env.GEMINI_API_KEY = "";
process.env.NODE_ENV = 'test';
process.env.DAPR_HTTP_HOST = "127.0.0.1";
process.env.DAPR_HTTP_PORT = "3505";
process.env.OLLAMA_API_URL = "http://127.0.0.1:11434";
process.env.AI_MODEL_NAME = "qwen2.5:7b-instruct-q5_K_M";

import { aiManager, anonymizeInvoice } from '../../managers/aiManager';
import { getPolicies, getFxRate } from '../../resources/db';
import { RagEngine } from '../../resources/ragEngine';

// ---- INLINE TYPES ----
interface LineItem {
    description: string;
    quantity: number;
    unitPrice: number;
}

interface Invoice {
    id: string;
    submitter: string;
    department: string;
    vendor: string;
    vendorKnown: boolean;
    invoiceNumber: string;
    currency: string;
    category: string;
    attendees: number;
    lineItems: LineItem[];
    taxAmount: number;
    total: number;
    receiptPresent: boolean;
    date: string;
    notes: string;
    expected: {
        route: string;
        violations: string[];
        reason: string;
    };
    [key: string]: any;
}

interface FxRateEntry {
    rate: number;
}

const ragEngine = new (RagEngine as any)();

async function resolveFxRate(invoice: Invoice): Promise<number> {
    if (invoice.currency !== 'USD') {
        const rateEntry = await (getFxRate as jest.Mock).mock.results[0]?.value || await getFxRate(invoice.currency, invoice.date) as FxRateEntry;
        // прямой вызов замоканый
        const entry = await getFxRate(invoice.currency, invoice.date) as FxRateEntry;
        if (entry && entry.rate) {
            return entry.rate;
        }
    }
    return 1;
}

async function checkInvoice(invoice: Invoice) {
    const activeRules = await getPolicies();
    const rate = await resolveFxRate(invoice);
    const anonymizedInvoice = anonymizeInvoice(invoice as any, rate);
    const dynamicPolicyContext = await ragEngine.retrieveRelevantPolicies(invoice, activeRules);
    const provider = await aiManager();
    return await provider.requestModel(invoice.id, anonymizedInvoice as any, dynamicPolicyContext);
}

describe('aiManager Handler', () => {
    test('testing aiResponses via RAG', async () => {
        const invoice: Invoice = {
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
        expect(aiResponse.recommendation.toLowerCase()).toBe(invoice.expected.route.toLowerCase());
    }, 200000);
});

let httpServer: any;
afterAll(async () => {
    if (httpServer && httpServer.close) {
        await new Promise<void>(r => httpServer.close(() => r()));
    }
});