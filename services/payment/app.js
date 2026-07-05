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

            // Reserve funds (persist reservation state)
            const reservationKey = `reservation:${trackingId}`;
            const reservation = {
                tracking_id: trackingId,
                reserved: true,
                amount: invoice.total || invoice.amount || 0,
                currency: invoice.currency || 'USD',
                created_at: new Date().toISOString()
            };

            try {
                await daprClient.state.save('approval-state', [{ key: reservationKey, value: reservation }]);
            } catch (err) {
                console.error(`[${trackingId}] Failed to save reservation:`, err.message);
                // publish failure
                await daprClient.pubsub.publish(PUB_SUB, 'payment.failed', { tracking_id: trackingId, reason: 'reservation_failed' });
                return 'RETRY';
            }

            // Simulate processing: if scenario indicates failure, trigger compensation
            const scenario = invoice.scenario || invoice.note || '';
            if (typeof scenario === 'string' && scenario.includes('payment-failure')) {
                console.log(`[${trackingId}] Simulating payment failure for scenario ${scenario}`);
                // release reservation
                await daprClient.state.delete('approval-state', reservationKey);
                await daprClient.pubsub.publish(PUB_SUB, 'payment.failed', { tracking_id: trackingId, reason: 'simulated_failure' });
                return 'SUCCESS';
            }

            // Otherwise commit payment (simulate external bank call success)
            const paymentRecordKey = `payment:${trackingId}`;
            const paymentRecord = {
                tracking_id: trackingId,
                status: 'CONFIRMED',
                amount: reservation.amount,
                currency: reservation.currency,
                confirmed_at: new Date().toISOString()
            };

            await daprClient.state.save('approval-state', [{ key: paymentRecordKey, value: paymentRecord }]);

            // Publish confirmed event
            await daprClient.pubsub.publish(PUB_SUB, 'payment.confirmed', { tracking_id: trackingId });

            // Optionally cleanup reservation
            await daprClient.state.delete('approval-state', reservationKey);

            console.log(`[${trackingId}] Payment confirmed and published`);
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
