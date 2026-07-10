const InvoiceController = require('../../backend/clients/invoice.controller');

describe('InvoiceController', () => {
    function createResponse() {
        return {
            json: jest.fn(),
            status: jest.fn().mockReturnThis()
        };
    }

    test('allows submitters to send invoices and broadcasts created items', async () => {
        const manager = {
            sendInvoices: jest.fn().mockResolvedValue([{ id: 'invoice-1' }])
        };
        const websocketBroadcast = jest.fn();
        const controller = new InvoiceController(manager, websocketBroadcast);
        const req = { user: { role: 'submitter' }, body: { invoice: { id: 'invoice-1' } } };
        const res = createResponse();

        await controller.sendInvoice(req, res);

        expect(manager.sendInvoices).toHaveBeenCalledWith({ id: 'invoice-1' });
        expect(websocketBroadcast).toHaveBeenCalledWith({ type: 'invoice-created', invoice: { id: 'invoice-1' } });
        expect(res.json).toHaveBeenCalledWith([{ id: 'invoice-1' }]);
    });

    test('rejects unauthorized invoice actions', async () => {
        const controller = new InvoiceController({}, jest.fn());
        const res = createResponse();

        await controller.getInvoices({ user: { role: 'guest' }, query: {} }, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    test('approvers can approve and reject invoices', async () => {
        const manager = {
            updateInvoiceStatus: jest.fn()
                .mockResolvedValueOnce({ key: 'invoice-1', status: 'APPROVED' })
                .mockResolvedValueOnce({ key: 'invoice-2', status: 'DECLINE' })
        };
        const websocketBroadcast = jest.fn();
        const controller = new InvoiceController(manager, websocketBroadcast);
        const approveRes = createResponse();
        const rejectRes = createResponse();

        await controller.approveInvoice({ user: { role: 'approver' }, query: { key: 'invoice-1' } }, approveRes);
        await controller.rejectInvoice({ user: { role: 'approver' }, query: { key: 'invoice-2' } }, rejectRes);

        expect(websocketBroadcast).toHaveBeenCalledWith({ type: 'invoice-updated', invoice: { key: 'invoice-1', status: 'APPROVED' } });
        expect(websocketBroadcast).toHaveBeenCalledWith({ type: 'invoice-updated', invoice: { key: 'invoice-2', status: 'DECLINE' } });
        expect(approveRes.json).toHaveBeenCalledWith({ key: 'invoice-1', status: 'APPROVED' });
        expect(rejectRes.json).toHaveBeenCalledWith({ key: 'invoice-2', status: 'DECLINE' });
    });
});
