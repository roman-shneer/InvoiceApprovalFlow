const AUTONOMY = {
    CEILING: 250,        // USD
    CONFIDENCE: 0.8,
    HARDSTOPS: ["GLOBAL-VENDOR", "GLOBAL-FX", "GLOBAL-MATH", "GLOBAL-FRAUD", "GLOBAL-RECEIPT"]
};
function applyAutonomyOverride(aiResult, invoice, rules) {
    const activeRules = Array.isArray(rules) ? rules : [];
    const amount = parseFloat(invoice.amount || invoice.total || 0);

    const confidence = parseFloat(aiResult.confidence || invoice.confidence || 0);

    const ceilingRule = activeRules.find(r => r.rule_id === 'AUTONOMY-CEILING' || r.key === 'AUTONOMY-CEILING' || (r.value && r.value.rule_id === 'AUTONOMY-CEILING'));
    const ceilingThreshold = ceilingRule ? parseFloat(ceilingRule.value?.value ?? ceilingRule.value?.threshold ?? ceilingRule.value ?? ceilingRule.threshold ?? 250) : 250;

    const confidenceRule = activeRules.find(r => r.rule_id === 'AUTONOMY-CONFIDENCE' || r.key === 'AUTONOMY-CONFIDENCE' || (r.value && r.value.rule_id === 'AUTONOMY-CONFIDENCE'));
    const confidenceThreshold = confidenceRule ? parseFloat(confidenceRule.value?.value ?? confidenceRule.value?.threshold ?? confidenceRule.value ?? confidenceRule.threshold ?? 0.80) : 0.80;

    if (amount > ceilingThreshold) {
        return {
            recommendation: 'HUMAN_REVIEW',
            reason: `Invoice amount $${amount} exceeds autonomy ceiling of $${ceilingThreshold}.`,
            triggered_rules: ['AUTONOMY-CEILING']
        };
    }

    if (confidence < confidenceThreshold) {
        return {
            recommendation: 'HUMAN_REVIEW',
            reason: `AI confidence level ${confidence} is below required autonomy threshold of ${confidenceThreshold}.`,
            triggered_rules: ['AUTONOMY-CONFIDENCE']
        };
    }

    return {
        recommendation: aiResult.recommendation || 'AUTO_APPROVE',
        reason: aiResult.reason || 'Invoice falls within safe autonomy bounds.',
        triggered_rules: aiResult.triggered_rules || []
    };
}

module.exports = { applyAutonomyOverride };
