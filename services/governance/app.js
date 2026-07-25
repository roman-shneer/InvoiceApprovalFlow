const express = require('express');
const { DaprServer, DaprClient } = require('@dapr/dapr');
const { aiManager, anonymizeInvoice } = require('./managers/aiManager');
const { applyOverride } = require('./engines/applyOverride');
const { evaluateInvoiceWithAI } = require('./engines/evaluateInvoiceWithAI');
const { getPolicies, saveInvoiceToMongo, getPendingInvoices, getFxRate } = require('./resources/db');
const { RagEngine } = require('./resources/ragEngine');
const ragEngine = new RagEngine();
const appPort = process.env.APP_PORT || "8002";
const daprHost = process.env.DAPR_HOST || "127.0.0.1";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";
const PUB_SUB_NAME = "approval-pubsub";
const PUB_SUB_TOPIC = 'invoice.submitted'
const NOTIFICATION_PROCESSED_TOPIC = "invoice.processed";
const NOTIFICATION_RETRY_TOPIC = "invoice.failed-to-save";
const NOTIFICATION_PAYMENT_REQUESTED_TOPIC = "payment.requested";

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

async function resolveFxRate(invoice) {
    if (invoice.currency !== 'USD') {
        const rateEntry = await getFxRate(invoice.currency, invoice.date);
        if (rateEntry && rateEntry.rate) {
            return rateEntry.rate;
        }
    }

    return 1;
}
async function processInvoice(trackingId, invoice) {
    const correlationId = invoice.correlation_id || "unknown";
    // Initialize empty buckets to accumulate ALL audit findings across the matrix boundaries
    let allTriggeredRules = [];
    let allReasons = [];
    console.log(`[${trackingId}] Processing`);
    await saveInvoiceToMongo((invoice.status = 'PROCESSING', invoice));
    await publishInvoiceNotification(invoice, NOTIFICATION_PROCESSED_TOPIC);
    try {
        const activeRules = await getPolicies();
        const rate = await resolveFxRate(invoice);
        let aiResult;
        try {
            const globalRules = activeRules
                .filter(rule => rule.category.toLowerCase() === 'global rules')
                .map(rule => ragEngine.ruleToText(rule));

            const autonomyRules = activeRules
                .filter(rule => rule.category.toLowerCase() === 'autonomy')
                .map(rule => ragEngine.ruleToText(rule));

            const categoryRules = activeRules
                .filter(rule => !['global rules', 'autonomy'].includes(rule.category.toLowerCase()));

            const ragPolicies = await ragEngine.retrieveRelevantPolicies(invoice, categoryRules);

            const policyComplects = [
                ragPolicies,
                globalRules.join('\n\n'),
                autonomyRules.join('\n\n')
            ];

            const anonymizedInvoice = anonymizeInvoice(invoice, rate);
            const provider = await aiManager();
            aiResult = await provider.requestModel(trackingId, anonymizedInvoice, policyComplects);

        } catch (err) {
            aiResult = evaluateInvoiceWithAI(invoice, activeRules);
            console.log(`[${trackingId}] ERROR: AI failure context: ${err.message}. Triggered static heuristics.`);
        }


        invoice.audit_metadata = applyOverride(aiResult, invoice, activeRules, rate);

        invoice.status = invoice.audit_metadata.recommendation;
        const aiApproved = invoice.status === 'AUTO_APPROVE';


        await saveInvoiceToMongo(invoice);
        await publishInvoiceNotification(invoice, NOTIFICATION_PROCESSED_TOPIC);

        // 6. Payment initiation routing boundary logic
        if (aiApproved) {
            try {
                if (!invoice.payment_requested) {
                    invoice.payment_requested = true;
                    await publishInvoiceNotification(invoice, NOTIFICATION_PAYMENT_REQUESTED_TOPIC);
                    console.log(`[${trackingId}] Published payment.requested for ${trackingId}`);
                } else {
                    console.log(`[${trackingId}] payment.requested already set; skipping publish`);
                }
            } catch (err) {
                console.error(`[${trackingId}] Failed to publish payment.requested:`, err.message);
            }
        }

    } catch (error) {
        console.error(`[${trackingId}] Critical failure inside background worker:`, error.message);
        try {
            invoice.status = 'HUMAN_REVIEW';
            invoice.audit_metadata = {
                checked_at: new Date().toISOString(),
                reason: `Governance processing failure: ${error.message}`,
                triggered_rules: ['SYSTEM-ERROR'],
                confidence: 0
            };
            await saveInvoiceToMongo(invoice);
            await publishInvoiceNotification(invoice, NOTIFICATION_PROCESSED_TOPIC);
        } catch (persistErr) {
            console.error(`[${trackingId}] Failed to persist fallback HUMAN_REVIEW state:`, persistErr.message);
        }
    }

}

async function startWorkerLoop() {
    const delayMs = (process.env.AI_REQUEST_DELAY && process.env.AI_REQUEST_DELAY.trim() !== "") ? parseInt(process.env.AI_REQUEST_DELAY) : 250;
    while (true) {
        const invoices = await getPendingInvoices('PENDING', 1);
        if (invoices && invoices.length > 0) {
            const invoice = invoices[0];
            const trackingId = invoice.tracking_id || invoice.id;
            await processInvoice(trackingId, invoice);
            await new Promise(res => setTimeout(res, delayMs));
        } else {
            await new Promise(res => setTimeout(res, 2000));
        }
    }
}


async function checkStuckInvoices() {
    const invoices = await getPendingInvoices('PROCESSING', 1000);

    for (const invoice of invoices) {
        console.log(`[${invoice.tracking_id}] Reprocessing pending invoice`);
        await publishInvoiceNotification(invoice, PUB_SUB_TOPIC);
    }
}

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
                console.log(`[${invoice.tracking_id}] Incoming invoice received via Pub/Sub`);
                //WILL BE PROCESSED in TOUR startWorkerLoop() function, so we just save it to mongo and return SUCCESS            
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
    // Replay any previously stuck PROCESSING invoices   
    if (process.env.NODE_ENV !== 'test') {
        try {
            await checkStuckInvoices();
        } catch (err) {
            console.error(`[governance-startup] Failed to replay pending invoices:`, err.message);
        }
        startWorkerLoop();
    }

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



async function publishInvoiceNotification(pendingInvoice, topic = NOTIFICATION_PROCESSED_TOPIC) {
    if (!pendingInvoice) return;
    try {
        await daprClient.pubsub.publish(PUB_SUB_NAME, topic, pendingInvoice);
    } catch (err) {
        console.error(`[${pendingInvoice?.tracking_id}] Failed to publish invoice processed notification:`, err.message);
    }
}

module.exports = { start, getPendingInvoices, server, daprClient };

if (require.main === module) {
    start().catch(console.error);
}
