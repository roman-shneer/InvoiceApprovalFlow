global.fetch = jest.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({}), text: async () => ''
});

const mockStateSave = jest.fn().mockResolvedValue(true);
const mockStateGet = jest.fn().mockResolvedValue(null);
const mockStateDelete = jest.fn().mockResolvedValue(true);
const mockPubSubPublish = jest.fn().mockResolvedValue(true);

const express = require('express');
jest.spyOn(express.application, 'listen').mockImplementation(function (port, cb) {
    if (cb) setImmediate(cb);
    return { close: (d) => d && d(), on: () => { } };
});

jest.mock('../resources/ragEngine', () => ({
    RagEngine: jest.fn().mockImplementation(() => ({
        retrieveRelevantPolicies: jest.fn().mockResolvedValue([]),
        close: jest.fn()
    }))
}));

jest.mock('../managers/aiManager', () => ({
    aiManager: jest.fn().mockResolvedValue({
        requestModel: jest.fn().mockResolvedValue({
            recommendation: 'AUTO_APPROVE', reason: 'AI ok', triggered_rules: [], confidence: 0.95
        })
    }),
    anonymizeInvoice: jest.fn().mockImplementation((inv) => inv)
}));

jest.mock('../engines/evaluateInvoiceWithAI', () => ({
    evaluateInvoiceWithAI: jest.fn().mockReturnValue({
        recommendation: 'AUTO_APPROVE', reason: 'Fallback', triggered_rules: []
    })
}));

jest.mock('../engines/applyOverride', () => ({
    applyOverride: jest.fn().mockReturnValue({
        recommendation: 'AUTO_APPROVE', reason: 'Final auto-approve', triggered_rules: [], confidence: 0.9
    })
}));

jest.mock('../resources/db', () => ({
    saveInvoiceToMongo: jest.fn().mockResolvedValue(true),
    getPolicies: jest.fn().mockResolvedValue([]),
    getFxRates: jest.fn().mockResolvedValue({ USD: 1 }),
    getFxRate: jest.fn().mockResolvedValue({ rate: 1 }),
    getPendingInvoices: jest.fn().mockResolvedValue([]),
}));

jest.mock('@dapr/dapr', () => ({
    DaprClient: jest.fn().mockImplementation(() => ({
        state: { save: mockStateSave, get: mockStateGet, delete: mockStateDelete, query: jest.fn().mockResolvedValue([]) },
        pubsub: { publish: mockPubSubPublish }
    })),
    DaprServer: jest.fn().mockImplementation(() => ({
        jobs: { register: jest.fn() },
        start: jest.fn()
    })),
}));

const flushPromises = () => new Promise(setImmediate);

describe('D5: One-command verification', () => {
    let appModule, dbMock, overrideMock;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.NODE_ENV = 'test';
        jest.resetModules();
        appModule = require('../app');
        dbMock = require('../resources/db');
        overrideMock = require('../engines/applyOverride');
    });

    test('Journey 1: accepts invoice.pending and route to AUTO_APPROVE', async () => {
        const saved = [];
        dbMock.saveInvoiceToMongo.mockImplementation(async (inv) => { saved.push(JSON.parse(JSON.stringify(inv))); return true; });
        overrideMock.applyOverride.mockReturnValue({
            recommendation: 'AUTO_APPROVE', reason: 'Final auto-approve', triggered_rules: [], confidence: 0.9
        });

        await appModule.processInvoice('INV-J1', { tracking_id: 'INV-J1', total: '12.34', currency: 'USD' });
        await flushPromises();

        expect(saved.length).toBeGreaterThan(0);
        const last = saved[saved.length - 1];
        expect(last.tracking_id).toBe('INV-J1');
        expect(last.status).toBe('AUTO_APPROVE');
    }, 15000);

    test('Journey 2: routes to HUMAN_REVIEW when above AUTONOMY-CEILING', async () => {
        const saved = [];
        dbMock.saveInvoiceToMongo.mockImplementation(async (inv) => { saved.push(JSON.parse(JSON.stringify(inv))); return true; });
        dbMock.getPolicies.mockResolvedValue([
            { value: { rule_id: 'AUTONOMY-CEILING', value: 50 } }
        ]);

        const actualOverride = jest.requireActual('../engines/applyOverride').applyOverride;
        overrideMock.applyOverride.mockImplementation((aiRes, inv, rules, rate) => actualOverride(aiRes, inv, rules, rate));

        await appModule.processInvoice('inv_override_test', { tracking_id: 'inv_override_test', total: '75.00', currency: 'USD' });
        await flushPromises();

        const human = saved.find(i => i.status === 'HUMAN_REVIEW');
        expect(human).toBeDefined();
        expect(human.audit_metadata.triggered_rules).toEqual(expect.arrayContaining(['AUTONOMY-CEILING']));
    }, 15000);

    test('Journey 3: triggers HARD_STOP', async () => {
        overrideMock.applyOverride.mockReturnValue({ recommendation: 'HUMAN_REVIEW', triggered_rules: ['HARD-STOP'], reason: 'HARD-STOP' });
        await appModule.processInvoice('INV-J3', { tracking_id: 'INV-J3', total: '25.00', currency: 'USD' });
        await flushPromises();
        expect(overrideMock.applyOverride).toHaveBeenCalled();
    }, 15000);

    test('Journey 4: fallback when MongoDB fails', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        let callCount = 0;
        dbMock.saveInvoiceToMongo.mockImplementation(async (inv) => {
            callCount++;
            if (callCount === 2) {
                throw new Error('MongoDB Connection Timeout');
            }
            return inv;
        });

        await appModule.processInvoice('INV-J4', { tracking_id: 'INV-J4', total: '15.00', currency: 'USD' });
        await flushPromises();

        expect(mockPubSubPublish).toHaveBeenCalled();
        const topics = mockPubSubPublish.mock.calls.map(c => c[1]);
        expect(topics).toContain('invoice.review');

        errorSpy.mockRestore();
    }, 15000);
});