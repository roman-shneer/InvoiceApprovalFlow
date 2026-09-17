const mockStateGet = jest.fn();
const mockStateSave = jest.fn();
const mockPubSubPublish = jest.fn();

jest.mock('@dapr/dapr', () => ({
    DaprClient: jest.fn().mockImplementation(() => ({ state: { get: mockStateGet, save: mockStateSave }, pubsub: { publish: mockPubSubPublish } })),
    DaprServer: jest.fn().mockImplementation(() => ({ pubsub: { subscribe: jest.fn() }, start: jest.fn().mockResolvedValue(true) })),
}));

import { processInvoicePayment } from '../app';

describe('Payment compensation workflow', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockStateGet.mockResolvedValue(JSON.stringify({ tracking_id: 'INV-1012', payment: { reservation: { reserved: true } } }));
        mockStateSave.mockResolvedValue(true);
        mockPubSubPublish.mockResolvedValue(true);
    });

    test('bank rejection triggers rollback and compensation event', async () => {
        const result = await processInvoicePayment({ tracking_id: 'INV-1012', status: 'AUTO_APPROVE', total: '5000.00', currency: 'EUR', bank_node_available: false });
        expect(result).toBe('SUCCESS');
        expect(mockStateSave).toHaveBeenCalledWith('mongo-invoices', [expect.objectContaining({ key: 'INV-1012', value: expect.objectContaining({ payment: expect.objectContaining({ status: 'REJECTED_ROLLBACK', reservation: { reserved: false } }) }) })]);
        expect(mockPubSubPublish).toHaveBeenCalledWith('approval-pubsub', 'payment.failed.compensate', expect.objectContaining({ tracking_id: 'INV-1012' }));
    });
});
