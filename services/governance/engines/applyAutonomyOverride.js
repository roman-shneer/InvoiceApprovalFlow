const AUTONOMY = {
    CEILING: 250,        // USD
    CONFIDENCE: 0.8,
    HARDSTOPS: ["GLOBAL-VENDOR", "GLOBAL-FX", "GLOBAL-MATH", "GLOBAL-FRAUD", "GLOBAL-RECEIPT"]
};
function applyAutonomyOverride(aiResult, invoice) {
    const amount = parseFloat(invoice.amount || invoice.total || 0);
    const currency = (invoice.currency || "USD").toUpperCase();


    const usdAmount = currency === "USD" ? amount : amount * 1.1;

    if (aiResult.recommendation === "AUTO_APPROVE") {
        // Ceiling check
        if (usdAmount > AUTONOMY.CEILING) {
            return {
                recommendation: "HUMAN_REVIEW",
                reason: `Autonomy ceiling override: $${usdAmount} exceeds max auto-approve limit ($${AUTONOMY.CEILING}).`,
                triggered_rules: ["AUTONOMY-CEILING"]
            };
        }

        // Confidence check
        if ((aiResult.confidence || 1.0) < AUTONOMY.CONFIDENCE) {
            return {
                recommendation: "HUMAN_REVIEW",
                reason: `Low confidence override: ${aiResult.confidence} < required ${AUTONOMY.CONFIDENCE}.`,
                triggered_rules: ["AUTONOMY-CONFIDENCE"]
            };
        }
    }

    return aiResult;
}
module.exports = { applyAutonomyOverride };