const mockStateGet = jest.fn();
const mockStateSave = jest.fn();
const mockPubSubPublish = jest.fn();
const mockSubscribe = jest.fn();

jest.mock('@dapr/dapr', () => {
    return {
        DaprClient: jest.fn().mockImplementation(() => {
            return {
                state: {
                    get: mockStateGet,
                    save: mockStateSave
                },
                pubsub: {
                    publish: mockPubSubPublish
                }
            };
        }),
        DaprServer: jest.fn().mockImplementation(() => {
            return {
                pubsub: { subscribe: mockSubscribe },
                start: jest.fn().mockResolvedValue(true)
            };
        }),
        __esModule: true
    };
});

describe('Transactional Saga Orchestration - Compensating Workflow Proof', () => {
    let paymentCallback;

    beforeEach(() => {
        jest.clearAllMocks();

        mockSubscribe.mockImplementation((pubsub, topic, cb) => {
            paymentCallback = cb;
        });

        jest.isolateModules(() => {
            require('../app.js');
        });
    });

    test('Journey INV-1012: Bank node rejection triggers state rollback and compensating steps execution', async () => {
        const failedInvoicePayload = {
            tracking_id: 'INV-1012',
            status: 'AUTO_APPROVE',
            total: '5000.00',
            currency: 'EUR',
            bank_node_available: false
        };

        mockStateGet.mockResolvedValue(JSON.stringify({
            tracking_id: 'INV-1012',
            payment: { reservation: { reserved: true } }
        }));

        mockStateSave.mockResolvedValue(true);
        mockPubSubPublish.mockResolvedValue(true);

        const result = await paymentCallback({ data: failedInvoicePayload });

        expect(result).toBe('SUCCESS');

        expect(mockStateSave).toHaveBeenCalledWith('mongo-invoices', expect.arrayContaining([
            expect.objectContaining({
                key: 'INV-1012',
                value: expect.objectContaining({
                    payment: expect.objectContaining({
                        status: 'REJECTED_ROLLBACK',
                        reservation: expect.objectContaining({ reserved: false })
                    })
                })
            })
        ]));

        expect(mockPubSubPublish).toHaveBeenCalledWith(
            'approval-pubsub',
            'payment.failed.compensate',
            expect.objectContaining({ tracking_id: 'INV-1012' })
        );
    });
});
