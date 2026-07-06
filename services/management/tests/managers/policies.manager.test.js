const PoliciesManager = require('../../backend/managers/policies.manager');

describe('PoliciesManager', () => {
    test('normalizes createdAt values from multiple input shapes', () => {
        const manager = new PoliciesManager({}, {});

        expect(manager.normalizeCreatedAt('2024-01-01T00:00:00.000Z')).toBe('2024-01-01T00:00:00.000Z');
        expect(manager.normalizeCreatedAt(new Date('2024-01-01T00:00:00.000Z'))).toBe('2024-01-01T00:00:00.000Z');
        expect(manager.normalizeCreatedAt({ $date: '2024-01-01T00:00:00.000Z' })).toBe('2024-01-01T00:00:00.000Z');
    });

    test('rejects invalid policies and saves valid ones', async () => {
        const resource = {
            find: jest.fn().mockResolvedValue([{ rule_id: 'RULE-1' }]),
            save: jest.fn().mockImplementation(async (policy) => policy),
            delete: jest.fn().mockResolvedValue(true)
        };
        const engine = {
            isValidPolicy: jest.fn().mockReturnValue(false)
        };
        const manager = new PoliciesManager(resource, engine);

        await expect(manager.savePolicy({ rule_id: 'RULE-1' })).resolves.toEqual({
            success: false,
            error: 'Invalid data format'
        });

        engine.isValidPolicy.mockReturnValueOnce(true);
        await expect(manager.savePolicy({
            rule_id: 'RULE-1',
            category: 'compliance',
            rule_text: 'Keep approvals visible'
        })).resolves.toEqual({
            success: true,
            data: expect.objectContaining({
                rule_id: 'RULE-1',
                category: 'compliance',
                rule_text: 'Keep approvals visible',
                created_at: expect.any(String)
            })
        });
        expect(resource.save).toHaveBeenCalledWith(expect.objectContaining({
            rule_id: 'RULE-1',
            category: 'compliance',
            rule_text: 'Keep approvals visible',
            created_at: expect.any(String)
        }));
    });

    test('loads and deletes policies through the resource layer', async () => {
        const resource = {
            find: jest.fn().mockResolvedValue([{ rule_id: 'RULE-1' }]),
            save: jest.fn(),
            delete: jest.fn().mockResolvedValue(true)
        };
        const manager = new PoliciesManager(resource, { isValidPolicy: jest.fn().mockReturnValue(true) });

        await expect(manager.loadPolicies()).resolves.toEqual([{ rule_id: 'RULE-1' }]);
        await expect(manager.deletePolicy('RULE-1')).resolves.toBe(true);
    });
});
