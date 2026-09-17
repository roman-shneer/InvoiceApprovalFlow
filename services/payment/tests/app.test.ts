const mockStateGet = jest.fn();
const mockStateSave = jest.fn();
const mockPubSubPublish = jest.fn();
const mockSubscribe = jest.fn();
const mockStart = jest.fn().mockResolvedValue(true);

jest.mock('@dapr/dapr', () => ({
    DaprClient: jest.fn().mockImplementation(() => ({ state: { get: mockStateGet, save: mockStateSave }, pubsub: { publish: mockPubSubPublish } })),
    DaprServer: jest.fn().mockImplementation(() => ({ pubsub: { subscribe: mockSubscribe }, start: mockStart })),
}));

import { processInvoicePayment, start } from '../app';

describe('Payment Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSubscribe.mockImplementation((_pubsub: string, _topic: string, callback: Function) => { (globalThis as any).paymentCallback = callback; return Promise.resolve(true); });
        mockStateSave.mockResolvedValue(true);
        mockPubSubPublish.mockResolvedValue(true);
    });

    test('subscribes to invoice.payment and starts the server', async () => {
        await start();
        expect(mockSubscribe).toHaveBeenCalledWith('approval-pubsub', 'invoice.payment', expect.any(Function));
        expect(mockStart).toHaveBeenCalled();
    });

    test('confirms an approved payment and publishes payment.confirmed', async () => {
        mockStateGet.mockImplementation(async (store: string, key: string) => {
            if (store === 'mongo-budgets') return JSON.stringify({ _id: key, value: { department: key, amount: 5000 } });
            if (store === 'mongo-invoices') return JSON.stringify({ tracking_id: key, status: 'AUTO_APPROVE' });
            return null;
        });
        const result = await processInvoicePayment({ tracking_id: 'INV-3001', status: 'AUTO_APPROVE', total: '42.50', currency: 'USD' });
        expect(result).toBe('SUCCESS');
        expect(mockStateSave).toHaveBeenCalledTimes(3);
        expect(mockStateSave).toHaveBeenNthCalledWith(2, 'mongo-budgets', [expect.objectContaining({ value: expect.objectContaining({ value: expect.objectContaining({ amount: 4957.5 }) }) })]);
        expect(mockPubSubPublish).toHaveBeenCalledWith('approval-pubsub', 'payment.confirmed', { tracking_id: 'INV-3001' });
    });

    test('uses FX rates for foreign currency', async () => {
        mockStateGet.mockImplementation(async (store: string, key: string) => {
            if (store === 'mongo-fx-rates') return JSON.stringify({ value: { rate: 1.2 } });
            if (store === 'mongo-budgets') return JSON.stringify({ value: { department: key, amount: 1000 } });
            if (store === 'mongo-invoices') return JSON.stringify({ tracking_id: key });
            return null;
        });
        expect(await processInvoicePayment({ tracking_id: 'INV-3003', status: 'AUTO_APPROVE', total: '100', currency: 'EUR', department: 'marketing' })).toBe('SUCCESS');
        expect(mockStateGet).toHaveBeenCalledWith('mongo-fx-rates', 'EUR');
        expect(mockPubSubPublish).toHaveBeenCalledWith('approval-pubsub', 'payment.confirmed', { tracking_id: 'INV-3003' });
    });

    test('rejects non-approved payment requests without state changes', async () => {
        expect(await processInvoicePayment({ tracking_id: 'INV-3002', status: 'PENDING', total: '12', currency: 'USD' })).toBe('REJECT');
        expect(mockStateSave).not.toHaveBeenCalled();
        expect(mockPubSubPublish).not.toHaveBeenCalled();
    });

    test('publishes payment.failed when the budget is insufficient', async () => {
        mockStateGet.mockImplementation(async (store: string, key: string) => {
            if (store === 'mongo-budgets') return JSON.stringify({ value: { department: key, amount: 50 } });
            if (store === 'mongo-invoices') return JSON.stringify({ tracking_id: key });
            return null;
        });
        expect(await processInvoicePayment({ tracking_id: 'INV-3999', status: 'AUTO_APPROVE', total: '120', department: 'marketing' })).toBe('SUCCESS');
        expect(mockPubSubPublish).toHaveBeenCalledWith('approval-pubsub', 'payment.failed', expect.objectContaining({ tracking_id: 'INV-3999', reason: 'insufficient_budget' }));
    });
});
