const PoliciesRepository = require('../../backend/resources/policies.repository');

describe('PoliciesRepository', () => {
    test('find, save and delete policies through Dapr state', async () => {
        const daprClient = {
            state: {
                query: jest.fn().mockResolvedValue({
                    results: [
                        { data: { rule_id: 'RULE-1', category: 'compliance' } },
                        { value: { rule_id: 'RULE-2', category: 'finance' } }
                    ]
                }),
                save: jest.fn().mockResolvedValue(true),
                delete: jest.fn().mockResolvedValue(true)
            }
        };
        const repository = new PoliciesRepository(daprClient);

        await expect(repository.find()).resolves.toEqual([
            { rule_id: 'RULE-1', category: 'compliance' },
            { rule_id: 'RULE-2', category: 'finance' }
        ]);
        await expect(repository.save({ rule_id: 'RULE-3', category: 'ops' })).resolves.toEqual({ rule_id: 'RULE-3', category: 'ops' });
        await expect(repository.delete('RULE-3')).resolves.toBe(true);

        expect(daprClient.state.save).toHaveBeenCalledWith('mongo-policies', [
            { key: 'RULE-3', value: { rule_id: 'RULE-3', category: 'ops' } }
        ]);
    });
});
