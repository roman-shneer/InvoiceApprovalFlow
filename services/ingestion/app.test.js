import request from 'supertest';
import { jest } from '@jest/globals';

// 1. Create mocks for DaprClient before importing the application
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

// Import our Express application (ensure app.js exports default app)
// and that app.listen() is only executed when the file is run directly.
import app from './app.js';

describe('Ingestion Service API Tests', () => {

    beforeEach(() => {
        // Clear mock call history before each test
        jest.clearAllMocks();
    });

    // --- TEST 1: Schema validation ---
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

        // Verify Dapr was not called, since the request is rejected during validation
        expect(mockStateGet).not.toHaveBeenCalled();
        expect(mockPubSubPublish).not.toHaveBeenCalled();
    });

    // --- TEST 2: Successful first invoice submission ---
    test('POST /api/v1/expenses - Should accept unique invoice and publish event', async () => {
        const validInvoice = {
            id: "INV-1016",
            vendor: "City Cabs",
            invoiceNumber: "CC-4410",
            total: 48.0
        };

        // Simulate that this key does not exist in Redis (Dapr returns empty object or null)
        mockStateGet.mockResolvedValue({});
        mockStateSave.mockResolvedValue(true);
        mockPubSubPublish.mockResolvedValue(true);

        const response = await request(app)
            .post('/api/v1/expenses')
            .send(validInvoice);

        // Verify HTTP status from the endpoint
        expect(response.status).toBe(202);
        expect(response.body).toEqual({
            tracking_id: "INV-1016",
            status: "ACCEPTED"
        });

        // Verify the service queried the deduplication store correctly
        // Hash for "City Cabs_CC-4410_48" is "7369bd65147814b7ecbd993e36e4f3a1"
        expect(mockStateGet).toHaveBeenCalledWith('approval-state', expect.any(String));

        // Verify that the lock was written to Redis
        expect(mockStateSave).toHaveBeenCalledWith('approval-state', [
            expect.objectContaining({
                key: expect.any(String),
                value: expect.objectContaining({
                    tracking_id: "INV-1016",
                    status: "PROCESSING"
                })
            })
        ]);

        // Verify the event was published to Dapr Pub/Sub
        expect(mockPubSubPublish).toHaveBeenCalledWith(
            'approval-pubsub',
            'invoice.submitted',
            expect.objectContaining({
                id: "INV-1016",
                vendor: "City Cabs",
                total: 48.0,
                idempotency_key: expect.any(String),
                correlation_id: expect.any(String)
            })
        );
    });

    // --- TEST 3: Duplicate request short-circuit ---
    test('POST /api/v1/expenses - Should short-circuit and return 200 on duplicate invoice', async () => {
        const duplicateInvoice = {
            id: "INV-1016",
            vendor: "City Cabs",
            invoiceNumber: "CC-4410",
            total: 48.0
        };

        // Simulate that Dapr State Store found an existing active lock in Redis
        mockStateGet.mockResolvedValue({
            tracking_id: "INV-1016",
            correlation_id: "corr_original_123",
            status: "PROCESSING"
        });

        const response = await request(app)
            .post('/api/v1/expenses')
            .send(duplicateInvoice);

        // According to the app logic, duplicates return 200 OK
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            tracking_id: "INV-1016",
            status: "PROCESSING",
            message: 'Duplicate request detected. Invoice is already being processed.'
        });

        // Important for high load: lock found, save and publish should not be called again
        expect(mockStateSave).not.toHaveBeenCalled();
        expect(mockPubSubPublish).not.toHaveBeenCalled();
    });

    // --- TEST 4: 404 handling for unknown routes ---
    test('GET /unknown-route - Should return 404', async () => {
        const response = await request(app).get('/unknown-route');
        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: 'Not Found' });
    });
});
