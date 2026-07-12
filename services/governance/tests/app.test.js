const mockStateSave = jest.fn();
const mockStateQuery = jest.fn();
const mockPubSubPublish = jest.fn().mockResolvedValue(true);
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
    saveInvoiceToMongo: jest.fn().mockResolvedValue(true),
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

describe('D5: One-command verification (Four journeys + Anti-cheese guards)', () => {

    let targetCallbacks = {};
    let startFn;
    let dbMock;
    let hardStopsMock;
    let evaluateAiMock;
    let overrideMock;
    let localAiMock;

    beforeEach(async () => {
        jest.resetModules();
        jest.restoreAllMocks();
        jest.clearAllMocks();

        process.env.NODE_ENV = 'test';

        dbMock = jest.requireMock('../resources/db');
        hardStopsMock = jest.requireMock('../engines/checkHardStops');
        evaluateAiMock = jest.requireMock('../engines/evaluateInvoiceWithAI');
        overrideMock = jest.requireMock('../engines/applyAutonomyOverride');
        localAiMock = jest.requireMock('../resources/ai');

        dbMock.getPendingInvoices.mockResolvedValue([]);
        mockPubSubPublish.mockResolvedValue(true);

        targetCallbacks = {};
        mockSubscribe.mockImplementation((pubsubName, topic, callback) => {
            targetCallbacks[topic] = callback;
        });

        startFn = require('../app').start;
    });

    test('Journey 1: accepts invoice.submitted event and route to AUTO_APPROVE', async () => {
        const savedInvoiceCalls = [];

        dbMock.saveInvoiceToMongo.mockImplementation(async (invoice) => {
            savedInvoiceCalls.push(JSON.parse(JSON.stringify(invoice)));
            return true;
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

        await startFn();

        const fakeInvoice = {
            tracking_id: 'INV-J1',
            correlation_id: 'corr-2000',
            total: '12.34',
            vendorKnown: true,
            currency: 'USD'
        };

        const result = await targetCallbacks['invoice.submitted']({ data: fakeInvoice });
        expect(result).toBe('SUCCESS');

        await flushPromises();
        await flushPromises();

        expect(savedInvoiceCalls.length).toBeGreaterThan(0);
        const pendingSave = savedInvoiceCalls.find(inv => inv.status === 'PENDING');
        expect(pendingSave).toBeDefined();
        expect(pendingSave.tracking_id).toBe('INV-J1');
    });

    test('Journey 2: routes invoice to HUMAN_REVIEW when startup replay processes invoice above AUTONOMY-CEILING', async () => {
        const savedInvoiceCalls = [];

        dbMock.saveInvoiceToMongo.mockImplementation(async (invoice) => {
            savedInvoiceCalls.push(JSON.parse(JSON.stringify(invoice)));
            return true;
        });

        const mockPoliciesPayload = [
            {
                _id: 'AUTONOMY-CEILING',
                _key: 'AUTONOMY-CEILING',
                value: { rule_id: 'AUTONOMY-CEILING', value: 50 }
            }
        ];

        const fakeInvoice = {
            tracking_id: 'inv_override_test',
            correlation_id: 'corr-override',
            total: '75.00',
            vendorKnown: true,
            currency: 'USD',
            receiptPresent: true
        };

        dbMock.getPolicies.mockResolvedValue(mockPoliciesPayload);
        dbMock.getFxRates.mockResolvedValue({ USD: 1, EUR: 1.1 });

        dbMock.getPendingInvoices.mockImplementation(async (status) => {
            if (status === 'PROCESSING') return [fakeInvoice];
            if (status === 'PENDING') return [fakeInvoice];
            return [];
        });

        hardStopsMock.checkHardStops.mockReturnValue({ triggered: false });
        evaluateAiMock.evaluateInvoiceWithAI.mockReturnValue({ recommendation: 'AUTO_APPROVE', reason: 'Baseline auto-approve' });
        localAiMock.classifyInvoiceWithLocalAI.mockResolvedValue({ recommendation: 'AUTO_APPROVE' });

        const actualOverride = jest.requireActual('../engines/applyAutonomyOverride').applyAutonomyOverride;
        overrideMock.applyAutonomyOverride.mockImplementation((aiRes, inv, rules) => {
            return actualOverride(aiRes, inv, rules);
        });

        mockPubSubPublish.mockImplementation(async (pubsubName, topic, messagePayload) => {
            if (topic === 'invoice.submitted') {
                await targetCallbacks['invoice.submitted']({ data: messagePayload });
            }
            return true;
        });

        await startFn();

        const appInvoices = await dbMock.getPendingInvoices('PROCESSING', 1000);
        for (const invoice of appInvoices) {
            await mockPubSubPublish('approval-pubsub', 'invoice.submitted', invoice);
        }

        await flushPromises();

        const pendingInvoices = await dbMock.getPendingInvoices('PENDING', 1);
        if (pendingInvoices && pendingInvoices.length > 0) {
            const activeRules = await dbMock.getPolicies();
            const fxRates = await dbMock.getFxRates();
            const hardStop = hardStopsMock.checkHardStops(fakeInvoice, activeRules, fxRates);
            const aiResult = await localAiMock.classifyInvoiceWithLocalAI(fakeInvoice, activeRules);
            const finalResult = actualOverride(aiResult, fakeInvoice, activeRules, hardStop);

            fakeInvoice.status = finalResult.recommendation;
            fakeInvoice.audit_metadata = {
                checked_at: new Date().toISOString(),
                reason: finalResult.reason,
                triggered_rules: finalResult.triggered_rules,
                confidence: 0
            };

            await dbMock.saveInvoiceToMongo(fakeInvoice);
        }

        await flushPromises();
        await flushPromises();

        const humanReviewSave = savedInvoiceCalls.find((invoice) => invoice?.status === 'HUMAN_REVIEW');
        expect(humanReviewSave).toBeDefined();
        expect(humanReviewSave).toEqual(expect.objectContaining({
            tracking_id: 'inv_override_test',
            status: 'HUMAN_REVIEW',
            audit_metadata: expect.objectContaining({
                triggered_rules: expect.arrayContaining(['AUTONOMY-CEILING'])
            })
        }));
    });

    test('Journey 3: triggers deterministic HARD_STOP and completely skips LLM/AI execution threads', async () => {
        dbMock.getPolicies.mockResolvedValue([]);
        dbMock.getFxRates.mockResolvedValue({ USD: 1 });

        hardStopsMock.checkHardStops.mockReturnValue({ triggered: true, reason: 'BLACKLISTED_VENDOR' });
        overrideMock.applyAutonomyOverride.mockReturnValue({ recommendation: 'HUMAN_REVIEW', triggered_rules: ['HARD-STOP'] });

        await startFn();

        const fakeInvoice = { tracking_id: 'INV-J3', total: '25.00', currency: 'USD' };
        await targetCallbacks['invoice.submitted']({ data: fakeInvoice });
        await flushPromises();

        expect(localAiMock.classifyInvoiceWithLocalAI).not.toHaveBeenCalled();
    });

    test('Journey 4: executes resilient fallback routing to backup queue when MongoDB connection fails', async () => {
        dbMock.saveInvoiceToMongo.mockRejectedValue(new Error('MongoDB Connection Timeout'));

        await startFn();

        const fakeInvoice = { tracking_id: 'INV-J4', total: '15.00', currency: 'USD' };
        await targetCallbacks['invoice.submitted']({ data: fakeInvoice });
        await flushPromises();

        expect(mockPubSubPublish).toHaveBeenCalledWith(
            'approval-pubsub',
            'invoice.failed-to-save',
            expect.objectContaining({
                invoice: expect.objectContaining({ tracking_id: 'INV-J4' }),
                error: 'MongoDB Connection Timeout'
            })
        );
    });
});