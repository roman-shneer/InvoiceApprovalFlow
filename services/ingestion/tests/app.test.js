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

function generateMockTestToken() {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString('base64');
    const futureExp = Math.floor(Date.now() / 1000) + 86400; // 1 day lifetime
    const payload = Buffer.from(JSON.stringify({ role: 'submitter', exp: futureExp })).toString('base64');
    return `${header}.${payload}.mock_signature_hash_bytes`;
}

describe('Ingestion Service API Tests', () => {
    let mockToken;

    beforeEach(() => {
        jest.clearAllMocks();
        mockToken = generateMockTestToken();
    });

    test('POST /api/v1/expenses - Should return 400 if ID is missing', async () => {
        const invalidInvoice = {
            vendor: "City Cabs",
            total: 48.0
        };

        const response = await request(app)
            .post('/api/v1/expenses')
            .set('Authorization', `Bearer ${mockToken}`)
            .send(invalidInvoice);

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid schema. Required: id' });

        expect(mockStateGet).not.toHaveBeenCalled();
        expect(mockPubSubPublish).not.toHaveBeenCalled();
    });

    test('POST /api/v1/expenses - Should accept unique invoice and dispatch outbox event', async () => {
        const validInvoice = {
            id: "INV-1016",
            vendor: "City Cabs",
            invoiceNumber: "CC-4410",
            total: 48.0
        };

        mockStateGet.mockResolvedValue(null);
        mockStateSave.mockResolvedValue(true);
        mockPubSubPublish.mockResolvedValue(true);

        const response = await request(app)
            .post('/api/v1/expenses')
            .set('Authorization', `Bearer ${mockToken}`)
            .send(validInvoice);

        expect(response.status).toBe(202);
        expect(response.body).toEqual({
            tracking_id: "INV-1016",
            status: "ACCEPTED",
            message: "Invoice submitted successfully and queued for processing."
        });

        expect(mockStateGet).toHaveBeenCalledWith('approval-state', expect.any(String));

        expect(mockStateSave).toHaveBeenCalledWith('approval-state', expect.arrayContaining([
            expect.objectContaining({
                key: expect.any(String),
                value: expect.objectContaining({
                    tracking_id: "INV-1016",
                    status: "PROCESSING"
                })
            })
        ]));

        expect(mockPubSubPublish).toHaveBeenCalledWith(
            'approval-pubsub',
            'invoice.submitted',
            expect.objectContaining({
                tracking_id: 'INV-1016',
                vendor: 'City Cabs',
                invoiceNumber: 'CC-4410',
                total: 48
            })
        );
    });

    test('POST /api/v1/expenses - Should short-circuit and return 200 on duplicate invoice', async () => {
        const duplicateInvoice = {
            id: "INV-1016",
            vendor: "City Cabs",
            invoiceNumber: "CC-4410",
            total: 48.0
        };

        mockStateGet.mockResolvedValue({
            tracking_id: "INV-1016",
            correlation_id: "corr_original_123",
            status: "PROCESSING"
        });

        const response = await request(app)
            .post('/api/v1/expenses')
            .set('Authorization', `Bearer ${mockToken}`)
            .send(duplicateInvoice);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            tracking_id: "INV-1016",
            status: "PROCESSING",
            message: 'Duplicate request detected. Invoice is already being processed.'
        });

        expect(mockStateSave).not.toHaveBeenCalled();
        expect(mockPubSubPublish).not.toHaveBeenCalled();
    });

    test('GET /unknown-route - Should return 404', async () => {
        const response = await request(app).get('/unknown-route');
        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: 'Not Found' });
    });
});
