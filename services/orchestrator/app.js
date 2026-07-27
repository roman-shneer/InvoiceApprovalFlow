const { DaprServer, DaprClient } = require('@dapr/dapr');
const appPort = process.env.APP_PORT || "8003";
const daprHost = process.env.DAPR_HOST || "127.0.0.1";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";
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
const PUB_SUB_NAME = "approval-pubsub";
const PUB_SUB_TOPIC_PENDING = 'invoice.pending';
const PUB_SUB_TOPIC_PAYMENT = 'payment.requested';

async function scheduleJob(jobName, data = {}, schedule = null, dueTime = null) {
    const payload = {
        data,
        dueTime: dueTime || new Date().toISOString()
    };

    if (schedule) {
        payload.schedule = schedule;
    }

    const res = await fetch(`http://${daprHost}:${daprPort}/v1.0-alpha1/jobs/${jobName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to schedule job ${jobName}: ${errorText}`);
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

async function saveInvoice(key, invoice, status) {
    invoice.status = status;
    invoice.processing_date = Date.now();
    await daprClient.state.save("mongo-invoices", [
        {
            key: key,
            value: invoice
        }
    ]);

}


async function start() {

    await server.invoker.listen(
        "job/mongo-event-cron", // Route URL
        async (req, res) => {
            const thirtyMinAgoMs = Date.now() - (5 * 60 * 1000);

            try {
                // 1.request to mongo-invoices
                const response = await daprClient.state.query("mongo-invoices", {
                    filter: {
                        "OR": [
                            { "EQ": { "status": "PENDING" } },
                            { "EQ": { "status": "AUTO_APPROVE" } },
                            { "EQ": { "status": "APPROVED" } },
                            {
                                "AND": [
                                    { "EQ": { "status": "PROCESSING" } },
                                    { "LTE": { "processing_date": thirtyMinAgoMs } }
                                ]
                            },
                            {
                                "AND": [
                                    { "EQ": { "status": "PROCESSING_PAYMENT" } },
                                    { "LTE": { "processing_date": thirtyMinAgoMs } }
                                ]
                            }
                        ]
                    },
                    page: { limit: 1 }, // Обрабатываем строго по 1 инвойсу за раз
                    sort: [{ key: 'created_at', order: 'ASC' }]
                });

                const rawResults = response?.results || [];
                if (rawResults.length === 0) {
                    return { done: true, message: "No pending invoices found" };
                }


                const item = rawResults[0];
                const key = item.key;
                const invoice = item.data || item.value || item;
                console.log(`[Job Cron] Processing invoice: ${invoice.tracking_id} | Status: ${invoice.status}`);
                switch (invoice.status) {
                    case 'PENDING':
                    case 'PROCESSING':
                        await daprClient.pubsub.publish(PUB_SUB_NAME, PUB_SUB_TOPIC_PENDING, invoice);
                        await saveInvoice(key, invoice, 'PROCESSING');
                        break;
                    case 'AUTO_APPROVE':
                    case 'APPROVED':
                    case 'PROCESSING_PAYMENT':
                        await daprClient.pubsub.publish(PUB_SUB_NAME, PUB_SUB_TOPIC_PAYMENT, invoice);
                        await saveInvoice(key, invoice, 'PROCESSING_PAYMENT');
                        break;

                }


            } catch (err) {
                console.error("[Job Cron Error]:", err.message || err);
            }

            return { done: true };
        },
        { method: "POST" }
    );

    await startServerWithRetry();

    try {
        // register job to run every 10 seconds (or as defined in env)
        await scheduleJob("mongo-event-cron", {}, `@every ${process.env.AI_REQUEST_DELAY || 10}s`);
        console.log("Successfully registered recurring job 'mongo-event-cron'");
    } catch (err) {
        console.error("Failed to register recurring job:", err.message);
    }
}

if (require.main === module) {
    start().catch(console.error);
}
