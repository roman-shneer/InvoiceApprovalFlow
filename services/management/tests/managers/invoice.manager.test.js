const InvoiceManager = require('../../backend/managers/invoice.manager');

function generateMockToken(role = 'submitter') {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString('base64');

    // Set expiration 1 day into the future from now to prevent triggering expiry guards
    const futureExp = Math.floor(Date.now() / 1000) + 86400;

    const payload = Buffer.from(JSON.stringify({
        role: role,
        exp: futureExp
    })).toString('base64');

    const mockSignature = "mock_signature_bytes_string";

    return `${header}.${payload}.${mockSignature}`;
}

describe('InvoiceManager', () => {
    test('sendInvoices parses payloads and forwards them to the resource', async () => {
        const resource = {
            sendInvoices: jest.fn().mockResolvedValue([{ id: 'invoice-1' }]),
            getInvoices: jest.fn(),
            updateInvoiceStatus: jest.fn()
        };
        const manager = new InvoiceManager(resource);

        const mockToken = generateMockToken();

        await expect(manager.sendInvoices('{"id":"invoice-1"}', mockToken)).resolves.toEqual({
            success: true,
            message: 'ok',
            results: [{ id: 'invoice-1' }]
        });

        // FIX: Expect array elements map and token string context as two independent arguments matches
        expect(resource.sendInvoices).toHaveBeenCalledWith([{ id: 'invoice-1' }], mockToken);
    });

    test('sendInvoices returns a parse error for invalid payloads', async () => {
        const mockToken = generateMockToken();
        const manager = new InvoiceManager({ sendInvoices: jest.fn() });
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        await expect(manager.sendInvoices('{', mockToken)).resolves.toEqual({
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
