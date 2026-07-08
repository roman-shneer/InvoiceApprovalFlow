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

        mockStateGet.mockImplementation(async (store, key) => {
            if (store === 'mongo-budgets' && key === 'default-pool') {
                return JSON.stringify({ _id: 'default-pool', value: { department: 'default-pool', amount: 5000 } });
            }
            if (store === 'mongo-invoices' && key === 'INV-3001') {
                return JSON.stringify(storedInvoice);
            }
            return null;
        });
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
        expect(mockStateSave).toHaveBeenCalledTimes(3);

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

        expect(mockStateSave).toHaveBeenNthCalledWith(2, 'mongo-budgets', [
            expect.objectContaining({
                key: 'default-pool',
                value: expect.objectContaining({
                    _id: 'default-pool',
                    value: expect.objectContaining({
                        department: 'default-pool',
                        amount: 4957.5
                    })
                })
            })
        ]);

        expect(mockStateSave).toHaveBeenNthCalledWith(3, 'mongo-invoices', [
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

    test('uses mongo-fx-rates for EUR to USD conversion when checking budget pool', async () => {
        const storedInvoice = {
            tracking_id: 'INV-3003',
            status: 'AUTO_APPROVE',
            total: '100.00',
            currency: 'EUR'
        };

        mockStateGet.mockImplementation(async (store, key) => {
            if (store === 'mongo-fx-rates' && key === 'EUR') {
                return JSON.stringify({ _id: 'EUR', value: { rate: 1.2 } });
            }
            if (store === 'mongo-budgets' && key === 'marketing-2026Q2') {
                return JSON.stringify({ _id: 'marketing-2026Q2', value: { department: 'marketing-2026Q2', amount: 1000 } });
            }
            if (store === 'mongo-invoices' && key === 'INV-3003') {
                return JSON.stringify(storedInvoice);
            }
            return null;
        });
        mockStateSave.mockResolvedValue(true);
        mockPubSubPublish.mockResolvedValue(true);

        const result = await appCallback({
            data: {
                tracking_id: 'INV-3003',
                status: 'AUTO_APPROVE',
                total: '100.00',
                currency: 'EUR',
                department: 'marketing-2026Q2'
            }
        });

        expect(result).toBe('SUCCESS');
        expect(mockStateGet).toHaveBeenCalledWith('mongo-fx-rates', 'EUR');
        expect(mockStateSave).toHaveBeenNthCalledWith(2, 'mongo-budgets', [
            expect.objectContaining({
                key: 'marketing-2026Q2',
                value: expect.objectContaining({
                    value: expect.objectContaining({
                        department: 'marketing-2026Q2',
                        amount: 880
                    })
                })
            })
        ]);
        expect(mockStateSave).toHaveBeenNthCalledWith(3, 'mongo-invoices', [
            expect.objectContaining({
                key: 'INV-3003',
                value: expect.objectContaining({
                    payment: expect.objectContaining({
                        status: 'CONFIRMED',
                        amount: 100,
                        currency: 'EUR'
                    })
                })
            })
        ]);
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

    test('fails payment when mongo budget is insufficient', async () => {
        mockStateGet.mockImplementation(async (store, key) => {
            if (store === 'mongo-budgets' && key === 'marketing-2026Q2') {
                return JSON.stringify({ _id: 'marketing-2026Q2', value: { department: 'marketing-2026Q2', amount: 50 } });
            }
            if (store === 'mongo-invoices' && key === 'INV-3999') {
                return JSON.stringify({ tracking_id: 'INV-3999', status: 'AUTO_APPROVE' });
            }
            return null;
        });
        mockStateSave.mockResolvedValue(true);
        mockPubSubPublish.mockResolvedValue(true);

        const result = await appCallback({
            data: {
                tracking_id: 'INV-3999',
                status: 'AUTO_APPROVE',
                total: '120.00',
                currency: 'USD',
                department: 'marketing-2026Q2'
            }
        });

        expect(result).toBe('SUCCESS');
        expect(mockPubSubPublish).toHaveBeenCalledWith(
            'approval-pubsub',
            'payment.failed',
            expect.objectContaining({ tracking_id: 'INV-3999', reason: 'insufficient_budget', department: 'marketing-2026Q2' })
        );
    });
});
