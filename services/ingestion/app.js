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
const MONGO_STATE_STORE = 'mongo-state';

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

async function dispatchOutboxEvent(outboxEvent, correlationId) {
    try {
        await daprClient.pubsub.publish(
            outboxEvent.pubsub_name,
            outboxEvent.topic,
            outboxEvent.payload
        );
        await daprClient.state.save(MONGO_STATE_STORE, [
            {
                key: outboxEvent.event_id,
                value: {
                    ...outboxEvent,
                    processed: true,
                    processed_at: new Date().toISOString()
                }
            }
        ]);


        logMessage('INFO', correlationId, `Dispatched outbox event ${outboxEvent.event_id} to ${outboxEvent.topic}`);
        return true;
    } catch (error) {
        logMessage('ERROR', correlationId, `Outbox dispatch failed for ${outboxEvent.event_id}: ${error.message}`);
        return false;
    }
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
            note: body.note ?? null
        };

        const outboxEventId = `outbox_${crypto.randomUUID()}`;
        const outboxEvent = {
            event_id: outboxEventId,
            pubsub_name: PUB_SUB_NAME,
            topic: PUB_SUB_TOPIC,
            payload: eventPayload,
            processed: false,
            created_at: new Date().toISOString()
        };
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
        await daprClient.state.save(MONGO_STATE_STORE, [
            {
                key: outboxEventId,
                value: outboxEvent
            }
        ]);

        logMessage('INFO', correlationId, `Transactionally saved invoice and outbox event ${outboxEventId}`);
        await dispatchOutboxEvent(outboxEvent, correlationId);

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
async function runOutboxSweeper() {
    try {
        // search in mongo stuck outbox
        const response = await daprClient.state.query(MONGO_STATE_STORE, {
            filter: {
                "EQ": { "value.processed": false }
            },
            page: { limit: 50 }
        });

        if (!response.results || response.results.length === 0) {
            console.log("Not Found stuck outbox events");
            return;
        }
        console.log("Found stuck outbox events:", response.results.length);
        const twoMinutesAgo = Date.now() - (2 * 60 * 1000);

        for (const item of response.results) {
            const outboxEvent = item.data;
            const createdAt = new Date(outboxEvent.created_at).getTime();

            // If the event was not dispatched and has been stuck for more than 2 minutes — re-dispatch
            if (createdAt < twoMinutesAgo) {
                logMessage('WARN', outboxEvent.payload.correlation_id, `Sweeper re-dispatched stuck event ${outboxEvent.event_id}`);
                await dispatchOutboxEvent(outboxEvent, outboxEvent.payload.correlation_id);
            }
        }
    } catch (error) {
        logMessage('ERROR', '0', `Outbox Sweeper error: ${error.message}`);
    }
}

<<<<<<< Updated upstream
// checking every 2 minutes
=======
>>>>>>> Stashed changes
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Ingestion Service successfully started on port ${PORT}`);
    });
<<<<<<< Updated upstream

    setInterval(runOutboxSweeper, 2 * 60 * 1000);
    runOutboxSweeper();
}

=======
<<<<<<< Updated upstream
}
=======
    runOutboxSweeper();
}

>>>>>>> Stashed changes
>>>>>>> Stashed changes
