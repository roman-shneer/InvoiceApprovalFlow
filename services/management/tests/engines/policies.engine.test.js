const PoliciesEngine = require('../../backend/engines/policies.engine');

describe('PoliciesEngine', () => {
    test('accepts well-formed policy payloads', () => {
        const engine = new PoliciesEngine();

        expect(engine.isValidPolicy({
            rule_id: 'RULE-1',
            category: 'compliance',
            rule_text: 'Require approval above threshold'
        })).toBe(true);
    });

    test('rejects malformed policy payloads', () => {
        const engine = new PoliciesEngine();

        expect(engine.isValidPolicy({ rule_id: 'RULE-1', category: 'compliance' })).toBe(false);
        expect(engine.isValidPolicy({ rule_id: 123, category: 'compliance', rule_text: 'x' })).toBe(false);
    });
});
