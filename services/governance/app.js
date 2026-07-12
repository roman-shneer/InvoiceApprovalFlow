const express = require('express');
const { DaprServer, DaprClient } = require('@dapr/dapr');
const { classifyInvoiceWithLocalAI } = require('./resources/ai');
const { checkHardStops } = require('./engines/checkHardStops');
const { applyAutonomyOverride } = require('./engines/applyAutonomyOverride');
const { evaluateInvoiceWithAI } = require('./engines/evaluateInvoiceWithAI');
const { getPolicies, getFxRates, saveInvoiceToMongo, getPendingInvoices } = require('./resources/db');

const appPort = "8002";
const daprHost = process.env.DAPR_HOST || "127.0.0.1";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";
const PUB_SUB_NAME = "approval-pubsub";
const PUB_SUB_TOPIC = 'invoice.submitted'
const NOTIFICATION_TOPIC = "invoice.processed";

const daprClient = new DaprClient({
    daprHost: daprHost,
    daprPort: daprPort,
    communicationTimeoutMs: 300000
});

const server = new DaprServer({
    serverHost: "0.0.0.0",
    serverPort: appPort,
    clientOptions: {
        daprHost: daprHost,
        daprPort: daprPort,
        communicationTimeoutMs: 300000
    }
});


async function processInvoice(trackingId, invoice) {
    const correlationId = invoice.correlation_id || "unknown";

    // Initialize empty buckets to accumulate ALL audit findings across the matrix boundaries
    let allTriggeredRules = [];
    let allReasons = [];
    console.log(`[${trackingId}] Processing`);
    invoice.status = 'PROCESSING';
    await saveInvoiceToMongo(invoice);
    await publishInvoiceProcessedNotification(invoice, 'PROCESSING', false, 'Invoice processing');
    try {
        const activeRules = await getPolicies();
        const fxRates = await getFxRates();

        // 1. Evaluate Deterministic Hard Stops Registry (Gathering all matching violations)
        const hardStop = checkHardStops(invoice, activeRules, fxRates);

        // 2. Local AI Inference and Rule Engine Fallback Classification
        let aiResult;
        try {
            aiResult = await classifyInvoiceWithLocalAI(invoice, activeRules);
        } catch (err) {
            aiResult = evaluateInvoiceWithAI(invoice, activeRules);
            console.log(`[${trackingId}] ERROR: AI failure context: ${err.message}. Triggered static heuristics.`);
        }

        console.log(`[${trackingId}] AI Evaluation Result: ${JSON.stringify(aiResult)}`);

        // 3. Evaluate Dynamic Autonomy Ceilings and Confidence Boundaries Thresholds
        const finalResult = applyAutonomyOverride(aiResult, invoice, activeRules, hardStop);
        const finalStatus = finalResult.recommendation;
        const aiApproved = finalStatus === 'AUTO_APPROVE';

        // 5. Atomic state synchronization layer execution
        invoice.status = finalStatus;
        invoice.audit_metadata = {
            checked_at: new Date().toISOString(),
            reason: finalResult.reason,
            triggered_rules: finalResult.triggered_rules,
            confidence: finalResult.confidence || 0,
        };

        await saveInvoiceToMongo(invoice);
        await publishInvoiceProcessedNotification(invoice, finalStatus, aiApproved);

        // 6. Payment initiation routing boundary logic
        if (aiApproved) {
            try {
                if (!invoice.payment_requested) {
                    invoice.payment_requested = true;
                    await daprClient.pubsub.publish(PUB_SUB_NAME, 'payment.requested', invoice);
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
            await publishInvoiceProcessedNotification(invoice, 'HUMAN_REVIEW', false);
        } catch (persistErr) {
            console.error(`[${trackingId}] Failed to persist fallback HUMAN_REVIEW state:`, persistErr.message);
        }
    }

}

async function startWorkerLoop() {
    while (true) {
        const invoices = await getPendingInvoices('PENDING', 1);
        if (invoices && invoices.length > 0) {
            const invoice = invoices[0];
            const trackingId = invoice.tracking_id || invoice.id;
            await processInvoice(trackingId, invoice);
            await new Promise(res => setTimeout(res, 250));
        } else {
            await new Promise(res => setTimeout(res, 2000));
        }
    }
}


async function checkStuckInvoices() {
    const invoices = await getPendingInvoices('PROCESSING', 1000);

    for (const invoice of invoices) {
        const trackingId = invoice.tracking_id || invoice.id || "unknown";
        console.log(`[${trackingId}] Reprocessing pending invoice`);
        await processInvoice(trackingId, invoice);
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
        "approval-pubsub",
        "invoice.submitted",
        async (eventData) => {
            try {
                const invoice = eventData && eventData.data ? eventData.data : eventData;
                const trackingId = invoice.tracking_id || invoice.id || "unknown";
                console.log(`[${trackingId}] Incoming invoice received via Pub/Sub`);
                //WILL BE PROCESSED in TOUR startWorkerLoop() function, so we just save it to mongo and return SUCCESS
                return "SUCCESS";

            } catch (err) {
                console.error("!!! ERROR IN INVOICE PROCESSING STREAM !!!", err.message);
                return "RETRY";
            }
        }
    );

    await startServerWithRetry();

    // Replay any previously stuck PROCESSING invoices
    try {
        await checkStuckInvoices();
    } catch (err) {
        console.error(`[governance-startup] Failed to replay pending invoices:`, err.message);
    }

    if (process.env.NODE_ENV !== 'test') {
        startWorkerLoop();
    }

    if (server.server && server.server.server) {
        server.server.server.timeout = 0;
        server.server.server.keepAliveTimeout = 0;
    }
    console.log(`🚀 Node.js Governance Agent successfully started on port ${appPort}`);
}



async function publishInvoiceProcessedNotification(pendingInvoice, finalStatus, aiApproved, reason = null) {
    if (!pendingInvoice) return;
    try {
        await daprClient.pubsub.publish(PUB_SUB_NAME, NOTIFICATION_TOPIC, pendingInvoice);
    } catch (err) {
        console.error(`[${pendingInvoice.tracking_id}] Failed to publish invoice processed notification:`, err.message);
    }
}

module.exports = { start, publishInvoiceProcessedNotification, getPendingInvoices, server, daprClient };

if (require.main === module) {
    start().catch(console.error);
}
