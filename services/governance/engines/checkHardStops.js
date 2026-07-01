function checkHardStops(invoice, rules) {
    const vendor = (invoice.vendor_id || invoice.vendor || "").toLowerCase();
    const currency = (invoice.currency || "USD").toUpperCase();
    const amount = parseFloat(invoice.amount || invoice.total || 0);
    const receiptPresent = invoice.receiptPresent ?? true;

    // GLOBAL-VENDOR: unknown vendor
    if (!invoice.vendorKnown || ["unknown", "brand-new vendor"].includes(vendor)) {
        return { triggered: true, rule: "GLOBAL-VENDOR", reason: "Unknown/unverified vendor always requires human review." };
    }

    // GLOBAL-FX: foreign currency + amount > $1000
    if (currency !== "USD" && amount > 1000) {
        return { triggered: true, rule: "GLOBAL-FX", reason: `FX hard stop: ${currency} ${amount} exceeds $1000 foreign currency limit.` };
    }

    // GLOBAL-RECEIPT: no receipt when amount > $25
    if (!receiptPresent && amount > 25) {
        return { triggered: true, rule: "GLOBAL-RECEIPT", reason: `Receipt required for expenses over $25.` };
    }

    // GLOBAL-MATH: row sum does not match total
    if (invoice.lineItems && invoice.lineItems.length > 0) {
        const lineTotal = invoice.lineItems.reduce((sum, item) => {
            return sum + (item.quantity * item.unitPrice);
        }, 0);
        const tax = parseFloat(invoice.taxAmount || 0);
        const expectedTotal = lineTotal + tax;

        if (Math.abs(expectedTotal - amount) > 0.01) {
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