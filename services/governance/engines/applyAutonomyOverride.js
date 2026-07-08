const AUTONOMY = {
    CEILING: 250,        // USD
    CONFIDENCE: 0.8,
    HARDSTOPS: ["GLOBAL-VENDOR", "GLOBAL-FX", "GLOBAL-MATH", "GLOBAL-FRAUD", "GLOBAL-RECEIPT"]
};
function applyAutonomyOverride(aiResult, invoice, rules) {
    const activeRules = Array.isArray(rules) ? rules : [];
    const amount = parseFloat(invoice.amount || invoice.total || 0);
    const confidence = parseFloat(aiResult.confidence || invoice.confidence || 0);

    const extractNumericThreshold = (rule, fallback) => {
        if (!rule) return fallback;
        const candidates = [
            rule.rule_text,
            rule.value?.rule_text,
            rule.value?.value,
            rule.value?.threshold,
            rule.value,
            rule.threshold
        ];
        for (const candidate of candidates) {
            if (candidate === undefined || candidate === null) continue;
            const parsed = parseFloat(candidate);
            if (!Number.isNaN(parsed)) return parsed;
        }
        return fallback;
    };

    const ceilingRule = activeRules.find(r => r.rule_id === 'AUTONOMY-CEILING' || r.key === 'AUTONOMY-CEILING' || (r.value && r.value.rule_id === 'AUTONOMY-CEILING'));
    const ceilingThreshold = extractNumericThreshold(ceilingRule, 250);

    const confidenceRule = activeRules.find(r => r.rule_id === 'AUTONOMY-CONFIDENCE' || r.key === 'AUTONOMY-CONFIDENCE' || (r.value && r.value.rule_id === 'AUTONOMY-CONFIDENCE'));
    const confidenceThreshold = extractNumericThreshold(confidenceRule, 0.80);

    const reasons = [];
    const triggeredRules = [];

    if (amount > ceilingThreshold) {
        reasons.push(`Invoice amount $${amount} exceeds autonomy ceiling of $${ceilingThreshold}.`);
        triggeredRules.push('AUTONOMY-CEILING');
    }

    if (confidence < confidenceThreshold) {
        reasons.push(`AI confidence level ${confidence} is below required autonomy threshold of ${confidenceThreshold}.`);
        triggeredRules.push('AUTONOMY-CONFIDENCE');
    }

    if (aiResult.recommendation === 'HUMAN_REVIEW' && aiResult.reason) {
        reasons.push(aiResult.reason);
        if (Array.isArray(aiResult.triggered_rules)) {
            triggeredRules.push(...aiResult.triggered_rules);
        }
    }

    if (reasons.length > 0) {
        return {
            recommendation: 'HUMAN_REVIEW',
            reason: reasons.join('; '),
            triggered_rules: [...new Set(triggeredRules)]
        };
    }

    return {
        recommendation: aiResult.recommendation || 'AUTO_APPROVE',
        reason: aiResult.reason || 'Invoice falls within safe autonomy bounds.',
        triggered_rules: aiResult.triggered_rules || []
    };
}

module.exports = { applyAutonomyOverride };
