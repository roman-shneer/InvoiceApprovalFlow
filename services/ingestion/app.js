const express = require('express');
const { DaprClient, HttpMethod } = require('@dapr/dapr');
const crypto = require('crypto');
const fs = require('fs');


const DAPR_HOST = process.env.DAPR_HOST || 'ingestion-dapr-sidecar';
const DAPR_PORT = process.env.DAPR_PORT || '3500';
const PORT = process.env.PORT || 8001;

const STATE_STORE_NAME = 'approval-state';
const PUB_SUB_NAME = 'approval-pubsub';
//const PUB_SUB_TOPIC = 'invoice.submitted';
const MONGO_STATE_STORE = 'mongo-state';
const MONGO_INVOICES_STORE = 'mongo-invoices';
const NOTIFICATION_PROCESSED_TOPIC = "invoice.processed";

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

function decodeJwtPayload(token) {
    if (!token) return null;
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const base64Url = parts[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = Buffer.from(base64, 'base64').toString('utf8');

        return JSON.parse(jsonPayload);
    } catch (err) {
        console.error('[JWT Error] Failed to decode token payload:', err.message);
        return null;
    }
}

async function saveInvoiceToMongo(invoice) {

    const pendingInvoice = {
        ...invoice,
        createdAt: new Date().toISOString()
    };
    try {
        await daprClient.state.save(MONGO_INVOICES_STORE, [
            {
                key: pendingInvoice.tracking_id,
                value: pendingInvoice
            }
        ]);

    } catch (dbErr) {
        console.log(`[${invoice.tracking_id}] ERROR: ${invoice.correlation_id}: Failed to save audit record in MongoDB: ${dbErr.message}`);
    }
}
async function publishInvoiceNotification(pendingInvoice, topic = NOTIFICATION_PROCESSED_TOPIC) {
    if (!pendingInvoice) return;
    try {
        await daprClient.pubsub.publish(PUB_SUB_NAME, topic, pendingInvoice);
    } catch (err) {
        console.error(`[${pendingInvoice?.tracking_id}] Failed to publish invoice processed notification:`, err.message);
    }
}

logMessage('INFO', '0', 'Ingestion service bootstrap complete. Listening for incoming traffic.');


app.post('/api/v1/expenses', async (req, res) => {
    const correlationId = req.headers['x-correlation-id'] || `corr_${crypto.randomUUID()}`;
    logMessage('INFO', correlationId, 'Received raw invoice submission request.');

    const authHeader = req.headers['authorization'];
    let userPayload = null;
    if (authHeader) {
        let token = null;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }
        userPayload = decodeJwtPayload(token);
    }
    if (!authHeader || !userPayload || userPayload.role !== 'submitter' || !userPayload.exp) {
        logMessage('WARN', correlationId, 'Unauthorized submission attempt.');
        return res.status(403).json({ error: 'Forbidden: Invalid or missing token.' });
    }

    const currentUnixTimestamp = Math.floor(Date.now() / 1000);
    if (currentUnixTimestamp > userPayload.exp) {
        logMessage('WARN', correlationId, 'Token has expired.');
        return res.status(403).json({ error: 'Forbidden: Token has expired.' });
    }

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
            logMessage('INFO', correlationId, `Duplicate detected: ${idempotencyKey}.`);

            return res.status(200).json({
                tracking_id: trackingId,
                status: existingState.status || 'PROCESSING',
                message: 'Duplicate request detected. Invoice is already being processed.'
            });
        }

        const trackingId = body.id;
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
            attendees: body.attendees || 1,
            lineItems: body.lineItems || [],

            taxAmount: parseFloat(body.taxAmount || 0.0),
            total: parseFloat(total),
            receiptPresent: Boolean(body.receiptPresent ?? true),
            date: body.date || new Date().toISOString().split('T')[0],
            notes: body.notes || '',
            scenario: body.scenario || 'standard-ingest',
            expected: body.expected ?? null,
            note: body.note ?? null,
            status: 'PENDING'
        };

        saveInvoiceToMongo((eventPayload.status = 'PENDING', eventPayload)).catch(async (dbErr) => {
            //TODO: Implement retry mechanism for failed Mongo saves. For now, log the error and continue processing.
            console.error(`[${eventPayload.tracking_id}] Failed asynchronous background Mongo save:`, dbErr.message);
        });
        await publishInvoiceNotification(eventPayload, NOTIFICATION_PROCESSED_TOPIC);
        //require for duplication detection - save to state store with TTL
        await daprClient.state.save(STATE_STORE_NAME, [
            {
                key: idempotencyKey,
                value: {
                    tracking_id: trackingId,
                    correlation_id: correlationId,
                    status: 'PROCESSING'
                },
                metadata: { ttlInSeconds: '86400' }
            }
        ]);


        return res.status(202).json({
            tracking_id: trackingId,
            status: 'ACCEPTED',
            message: `Invoice submitted successfully and queued for processing.`
        });

    } catch (error) {
        logMessage('ERROR', correlationId, `Critical failure in ingestion processing: ${error.message}`);
        const statusCode = error.status || error.statusCode || 500;
        const errorMessage = statusCode === 500 ? 'Internal Server Error' : error.message;
        return res.status(statusCode).json({ error: errorMessage });
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
