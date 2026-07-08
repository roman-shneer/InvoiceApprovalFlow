//require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
//require('dotenv').config({});
console.log("APP loaded", process.env.MONGO_DB, "with AI model:", process.env.AI_MODEL_NAME);
const express = require('express');
const { DaprServer, DaprClient } = require('@dapr/dapr');
const { classifyInvoiceWithLocalAI } = require('./resources/ai');
const { checkHardStops } = require('./engines/checkHardStops');
const { applyAutonomyOverride } = require('./engines/applyAutonomyOverride');
const { evaluateInvoiceWithAI } = require('./engines/evaluateInvoiceWithAI');
const { logCompliance } = require('./utils/logCompliance');
const { getPolicies, getFxRates, saveInvoiceToMongo } = require('./resources/db');

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
    await server.pubsub.subscribe(
        "approval-pubsub",
        "invoice.submitted",
        async (eventData) => {
            try {
                const invoice = eventData && eventData.data ? eventData.data : eventData;
                const trackingId = invoice.tracking_id || invoice.id || "unknown";

                console.log(`[${trackingId}] Incoming invoice received via Pub/Sub`);

                invoice.status = 'PENDING';
                await saveInvoiceToMongo(invoice);
                await publishInvoiceProcessedNotification(invoice, 'PENDING', false, 'Invoice received and pending processing');

                setImmediate(async () => {
                    const correlationId = invoice.correlation_id || "unknown";

                    // Initialize empty buckets to accumulate ALL audit findings across the matrix boundaries
                    let allTriggeredRules = [];
                    let allReasons = [];
                    let forceHumanReview = false;

                    try {
                        const activeRules = await getPolicies();
                        const fxRates = await getFxRates();

                        // 1. Evaluate Deterministic Hard Stops Registry (Gathering all matching violations)
                        const hardStop = checkHardStops(invoice, activeRules, fxRates);
                        console.log("****hardStop Evaluation:", trackingId, hardStop);

                        if (hardStop.triggered) {
                            forceHumanReview = true;
                            // Support both multi-rule array returns or legacy single rule objects fallbacks
                            if (hardStop.rules && Array.isArray(hardStop.rules)) {
                                allTriggeredRules = [...allTriggeredRules, ...hardStop.rules];
                            } else if (hardStop.rule) {
                                allTriggeredRules.push(hardStop.rule);
                            }
                            allReasons.push(hardStop.reason);
                            logCompliance("WARN", trackingId, correlationId, `Deterministic stop triggered: ${hardStop.reason}`);
                        }

                        // 2. Local AI Inference and Rule Engine Fallback Classification
                        let aiResult;
                        try {
                            aiResult = await classifyInvoiceWithLocalAI(invoice, activeRules);
                            console.log("****classifyInvoiceWithLocalAI", trackingId, aiResult);
                        } catch (err) {
                            aiResult = evaluateInvoiceWithAI(invoice, activeRules);
                            console.log("****evaluateInvoiceWithAI", aiResult);
                            logCompliance("ERROR", trackingId, correlationId, `AI failure context: ${err.message}. Triggered static heuristics.`);
                        }

                        // 3. Evaluate Dynamic Autonomy Ceilings and Confidence Boundaries Thresholds
                        const finalResult = applyAutonomyOverride(aiResult, invoice, activeRules);
                        console.log("***finalResult", finalResult);
                        if (finalResult.recommendation === 'HUMAN_REVIEW') {
                            forceHumanReview = true;
                        }

                        if (finalResult.triggered_rules && Array.isArray(finalResult.triggered_rules)) {
                            allTriggeredRules = [...allTriggeredRules, ...finalResult.triggered_rules];
                        }
                        allReasons.push(finalResult.reason);

                        // 4. Deduplicate rules array and compile formatted clear audit text records string
                        const uniqueTriggeredRules = [...new Set(allTriggeredRules)];
                        console.log("***allReasons", allReasons);
                        const cleanFinalReason = allReasons.filter(Boolean).join(" ; ");
                        const finalStatus = forceHumanReview ? 'HUMAN_REVIEW' : 'AUTO_APPROVE';
                        const aiApproved = finalStatus === 'AUTO_APPROVE';

                        logCompliance(
                            aiApproved ? "INFO" : "WARN",
                            trackingId, correlationId,
                            `Final Combined Verdict: ${finalStatus}. Reasons: ${cleanFinalReason}`
                        );

                        // 5. Atomic state synchronization layer execution
                        invoice.status = finalStatus;
                        invoice.audit_metadata = {
                            checked_at: new Date().toISOString(),
                            reason: cleanFinalReason,
                            triggered_rules: uniqueTriggeredRules
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
                    }
                });

                return "SUCCESS";

            } catch (err) {
                console.error("!!! ERROR IN INVOICE PROCESSING STREAM !!!", err.message);
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
    try {
        await daprClient.pubsub.publish(PUB_SUB_NAME, NOTIFICATION_TOPIC, pendingInvoice);
        console.log(`[${pendingInvoice.tracking_id}] Published invoice processed notification to ${NOTIFICATION_TOPIC}`);
    } catch (err) {
        console.error(`[${pendingInvoice.tracking_id}] Failed to publish invoice processed notification:`, err.message);
    }
}

module.exports = { start, publishInvoiceProcessedNotification, server, daprClient };

if (require.main === module) {
    start().catch(console.error);
}
