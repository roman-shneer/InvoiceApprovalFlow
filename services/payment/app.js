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

async function start() {
    await server.pubsub.subscribe(PUB_SUB, 'payment.requested', async (eventData) => {
        try {
            const invoice = eventData && eventData.data ? eventData.data : eventData;
            const trackingId = invoice.tracking_id || invoice.id || 'unknown';
            console.log(`[${trackingId}] Payment request received`);

            if (invoice.status != 'AUTO_APPROVE' && invoice.status != 'APPROVED') {
                return 'REJECTED';
            }

            if (invoice.bank_node_available === false || scenario.includes('payment-failure')) {
                console.log(`[${trackingId}] Bank node transaction rejected. Triggering Saga compensation workflow.`);
                try {
                    let stored = await daprClient.state.get('mongo-invoices', trackingId);
                    let storedInvoice = stored ? (typeof stored === 'string' ? JSON.parse(stored) : stored) : { tracking_id: trackingId };

                    storedInvoice.payment = {
                        status: 'REJECTED_ROLLBACK',
                        amount: invoice.total || invoice.amount || 0,
                        currency: invoice.currency || 'USD',
                        reservation: { reserved: false }
                    };

                    await daprClient.state.save('mongo-invoices', [{ key: trackingId, value: storedInvoice }]);
                    await daprClient.pubsub.publish(PUB_SUB, 'payment.failed.compensate', { tracking_id: trackingId });
                    return 'SUCCESS';
                } catch (err) {
                    console.error(`[${trackingId}] Failed to execute compensation step:`, err.message);
                    return 'RETRY';
                }
            }

            const reservation = {
                reserved: true,
                amount: invoice.total || invoice.amount || 0,
                currency: invoice.currency || 'USD',
                created_at: new Date().toISOString()
            };

            try {
                let stored = await daprClient.state.get('mongo-invoices', trackingId);
                let storedInvoice = null;
                if (stored) {
                    storedInvoice = typeof stored === 'string' ? JSON.parse(stored) : stored;
                } else {
                    storedInvoice = { tracking_id: trackingId };
                }

                storedInvoice.payment = storedInvoice.payment || {};
                storedInvoice.payment.reservation = reservation;

                await daprClient.state.save('mongo-invoices', [{ key: trackingId, value: storedInvoice }]);
            } catch (err) {
                console.error(`[${trackingId}] Failed to save reservation on invoice record:`, err.message);
                await daprClient.pubsub.publish(PUB_SUB, 'payment.failed', { tracking_id: trackingId, reason: 'reservation_failed' });
                return 'RETRY';
            }

            const scenario = invoice.scenario || invoice.note || '';
            if (typeof scenario === 'string' && scenario.includes('payment-failure')) {
                console.log(`[${trackingId}] Simulating payment failure for scenario ${scenario}`);
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

            const paymentRecord = {
                tracking_id: trackingId,
                status: 'CONFIRMED',
                amount: reservation.amount,
                currency: reservation.currency,
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
