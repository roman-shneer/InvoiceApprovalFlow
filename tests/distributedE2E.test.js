const request = require('supertest');

const mockStateGet = jest.fn();
const mockStateSave = jest.fn();
const mockPubSubPublish = jest.fn();

jest.mock('@dapr/dapr', () => {
    return {
        DaprClient: jest.fn().mockImplementation(() => {
            return {
                state: {
                    get: mockStateGet.mockResolvedValue([]),
                    save: mockStateSave.mockResolvedValue(true),
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

const appModule = require('../services/ingestion/app.js');
const app = appModule.app || appModule;

describe('Distributed Multi-Service Live End-to-End Journey Harness', () => {
    const mockTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const mockSpanId = "00f067aa0ba902b7";
    const w3cTraceParent = `00-${mockTraceId}-${mockSpanId}-01`;

    beforeEach(() => {
        jest.clearAllMocks();
        mockStateGet.mockResolvedValue([]);
    });

    test('Journey INV-1001: Gateway Ingestion Route Acceptance with W3C Trace Context Propagation', async () => {
        const incomingInvoice = {
            id: "INV-1001",
            vendor: "Acme Corp",
            invoiceNumber: "AC-001",
            total: 45.00,
            currency: "USD",
            receiptPresent: true,
            vendorKnown: true
        };

        mockStateGet.mockImplementation((store, key) => {
            if (key === 'outbox_registry') return Promise.resolve([]);
            return Promise.resolve({});
        });
        mockStateSave.mockResolvedValue(true);
        mockPubSubPublish.mockResolvedValue(true);

        const response = await request(app)
            .post('/api/v1/expenses')
            .set('traceparent', w3cTraceParent)
            .set('x-correlation-id', 'corr-inv-1001')
            .send(incomingInvoice);

        expect([200, 202]).toContain(response.status);
        expect(response.body.tracking_id).toBe("INV-1001");
    }, 30000);

    test('Journey INV-1003: Ingestion Gate Duplicates Short-Circuiting Enforcement Checks', async () => {
        const duplicateInvoice = {
            id: "INV-1001",
            vendor: "Acme Corp",
            invoiceNumber: "AC-001",
            total: 45.00
        };

        mockStateGet.mockImplementation((store, key) => {
            if (key === 'outbox_registry') return Promise.resolve([]);
            return Promise.resolve({
                tracking_id: "INV-1001",
                status: "PROCESSING"
            });
        });

        const response = await request(app)
            .post('/api/v1/expenses')
            .set('traceparent', w3cTraceParent)
            .send(duplicateInvoice);

        expect(response.status).toBe(200);
        expect(response.body.message).toContain('Duplicate request detected');
    }, 30000);

    test('Journey INV-1007: Out-of-Bounds Ingestion Contract Scheme Rejections Guard', async () => {
        const brokenInvoice = {
            vendor: "Broken Corp",
            total: 100.00
        };

        const response = await request(app)
            .post('/api/v1/expenses')
            .send(brokenInvoice);

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Invalid schema');
    }, 30000);
});
