const express = require('express');
const { DaprServer, DaprClient } = require('@dapr/dapr');
const { classifyInvoiceWithLocalAI } = require('./resources/ai');
const { checkHardStops } = require('./engines/checkHardStops');
const { applyAutonomyOverride } = require('./engines/applyAutonomyOverride');
const { evaluateInvoiceWithAI } = require('./engines/evaluateInvoiceWithAI');
const { logCompliance } = require('./utils/logCompliance');
const { getPolicies, saveAuditRecord } = require('./resources/db');

const appPort = "8002";
const daprHost = "127.0.0.1";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";

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

                const invoice = eventData && eventData.data ? eventData.data : eventData;

                console.log(`Inovoice incoming`, invoice);

                const correlationId = invoice.correlation_id || "unknown";
                const trackingId = invoice.tracking_id || "unknown";
                const total = parseFloat(invoice.total || 0);


                const hardStop = checkHardStops(invoice, activeRules);
                if (hardStop.triggered) {
                    logCompliance("WARN", trackingId, correlationId,
                        `Hard stop [${hardStop.rule}]: ${hardStop.reason}`);

                    await saveAuditRecord(trackingId, correlationId, invoice, "HUMAN_REVIEW", hardStop.reason, [hardStop.rule]);
                    return;
                }

                let aiResult;
                try {
                    aiResult = await classifyInvoiceWithLocalAI(invoice, activeRules);
                } catch (err) {
                    logCompliance("ERROR", trackingId, correlationId, `AI failed: ${err.message}`);
                    aiResult = evaluateInvoiceWithAI(invoice, activeRules);
                }
                const finalResult = applyAutonomyOverride(aiResult, invoice);

                logCompliance(
                    finalResult.recommendation === "AUTO_APPROVE" ? "INFO" : "WARN",
                    trackingId, correlationId,
                    `Decision: ${finalResult.recommendation}. ${finalResult.reason}`
                );

                await saveAuditRecord(
                    trackingId, correlationId, invoice,
                    finalResult.recommendation,
                    finalResult.reason,
                    finalResult.triggered_rules || []
                );

            } catch (err) {
                console.error("!!! ERROR IN INVOICE PROCESSING STREAM !!!", err.message);
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



start().catch(console.error);
