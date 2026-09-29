let mockStateSave: jest.Mock;
let mockStateQuery: jest.Mock;
let mockPubSubPublish: jest.Mock;

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

import { DaprClient } from '@dapr/dapr';
import { saveInvoiceToMongo, getPolicies } from '../resources/db';

// ---- INLINE TYPES ----
interface Invoice {
    tracking_id: string;
    correlation_id: string;
    vendor: string;
    total: number;
    status: string;
}

interface Policy {
    rule_id: string;
    category: string;
    is_active: boolean;
}

describe('Governance resources/db', () => {
    let localMockSave: jest.Mock;
    let localMockQuery: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        const mockClient = new (DaprClient as any)();
        localMockSave = mockClient.state.save;
        localMockQuery = mockClient.state.query;
    });

    test('saveInvoiceToMongo stores invoice with createdAt and uses tracking_id as key', async () => {
        const invoice: Invoice = {
            tracking_id: 'INV-1001',
            correlation_id: 'corr-1',
            vendor: 'Test Vendor',
            total: 123.45,
            status: 'PENDING'
        };

        localMockSave.mockResolvedValue(true);

        await saveInvoiceToMongo(invoice as any);

        expect(localMockSave).toHaveBeenCalledWith('mongo-invoices', [
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
        localMockQuery.mockResolvedValue({
            results: [
                { data: { rule_id: 'RULE1', category: 'compliance', 'is_active': true } },
                { value: { rule_id: 'RULE2', category: 'finance', 'is_active': true } }
            ]
        });

        const activeRules = await getPolicies();

        expect(localMockQuery).toHaveBeenCalledWith('mongo-policies', {
            filter: {
                EQ: {
                    is_active: true
                }
            },
            page: { limit: 100 }
        });
        expect(activeRules).toEqual([
            { rule_id: 'RULE1', category: 'compliance', 'is_active': true },
            { rule_id: 'RULE2', category: 'finance', 'is_active': true }
        ]);
    });
});