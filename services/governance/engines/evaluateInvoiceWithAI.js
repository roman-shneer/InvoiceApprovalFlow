function evaluateInvoiceWithAI(invoice, rules) {
    const total = parseFloat(invoice.total || 0);
    const category = invoice.category || "General";
    const vendor = invoice.vendor || "Unknown";

    let recommendation = "AUTO_APPROVE";
    let triggeredRules = [];
    let reason = "All automated compliance checks passed successfully.";

    const dbRuleIds = new Set(
        rules
            .filter(r => r.category === category || r.category === "Global rules")
            .map(r => r.rule_id)
    );

    if (dbRuleIds.has("GLOBAL-VENDOR") && ["unknown", "brand-new vendor"].includes(vendor.toLowerCase())) {
        return {
            recommendation: "HUMAN_REVIEW",
            triggeredRules: ["GLOBAL-VENDOR"],
            reason: `Flagged by GLOBAL-VENDOR: Vendor '${vendor}' is not verified.`
        };
    }

    if (category === "Meals & Entertainment" && dbRuleIds.has("MEAL-02") && total > 500) {
        recommendation = "HUMAN_REVIEW";
        triggeredRules.push("MEAL-02");
        reason = "Violation of MEAL-02: Entertainment expenses exceeding $500 require manual review.";
    } else if (category === "Travel" && dbRuleIds.has("TRAVEL-02") && total > 1500) {
        recommendation = "HUMAN_REVIEW";
        triggeredRules.push("TRAVEL-02");
        reason = "Hard stop by TRAVEL-02: Travel expenses exceeding $1,500 require manager approval.";
    }

    return { recommendation, triggeredRules, reason };
}
module.exports = { evaluateInvoiceWithAI };