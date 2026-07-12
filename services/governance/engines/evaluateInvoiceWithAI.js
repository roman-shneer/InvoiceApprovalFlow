/**
 * Hardcoded rule-engine fallback heuristics when LLM/RAG engine fails.
 * 
 * @param {Object} invoice - The current invoice data payload
 * @param {Array} rules - Fallback active rules fetched from the database
 * @returns {Object} - { recommendation, triggered_rules, reason }
 */
function evaluateInvoiceWithAI(invoice, rules) {
    const total = parseFloat(invoice.total || 0);
    const category = String(invoice.category || "General").toLowerCase();
    const vendor = String(invoice.vendor || "Unknown").toLowerCase();

    let recommendation = "AUTO_APPROVE";
    let triggered_rules = []; // FIXED: Renamed from triggeredRules to match database and test schemas
    let reason = "All automated compliance checks passed successfully.";

    // Convert rule array into a Set of IDs for O(1) matching performance optimization
    // Normalized to handle variations in DB text casing securely
    const dbRuleIds = new Set(
        rules
            .filter(r => {
                const ruleCat = String(r.category || "").toLowerCase();
                return ruleCat === category || ruleCat === "global rules";
            })
            .map(r => String(r.rule_id).toUpperCase())
    );

    // 1. Global Vendor Validation Check
    if (dbRuleIds.has("GLOBAL-VENDOR") && ["unknown", "brand-new vendor", "unverified"].includes(vendor)) {
        return {
            recommendation: "HUMAN_REVIEW",
            triggered_rules: ["GLOBAL-VENDOR"],
            reason: `Flagged by GLOBAL-VENDOR: Vendor '${invoice.vendor}' is unverified in system database.`
        };
    }

    // 2. Category Bounds Evaluations
    if (category.includes("meal") || category.includes("entertainment")) {
        if (dbRuleIds.has("MEAL-02") && total > 500) {
            recommendation = "HUMAN_REVIEW";
            triggered_rules.push("MEAL-02");
            reason = `Violation of MEAL-02: Total amount $${total} exceeds the allowed $500 entertainment ceiling.`;
        }
    } else if (category.includes("travel")) {
        if (dbRuleIds.has("TRAVEL-02") && total > 1500) {
            recommendation = "HUMAN_REVIEW";
            triggered_rules.push("TRAVEL-02");
            reason = `Violation of TRAVEL-02: Total travel amount $${total} exceeds the strict $1,500 manager limit.`;
        }
    }

    return { recommendation, triggered_rules, reason };
}

module.exports = { evaluateInvoiceWithAI };