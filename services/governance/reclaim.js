// reclaim.js - concurrencyPolicy: Forbid
async function reclaim() {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const result = await daprClient.state.query(STATE_STORE_NAME, {
        filter: {
            AND: [
                { EQ: { status: 'PROCESSING' } },
                { LT: { lockedAt: cutoff } }
            ]
        },
        page: { limit: 20 }
    });

    for (const item of result.results) {
        try {
            // first-write + etag = атомарный лок, только 1 под заберет
            await daprClient.state.save(STATE_STORE_NAME, [{
                key: item.key,
                value: { ...item.data, lockedBy: POD_NAME, lockedAt: new Date().toISOString() },
                etag: item.etag,
                options: { concurrency: 'first-write' }
            }]);

            console.log(`Перепубликовываю зависший ${item.key}`);
            await daprClient.pubsub.publish("approval-pubsub", "invoice-pending", item.data.payload);

        } catch (e) {
            // etag не совпал - другой под уже забрал, пропускаем
            continue;
        }
    }
}