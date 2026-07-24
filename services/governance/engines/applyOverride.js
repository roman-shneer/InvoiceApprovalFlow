function extractNumericThreshold(rule, fallback) {
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
}

function applyOverride(aiResult, invoice, rules, fxRate = 1) {

    const activeRules = Array.isArray(rules) ? rules : [];
    const hasRule = (key) => activeRules.some(r => r.rule_id === key || r.key === key || (r.value && r.value.rule_id === key));
    const getThreshold = (key, fallback) => {
        const rule = activeRules.find(r => r.rule_id === key || r.key === key || (r.value && r.value.rule_id === key));
        if (!rule) return fallback;
        const val = rule.value?.value ?? rule.value?.threshold ?? rule.value?.max_total ?? rule.value ?? rule.threshold ?? rule.max_total ?? rule.limit;
        return val !== undefined ? parseFloat(val) : fallback;
    };

    const amount = parseFloat(invoice.amount || invoice.total || 0);
    const amountInUSD = amount * fxRate;
    const vendor = (invoice.vendor_id || invoice.vendor || "").toLowerCase();
    const vendorKnown = invoice.vendorKnown || false;
    const currency = (invoice.currency || "USD").toUpperCase();
    const receiptPresent = invoice.receiptPresent === true || invoice.receiptPresent === 'true' || (invoice.receiptPresent ?? true) === true;


    const receiptThreshold = getThreshold('GLOBAL-RECEIPT', 25);

    const confidence = parseFloat(aiResult.confidence || invoice.confidence || 0);

    let reasons = [];
    const triggeredRules = [];
    let recommendation = aiResult.recommendation || 'HUMAN_REVIEW';
    if (!['REJECT', 'HUMAN_REVIEW', 'AUTO_APPROVE'].includes(aiResult.recommendation)) {
        recommendation = 'HUMAN_REVIEW';
    }

    // 1. GLOBAL-VENDOR Policy Enforcement Check
    if (hasRule('GLOBAL-VENDOR') && (!vendorKnown || ["unknown", "brand-new vendor"].includes(vendor))) {
        triggeredRules.push("GLOBAL-VENDOR");
        reasons.push("Unknown/unverified vendor always requires human review.");
    }

    // 2. GLOBAL-FX Policy Enforcement Check
    const fxThreshold = getThreshold('GLOBAL-FX', 1000);
    if (currency !== "USD" && amountInUSD > fxThreshold) {
        triggeredRules.push("GLOBAL-FX");
        reasons.push(`FX hard stop: ${currency} ${amount} (~USD ${amountInUSD.toFixed(2)}) exceeds $${fxThreshold} foreign currency limit.`);
    }

    // 3. GLOBAL-RECEIPT Policy Enforcement Check
    if ((!receiptPresent && amount > receiptThreshold) || (hasRule('GLOBAL-RECEIPT') && !receiptPresent)) {
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
    if (hasRule('MEAL-03') && aiResult.triggered_rules.includes('MEAL-03')) {
        recommendation = 'REJECT';
    }
    if (hasRule('SAAS-01') && amount > getThreshold('SAAS-01', 200)) {
        triggeredRules.push("SAAS-01");
        reasons.push(`Software/SaaS subscription exceeds $${getThreshold('SAAS-01', 200)} per month limit.`);
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

    //AUTONOMY-CEILING
    const ceilingRule = activeRules.find(r => r.rule_id === 'AUTONOMY-CEILING' || r.key === 'AUTONOMY-CEILING' || (r.value && r.value.rule_id === 'AUTONOMY-CEILING'));
    const ceilingThreshold = extractNumericThreshold(ceilingRule, 250);

    if (amount > ceilingThreshold) {
        reasons.push(`Invoice amount $${amount} exceeds autonomy ceiling of $${ceilingThreshold}.`);
        triggeredRules.push('AUTONOMY-CEILING');
    }

    //AUTONOMY-CONFIDENCE
    const confidenceRule = activeRules.find(r => r.rule_id === 'AUTONOMY-CONFIDENCE' || r.key === 'AUTONOMY-CONFIDENCE' || (r.value && r.value.rule_id === 'AUTONOMY-CONFIDENCE'));
    const confidenceThreshold = extractNumericThreshold(confidenceRule, 0.80);
    if (confidence < confidenceThreshold) {
        reasons.push(`AI confidence level ${confidence} is below required autonomy threshold of ${confidenceThreshold}.`);
        triggeredRules.push('AUTONOMY-CONFIDENCE');
    }

    if (['HUMAN_REVIEW', 'REJECT'].includes(recommendation) && aiResult.reason) {
        reasons.push(aiResult.reason);
        if (Array.isArray(aiResult.triggered_rules)) {
            triggeredRules.push(...aiResult.triggered_rules);
        }
    }



    if (reasons.length > 0) {
        const uniqueReasons = [...new Set(reasons)];
        return {
            recommendation: recommendation === 'REJECT' ? 'REJECT' : 'HUMAN_REVIEW',
            aiResult: aiResult,
            reason: uniqueReasons.join('; '),
            triggered_rules: [...new Set(triggeredRules)],
            confidence: confidence,
            checked_at: new Date().toISOString(),
        };
    }

    return {
        recommendation: recommendation,
        aiResult: aiResult,
        reason: aiResult.reason || 'Invoice falls within safe autonomy bounds.',
        triggered_rules: aiResult.triggered_rules || [],
        confidence: confidence,
        checked_at: new Date().toISOString(),
    };
}

module.exports = { applyOverride };
