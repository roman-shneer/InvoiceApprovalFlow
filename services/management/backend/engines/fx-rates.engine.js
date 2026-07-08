class FxRatesEngine {
    normalizeCode(rawCode) {
        return String(rawCode || '').trim().toUpperCase();
    }

    parseRate(rawRate) {
        const parsed = parseFloat(rawRate);
        if (Number.isNaN(parsed) || !Number.isFinite(parsed) || parsed <= 0) {
            return null;
        }
        return parsed;
    }

    normalizeQueryRow(item) {
        const doc = item?.data || item?.value || {};
        const code = this.normalizeCode(doc._id || doc._key || item?.key);
        if (!code) {
            return null;
        }

        const rate = this.parseRate(doc.value?.rate ?? doc.rate ?? 1);

        return {
            _id: code,
            _key: code,
            value: { rate: rate ?? 1 },
            _etag: doc._etag || null,
            _ttl: doc._ttl ?? null
        };
    }

    buildStateRecord(ratePayload, etag) {
        const code = this.normalizeCode(ratePayload?._id || ratePayload?._key || ratePayload?.code);
        const rate = this.parseRate(ratePayload?.value?.rate ?? ratePayload?.rate);

        if (!code || rate === null) {
            return null;
        }

        return {
            _id: code,
            _key: code,
            value: { rate },
            _etag: etag || null,
            _ttl: null
        };
    }
}

module.exports = FxRatesEngine;