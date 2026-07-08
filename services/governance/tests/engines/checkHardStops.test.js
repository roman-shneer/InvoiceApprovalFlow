const { checkHardStops } = require('../../engines/checkHardStops');
const { applyAutonomyOverride } = require('../../engines/applyAutonomyOverride');

describe('checkHardStops Policy Compliance', () => {
    describe('AUTONOMY-HARDSTOPS Global Rules', () => {
        test('does not trigger GLOBAL-VENDOR for known vendors even when policy is active', () => {
            const invoice = { vendorKnown: true, vendor: 'Acme Corp' };
            const rules = [{ rule_id: 'GLOBAL-VENDOR' }];
            const result = checkHardStops(invoice, rules);
            expect(result).toEqual({ triggered: false });
        });

        test('triggers GLOBAL-FRAUD when fraud flag matches constraint', () => {
            const invoice = { vendorKnown: true, fraudSignal: true };
            const result = checkHardStops(invoice, []);
            expect(result.triggered).toBe(true);
            expect(result.rules).toContain('GLOBAL-FRAUD');
        });

        test('does not trigger GLOBAL-FRAUD only because policy is active without fraud indicators', () => {
            const invoice = {
                vendorKnown: true,
                vendor: 'Acme Corp',
                currency: 'USD',
                total: 40,
                receiptPresent: true,
                lineItems: [{ quantity: 1, unitPrice: 40 }],
                taxAmount: 0
            };
            const rules = [{ rule_id: 'GLOBAL-FRAUD' }];

            const result = checkHardStops(invoice, rules);

            expect(result).toEqual({ triggered: false });
        });

        test('triggers MEAL-01 when required compliance info is absent', () => {
            const invoice = { vendorKnown: true, missingMealInfo: true };
            const rules = [{ rule_id: 'MEAL-01' }];
            const result = checkHardStops(invoice, rules);
            expect(result.triggered).toBe(true);
            expect(result.rules).toContain('MEAL-01');
        });

        test('does not trigger GLOBAL-VENDOR for known vendor when GLOBAL-VENDOR policy is active', () => {
            const invoice = {
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
            const rules = [
                { value: { rule_id: 'GLOBAL-VENDOR' } },
                { value: { rule_id: 'GLOBAL-FX', value: 1000 } }
            ];

            const result = checkHardStops(invoice, rules);

            expect(result).toEqual({
                triggered: true,
                rules: ['GLOBAL-FX'],
                reason: expect.stringContaining('FX hard stop')
            });
        });
    });

    describe('Dynamic FX and Receipt Limits', () => {
        test('applies custom currency limit via active policy threshold configuration', () => {
            const rules = [{ rule_id: 'GLOBAL-FX', threshold: 500 }];
            const invoice = { vendorKnown: true, currency: 'EUR', total: 600 };
            const result = checkHardStops(invoice, rules);
            expect(result.triggered).toBe(true);
            expect(result.rules).toContain('GLOBAL-FX');
        });

        test('uses fxRates conversion map for GLOBAL-FX check against USD threshold', () => {
            const rules = [{ rule_id: 'GLOBAL-FX', threshold: 1000 }];
            const fxRates = { USD: 1, EUR: 1.2 };
            const invoice = { vendorKnown: true, currency: 'EUR', total: 900 };

            const result = checkHardStops(invoice, rules, fxRates);

            expect(result.triggered).toBe(true);
            expect(result.rules).toContain('GLOBAL-FX');
            expect(result.reason).toContain('~USD 1080.00');
        });

        test('applies custom receipt floor limit via policy values configuration', () => {
            const rules = [{ rule_id: 'GLOBAL-RECEIPT', value: 10 }];
            const invoice = { vendorKnown: true, amount: 15, receiptPresent: false };
            const result = checkHardStops(invoice, rules);
            expect(result.triggered).toBe(true);
            expect(result.rules).toContain('GLOBAL-RECEIPT');
        });

    });
});

describe('applyAutonomyOverride Handler', () => {
    const defaultAiResult = { recommendation: 'AUTO_APPROVE', confidence: 0.95 };
    const defaultInvoice = { total: 100 };

    describe('Fallback Default Constants Behavior', () => {
        test('forces human review if total exceeds default 250 ceiling', () => {
            const invoice = { total: 251 };
            const result = applyAutonomyOverride(defaultAiResult, invoice, []);
            expect(result.recommendation).toBe('HUMAN_REVIEW');
            expect(result.triggered_rules).toContain('AUTONOMY-CEILING');
        });

        test('forces human review if confidence falls below default 0.80 threshold', () => {
            const aiResult = { recommendation: 'AUTO_APPROVE', confidence: 0.79 };
            const result = applyAutonomyOverride(aiResult, defaultInvoice, []);
            expect(result.recommendation).toBe('HUMAN_REVIEW');
            expect(result.triggered_rules).toContain('AUTONOMY-CONFIDENCE');
        });

        test('allows auto approve when within safe fallback defaults boundaries', () => {
            const result = applyAutonomyOverride(defaultAiResult, defaultInvoice, []);
            expect(result.recommendation).toBe('AUTO_APPROVE');
        });
    });

    describe('Dynamic Overrides via Database Policies', () => {
        test('respects custom tighter ceiling boundary from rules config', () => {
            const rules = [
                {
                    _id: 'AUTONOMY-CEILING',
                    _key: 'AUTONOMY-CEILING',
                    value: { rule_id: 'AUTONOMY-CEILING', rule_text: 50 }
                }
            ];
            const invoice = { total: 75 };
            const result = applyAutonomyOverride(defaultAiResult, invoice, rules);
            expect(result.recommendation).toBe('HUMAN_REVIEW');
            expect(result.reason).toContain('ceiling of $50');
        });

        test('respects custom higher confidence constraint from rules config', () => {
            const rules = [
                {
                    _id: 'AUTONOMY-CONFIDENCE',
                    _key: 'AUTONOMY-CONFIDENCE',
                    value: { rule_id: 'AUTONOMY-CONFIDENCE', rule_text: 0.99 }
                }
            ];
            const aiResult = { recommendation: 'AUTO_APPROVE', confidence: 0.95 };
            const result = applyAutonomyOverride(aiResult, defaultInvoice, rules);
            expect(result.recommendation).toBe('HUMAN_REVIEW');
            expect(result.reason).toContain('threshold of 0.99');
        });
    });
});
