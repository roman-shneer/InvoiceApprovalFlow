class BudgetsEngine {
    normalizeDepartment(rawDepartment) {
        return String(rawDepartment || '').trim();
    }

    parseAmount(rawAmount) {
        const parsed = parseFloat(rawAmount);
        if (Number.isNaN(parsed) || !Number.isFinite(parsed) || parsed < 0) {
            return null;
        }
        return parsed;
    }

    normalizeQueryRow(item) {
        const doc = item?.data || item?.value || {};
        const department = this.normalizeDepartment(doc._id || doc._key || doc.value?.department || item?.key);
        if (!department) {
            return null;
        }

        const amount = this.parseAmount(doc.value?.amount ?? doc.amount);

        return {
            _id: department,
            _key: department,
            value: {
                department,
                amount: amount ?? 0
            },
            _etag: doc._etag || null,
            _ttl: doc._ttl ?? null
        };
    }

    buildStateRecord(budgetPayload, etag) {
        const department = this.normalizeDepartment(
            budgetPayload?._id || budgetPayload?._key || budgetPayload?.department || budgetPayload?.value?.department
        );
        const amount = this.parseAmount(budgetPayload?.value?.amount ?? budgetPayload?.amount);

        if (!department || amount === null) {
            return null;
        }

        return {
            _id: department,
            _key: department,
            value: {
                department,
                amount
            },
            _etag: etag || null,
            _ttl: null
        };
    }
}

module.exports = BudgetsEngine;