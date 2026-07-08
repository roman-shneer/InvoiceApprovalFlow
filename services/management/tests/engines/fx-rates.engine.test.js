const FxRatesEngine = require('../../backend/engines/fx-rates.engine');

describe('FxRatesEngine', () => {
    test('normalizes query row from state store shape', () => {
        const engine = new FxRatesEngine();

        const normalized = engine.normalizeQueryRow({
            key: 'eur',
            data: {
                _id: 'eur',
                value: { rate: '1.09' },
                _etag: 'abc'
            }
        });

        expect(normalized).toEqual({
            _id: 'EUR',
            _key: 'EUR',
            value: { rate: 1.09 },
            _etag: 'abc',
            _ttl: null
        });
    });

    test('builds state record for valid payload', () => {
        const engine = new FxRatesEngine();

        const record = engine.buildStateRecord({
            _id: 'usd',
            value: { rate: '1.0' }
        }, 'etag-1');

        expect(record).toEqual({
            _id: 'USD',
            _key: 'USD',
            value: { rate: 1 },
            _etag: 'etag-1',
            _ttl: null
        });
    });

    test('returns null for invalid payloads', () => {
        const engine = new FxRatesEngine();

        expect(engine.buildStateRecord({ _id: '', value: { rate: 1 } }, 'x')).toBeNull();
        expect(engine.buildStateRecord({ _id: 'USD', value: { rate: 0 } }, 'x')).toBeNull();
        expect(engine.buildStateRecord({ _id: 'USD', value: { rate: 'abc' } }, 'x')).toBeNull();
    });
});