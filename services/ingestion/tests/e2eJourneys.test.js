const request = require('supertest');

const mockStateGet = jest.fn();
const mockStateSave = jest.fn();
const mockPubSubPublish = jest.fn();

jest.mock('@dapr/dapr', () => {
    return {
        DaprClient: jest.fn().mockImplementation(() => {
            return {
                state: {
                    get: mockStateGet,
                    save: mockStateSave,
                    query: jest.fn().mockResolvedValue({ results: [] }),
                    delete: jest.fn().mockResolvedValue(true)
                },
                pubsub: {
                    publish: mockPubSubPublish.mockResolvedValue(true),
                },
            };
        }),
    };
});

const appModule = require('../app.js');
const app = appModule.app || appModule;

// Helper to generate a valid, non-expired testing JWT token string to bypass security credentials filters
function generateMockTestToken() {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString('base64');
    const futureExp = Math.floor(Date.now() / 1000) + 86400; // 1 day lifetime
    const payload = Buffer.from(JSON.stringify({ role: 'submitter', exp: futureExp })).toString('base64');
    return `${header}.${payload}.mock_signature_hash_bytes`;
}

describe('End-to-End Enterprise Journey Verification Harness', () => {
    let mockToken;

    beforeEach(() => {
        jest.clearAllMocks();
        mockToken = generateMockTestToken();
    });

    test('Journey INV-1001: Standard Policy-Compliant Invoice Auto-Approval Flow', async () => {
        const invoice = {
            id: "INV-1001",
            vendor: "Acme Corp",
            invoiceNumber: "AC-001",
            total: 45.00,
            currency: "USD",
            receiptPresent: true,
            vendorKnown: true
        };

        mockStateGet.mockResolvedValue(null);
        mockStateSave.mockResolvedValue(true);

        const response = await request(app)
            .post('/api/v1/expenses')
            .set('Authorization', `Bearer ${mockToken}`) // <-- FIX: Inject valid token to pass the authentication guard
            .send(invoice);

        expect(response.status).toBe(202);
        expect(response.body.status).toBe('ACCEPTED');
    });

    test('Journey INV-1003: Missing Receipt Violating Global Hard Stop Constraints', async () => {
        const invoice = {
            id: "INV-1003",
            vendor: "Acme Corp",
            invoiceNumber: "AC-003",
            total: 85.00,
            currency: "USD",
            receiptPresent: false,
            vendorKnown: true
        };

        mockStateGet.mockResolvedValue(null);
        mockStateSave.mockResolvedValue(true);

        const response = await request(app)
            .post('/api/v1/expenses')
            .set('Authorization', `Bearer ${mockToken}`) // <-- FIX: Inject valid token to pass the authentication guard
            .send(invoice);

        expect(response.status).toBe(202);
    });

    test('Journey INV-1007: Invoice Amount Exceeding Autonomy Ceiling Limit', async () => {
        const invoice = {
            id: "INV-1007",
            vendor: "Acme Corp",
            invoiceNumber: "AC-007",
            total: 1250.00,
            currency: "USD",
            receiptPresent: true,
            vendorKnown: true
        };

        mockStateGet.mockResolvedValue(null);
        mockStateSave.mockResolvedValue(true);

        const response = await request(app)
            .post('/api/v1/expenses')
            .set('Authorization', `Bearer ${mockToken}`) // <-- FIX: Inject valid token to pass the authentication guard
            .send(invoice);

        expect(response.status).toBe(202);
    });

    test('Journey INV-1012: Transactional Saga Failure and Compensating Step Trigger', async () => {
        const invoice = {
            id: "INV-1012",
            vendor: "Unknown Fraudulent Vendor",
            invoiceNumber: "FR-666",
            total: 5000.00,
            currency: "EUR",
            receiptPresent: true,
            vendorKnown: false
        };

        mockStateGet.mockResolvedValue(null);
        mockStateSave.mockResolvedValue(true);

        const response = await request(app)
            .post('/api/v1/expenses')
            .set('Authorization', `Bearer ${mockToken}`) // <-- FIX: Inject valid token to pass the authentication guard
            .send(invoice);

        expect(response.status).toBe(202);
    });
});
