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

        mockStateGet.mockResolvedValue({});
        mockStateSave.mockResolvedValue(true);

        const response = await request(app)
            .post('/api/v1/expenses')
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

        expect(mockStateSave).toHaveBeenNthCalledWith(1, 'approval-state', expect.arrayContaining([
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

        expect(mockStateSave).toHaveBeenNthCalledWith(2, 'approval-state', [
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
