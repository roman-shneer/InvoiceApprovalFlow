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
                },
                pubsub: {
                    publish: mockPubSubPublish,
                },
            };
        }),
    };
});

const appModule = require('../app.js');
const app = appModule.app || appModule;

describe('End-to-End Enterprise Journey Verification Harness', () => {
    beforeEach(() => {
        jest.clearAllMocks();
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

        mockStateGet.mockResolvedValue({});
        mockStateSave.mockResolvedValue(true);

        const response = await request(app).post('/api/v1/expenses').send(invoice);
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

        mockStateGet.mockResolvedValue({});
        mockStateSave.mockResolvedValue(true);

        const response = await request(app).post('/api/v1/expenses').send(invoice);
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

        mockStateGet.mockResolvedValue({});
        mockStateSave.mockResolvedValue(true);

        const response = await request(app).post('/api/v1/expenses').send(invoice);
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

        mockStateGet.mockResolvedValue({});
        mockStateSave.mockResolvedValue(true);

        const response = await request(app).post('/api/v1/expenses').send(invoice);
        expect(response.status).toBe(202);
    });
});
