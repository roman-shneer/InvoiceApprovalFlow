const mockStateSave = jest.fn();
const mockStateQuery = jest.fn();
const mockPubSubPublish = jest.fn();
const mockSubscribe = jest.fn();
const mockServerStart = jest.fn().mockResolvedValue(true);
const { DaprServer } = require('@dapr/dapr');
const db = require('../resources/db');

const flushPromises = () => new Promise(setImmediate);

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
    getPolicies: jest.fn(),
    getFxRates: jest.fn(),
    getPendingInvoices: jest.fn()
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


describe('Governance main processing flow', () => {
    let capturedCallback;
    let startFn;
    let dbMock;
    let hardStopsMock;
    let evaluateAiMock;
    let overrideMock;
    let localAiMock;

    beforeEach(async () => {
        jest.restoreAllMocks();
        jest.clearAllMocks();

        dbMock = jest.requireMock('../resources/db');
        hardStopsMock = jest.requireMock('../engines/checkHardStops');
        evaluateAiMock = jest.requireMock('../engines/evaluateInvoiceWithAI');
        overrideMock = jest.requireMock('../engines/applyAutonomyOverride');
        localAiMock = jest.requireMock('../resources/ai');

        dbMock.getPendingInvoices.mockResolvedValue([]);

        mockSubscribe.mockImplementation((pubsubName, topic, callback) => {
            capturedCallback = callback;
        });

        let start;
        jest.isolateModules(() => {
            start = require('../app').start;
        });
        startFn = start;
        await startFn();
    });

    test('accepts invoice.submitted event and returns SUCCESS', async () => {
        const savedInvoiceCalls = [];
        dbMock.saveInvoiceToMongo.mockImplementation(async (invoice) => {
            savedInvoiceCalls.push(JSON.parse(JSON.stringify(invoice)));
        });

        dbMock.getPolicies.mockResolvedValue([]);
        dbMock.getFxRates.mockResolvedValue({ USD: 1, EUR: 1.1 });
        dbMock.getPendingInvoices.mockResolvedValue([]);
        hardStopsMock.checkHardStops.mockReturnValue({ triggered: false });
        evaluateAiMock.evaluateInvoiceWithAI.mockReturnValue({
            recommendation: 'AUTO_APPROVE',
            reason: 'Baseline auto-approve',
            triggered_rules: []
        });
        localAiMock.classifyInvoiceWithLocalAI.mockResolvedValue({
            recommendation: 'AUTO_APPROVE',
            reason: 'Local AI approves'
        });
        overrideMock.applyAutonomyOverride.mockReturnValue({
            recommendation: 'AUTO_APPROVE',
            reason: 'Final auto-approve',
            triggered_rules: []
        });

        const fakeInvoice = {
            tracking_id: 'INV-2000',
            correlation_id: 'corr-2000',
            total: '12.34',
            vendorKnown: true,
            currency: 'USD'
        };

        const result = await capturedCallback({ data: fakeInvoice });
        expect(result).toBe('SUCCESS');

        await flushPromises();
        await flushPromises();

        expect(savedInvoiceCalls).toHaveLength(0);
        expect(mockPubSubPublish).not.toHaveBeenCalledWith('approval-pubsub', 'payment.requested', expect.anything());
    });

    test('should route invoice to HUMAN_REVIEW when startup replay processes invoice above AUTONOMY-CEILING', async () => {
        const savedInvoiceCalls = [];
        dbMock.saveInvoiceToMongo.mockImplementation(async (invoice) => {
            savedInvoiceCalls.push(JSON.parse(JSON.stringify(invoice)));
        });

        const mockPoliciesPayload = [
            {
                _id: 'AUTONOMY-CEILING',
                _key: 'AUTONOMY-CEILING',
                value: { rule_id: 'AUTONOMY-CEILING', value: 50 }
            }
        ];

        dbMock.getPolicies.mockResolvedValue(mockPoliciesPayload);
        dbMock.getFxRates.mockResolvedValue({ USD: 1, EUR: 1.1 });
        dbMock.getPendingInvoices.mockResolvedValue([]);
        hardStopsMock.checkHardStops.mockReturnValue({ triggered: false });

        evaluateAiMock.evaluateInvoiceWithAI.mockReturnValue({
            recommendation: 'AUTO_APPROVE',
            reason: 'Baseline auto-approve'
        });
        localAiMock.classifyInvoiceWithLocalAI.mockResolvedValue({
            recommendation: 'AUTO_APPROVE'
        });

        // Requiring actual implementation block here to test real routing behavior
        const actualOverride = jest.requireActual('../engines/applyAutonomyOverride').applyAutonomyOverride;
        overrideMock.applyAutonomyOverride.mockImplementation((aiRes, inv, rules) => {
            return actualOverride(aiRes, inv, rules);
        });

        const fakeInvoice = {
            tracking_id: 'inv_override_test',
            correlation_id: 'corr-override',
            total: '75.00',
            vendorKnown: true,
            currency: 'USD',
            receiptPresent: true
        };

        // Trigger checkStuckInvoices() path inside start(): getPendingInvoices('PROCESSING', ...)
        dbMock.getPendingInvoices.mockResolvedValueOnce([fakeInvoice]);
        await startFn();

        await flushPromises();
        await flushPromises();

        const humanReviewSave = savedInvoiceCalls.find((invoice) => invoice?.status === 'HUMAN_REVIEW');
        expect(humanReviewSave).toEqual(expect.objectContaining({
            tracking_id: 'inv_override_test',
            status: 'HUMAN_REVIEW',
            audit_metadata: expect.objectContaining({
                triggered_rules: expect.arrayContaining(['AUTONOMY-CEILING'])
            })
        }));
    });
});
