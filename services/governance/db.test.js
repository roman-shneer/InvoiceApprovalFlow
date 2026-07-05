const { DaprClient } = require('@dapr/dapr');
const { saveAuditRecord } = require('./resources/db');

jest.mock('@dapr/dapr', () => {
    const mockStateGet = jest.fn();
    const mockStateSave = jest.fn();
    return {
        DaprClient: jest.fn().mockImplementation(() => ({
            state: {
                get: mockStateGet,
                save: mockStateSave
            }
        })),
        __esModule: true
    };
});

describe('Governance resources/db', () => {
    let mockStateGet, mockStateSave;

    beforeEach(() => {
        const mockClient = new DaprClient();
        mockStateGet = mockClient.state.get;
        mockStateSave = mockClient.state.save;
        jest.clearAllMocks();
    });

    test('saveAuditRecord updates only status and audit metadata when record exists', async () => {
        const existingInvoice = {
            tracking_id: 'INV-1001',
            correlation_id: 'corr-1',
            vendor: 'Test Vendor',
            total: 123.45,
            status: 'PENDING',
            audit_metadata: {
                checked_at: '2026-07-05T00:00:00.000Z',
                reason: 'initial',
                triggered_rules: []
            }
        };

        mockStateGet.mockResolvedValue(existingInvoice);
        mockStateSave.mockResolvedValue(true);

        await saveAuditRecord('INV-1001', 'corr-1', 'APPROVED', 'Approved by policy', ['RULE1']);

        expect(mockStateGet).toHaveBeenCalledWith('mongo-invoices', 'INV-1001');
        expect(mockStateSave).toHaveBeenCalledWith('mongo-invoices', [
            expect.objectContaining({
                key: 'INV-1001',
                value: expect.objectContaining({
                    status: 'APPROVED',
                    audit_metadata: expect.objectContaining({
                        reason: 'Approved by policy',
                        triggered_rules: ['RULE1']
                    })
                })
            })
        ]);
    });

    test('saveAuditRecord logs error and does not save when record is missing', async () => {
        mockStateGet.mockResolvedValue(null);
        mockStateSave.mockResolvedValue(true);

        await saveAuditRecord('INV-1002', 'corr-2', 'REJECTED', 'Rejected by policy', ['RULE2']);

        expect(mockStateGet).toHaveBeenCalledWith('mongo-invoices', 'INV-1002');
        expect(mockStateSave).not.toHaveBeenCalled();
    });
});
