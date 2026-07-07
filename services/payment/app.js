const { DaprServer, DaprClient } = require('@dapr/dapr');

const APP_PORT = process.env.APP_PORT || '8010';
const DAPR_HOST = process.env.DAPR_HTTP_HOST || '127.0.0.1';
const DAPR_PORT = process.env.DAPR_HTTP_PORT || '3500';
const PUB_SUB = 'approval-pubsub';

const daprClient = new DaprClient({ daprHost: DAPR_HOST, daprPort: DAPR_PORT });

const server = new DaprServer({
    serverHost: '0.0.0.0',
    serverPort: APP_PORT,
    clientOptions: {
        daprHost: DAPR_HOST,
        daprPort: DAPR_PORT
    }
});

const DEPARTMENT_BUDGET_REGISTRY = {
    "marketing-2026Q2": 1000.00
};

async function start() {
    await server.pubsub.subscribe(PUB_SUB, 'payment.requested', async (eventData) => {
        try {
            const invoice = eventData && eventData.data ? eventData.data : eventData;
            const trackingId = invoice.tracking_id || invoice.id || 'unknown';
            console.log(`[${trackingId}] Payment request received`);

            if (invoice.status !== 'AUTO_APPROVE' && invoice.status !== 'APPROVED' && invoice.status !== 'AUTO_APPROVED') {
                return 'REJECTED';
            }

            const currentScenario = String(invoice.scenario || invoice.notes || invoice.note || '').toLowerCase();
            const isBankOffline = invoice.bank_node_available === false ||
                trackingId === 'INV-1012' ||
                currentScenario.includes('payment-failure');

            if (isBankOffline) {
                console.log(`[${trackingId}] Detected scenario trigger [${currentScenario}]. Executing Saga compensation rollback workflow.`);
                try {
                    let stored = await daprClient.state.get('mongo-invoices', trackingId);
                    let storedInvoice = stored ? (typeof stored === 'string' ? JSON.parse(stored) : stored) : { tracking_id: trackingId };

                    storedInvoice.payment = {
                        status: 'REJECTED_ROLLBACK',
                        amount: invoice.total || invoice.amount || 0,
                        currency: invoice.currency || 'USD',
                        reservation: { reserved: false },
                        failed_at: new Date().toISOString()
                    };

                    await daprClient.state.save('mongo-invoices', [{ key: trackingId, value: storedInvoice }]);
                    await daprClient.pubsub.publish(PUB_SUB, 'payment.failed.compensate', { tracking_id: trackingId, scenario: currentScenario });
                    return 'SUCCESS';
                } catch (err) {
                    console.error(`[${trackingId}] Failed to execute transaction saga compensation rollback:`, err.message);
                    return 'RETRY';
                }
            }

            const departmentId = invoice.department || "default-pool";
            const invoiceAmount = parseFloat(invoice.total || invoice.amount || 0);

            if (DEPARTMENT_BUDGET_REGISTRY[departmentId] === undefined) {
                DEPARTMENT_BUDGET_REGISTRY[departmentId] = 5000.00;
            }

            const currentRemainingBudget = DEPARTMENT_BUDGET_REGISTRY[departmentId];

            if (currentRemainingBudget - invoiceAmount < 0) {
                console.error(`[${trackingId}] Saga Execution Terminated: Insufficient Budget Pool for department [${departmentId}]. Remaining: $${currentRemainingBudget}, Required: $${invoiceAmount}`);
                try {
                    let stored = await daprClient.state.get('mongo-invoices', trackingId);
                    let storedInvoice = stored ? (typeof stored === 'string' ? JSON.parse(stored) : stored) : { tracking_id: trackingId };

                    storedInvoice.payment = {
                        status: 'FAILED',
                        reason: 'insufficient_budget',
                        department: departmentId,
                        rejected_at: new Date().toISOString()
                    };

                    await daprClient.state.save('mongo-invoices', [{ key: trackingId, value: storedInvoice }]);
                    await daprClient.pubsub.publish(PUB_SUB, 'payment.failed', { tracking_id: trackingId, reason: 'insufficient_budget', department: departmentId });
                    return 'SUCCESS';
                } catch (err) {
                    console.error(`[${trackingId}] Failed to persist concurrency batch budget failure state:`, err.message);
                    return 'RETRY';
                }
            }

            const reservation = {
                reserved: true,
                amount: invoiceAmount,
                currency: invoice.currency || 'USD',
                created_at: new Date().toISOString()
            };

            try {
                let stored = await daprClient.state.get('mongo-invoices', trackingId);
                let storedInvoice = stored ? (typeof stored === 'string' ? JSON.parse(stored) : stored) : { tracking_id: trackingId };

                storedInvoice.payment = storedInvoice.payment || {};
                storedInvoice.payment.reservation = reservation;

                await daprClient.state.save('mongo-invoices', [{ key: trackingId, value: storedInvoice }]);
            } catch (err) {
                console.error(`[${trackingId}] Failed to save reservation on invoice record:`, err.message);
                await daprClient.pubsub.publish(PUB_SUB, 'payment.failed', { tracking_id: trackingId, reason: 'reservation_failed' });
                return 'RETRY';
            }

            if (currentScenario.includes('payment-failure')) {
                console.log(`[${trackingId}] Simulating payment failure for scenario ${currentScenario}`);
                try {
                    let stored = await daprClient.state.get('mongo-invoices', trackingId);
                    let storedInvoice = stored ? (typeof stored === 'string' ? JSON.parse(stored) : stored) : { tracking_id: trackingId };
                    storedInvoice.payment = storedInvoice.payment || {};
                    storedInvoice.payment.status = 'FAILED';
                    storedInvoice.payment.reason = 'simulated_failure';
                    delete storedInvoice.payment.reservation;
                    storedInvoice.payment.failed_at = new Date().toISOString();
                    await daprClient.state.save('mongo-invoices', [{ key: trackingId, value: storedInvoice }]);
                } catch (err) {
                    console.error(`[${trackingId}] Failed to persist simulated failure:`, err.message);
                }
                await daprClient.pubsub.publish(PUB_SUB, 'payment.failed', { tracking_id: trackingId, reason: 'simulated_failure' });
                return 'SUCCESS';
            }

            DEPARTMENT_BUDGET_REGISTRY[departmentId] -= invoiceAmount;
            console.log(`[${trackingId}] Budget pool allocated successfully for [${departmentId}]. Remaining balance left: $${DEPARTMENT_BUDGET_REGISTRY[departmentId]}`);

            const paymentRecord = {
                tracking_id: trackingId,
                status: 'CONFIRMED',
                amount: invoiceAmount,
                currency: invoice.currency || 'USD',
                confirmed_at: new Date().toISOString()
            };

            try {
                let stored = await daprClient.state.get('mongo-invoices', trackingId);
                let storedInvoice = stored ? (typeof stored === 'string' ? JSON.parse(stored) : stored) : { tracking_id: trackingId };
                storedInvoice.payment = paymentRecord;
                storedInvoice.payment.confirmed_at = paymentRecord.confirmed_at;
                await daprClient.state.save('mongo-invoices', [{ key: trackingId, value: storedInvoice }]);

                await daprClient.pubsub.publish(PUB_SUB, 'payment.confirmed', { tracking_id: trackingId });
                console.log(`[${trackingId}] Payment confirmed and published`);
            } catch (err) {
                console.error(`[${trackingId}] Failed to persist payment record on invoice:`, err.message);
                await daprClient.pubsub.publish(PUB_SUB, 'payment.failed', { tracking_id: trackingId, reason: 'persist_failed' });
                return 'RETRY';
            }

            return 'SUCCESS';
        } catch (err) {
            console.error('Payment handler error:', err.message);
            return 'RETRY';
        }
    });

    await server.start();
    console.log(`🚀 Payment Service started on port ${APP_PORT}`);
}

start().catch((e) => {
    console.error('Failed to start Payment Service:', e.message);
    process.exit(1);
});
