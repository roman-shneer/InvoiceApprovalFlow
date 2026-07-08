const InvoicesRepository = require('../../backend/resources/invoices.repository');

function generateMockToken() {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString('base64');
    const futureExp = Math.floor(Date.now() / 1000) + 86400;
    const payload = Buffer.from(JSON.stringify({ role: 'submitter', exp: futureExp })).toString('base64');
    return `${header}.${payload}.mock_signature`;
}

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
        const mockToken = generateMockToken();

        await expect(repository.sendInvoices([{ id: 'invoice-1' }, { id: 'invoice-2' }], mockToken)).resolves.toEqual([
            { id: 'invoice-1' }
        ]);

        expect(global.fetch).toHaveBeenCalledWith('http://invoice.example.test', expect.objectContaining({
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${mockToken}`
            }
        }));
    });

    test('getInvoices returns state rows with keys and supports HUMAN_REVIEW filtering/sorting', async () => {
        const query = jest.fn().mockResolvedValue({
            results: [
                { key: 'invoice-1', data: { status: 'HUMAN_REVIEW', total: 10, submitted_at: '2026-07-06T10:00:00.000Z' } },
                { key: 'invoice-2', data: { status: 'HUMAN_REVIEW', total: 20, submitted_at: '2026-07-06T09:00:00.000Z' } },
                { key: 'invoice-3', data: { status: 'AUTO_APPROVE', total: 30, submitted_at: '2026-07-06T08:00:00.000Z' } }
            ]
        });
        const repository = new InvoicesRepository({ state: { query, get: jest.fn(), save: jest.fn() }, pubsub: { publish: jest.fn() } });

        await expect(repository.getInvoices('HUMAN_REVIEW')).resolves.toEqual([
            { key: 'invoice-2', status: 'HUMAN_REVIEW', total: 20, submitted_at: '2026-07-06T09:00:00.000Z' },
            { key: 'invoice-1', status: 'HUMAN_REVIEW', total: 10, submitted_at: '2026-07-06T10:00:00.000Z' }
        ]);
        expect(query).toHaveBeenCalledWith('mongo-invoices', {
            filter: {},
            page: { limit: 100 }
        });
    });

    test('getInvoices also maps rows returned with value payload shape', async () => {
        const query = jest.fn().mockResolvedValue({
            results: [{ key: 'invoice-2', value: { tracking_id: 'INV-2', total: 20 } }]
        });
        const repository = new InvoicesRepository({ state: { query, get: jest.fn(), save: jest.fn() }, pubsub: { publish: jest.fn() } });

        await expect(repository.getInvoices()).resolves.toEqual([
            { key: 'invoice-2', tracking_id: 'INV-2', total: 20 }
        ]);
    });

    test('getInvoices maps rows returned with _id and value shape from mongo', async () => {
        const query = jest.fn().mockResolvedValue({
            results: [{ _id: 'INV-1001XXXX', value: { tracking_id: 'INV-1001XXXX', total: 42, status: 'HUMAN_REVIEW' } }]
        });
        const repository = new InvoicesRepository({ state: { query, get: jest.fn(), save: jest.fn() }, pubsub: { publish: jest.fn() } });

        await expect(repository.getInvoices()).resolves.toEqual([
            { key: 'INV-1001XXXX', tracking_id: 'INV-1001XXXX', total: 42, status: 'HUMAN_REVIEW' }
        ]);
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
