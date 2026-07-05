const express = require('express');
const { DaprServer, DaprClient } = require('@dapr/dapr');
const { classifyInvoiceWithLocalAI } = require('./resources/ai');
const { checkHardStops } = require('./engines/checkHardStops');
const { applyAutonomyOverride } = require('./engines/applyAutonomyOverride');
const { evaluateInvoiceWithAI } = require('./engines/evaluateInvoiceWithAI');
const { logCompliance } = require('./utils/logCompliance');
const { getPolicies, saveAuditRecord, saveInvoiceToMongo } = require('./resources/db');

const appPort = "8002";
const daprHost = "127.0.0.1";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";
const PUB_SUB_NAME = "approval-pubsub";
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

async function start() {
    const activeRules = await getPolicies();

    await server.pubsub.subscribe(
        "approval-pubsub",
        "invoice.submitted",
        async (eventData) => {
            try {
                // Extract raw invoice payload from Dapr CloudEvent envelope
                const invoice = eventData && eventData.data ? eventData.data : eventData;
                const trackingId = invoice.tracking_id || invoice.id || "unknown";

                console.log(`[${trackingId}] Incoming invoice received via Pub/Sub`);

                // Phase 1: persist invoice in Mongo with PENDING status
                invoice.status = 'PENDING';
                await saveInvoiceToMongo(invoice);

                // Immediately emit initial processing notification
                await publishInvoiceProcessedNotification(invoice, 'PENDING', false, 'Invoice received and pending processing');

                // Phase 2: move heavy business and AI logic off the main path
                // setImmediate is safer than nextTick for event-loop scheduling here
                setImmediate(async () => {
                    const correlationId = invoice.correlation_id || "unknown";
                    const total = parseFloat(invoice.total || 0);

                    try {
                        // 1. Check hard stop rules
                        const hardStop = checkHardStops(invoice, activeRules);
                        if (hardStop.triggered) {
                            logCompliance("WARN", trackingId, correlationId, `Hard stop [${hardStop.rule}]: ${hardStop.reason}`);

                            invoice.status = 'HUMAN_REVIEW';
                            await saveInvoiceToMongo(invoice); // Persist updated invoice status to Mongo
                            await saveAuditRecord(trackingId, correlationId, "HUMAN_REVIEW", hardStop.reason, [hardStop.rule]);
                            await publishInvoiceProcessedNotification(invoice, 'HUMAN_REVIEW', false);
                            return;
                        }

                        // 2. AI classification step
                        let aiResult;
                        try {
                            aiResult = await classifyInvoiceWithLocalAI(invoice, activeRules);
                        } catch (err) {
                            logCompliance("ERROR", trackingId, correlationId, `AI failed: ${err.message}. Running fallback rule engine.`);
                            aiResult = evaluateInvoiceWithAI(invoice, activeRules);
                        }

                        // 3. Apply autonomy override / threshold logic
                        const finalResult = applyAutonomyOverride(aiResult, invoice);
                        const finalStatus = finalResult.recommendation === 'AUTO_APPROVE' ? 'AUTO_APPROVE' : 'HUMAN_REVIEW';
                        const aiApproved = finalResult.recommendation === 'AUTO_APPROVE';

                        logCompliance(
                            aiApproved ? "INFO" : "WARN",
                            trackingId, correlationId,
                            `Decision: ${finalResult.recommendation}. ${finalResult.reason}`
                        );

                        // 4. Final sync of invoice state
                        invoice.status = finalStatus;

                        // Persist the final invoice status in MongoDB
                        await saveInvoiceToMongo(invoice);

                        // Save audit history
                        await saveAuditRecord(
                            trackingId, correlationId,
                            finalResult.recommendation,
                            finalResult.reason,
                            finalResult.triggered_rules || []
                        );

                        // Publish final verdict to notification channel
                        await publishInvoiceProcessedNotification(invoice, finalStatus, aiApproved);

                    } catch (error) {
                        console.error(`[${trackingId}] Critical failure inside background worker:`, error.message);
                    }
                });

                // Return success for Dapr Pub/Sub subscription acknowledgement
                return "SUCCESS";

            } catch (err) {
                console.error("!!! ERROR IN INVOICE PROCESSING STREAM !!!", err.message);
                // On first-phase failure, return RETRY so Dapr can redeliver later
                return "RETRY";
            }
        }
    );

    await server.start();

    if (server.server && server.server.server) {
        server.server.server.timeout = 0;
        server.server.server.keepAliveTimeout = 0;
    }
    console.log(`🚀 Node.js Governance Agent successfully started on port ${appPort}`);
}

async function publishInvoiceProcessedNotification(pendingInvoice, finalStatus, aiApproved, reason = null) {
    if (!pendingInvoice) return;

    const notificationPayload = {
        tracking_id: pendingInvoice.tracking_id || pendingInvoice.id || 'unknown',
        correlation_id: pendingInvoice.correlation_id || 'unknown',
        status: finalStatus,
        reason: reason || (aiApproved ? 'AI Auto Approved' : 'Requires Human Review'),
        amount: pendingInvoice.total,
        timestamp: new Date().toISOString()
    };

    try {
        await daprClient.pubsub.publish(PUB_SUB_NAME, NOTIFICATION_TOPIC, notificationPayload);
        console.log(`[${notificationPayload.tracking_id}] Published invoice processed notification to ${NOTIFICATION_TOPIC}`);
    } catch (err) {
        console.error(`[${notificationPayload.tracking_id}] Failed to publish invoice processed notification:`, err.message);
    }
}

start().catch(console.error);
