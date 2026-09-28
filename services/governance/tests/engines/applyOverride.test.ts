import { applyOverride } from '../../engines/applyOverride';

// ---- INLINE TEST TYPES ----
interface AiResult {
    recommendation: string;
    confidence: number;
    reason?: string;
    triggered_rules?: string[];
}

interface Invoice {
    total?: number;
    amount?: number;
    vendorKnown?: boolean;
    vendor?: string;
    currency?: string;
    receiptPresent?: boolean;
    fraudSignal?: boolean;
    missingMealInfo?: boolean;
    lineItems?: Array<{ quantity: number; unitPrice: number }>;
    taxAmount?: number;
}

interface Rule {
    rule_id?: string;
    threshold?: number;
    value?: any;
    _id?: string;
    _key?: string;
    [key: string]: any;
}

describe('applyOverride Handler', () => {
    const defaultAiResult: AiResult = { recommendation: 'AUTO_APPROVE', confidence: 0.95 };
    const defaultInvoice: Invoice = { total: 100 };

    describe('Dynamic FX and Receipt Limits', () => {
        test('applies custom currency limit via active policy threshold configuration', () => {
            const rules: Rule[] = [{ rule_id: 'GLOBAL-FX', threshold: 500 }];
            const invoice: Invoice = { vendorKnown: true, currency: 'EUR', total: 600 };
            const result = applyOverride(defaultAiResult as any, invoice as any, rules as any);
            expect(result.recommendation).toBe('HUMAN_REVIEW');
            expect(result.triggered_rules).toContain('GLOBAL-FX');
        });

        test('uses fxRates conversion map for GLOBAL-FX check against USD threshold', () => {
            const rules: Rule[] = [{ rule_id: 'GLOBAL-FX', threshold: 1000 }];
            const fxRates: Record<string, number> = { USD: 1, EUR: 1.2 };
            const invoice: Invoice = { vendorKnown: true, currency: 'EUR', total: 900 };

            const result = applyOverride(defaultAiResult as any, invoice as any, rules as any, fxRates[invoice.currency!] || 1);
            expect(result.recommendation).toBe("HUMAN_REVIEW");
            expect(result.triggered_rules).toContain("GLOBAL-FX");
            expect(result.reason).toContain("~USD 1080.00");
        });

        test('applies custom receipt floor limit via policy values configuration', () => {
            const rules: Rule[] = [{ rule_id: 'GLOBAL-RECEIPT', value: 10 }];
            const invoice: Invoice = { vendorKnown: true, amount: 15, receiptPresent: false };
            const result = applyOverride(defaultAiResult as any, invoice as any, rules as any);
            expect(result.recommendation).toBe('HUMAN_REVIEW');
            expect(result.triggered_rules).toContain('GLOBAL-RECEIPT');
        });
    });

    describe('AUTONOMY-HARDSTOPS Global Rules', () => {
        test('does not trigger GLOBAL-VENDOR for known vendors even when policy is active', () => {
            const invoice: Invoice = { vendorKnown: true, vendor: 'Acme Corp' };
            const rules: Rule[] = [{ rule_id: 'GLOBAL-VENDOR' }];
            const result = applyOverride(defaultAiResult as any, invoice as any, rules as any);
            expect(result.recommendation).toBe('AUTO_APPROVE');
        });

        test('triggers GLOBAL-FRAUD when fraud flag matches constraint', () => {
            const invoice: Invoice = { vendorKnown: true, fraudSignal: true };
            const result = applyOverride(defaultAiResult as any, invoice as any, [] as any);
            expect(result.recommendation).toBe('HUMAN_REVIEW');
            expect(result.triggered_rules).toContain('GLOBAL-FRAUD');
        });

        test('does not trigger GLOBAL-FRAUD only because policy is active without fraud indicators', () => {
            const invoice: Invoice = {
                vendorKnown: true,
                vendor: 'Acme Corp',
                currency: 'USD',
                total: 40,
                receiptPresent: true,
                lineItems: [{ quantity: 1, unitPrice: 40 }],
                taxAmount: 0
            };
            const rules: Rule[] = [{ rule_id: 'GLOBAL-FRAUD' }];

            const result = applyOverride(defaultAiResult as any, invoice as any, rules as any);
            expect(result.recommendation).toBe('AUTO_APPROVE');
        });

        test('triggers MEAL-01 when required compliance info is absent', () => {
            const invoice: Invoice = { vendorKnown: true, missingMealInfo: true };
            const rules: Rule[] = [{ rule_id: 'MEAL-01' }];

            const result = applyOverride(defaultAiResult as any, invoice as any, rules as any);
            expect(result.recommendation).toBe('HUMAN_REVIEW');
            expect(result.triggered_rules).toContain('MEAL-01');
        });

        test('does not trigger GLOBAL-VENDOR for known vendor when GLOBAL-VENDOR policy is active', () => {
            const invoice: Invoice = {
                vendorKnown: true,
                vendor: 'Hotel Adler',
                currency: 'EUR',
                total: 1200,
                receiptPresent: true,
                lineItems: [
                    { quantity: 3, unitPrice: 400 }
                ],
                taxAmount: 0
            };
            const rules: Rule[] = [
                { value: { rule_id: 'GLOBAL-VENDOR' } },
                { value: { rule_id: 'GLOBAL-FX', value: 1000 } }
            ];
            const result = applyOverride(defaultAiResult as any, invoice as any, rules as any);
            expect(result.recommendation).toBe('HUMAN_REVIEW');
            expect(result.triggered_rules).toContain('GLOBAL-FX');
        });
    });

    describe('Fallback Default Constants Behavior', () => {
        test('forces human review if total exceeds default 250 ceiling', () => {
            const invoice: Invoice = { total: 251 };
            const result = applyOverride(defaultAiResult as any, invoice as any, [] as any);
            expect(result.recommendation).toBe('HUMAN_REVIEW');
            expect(result.triggered_rules).toContain('AUTONOMY-CEILING');
        });

        test('forces human review if confidence falls below default 0.80 threshold', () => {
            const aiResult: AiResult = { recommendation: 'AUTO_APPROVE', confidence: 0.79 };
            const result = applyOverride(aiResult as any, defaultInvoice as any, [] as any);
            expect(result.recommendation).toBe('HUMAN_REVIEW');
            expect(result.triggered_rules).toContain('AUTONOMY-CONFIDENCE');
        });

        test('allows auto approve when within safe fallback defaults boundaries', () => {
            const result = applyOverride(defaultAiResult as any, defaultInvoice as any, [] as any);
            expect(result.recommendation).toBe('AUTO_APPROVE');
        });
    });

    describe('Dynamic Overrides via Database Policies', () => {
        test('respects custom tighter ceiling boundary from rules config', () => {
            const rules: Rule[] = [
                {
                    _id: 'AUTONOMY-CEILING',
                    _key: 'AUTONOMY-CEILING',
                    value: { rule_id: 'AUTONOMY-CEILING', rule_text: 50 }
                }
            ];
            const invoice: Invoice = { total: 75 };
            const result = applyOverride(defaultAiResult as any, invoice as any, rules as any);
            expect(result.recommendation).toBe('HUMAN_REVIEW');
            expect(result.reason).toContain('ceiling of $50');
        });

        test('respects custom higher confidence constraint from rules config', () => {
            const rules: Rule[] = [
                {
                    _id: 'AUTONOMY-CONFIDENCE',
                    _key: 'AUTONOMY-CONFIDENCE',
                    value: { rule_id: 'AUTONOMY-CONFIDENCE', rule_text: 0.99 }
                }
            ];
            const aiResult: AiResult = { recommendation: 'AUTO_APPROVE', confidence: 0.95 };
            const result = applyOverride(aiResult as any, defaultInvoice as any, rules as any);
            expect(result.recommendation).toBe('HUMAN_REVIEW');
            expect(result.reason).toContain('threshold of 0.99');
        });
    });
});