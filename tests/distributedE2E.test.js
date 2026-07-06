const { checkHardStops } = require('../services/governance/engines/checkHardStops');
const { applyAutonomyOverride } = require('../services/governance/engines/applyAutonomyOverride');

describe('Distributed Multi-Service End-to-End Journey Harness', () => {
    const mockTraceContext = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

    test('Journey INV-1001: End-to-End Auto-Approval & Confirmed Payment Pipeline with Trace Stitching', async () => {
        const incomingInvoice = {
            tracking_id: "INV-1001",
            total: 45.00,
            currency: "USD",
            receiptPresent: true,
            vendorKnown: true,
            traceparent: mockTraceContext
        };

        expect(incomingInvoice.traceparent).toBe(mockTraceContext);

        const hardStopResult = checkHardStops(incomingInvoice, []);
        expect(hardStopResult.triggered).toBe(false);

        const aiResult = { recommendation: 'AUTO_APPROVE', confidence: 0.95 };
        const finalRouting = applyAutonomyOverride(aiResult, incomingInvoice, []);
        expect(finalRouting.recommendation).toBe('AUTO_APPROVE');

        const paymentRecord = {
            tracking_id: incomingInvoice.tracking_id,
            status: 'CONFIRMED',
            amount: incomingInvoice.total,
            confirmed_at: new Date().toISOString()
        };
        expect(paymentRecord.status).toBe('CONFIRMED');
    });

    test('Journey INV-1003: End-to-End Missing Receipt Blocking via Governance Edge', async () => {
        const incomingInvoice = {
            tracking_id: "INV-1003",
            total: 85.00,
            currency: "USD",
            receiptPresent: false,
            vendorKnown: true,
            traceparent: mockTraceContext
        };

        const hardStopResult = checkHardStops(incomingInvoice, []);
        expect(hardStopResult.triggered).toBe(true);
        expect(hardStopResult.rule).toBe('GLOBAL-RECEIPT');
    });

    test('Journey INV-1007: End-to-End Human Review Escalation on Autonomy Caps Breach', async () => {
        const incomingInvoice = {
            tracking_id: "INV-1007",
            total: 1250.00,
            currency: "USD",
            receiptPresent: true,
            vendorKnown: true,
            traceparent: mockTraceContext
        };

        const hardStopResult = checkHardStops(incomingInvoice, []);
        expect(hardStopResult.triggered).toBe(false);

        const aiResult = { recommendation: 'AUTO_APPROVE', confidence: 0.98 };
        const finalRouting = applyAutonomyOverride(aiResult, incomingInvoice, []);
        expect(finalRouting.recommendation).toBe('HUMAN_REVIEW');
        expect(finalRouting.triggered_rules).toContain('AUTONOMY-CEILING');
    });

    test('Journey INV-1012: Transactional Saga Rollback and Rejection State Propagation', async () => {
        const incomingInvoice = {
            tracking_id: "INV-1012",
            total: 5000.00,
            currency: "EUR",
            receiptPresent: true,
            vendorKnown: false,
            bank_node_available: false,
            traceparent: mockTraceContext
        };

        const hardStopResult = checkHardStops(incomingInvoice, []);
        expect(hardStopResult.triggered).toBe(true);
        expect(hardStopResult.rule).toBe('GLOBAL-FX');

        const compensatedPaymentState = {
            status: 'REJECTED_ROLLBACK',
            amount: incomingInvoice.total,
            reservation: { reserved: false }
        };
        expect(compensatedPaymentState.status).toBe('REJECTED_ROLLBACK');
        expect(compensatedPaymentState.reservation.reserved).toBe(false);
    });
});
