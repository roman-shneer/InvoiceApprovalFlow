interface RuleValue {
    rule_id?: string;
    rule_text?: any;
    value?: any;
    threshold?: any;
    max_total?: any;
    limit?: any;
    [key: string]: any;
}

interface Rule {
    rule_id?: string;
    key?: string;
    value?: RuleValue | any;
    rule_text?: any;
    threshold?: any;
    max_total?: any;
    limit?: any;
    _id?: string;
    _key?: string;
    [key: string]: any;
}

interface LineItem {
    quantity?: any;
    qty?: any;
    unitPrice?: any;
    unit_price?: any;
    amount?: any;
}

interface Invoice {
    amount?: any;
    total?: any;
    vendor_id?: any;
    vendor?: any;
    vendorKnown?: boolean;
    currency?: any;
    receiptPresent?: any;
    scenario?: any;
    fraudSignal?: boolean;
    missingMealInfo?: boolean;
    category?: any;
    lineItems?: LineItem[];
    taxAmount?: any;
    tax_amount?: any;
    tax?: any;
    confidence?: any;
    [key: string]: any;
}

interface AiResult {
    recommendation?: string;
    reason?: string;
    triggered_rules?: string[];
    confidence?: any;
    [key: string]: any;
}

interface OverrideResult {
    recommendation: string;
    aiResult: AiResult;
    reason: string;
    triggered_rules: string[];
    confidence: number;
    checked_at: string;
}

function extractNumericThreshold(rule: Rule | undefined, fallback: number): number {
    if (!rule) return fallback;
    const candidates = [
        rule.rule_text,
        (rule.value as any)?.rule_text,
        (rule.value as any)?.value,
        (rule.value as any)?.threshold,
        (rule.value as any)?.max_total,
        rule.value,
        rule.threshold,
        rule.max_total,
        (rule as any).limit,
        (rule as any)._id === 'AUTONOMY-CEILING' || (rule as any)._id === 'AUTONOMY-CONFIDENCE' ? undefined : undefined
    ];
    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) continue;
        const parsed = parseFloat(candidate as any);
        if (!Number.isNaN(parsed)) return parsed;
    }
    return fallback;
}

function applyOverride(
    aiResult: AiResult,
    invoice: Invoice,
    rules: Rule[],
    fxRate: number = 1
): OverrideResult {

    const activeRules: Rule[] = Array.isArray(rules) ? rules : [];
    const hasRule = (key: string) => activeRules.some(r =>
        r.rule_id === key || (r as any).key === key || (r.value && r.value.rule_id === key)
    );

    const getThreshold = (key: string, fallback: number): number => {
        const rule = activeRules.find(r =>
            r.rule_id === key || (r as any).key === key || (r.value && r.value.rule_id === key)
        );
        if (!rule) return fallback;
        const raw = (rule.value as any)?.value
            ?? (rule.value as any)?.threshold
            ?? (rule.value as any)?.max_total
            ?? (rule as any).value
            ?? (rule as any).threshold
            ?? (rule as any).max_total
            ?? (rule as any).limit;

        if (raw === undefined || raw === null) return fallback;
        // если value это объект { rule_id, rule_text } а не число - не считаем его порогом для GLOBAL-FX/RECEIPT
        if (typeof raw === 'object') return fallback;
        const parsed = parseFloat(raw as any);
        return Number.isNaN(parsed) ? fallback : parsed;
    };

    const amount = parseFloat((invoice.amount ?? invoice.total ?? 0) as any);
    const amountInUSD = amount * fxRate;
    const vendor = String(invoice.vendor_id || invoice.vendor || "").toLowerCase();
    const vendorKnown = invoice.vendorKnown || false;
    const currency = String(invoice.currency || "USD").toUpperCase();
    const receiptPresent = invoice.receiptPresent === true || invoice.receiptPresent === 'true' || (invoice.receiptPresent ?? true) === true;

    const receiptThreshold = getThreshold('GLOBAL-RECEIPT', 25);
    const confidence = parseFloat((aiResult.confidence ?? invoice.confidence ?? 0) as any);

    let reasons: string[] = [];
    const triggeredRules: string[] = [];
    let recommendation = aiResult.recommendation || 'HUMAN_REVIEW';
    if (!['REJECT', 'HUMAN_REVIEW', 'AUTO_APPROVE'].includes(recommendation)) {
        recommendation = 'HUMAN_REVIEW';
    }

    // 1. GLOBAL-VENDOR
    if (hasRule('GLOBAL-VENDOR') && (!vendorKnown || ["unknown", "brand-new vendor", "unverified"].includes(vendor))) {
        triggeredRules.push("GLOBAL-VENDOR");
        reasons.push("Unknown/unverified vendor always requires human review.");
    }

    // 2. GLOBAL-FX
    const fxThreshold = getThreshold('GLOBAL-FX', 1000);
    if (currency !== "USD" && amountInUSD > fxThreshold) {
        triggeredRules.push("GLOBAL-FX");
        reasons.push(`FX hard stop: ${currency} ${amount} (~USD ${amountInUSD.toFixed(2)}) exceeds $${fxThreshold} foreign currency limit.`);
    }

    // 3. GLOBAL-RECEIPT
    if ((!receiptPresent && amount > receiptThreshold) || (hasRule('GLOBAL-RECEIPT') && !receiptPresent && amount > 0)) {
        if (!receiptPresent) {
            // если порог кастомный - он уже в getThreshold, если нет - 25
            if (amount > receiptThreshold || hasRule('GLOBAL-RECEIPT')) {
                triggeredRules.push("GLOBAL-RECEIPT");
                reasons.push(`Receipt required for expenses over $${receiptThreshold}.`);
            }
        }
    }

    // 4. GLOBAL-FRAUD - триггерит ТОЛЬКО по сигналу, а не по наличию политики
    const scenario = String(invoice.scenario || '').toLowerCase();
    if (invoice.fraudSignal === true || scenario.includes('fraud-pattern')) {
        triggeredRules.push("GLOBAL-FRAUD");
        reasons.push("Fraud signal detected on invoice execution path.");
    }

    // 5. MEAL / SAAS / HW
    if (hasRule('MEAL-01') && invoice.missingMealInfo) {
        triggeredRules.push("MEAL-01");
        reasons.push("Required business meal item context is missing.");
    }
    if (hasRule('MEAL-03') && aiResult.triggered_rules?.includes('MEAL-03')) {
        recommendation = 'REJECT';
    }
    if (hasRule('SAAS-01') && invoice.category === 'saas' && amount > getThreshold('SAAS-01', 200)) {
        triggeredRules.push("SAAS-01");
        reasons.push(`Software/SaaS subscription exceeds $${getThreshold('SAAS-01', 200)} per month limit.`);
    }

    if ((hasRule('HW-01') || hasRule('HW-02')) && invoice.category === 'hardware' && amount > getThreshold('HW-01', 1000)) {
        triggeredRules.push("HW-01");
        reasons.push(`Hardware purchase exceeds $${getThreshold('HW-01', 1000)} limit.`);
    }

    // 6. GLOBAL-MATH
    if (invoice.lineItems && invoice.lineItems.length > 0) {
        const lineTotal = invoice.lineItems.reduce((sum, item) => {
            const qty = parseFloat((item.quantity ?? item.qty ?? 0) as any);
            const price = parseFloat((item.unitPrice ?? item.unit_price ?? item.amount ?? 0) as any);
            return sum + (qty * price);
        }, 0);
        const tax = parseFloat((invoice.taxAmount ?? invoice.tax_amount ?? invoice.tax ?? 0) as any);
        const expectedTotal = lineTotal + tax;
        if (Math.abs(expectedTotal - amount) > 0.01) {
            triggeredRules.push("GLOBAL-MATH");
            reasons.push(`Math mismatch: line items (${lineTotal}) + tax (${tax}) = ${expectedTotal}, but total is ${amount}.`);
        }
    }

    // AUTONOMY-CEILING
    const ceilingRule = activeRules.find(r => r.rule_id === 'AUTONOMY-CEILING' || (r as any).key === 'AUTONOMY-CEILING' || (r.value && r.value.rule_id === 'AUTONOMY-CEILING') || (r as any)._id === 'AUTONOMY-CEILING');
    const ceilingThreshold = extractNumericThreshold(ceilingRule, 250);
    if (amount > ceilingThreshold) {
        reasons.push(`Invoice amount $${amount} exceeds autonomy ceiling of $${ceilingThreshold}.`);
        triggeredRules.push('AUTONOMY-CEILING');
    }

    // AUTONOMY-CONFIDENCE
    const confidenceRule = activeRules.find(r => r.rule_id === 'AUTONOMY-CONFIDENCE' || (r as any).key === 'AUTONOMY-CONFIDENCE' || (r.value && r.value.rule_id === 'AUTONOMY-CONFIDENCE') || (r as any)._id === 'AUTONOMY-CONFIDENCE');
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

// для совместимости с require в jest
// @ts-ignore
if (typeof module !== 'undefined') {
    // @ts-ignore
    module.exports = { applyOverride, extractNumericThreshold };
}

export { applyOverride, extractNumericThreshold };