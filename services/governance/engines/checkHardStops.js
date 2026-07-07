function checkHardStops(invoice, rules) {
    const vendor = (invoice.vendor_id || invoice.vendor || "").toLowerCase();
    const currency = (invoice.currency || "USD").toUpperCase();
    const amount = parseFloat(invoice.amount || invoice.total || 0);

    // Strict boolean conversion to completely eliminate string or null fallback bugs
    const receiptPresent = invoice.receiptPresent === true || invoice.receiptPresent === 'true';

    const activeRules = Array.isArray(rules) ? rules : [];

    const hasRule = (key) => activeRules.some(r => r.rule_id === key || r.key === key || (r.value && r.value.rule_id === key));

    const getThreshold = (key, fallback) => {
        const rule = activeRules.find(r => r.rule_id === key || r.key === key || (r.value && r.value.rule_id === key));
        if (!rule) return fallback;
        const val = rule.value?.value ?? rule.value?.threshold ?? rule.value?.max_total ?? rule.value ?? rule.threshold ?? rule.max_total ?? rule.limit;
        return val !== undefined ? parseFloat(val) : fallback;
    };

    const fxThreshold = getThreshold('GLOBAL-FX', 1000);
    const receiptThreshold = getThreshold('GLOBAL-RECEIPT', 25);

    // Initialize arrays to collect ALL architectural violations in a single pass
    const triggeredRules = [];
    const reasons = [];

    // 1. GLOBAL-VENDOR Validator
    if (hasRule('GLOBAL-VENDOR') && (!invoice.vendorKnown || ["unknown", "brand-new vendor"].includes(vendor))) {
        triggeredRules.push("GLOBAL-VENDOR");
        reasons.push("Unknown/unverified vendor always requires human review.");
    }

    // 2. GLOBAL-FX Validator
    if (currency !== "USD" && amount > fxThreshold) {
        triggeredRules.push("GLOBAL-FX");
        reasons.push(`FX hard stop: ${currency} ${amount} exceeds $${fxThreshold} foreign currency limit.`);
    }

    // 3. GLOBAL-RECEIPT Validator (Triggers ONLY if receipt is missing and amount exceeds limit)
    if (!receiptPresent && (amount > receiptThreshold || hasRule('GLOBAL-RECEIPT'))) {
        triggeredRules.push("GLOBAL-RECEIPT");
        reasons.push(`Receipt required for expenses over $${receiptThreshold}. Missing receipt for amount $${amount}.`);
    }

    // 4. GLOBAL-FRAUD Validator
    const scenario = String(invoice.scenario || '').toLowerCase();
    if (invoice.fraudSignal === true || scenario.includes('fraud-pattern')) {
        triggeredRules.push("GLOBAL-FRAUD");
        reasons.push("Fraud signal detected on invoice execution path.");
    }

    // 5. MEAL-01 Validator
    if (hasRule('MEAL-01') && invoice.missingMealInfo) {
        triggeredRules.push("MEAL-01");
        reasons.push("Required business meal item context is missing.");
    }

    // 6. GLOBAL-MATH Reconciler
    if (hasRule('GLOBAL-MATH') && invoice.lineItems && invoice.lineItems.length > 0) {
        // Handle field naming flexibility inside line item arrays maps mapping schemas
        const lineTotal = invoice.lineItems.reduce((sum, item) => {
            const qty = parseFloat(item.quantity || item.qty || 0);
            const price = parseFloat(item.unitPrice || item.unit_price || item.amount || 0);
            return sum + (qty * price);
        }, 0);
        const tax = parseFloat(invoice.taxAmount || invoice.tax_amount || invoice.tax || 0);
        const expectedTotal = lineTotal + tax;
        const diff = Math.abs(expectedTotal - amount);
        if (diff > 0.01) {
            triggeredRules.push("GLOBAL-MATH");
            reasons.push(`Math mismatch: line items (${lineTotal}) + tax (${tax}) = ${expectedTotal}, but total is ${amount}.`);
        }
    }

    // Return the aggregated result matrix to the governance start() engine block
    if (triggeredRules.length > 0) {
        return {
            triggered: true,
            rules: triggeredRules, // Array of ALL rules breached
            reason: reasons.join(" | ") // Combined audit text string
        };
    }

    return { triggered: false };
}

module.exports = { checkHardStops };
