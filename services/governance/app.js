const express = require('express');
const { DaprServer, DaprClient } = require('@dapr/dapr');
const { saveInvoiceToMongo } = require('./resources/db');

const appPort = "8002";
const daprHost = process.env.DAPR_HOST || "127.0.0.1";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";
const PUB_SUB_NAME = "approval-pubsub";
const PUB_SUB_TOPIC = 'invoice.submitted'
const NOTIFICATION_RETRY_TOPIC = "invoice.failed-to-save";

const MAX_RETRIES = 5;

const daprClient = new DaprClient({
    daprHost: daprHost,
    daprPort: daprPort,
    communicationTimeoutMs: 300000
});

const server = new DaprServer({
    serverHost: "0.0.0.0",
    serverPort: appPort,
    client: daprClient
});



async function startServerWithRetry() {
    const maxAttempts = Number(process.env.DAPR_START_MAX_ATTEMPTS || 30);
    const delayMs = Number(process.env.DAPR_START_RETRY_DELAY_MS || 2000);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await server.start();
            return;
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            const isSidecarBootRace = msg.includes('DAPR_SIDECAR_COULD_NOT_BE_STARTED');

            if (!isSidecarBootRace || attempt === maxAttempts) {
                throw err;
            }

            console.warn(`[governance-startup] Dapr sidecar not ready (attempt ${attempt}/${maxAttempts}). Retrying in ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

async function start() {



    await server.pubsub.subscribe(
        PUB_SUB_NAME,
        PUB_SUB_TOPIC,
        async (eventData) => {
            try {
                const invoice = eventData && eventData.data ? eventData.data : eventData;
                console.log(`[${invoice.tracking_id}] Incoming invoice received via Pub/Sub id: ${invoice.id}, status: ${invoice.status}`);

                saveInvoiceToMongo((invoice.status = 'PENDING', invoice)).catch(async (dbErr) => {
                    //if mongo dead - send to pubsub invoice.failed-to-save to retry later
                    console.error(`[${invoice.tracking_id}] Failed asynchronous background Mongo save:`, dbErr.message);
                    publishInvoiceNotification({
                        invoice,
                        error: dbErr.message,
                        retryCount: 0
                    }, NOTIFICATION_RETRY_TOPIC).catch(pubSubErr => {
                        console.error("CRITICAL ERROR: Pub/Sub is also unavailable!", pubSubErr.message);
                    });
                });
                return "SUCCESS";


            } catch (err) {
                console.error("!!! ERROR IN INVOICE PROCESSING STREAM !!!", err.message);
                return "RETRY";
            }
        }
    );

    // Subscribe to the "invoice.failed-to-save" topic to handle invoices that failed to save to MongoDB
    await server.pubsub.subscribe(
        PUB_SUB_NAME,
        NOTIFICATION_RETRY_TOPIC,
        async (eventData) => {
            const payload = eventData?.data || eventData;
            const invoice = payload.invoice;
            let currentRetry = payload.retryCount !== undefined ? payload.retryCount : 1;
            const trackingId = invoice.tracking_id || invoice.id || "unknown";

            try {
                console.log(`[${trackingId}] Attempting to re-save invoice from the backup queue...`);
                await saveInvoiceToMongo(invoice);
                console.log(`[${trackingId}] Successfully saved! MongoDB has recovered.`);
                return "SUCCESS";
            } catch (err) {
                console.error(`[${trackingId}] The database is still there. Leaving it in the Redis queue for retry.`, err.message);
                if (currentRetry >= MAX_RETRIES) {
                    console.error(`[${trackingId}] CRITICAL ERROR: Invoice exceeded ${MAX_RETRIES} attempts. Sending to log/human.`);
                    await saveToFile(invoice, err.message);
                    return "SUCCESS";
                }
                currentRetry++;
                await publishInvoiceNotification({
                    invoice,
                    error: err.message,
                    retryCount: currentRetry
                }, NOTIFICATION_RETRY_TOPIC).catch(pubSubErr => {
                    console.error("CRITICAL ERROR: Even Redis is unavailable for retry!", pubSubErr.message);
                });
                return "SUCCESS";
            }
        }
    );

    await startServerWithRetry();
}

async function saveToFile(invoice, message) {
    const deadLetterPayload = {
        failed_at: new Date().toISOString(),
        error: message,
        invoice: invoice
    };

    fs.appendFile(
        path.join(__dirname, 'failed-invoices.jsonl'),
        JSON.stringify(deadLetterPayload) + '\n',
        'utf8'
    ).then(() => {
        console.log(`[${invoice.tracking_id || invoice.id || "unknown"}] The emergency invoice was successfully saved locally to disk.`);
    }).catch(fsErr => {
        console.error(`[${invoice.tracking_id || invoice.id || "unknown"}] CATASTROPHE: Even the disk is not writable!`, fsErr.message);
    });
}



async function publishInvoiceNotification(pendingInvoice, topic) {
    if (!pendingInvoice) return;
    try {
        await daprClient.pubsub.publish(PUB_SUB_NAME, topic, pendingInvoice);
    } catch (err) {
        console.error(`[${pendingInvoice?.tracking_id}] Failed to publish invoice processed notification:`, err.message);
    }
}

module.exports = { start, server, daprClient };

if (require.main === module) {
    start().catch(console.error);
}
