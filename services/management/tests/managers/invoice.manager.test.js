const InvoiceManager = require('../../backend/managers/invoice.manager');

describe('InvoiceManager', () => {
    test('sendInvoices parses payloads and forwards them to the resource', async () => {
        const resource = {
            sendInvoices: jest.fn().mockResolvedValue([{ id: 'invoice-1' }]),
            getInvoices: jest.fn(),
            updateInvoiceStatus: jest.fn()
        };
        const manager = new InvoiceManager(resource);

        await expect(manager.sendInvoices('{"id":"invoice-1"}')).resolves.toEqual({
            success: true,
            message: 'ok',
            results: [{ id: 'invoice-1' }]
        });
        expect(resource.sendInvoices).toHaveBeenCalledWith([{ id: 'invoice-1' }]);
    });

    test('sendInvoices returns a parse error for invalid payloads', async () => {
        const manager = new InvoiceManager({ sendInvoices: jest.fn() });
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        await expect(manager.sendInvoices('{')).resolves.toEqual({
            success: false,
            message: expect.stringContaining('JSON parsing error:')
        });

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'JSON parsing error:',
            expect.stringContaining("Expected property name or '}'")
        );
        consoleErrorSpy.mockRestore();
    });

    test('delegates read and status updates to the resource', async () => {
        const resource = {
            sendInvoices: jest.fn(),
            getInvoices: jest.fn().mockResolvedValue([{ key: 'invoice-1' }]),
            updateInvoiceStatus: jest.fn().mockResolvedValue({ key: 'invoice-1', status: 'APPROVED' })
        };
        const manager = new InvoiceManager(resource);

        await expect(manager.getInvoices('HUMAN_REVIEW')).resolves.toEqual([{ key: 'invoice-1' }]);
        await expect(manager.updateInvoiceStatus('invoice-1', 'APPROVED')).resolves.toEqual({
            key: 'invoice-1',
            status: 'APPROVED'
        });
    });
});
