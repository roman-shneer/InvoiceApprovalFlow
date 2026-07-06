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

describe('Ingestion Service Rate Limiting Fallbacks', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('POST /api/v1/expenses - Should handle external upstream 429 status codes gracefully', async () => {
        const validInvoice = {
            id: "INV-RTLIMIT",
            vendor: "Express Courier",
            invoiceNumber: "EC-9911",
            total: 120.0
        };

        mockStateGet.mockImplementation(() => {
            const error = new Error('Too Many Requests');
            error.status = 429;
            return Promise.reject(error);
        });

        const response = await request(app)
            .post('/api/v1/expenses')
            .send(validInvoice);

        expect(response.status).toBe(429);
        expect(response.body).toEqual(expect.objectContaining({
            error: expect.stringContaining('Too Many Requests')
        }));

        expect(mockPubSubPublish).not.toHaveBeenCalled();
    });
});
