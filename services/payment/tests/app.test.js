const mockStateGet = jest.fn();
const mockStateSave = jest.fn();
const mockPubSubPublish = jest.fn();
const mockServerSubscribe = jest.fn();
const mockServerStart = jest.fn().mockResolvedValue(true);

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
                pubsub: {
                    subscribe: mockServerSubscribe
                },
                start: mockServerStart
            };
        }),
        __esModule: true
    };
});

describe('Payment Service Tests', () => {
    let appCallback;

    beforeEach(() => {
        jest.clearAllMocks();

        mockServerSubscribe.mockImplementation((pubsubName, topic, callback) => {
            appCallback = callback;
            return Promise.resolve(true);
        });

        jest.isolateModules(() => {
            require('../app');
        });
    });

    test('subscribes to payment.requested and starts the server', () => {
        expect(mockServerSubscribe).toHaveBeenCalledWith(
            'approval-pubsub',
            'payment.requested',
            expect.any(Function)
        );
        expect(typeof appCallback).toBe('function');
    });

    test('confirms an approved payment and publishes payment.confirmed', async () => {
        const storedInvoice = {
            tracking_id: 'INV-3001',
            status: 'AUTO_APPROVE',
            total: '42.50',
            currency: 'USD'
        };

        mockStateGet.mockResolvedValue(JSON.stringify(storedInvoice));
        mockStateSave.mockResolvedValue(true);
        mockPubSubPublish.mockResolvedValue(true);

        const result = await appCallback({
            data: {
                tracking_id: 'INV-3001',
                status: 'AUTO_APPROVE',
                total: '42.50',
                currency: 'USD'
            }
        });

        expect(result).toBe('SUCCESS');
        expect(mockStateSave).toHaveBeenCalledTimes(2);

        expect(mockStateSave).toHaveBeenNthCalledWith(1, 'mongo-invoices', [
            expect.objectContaining({
                key: 'INV-3001',
                value: expect.objectContaining({
                    payment: expect.objectContaining({
                        reservation: expect.objectContaining({ reserved: true })
                    })
                })
            })
        ]);

        expect(mockStateSave).toHaveBeenNthCalledWith(2, 'mongo-invoices', [
            expect.objectContaining({
                key: 'INV-3001',
                value: expect.objectContaining({
                    payment: expect.objectContaining({
                        status: 'CONFIRMED',
                        amount: 42.5
                    })
                })
            })
        ]);

        expect(mockPubSubPublish).toHaveBeenCalledWith(
            'approval-pubsub',
            'payment.confirmed',
            { tracking_id: 'INV-3001' }
        );
    });

    test('rejects non-approved payment requests without persisting state', async () => {
        const result = await appCallback({
            data: {
                tracking_id: 'INV-3002',
                status: 'PENDING',
                total: '12.00',
                currency: 'USD'
            }
        });

        expect(result).toBe('REJECTED');
        expect(mockStateSave).not.toHaveBeenCalled();
        expect(mockPubSubPublish).not.toHaveBeenCalled();
    });
});
