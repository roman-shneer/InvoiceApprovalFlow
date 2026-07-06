const InvoicesRepository = require('../../backend/resources/invoices.repository');

describe('InvoicesRepository', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        global.fetch = jest.fn();
        process.env.INVOICE_URL = 'http://invoice.example.test';
    });

    test('sendInvoices posts every invoice that returns ok', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'invoice-1' }) })
            .mockResolvedValueOnce({ ok: false, json: async () => ({ id: 'invoice-2' }) });

        const repository = new InvoicesRepository({ state: { query: jest.fn(), get: jest.fn(), save: jest.fn() }, pubsub: { publish: jest.fn() } });

        await expect(repository.sendInvoices([{ id: 'invoice-1' }, { id: 'invoice-2' }])).resolves.toEqual([
            { id: 'invoice-1' }
        ]);
        expect(global.fetch).toHaveBeenCalledWith('http://invoice.example.test', expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }));
    });

    test('getInvoices returns state rows with keys and supports HUMAN_REVIEW sorting', async () => {
        const query = jest.fn().mockResolvedValue({ results: [{ key: 'invoice-1', data: { total: 10 } }] });
        const repository = new InvoicesRepository({ state: { query, get: jest.fn(), save: jest.fn() }, pubsub: { publish: jest.fn() } });

        await expect(repository.getInvoices('HUMAN_REVIEW')).resolves.toEqual([{ key: 'invoice-1', total: 10 }]);
        expect(query).toHaveBeenCalledWith('mongo-invoices', {
            filter: { EQ: { status: 'HUMAN_REVIEW' } },
            sort: [{ key: 'submitted_at', order: 'ASC' }],
            page: { limit: 100 }
        });
    });

    test('updateInvoiceStatus saves approved invoices and publishes payment requests', async () => {
        const get = jest.fn().mockResolvedValue(JSON.stringify({ tracking_id: 'invoice-1', status: 'PENDING', amount: 100 }));
        const save = jest.fn().mockResolvedValue(true);
        const publish = jest.fn().mockResolvedValue(true);
        const repository = new InvoicesRepository({ state: { get, query: jest.fn(), save }, pubsub: { publish } });

        await expect(repository.updateInvoiceStatus('invoice-1', 'APPROVED')).resolves.toEqual({
            tracking_id: 'invoice-1',
            status: 'APPROVED',
            amount: 100
        });
        expect(save).toHaveBeenCalledWith('mongo-invoices', [
            { key: 'invoice-1', value: { tracking_id: 'invoice-1', status: 'APPROVED', amount: 100 } }
        ]);
        expect(publish).toHaveBeenCalledWith('approval-pubsub', 'payment.requested', {
            tracking_id: 'invoice-1',
            status: 'APPROVED',
            amount: 100
        });
    });

    test('updateInvoiceStatus rejects unsupported statuses', async () => {
        const repository = new InvoicesRepository({ state: { get: jest.fn(), query: jest.fn(), save: jest.fn() }, pubsub: { publish: jest.fn() } });

        await expect(repository.updateInvoiceStatus('invoice-1', 'PENDING')).resolves.toBe(false);
    });
});
