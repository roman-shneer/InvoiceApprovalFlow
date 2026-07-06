const mockStateSave = jest.fn();
const mockStateQuery = jest.fn();
const mockPubSubPublish = jest.fn();
const mockSubscribe = jest.fn();
const mockServerStart = jest.fn().mockResolvedValue(true);

jest.mock('@dapr/dapr', () => ({
    DaprClient: jest.fn().mockImplementation(() => ({
        state: {
            save: mockStateSave,
            query: mockStateQuery
        },
        pubsub: {
            publish: mockPubSubPublish
        }
    })),
    DaprServer: jest.fn().mockImplementation(() => ({
        pubsub: {
            subscribe: mockSubscribe
        },
        start: mockServerStart
    })),
    __esModule: true
}));

jest.mock('../resources/db', () => ({
    saveInvoiceToMongo: jest.fn(),
    getPolicies: jest.fn()
}));

jest.mock('../engines/checkHardStops', () => ({
    checkHardStops: jest.fn()
}));

jest.mock('../engines/evaluateInvoiceWithAI', () => ({
    evaluateInvoiceWithAI: jest.fn()
}));

jest.mock('../engines/applyAutonomyOverride', () => ({
    applyAutonomyOverride: jest.fn()
}));

jest.mock('../resources/ai', () => ({
    classifyInvoiceWithLocalAI: jest.fn()
}));

jest.mock('../utils/logCompliance', () => ({
    logCompliance: jest.fn()
}));

describe('Governance main processing flow', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('processes invoice.submitted and publishes payment.requested on AUTO_APPROVE', async () => {
        const { saveInvoiceToMongo, getPolicies } = jest.requireMock('../resources/db');
        const { checkHardStops } = jest.requireMock('../engines/checkHardStops');
        const { evaluateInvoiceWithAI } = jest.requireMock('../engines/evaluateInvoiceWithAI');
        const { applyAutonomyOverride } = jest.requireMock('../engines/applyAutonomyOverride');
        const { classifyInvoiceWithLocalAI } = jest.requireMock('../resources/ai');

        let invoiceCallback;
        mockSubscribe.mockImplementation((pubsubName, topic, callback) => {
            invoiceCallback = callback;
        });

        const savedInvoiceCalls = [];
        saveInvoiceToMongo.mockImplementation(async (invoice) => {
            savedInvoiceCalls.push(JSON.parse(JSON.stringify(invoice)));
        });
        getPolicies.mockResolvedValue([]);
        checkHardStops.mockReturnValue({ triggered: false });
        evaluateInvoiceWithAI.mockReturnValue({
            recommendation: 'AUTO_APPROVE',
            reason: 'Baseline auto-approve',
            triggered_rules: []
        });
        classifyInvoiceWithLocalAI.mockResolvedValue({
            recommendation: 'AUTO_APPROVE',
            reason: 'Local AI approves'
        });
        applyAutonomyOverride.mockReturnValue({
            recommendation: 'AUTO_APPROVE',
            reason: 'Final auto-approve',
            triggered_rules: []
        });

        let start;
        jest.isolateModules(() => {
            start = require('../app').start;
        });
        await start();

        expect(mockSubscribe).toHaveBeenCalledWith('approval-pubsub', 'invoice.submitted', expect.any(Function));
        expect(mockServerStart).toHaveBeenCalled();

        const fakeInvoice = {
            tracking_id: 'INV-2000',
            correlation_id: 'corr-2000',
            total: '12.34',
            vendorKnown: true,
            currency: 'USD'
        };

        const result = await invoiceCallback({ data: fakeInvoice });
        expect(result).toBe('SUCCESS');

        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));

        expect(savedInvoiceCalls[0]).toEqual(expect.objectContaining({ tracking_id: 'INV-2000', status: 'PENDING' }));
        expect(savedInvoiceCalls[1]).toEqual(expect.objectContaining({ tracking_id: 'INV-2000', status: 'AUTO_APPROVE' }));
        expect(checkHardStops).toHaveBeenCalledWith(expect.objectContaining({ tracking_id: 'INV-2000' }), []);
        expect(evaluateInvoiceWithAI).toHaveBeenCalled();
        expect(classifyInvoiceWithLocalAI).toHaveBeenCalledWith(expect.objectContaining({ tracking_id: 'INV-2000' }), []);
        expect(applyAutonomyOverride).toHaveBeenCalled();

        expect(mockPubSubPublish).toHaveBeenCalledWith('approval-pubsub', 'invoice.processed', expect.objectContaining({ tracking_id: 'INV-2000' }));
        expect(mockPubSubPublish).toHaveBeenCalledWith('approval-pubsub', 'payment.requested', expect.objectContaining({ tracking_id: 'INV-2000' }));
    });
});
