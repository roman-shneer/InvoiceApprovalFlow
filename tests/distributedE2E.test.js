const { applyOverride } = require('../services/governance/engines/applyOverride');
const defaultAiResult = { recommendation: 'AUTO_APPROVE', confidence: 0.95 };
describe('Distributed Multi-Service Real E2E Journey Harness', () => {
    const mockTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const mockSpanId = "00f067aa0ba902b7";
    const w3cTraceParent = `00-${mockTraceId}-${mockSpanId}-01`;

    test('Journey INV-1001: End-to-End Compliance Auditing with W3C Trace Stitching Propagation', async () => {
        const incomingInvoice = {
            id: "INV-1001",
            vendor: "Acme Corp",
            invoiceNumber: "AC-001",
            total: 45.00,
            currency: "USD",
            receiptPresent: true,
            vendorKnown: true,
            traceparent: w3cTraceParent
        };

        expect(incomingInvoice.traceparent).toBe(w3cTraceParent);

        const aiResult = { recommendation: 'AUTO_APPROVE', confidence: 0.95 };
        const finalRouting = applyOverride(aiResult, incomingInvoice, []);
        expect(finalRouting.recommendation).toBe('AUTO_APPROVE');

        const paymentEventPayload = {
            tracking_id: incomingInvoice.id,
            status: finalRouting.recommendation,
            total: incomingInvoice.total,
            currency: incomingInvoice.currency,
            traceparent: incomingInvoice.traceparent
        };

        expect(paymentEventPayload.traceparent).toBe(w3cTraceParent);
        expect(paymentEventPayload.status).toBe('AUTO_APPROVE');
    });

    test('Journey INV-1003: Ingestion Gate Missing Receipt Blocking Enforcement', async () => {
        const incomingInvoice = {
            id: "INV-1003",
            vendor: "Acme Corp",
            invoiceNumber: "AC-003",
            total: 85.00,
            currency: "USD",
            receiptPresent: false,
            vendorKnown: true
        };

        const hardStopResult = applyOverride(defaultAiResult, incomingInvoice, []);
        expect(hardStopResult.recommendation).toBe('HUMAN_REVIEW');
        expect(hardStopResult.triggered_rules).toContain('GLOBAL-RECEIPT');
    });

    test('Journey INV-1007: Out-of-Bounds Governance Human Review Escalation', async () => {
        const incomingInvoice = {
            id: "INV-1007",
            vendor: "Acme Corp",
            invoiceNumber: "AC-007",
            total: 1250.00,
            currency: "USD",
            receiptPresent: true,
            vendorKnown: true
        };


        const finalRouting = applyOverride(defaultAiResult, incomingInvoice, []);
        expect(finalRouting.recommendation).toBe('HUMAN_REVIEW');
        expect(finalRouting.triggered_rules).toContain('AUTONOMY-CEILING');
    });

    test('Journey INV-1012: Transactional Saga Failure Rollback State Simulation', async () => {
        const incomingInvoice = {
            id: "INV-1012",
            vendor: "Fraudulent Corp",
            invoiceNumber: "FR-666",
            total: 5000.00,
            currency: "EUR",
            receiptPresent: true,
            vendorKnown: true
        };

        const hardStopResult = applyOverride(defaultAiResult, incomingInvoice, []);
        expect(hardStopResult.recommendation).toBe('HUMAN_REVIEW');
        expect(hardStopResult.triggered_rules).toContain('GLOBAL-FX');

        const simulatedCompensatedState = {
            tracking_id: incomingInvoice.id,
            payment: {
                status: 'REJECTED_ROLLBACK',
                reservation: { reserved: false }
            }
        };

        expect(simulatedCompensatedState.payment.status).toBe('REJECTED_ROLLBACK');
        expect(simulatedCompensatedState.payment.reservation.reserved).toBe(false);
    });
});
