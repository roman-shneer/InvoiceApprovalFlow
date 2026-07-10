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

        const mockToken = generateMockTestToken();

        const response = await request(app)
            .post('/api/v1/expenses')
            .set('Authorization', `Bearer ${mockToken}`)
            .send(validInvoice);

        expect(response.status).toBe(429);
        expect(response.body).toEqual(expect.objectContaining({
            error: expect.stringContaining('Too Many Requests')
        }));

        expect(mockPubSubPublish).not.toHaveBeenCalled();
    });
});
