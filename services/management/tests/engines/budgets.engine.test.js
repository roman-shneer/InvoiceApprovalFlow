const BudgetsEngine = require('../../backend/engines/budgets.engine');

describe('BudgetsEngine', () => {
    test('normalizes budget row from state store shape', () => {
        const engine = new BudgetsEngine();

        const normalized = engine.normalizeQueryRow({
            key: 'marketing-2026Q2',
            data: {
                _id: 'marketing-2026Q2',
                value: { department: 'marketing-2026Q2', amount: '1000.0' },
                _etag: 'etag-1'
            }
        });

        expect(normalized).toEqual({
            _id: 'marketing-2026Q2',
            _key: 'marketing-2026Q2',
            value: { department: 'marketing-2026Q2', amount: 1000 },
            _etag: 'etag-1',
            _ttl: null
        });
    });

    test('builds state record for valid payload', () => {
        const engine = new BudgetsEngine();

        const record = engine.buildStateRecord({
            _id: 'sales-2026Q2',
            value: { amount: 20000 }
        }, 'etag-x');

        expect(record).toEqual({
            _id: 'sales-2026Q2',
            _key: 'sales-2026Q2',
            value: { department: 'sales-2026Q2', amount: 20000 },
            _etag: 'etag-x',
            _ttl: null
        });
    });

    test('rejects invalid payloads', () => {
        const engine = new BudgetsEngine();

        expect(engine.buildStateRecord({ _id: '', value: { amount: 10 } }, 'etag')).toBeNull();
        expect(engine.buildStateRecord({ _id: 'team', value: { amount: -1 } }, 'etag')).toBeNull();
        expect(engine.buildStateRecord({ _id: 'team', value: { amount: 'abc' } }, 'etag')).toBeNull();
    });
});