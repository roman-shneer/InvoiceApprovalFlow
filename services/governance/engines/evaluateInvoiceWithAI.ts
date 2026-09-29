// ---- INLINE TYPES ----
interface Invoice {
    total?: string | number;
    category?: string;
    vendor?: string;
    vendorKnown?: boolean;
    [key: string]: any;
}

interface Rule {
    rule_id?: string;
    category?: string;
    [key: string]: any;
}

interface FallbackResult {
    recommendation: 'AUTO_APPROVE' | 'HUMAN_REVIEW' | 'REJECT';
    triggered_rules: string[];
    reason: string;
    confidence: number;
    model: string;
}

/**
 * Hardcoded rule-engine fallback heuristics when LLM/RAG engine fails.
 */
function evaluateInvoiceWithAI(invoice: Invoice, rules: Rule[]): FallbackResult {
    const total: number = parseFloat((invoice.total || 0) as any);
    const category: string = String(invoice.category || "General").toLowerCase();
    const vendor: string = String(invoice.vendor || "Unknown").toLowerCase();
    const vendorKnown: boolean = invoice.vendorKnown || false;

    let recommendation: FallbackResult['recommendation'] = "AUTO_APPROVE";
    let triggered_rules: string[] = [];
    let reason: string = "All automated compliance checks passed successfully.";

    // Convert rule array into a Set of IDs for O(1) matching
    const dbRuleIds = new Set<string>(
        rules
            .filter(r => {
                const ruleCat = String(r.category || "").toLowerCase();
                return ruleCat === category || ruleCat === "global rules";
            })
            .map(r => String(r.rule_id).toUpperCase())
    );

    // 1. Global Vendor Validation Check
    if (dbRuleIds.has("GLOBAL-VENDOR") && (["unknown", "brand-new vendor", "unverified"].includes(vendor) || vendorKnown === false)) {
        return {
            recommendation: "HUMAN_REVIEW",
            triggered_rules: ["GLOBAL-VENDOR"],
            reason: `Flagged by GLOBAL-VENDOR: Vendor '${invoice.vendor}' is unverified in system database.`,
            confidence: 0.0,
            model: "FALLBACK_RULE_ENGINE"
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

    const confidence: number = recommendation === "AUTO_APPROVE" ? 1.0 : 0.0;
    const model = "FALLBACK_RULE_ENGINE";
    return { recommendation, triggered_rules, reason, confidence, model };
}

export { evaluateInvoiceWithAI };
export type { Invoice, Rule, FallbackResult };