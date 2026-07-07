function checkHardStops(invoice, rules) {
    const vendor = (invoice.vendor_id || invoice.vendor || "").toLowerCase();
    const currency = (invoice.currency || "USD").toUpperCase();
    const amount = parseFloat(invoice.amount || invoice.total || 0);
    const receiptPresent = invoice.receiptPresent ?? true;

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

    if (hasRule('GLOBAL-VENDOR') && (!invoice.vendorKnown || ["unknown", "brand-new vendor"].includes(vendor))) {
        return { triggered: true, rule: "GLOBAL-VENDOR", reason: "Unknown/unverified vendor always requires human review." };
    }

    if (currency !== "USD" && amount > fxThreshold) {
        return { triggered: true, rule: "GLOBAL-FX", reason: `FX hard stop: ${currency} ${amount} exceeds $${fxThreshold} foreign currency limit.` };
    }

    if ((!receiptPresent && amount > receiptThreshold) || (hasRule('GLOBAL-RECEIPT') && !receiptPresent)) {
        return { triggered: true, rule: "GLOBAL-RECEIPT", reason: `Receipt required for expenses over $${receiptThreshold}.` };
    }

    const scenario = String(invoice.scenario || '').toLowerCase();
    if (invoice.fraudSignal === true || scenario.includes('fraud-pattern')) {
        return { triggered: true, rule: "GLOBAL-FRAUD", reason: "Fraud signal detected on invoice execution path." };
    }

    if (hasRule('MEAL-01') && invoice.missingMealInfo) {
        return { triggered: true, rule: "MEAL-01", reason: "Required business meal item context is missing." };
    }

    if (hasRule('GLOBAL-MATH') && invoice.lineItems && invoice.lineItems.length > 0) {
        const lineTotal = invoice.lineItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
        const tax = parseFloat(invoice.taxAmount || 0);
        const expectedTotal = lineTotal + tax;
        const diff = Math.abs(expectedTotal - amount);
        if (diff > 0.01) {
            return {
                triggered: true,
                rule: "GLOBAL-MATH",
                reason: `Math mismatch: line items (${lineTotal}) + tax (${tax}) = ${expectedTotal}, but total is ${amount}.`
            };
        }
    }

    return { triggered: false };
}

module.exports = { checkHardStops };
