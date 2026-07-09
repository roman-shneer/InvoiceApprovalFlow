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

describe('Ingestion Service Transactional Outbox Pattern', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('POST /api/v1/expenses - Should save event log to outbox storage and dispatch it', async () => {
        const validInvoice = {
            id: "INV-OUTBOX-99",
            vendor: "Cloud Providers Inc",
            invoiceNumber: "CP-1234",
            total: 999.0
        };

        mockStateGet.mockResolvedValue(null);
        mockStateSave.mockResolvedValue(true);

        const mockToken = generateMockTestToken();

        const response = await request(app)
            .post('/api/v1/expenses')
            .set('Authorization', `Bearer ${mockToken}`)
            .send(validInvoice);

        expect(response.status).toBe(202);

        expect(mockPubSubPublish).toHaveBeenCalledWith(
            'approval-pubsub',
            'invoice.submitted',
            expect.objectContaining({
                tracking_id: 'INV-OUTBOX-99',
                total: 999
            })
        );

        // Первый вызов (NthCalledWith(1)) идет в Redis ('approval-state') для проверки дубликатов
        expect(mockStateSave).toHaveBeenNthCalledWith(1, 'approval-state', expect.arrayContaining([
            expect.objectContaining({
                key: expect.any(String),
                value: expect.objectContaining({
                    status: "PROCESSING",
                    tracking_id: "INV-OUTBOX-99"
                })
            })
        ]));

        // Второй вызов (NthCalledWith(2)) сохраняет начальный Outbox (processed: false) в 'mongo-state'
        expect(mockStateSave).toHaveBeenNthCalledWith(2, 'mongo-state', expect.arrayContaining([
            expect.objectContaining({
                key: expect.stringContaining('outbox_'),
                value: expect.objectContaining({
                    pubsub_name: 'approval-pubsub',
                    topic: 'invoice.submitted',
                    processed: false,
                    payload: expect.objectContaining({
                        tracking_id: "INV-OUTBOX-99",
                        total: 999.0
                    })
                })
            })
        ]));

        // Третий вызов (NthCalledWith(3)) внутри dispatchOutboxEvent переводит статус в processed: true в 'mongo-state'
        expect(mockStateSave).toHaveBeenNthCalledWith(3, 'mongo-state', [
            expect.objectContaining({
                key: expect.stringContaining('outbox_'),
                value: expect.objectContaining({
                    processed: true,
                    processed_at: expect.any(String)
                })
            })
        ]);
    });
});
