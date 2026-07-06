let mockStateSave;
let mockStateQuery;
let mockPubSubPublish;

jest.mock('@dapr/dapr', () => {
    mockStateSave = jest.fn();
    mockStateQuery = jest.fn();
    mockPubSubPublish = jest.fn();
    return {
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
                subscribe: jest.fn()
            },
            start: jest.fn().mockResolvedValue(true)
        })),
        __esModule: true
    };
});

const { DaprClient } = require('@dapr/dapr');
const { saveInvoiceToMongo, getPolicies } = require('../resources/db');



describe('Governance resources/db', () => {
    let mockStateSave;
    let mockStateQuery;

    beforeEach(() => {
        jest.clearAllMocks();
        const mockClient = new DaprClient();
        mockStateSave = mockClient.state.save;
        mockStateQuery = mockClient.state.query;
    });

    test('saveInvoiceToMongo stores invoice with createdAt and uses tracking_id as key', async () => {
        const invoice = {
            tracking_id: 'INV-1001',
            correlation_id: 'corr-1',
            vendor: 'Test Vendor',
            total: 123.45,
            status: 'PENDING'
        };

        mockStateSave.mockResolvedValue(true);

        await saveInvoiceToMongo(invoice);

        expect(mockStateSave).toHaveBeenCalledWith('mongo-invoices', [
            expect.objectContaining({
                key: 'INV-1001',
                value: expect.objectContaining({
                    tracking_id: 'INV-1001',
                    correlation_id: 'corr-1',
                    status: 'PENDING',
                    createdAt: expect.any(String)
                })
            })
        ]);
    });

    test('getPolicies returns active rules from mongo-policies state store', async () => {
        mockStateQuery.mockResolvedValue({
            results: [
                { data: { rule_id: 'RULE1', category: 'compliance' } },
                { value: { rule_id: 'RULE2', category: 'finance' } }
            ]
        });

        const activeRules = await getPolicies();

        expect(mockStateQuery).toHaveBeenCalledWith('mongo-policies', {
            filter: {},
            page: { limit: 100 }
        });
        expect(activeRules).toEqual([
            { rule_id: 'RULE1', category: 'compliance' },
            { rule_id: 'RULE2', category: 'finance' }
        ]);
    });
});
