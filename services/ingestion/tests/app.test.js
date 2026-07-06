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

describe('Ingestion Service API Tests', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('POST /api/v1/expenses - Should return 400 if ID is missing', async () => {
        const invalidInvoice = {
            vendor: "City Cabs",
            total: 48.0
        };

        const response = await request(app)
            .post('/api/v1/expenses')
            .send(invalidInvoice);

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid schema. Required: id' });

        expect(mockStateGet).not.toHaveBeenCalled();
        expect(mockPubSubPublish).not.toHaveBeenCalled();
    });

    test('POST /api/v1/expenses - Should accept unique invoice and publish event', async () => {
        const validInvoice = {
            id: "INV-1016",
            vendor: "City Cabs",
            invoiceNumber: "CC-4410",
            total: 48.0
        };

        mockStateGet.mockResolvedValue({});
        mockStateSave.mockResolvedValue(true);
        mockPubSubPublish.mockResolvedValue(true);

        const response = await request(app)
            .post('/api/v1/expenses')
            .send(validInvoice);

        expect(response.status).toBe(202);
        expect(response.body).toEqual({
            tracking_id: "INV-1016",
            status: "ACCEPTED",
            message: "Invoice submitted successfully and queued for processing."
        });

        expect(mockStateGet).toHaveBeenCalledWith('approval-state', expect.any(String));

        expect(mockStateSave).toHaveBeenCalledWith('approval-state', [
            expect.objectContaining({
                key: expect.any(String),
                value: expect.objectContaining({
                    tracking_id: "INV-1016",
                    status: "PROCESSING"
                })
            })
        ]);

        expect(mockPubSubPublish).toHaveBeenCalledWith(
            'approval-pubsub',
            'invoice.submitted',
            expect.objectContaining({
                tracking_id: "INV-1016",
                vendor: "City Cabs",
                total: 48.0,
                invoiceNumber: "CC-4410",
                idempotency_key: expect.any(String),
                correlation_id: expect.any(String)
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
