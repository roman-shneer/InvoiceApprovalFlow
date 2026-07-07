function checkHardStops(invoice, rules) {
    const vendor = (invoice.vendor_id || invoice.vendor || "").toLowerCase();
    const currency = (invoice.currency || "USD").toUpperCase();
    const amount = parseFloat(invoice.amount || invoice.total || 0);

    // Strict type casing normalization for boolean attributes flags
    const receiptPresent = invoice.receiptPresent === true || invoice.receiptPresent === 'true' || (invoice.receiptPresent ?? true) === true;

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

    const triggeredRules = [];
    const reasons = [];

    // 1. GLOBAL-VENDOR Policy Enforcement Check
    if (hasRule('GLOBAL-VENDOR') && (!invoice.vendorKnown || ["unknown", "brand-new vendor"].includes(vendor))) {
        triggeredRules.push("GLOBAL-VENDOR");
        reasons.push("Unknown/unverified vendor always requires human review.");
    }

    // 2. GLOBAL-FX Policy Enforcement Check
    if (currency !== "USD" && amount > fxThreshold) {
        triggeredRules.push("GLOBAL-FX");
        reasons.push(`FX hard stop: ${currency} ${amount} exceeds $${fxThreshold} foreign currency limit.`);
    }

    // 3. GLOBAL-RECEIPT Policy Enforcement Check
    if (hasRule('GLOBAL-RECEIPT') && receiptPresent == false && (amount > receiptThreshold)) {
        console.log(`GLOBAL_RECEIPT triggered: receiptPresent=${receiptPresent}, amount=${amount}, receiptThreshold=${receiptThreshold}`);
        triggeredRules.push("GLOBAL-RECEIPT");
        reasons.push(`Receipt required for expenses over $${receiptThreshold}.`);
    }

    // 4. GLOBAL-FRAUD Policy Enforcement Check
    const scenario = String(invoice.scenario || '').toLowerCase();
    if (invoice.fraudSignal === true || scenario.includes('fraud-pattern') || hasRule('GLOBAL-FRAUD')) {
        // Enforce trigger only if real fraud indicators exist in execution bounds context
        if (invoice.fraudSignal === true || scenario.includes('fraud-pattern')) {
            triggeredRules.push("GLOBAL-FRAUD");
            reasons.push("Fraud signal detected on invoice execution path.");
        }
    }

    // 5. MEAL-01 Policy Enforcement Check
    if (hasRule('MEAL-01') && invoice.missingMealInfo) {
        triggeredRules.push("MEAL-01");
        reasons.push("Required business meal item context is missing.");
    }

    // 6. GLOBAL-MATH Policy Enforcement Check (Triggers strictly on actual mathematical mismatches)
    if (invoice.lineItems && invoice.lineItems.length > 0) {
        const lineTotal = invoice.lineItems.reduce((sum, item) => {
            const qty = parseFloat(item.quantity || item.qty || 0);
            const price = parseFloat(item.unitPrice || item.unit_price || item.amount || 0);
            return sum + (qty * price);
        }, 0);
        const tax = parseFloat(invoice.taxAmount || invoice.tax_amount || invoice.tax || 0);
        const expectedTotal = lineTotal + tax;

        if (Math.abs(expectedTotal - amount) > 0.01) {
            triggeredRules.push("GLOBAL-MATH");
            reasons.push(`Math mismatch: line items (${lineTotal}) + tax (${tax}) = ${expectedTotal}, but total is ${amount}.`);
        }
    }

    // Compile and return the multi-rule evaluation matrix schema payload to the orchestrator execution pipeline
    if (triggeredRules.length > 0) {
        return {
            triggered: true,
            rules: triggeredRules,
            reason: reasons.join(" | ")
        };
    }

    return { triggered: false };
}

module.exports = { checkHardStops };
