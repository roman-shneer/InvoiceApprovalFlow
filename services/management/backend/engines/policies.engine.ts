// @ts-nocheck
class PoliciesEngine {
    isValidPolicy(policy) {
        if (!policy.rule_id || typeof policy.rule_id !== 'string') return false;
        if (!policy.category || typeof policy.category !== 'string') return false;
        if (!policy.rule_text || typeof policy.rule_text !== 'string') return false;

        return true;
    }
}

module.exports = PoliciesEngine;
