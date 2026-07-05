const express = require('express');
const { DaprClient, HttpMethod } = require('@dapr/dapr');
const crypto = require('crypto');
const fs = require('fs');


const DAPR_HOST = process.env.DAPR_HOST || 'ingestion-dapr-sidecar';
const DAPR_PORT = process.env.DAPR_PORT || '3500';
const PORT = process.env.PORT || 8001;

const STATE_STORE_NAME = 'approval-state';
const PUB_SUB_NAME = 'approval-pubsub';
const PUB_SUB_TOPIC = 'invoice.submitted';


const daprClient = new DaprClient({ daprHost: DAPR_HOST, daprPort: DAPR_PORT });
const app = express();


app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    next();
});


function logMessage(level, correlationId, message) {
    const log = {
        timestamp: new Date().toISOString(),
        level: level,
        service: 'ingestion-service',
        correlation_id: correlationId,
        message: message
    };

    const formattedMsg = JSON.stringify(log) + '\n';
    process.stdout.write(formattedMsg);


    fs.appendFile('server.log', formattedMsg, (err) => {
        if (err) console.error('Error writing log to file:', err);
    });
}


logMessage('INFO', '0', 'Ingestion service bootstrap complete. Listening for incoming traffic.');


app.post('/api/v1/expenses', async (req, res) => {

    const correlationId = req.headers['x-correlation-id'] || `corr_${crypto.randomUUID()}`;
    logMessage('INFO', correlationId, 'Received raw invoice submission request.');

    const body = req.body;


    if (!body || !body.id) {
        logMessage('WARN', correlationId, 'Rejected due to invalid JSON schema.');
        return res.status(400).json({ error: 'Invalid schema. Required: id' });
    }


    const vendor = body.vendor || 'UnknownVendor';
    const invoiceNumber = body.invoiceNumber || 'NoNumber';
    const total = body.total ?? 0.0;


    const hashString = `${vendor}_${invoiceNumber}_${total}`;
    const idempotencyKey = crypto.createHash('md5').update(hashString).digest('hex');

    try {

        const existingState = await daprClient.state.get(STATE_STORE_NAME, idempotencyKey);

        if (existingState && Object.keys(existingState).length > 0) {
            const trackingId = existingState.tracking_id || body.id;
            logMessage('INFO', correlationId, `Duplicate detected via key: ${idempotencyKey}. Short-circuiting request.`);

            return res.status(200).json({
                tracking_id: trackingId,
                status: existingState.status || 'PROCESSING',
                message: 'Duplicate request detected. Invoice is already being processed.'
            });
        }

        const trackingId = body.id;


        await daprClient.state.save(STATE_STORE_NAME, [
            {
                key: idempotencyKey,
                value: {
                    tracking_id: trackingId,
                    correlation_id: correlationId,
                    status: 'PROCESSING'
                },
                metadata: {
                    ttlInSeconds: '86400'
                }
            }
        ]);


        const category = body.category || 'General';

        const eventPayload = {
            idempotency_key: idempotencyKey,
            correlation_id: correlationId,
            submitted_at: new Date().toISOString(),
            tracking_id: trackingId,
            submitter: body.submitter || 'anonymous@example.com',
            department: body.department || 'unassigned',
            vendor: vendor,
            vendorKnown: Boolean(body.vendorKnown ?? true),
            invoiceNumber: invoiceNumber,
            currency: body.currency || 'USD',
            category: category,
            lineItems: body.lineItems || [],
            taxAmount: parseFloat(body.taxAmount || 0.0),
            total: parseFloat(total),
            receiptPresent: Boolean(body.receiptPresent ?? true),
            date: body.date || new Date().toISOString().split('T')[0],
            notes: body.notes || '',
            scenario: body.scenario || 'standard-ingest',
            expected: body.expected ?? null,
            note: body.note ?? null
        };


        await daprClient.pubsub.publish(PUB_SUB_NAME, PUB_SUB_TOPIC, eventPayload);
        logMessage('INFO', correlationId, `Successfully published '${PUB_SUB_TOPIC}' event for tracking_id: ${trackingId}`);


        return res.status(202).json({
            tracking_id: trackingId,
            status: 'ACCEPTED',
            message: 'Invoice submitted successfully and queued for processing.'
        });

    } catch (error) {
        logMessage('ERROR', correlationId, `Critical failure in ingestion processing: ${error.message}`);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});


app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
});

module.exports = app;
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Ingestion Service successfully started on port ${PORT}`);
    });
}