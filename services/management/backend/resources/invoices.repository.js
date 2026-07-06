const STATE_STORE_NAME = "mongo-invoices";
const PUB_SUB_NAME = "approval-pubsub";

class InvoicesRepository {
    constructor(daprClient) {
        this.daprClient = daprClient;
    }
    async sendInvoices(invoices) {
        const apiURL = process.env.INVOICE_URL;
        const results = [];
        for (var invoice of invoices) {

            const response = await fetch(apiURL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // 'Authorization': 'Bearer YOUR_TOKEN'
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
        let filter = {};
        let sorting = [
            {
                key: "submitted_at",
                order: "DESC"
            }
        ];
        if (targetStatus == "HUMAN_REVIEW") {
            filter = {
                EQ: {
                    "status": targetStatus
                }
            };
            sorting = [
                {
                    key: "submitted_at",
                    order: "ASC"
                }
            ];
        }
        const response = await this.daprClient.state.query(STATE_STORE_NAME, {
            filter: filter,
            sort: sorting,
            page: { limit: 100 }
        });

        const invoices = response.results.map(item => ({ ...(item.data || {}), key: item.key }));
        return invoices || [];

    }

    async updateInvoiceStatus(key, status) {
        if (status !== 'APPROVED' && status !== "REJECTED") {
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
            await this.daprClient.pubsub.publish(PUB_SUB_NAME, 'payment.requested', invoice);
        }
        return invoice;

    }

}
module.exports = InvoicesRepository;