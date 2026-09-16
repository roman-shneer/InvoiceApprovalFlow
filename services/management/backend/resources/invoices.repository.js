const STATE_STORE_NAME = "mongo-invoices";
const PUB_SUB_NAME = "approval-pubsub";

class InvoicesRepository {
    constructor(daprClient) {
        this.daprClient = daprClient;
    }

    parseInvoiceRecord(item) {
        const rawPayload = item?.data ?? item?.value ?? null;
        const payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : (rawPayload || {});
        const key = item?.key || item?._id || payload?.tracking_id || payload?.id;
        return { ...payload, key };
    }

    async sendInvoices(invoices, token) {
        const apiURL = process.env.INVOICE_URL;
        const results = [];

        for (var invoice of invoices) {

            const response = await fetch(apiURL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(invoice)
            });

            if (response.ok) {
                const result = await response.json();
                results.push(result);
            }
        }
        return results;
    }

    async getInvoices(targetStatus) {
        const response = await this.daprClient.state.query(STATE_STORE_NAME, {
            filter: {},
            page: { limit: 100 }
        });

        const results = Array.isArray(response?.results) ? response.results : [];
        const invoices = results.map(item => this.parseInvoiceRecord(item));

        const filtered = targetStatus
            ? invoices.filter(invoice => invoice.status === targetStatus)
            : invoices;

        filtered.sort((a, b) => {
            const aDate = new Date(a.submitted_at || a.createdAt || 0).valueOf();
            const bDate = new Date(b.submitted_at || b.createdAt || 0).valueOf();
            if (targetStatus === 'HUMAN_REVIEW') {
                return aDate - bDate;
            }
            return bDate - aDate;
        });

        return filtered;

    }

    async updateInvoiceStatus(key, status) {
        if (status !== 'APPROVED' && status !== "DECLINE") {
            return false;
        }
        let actualKey = key;
        let rawInvoice = await this.daprClient.state.get(STATE_STORE_NAME, actualKey);
        if (!rawInvoice && typeof key === 'string') {
            const normalizedKey = key.includes('||') ? key.split('||').pop() : key;
            if (normalizedKey !== actualKey) {
                actualKey = normalizedKey;
                rawInvoice = await this.daprClient.state.get(STATE_STORE_NAME, actualKey);
            }
        }
        if (!rawInvoice && typeof key === 'string') {
            const response = await this.daprClient.state.query(STATE_STORE_NAME, {
                filter: {
                    EQ: {
                        tracking_id: key
                    }
                },
                page: { limit: 1 }
            });
            if (response?.results?.length > 0) {
                actualKey = response.results[0].key;
                rawInvoice = response.results[0].data || response.results[0].value;
            }
        }

        if (!rawInvoice) {
            return false;
        }
        let invoice = typeof rawInvoice === 'string' ? JSON.parse(rawInvoice) : rawInvoice;
        invoice.status = status;
        await this.daprClient.state.save(STATE_STORE_NAME, [
            {
                key: actualKey,
                value: invoice
            }
        ]);
        //inform payment
        if (status == 'APPROVED') {
            await this.daprClient.pubsub.publish(PUB_SUB_NAME, 'invoice.payment', invoice);
        }
        return invoice;

    }

}
module.exports = InvoicesRepository;