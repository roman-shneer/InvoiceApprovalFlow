const STATE_STORE_NAME = "mongo-invoices";
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
                    // 'Authorization': 'Bearer YOUR_TOKEN' // если нужна авторизация
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
        console.log("updateInvoiceStatus", key);
        let rawInvoice = await this.daprClient.state.get(STATE_STORE_NAME, key);
        if (!rawInvoice) {
            return false;
        }
        console.log("updateInvoiceStatus.rawInvoice", rawInvoice);
        let invoice = typeof rawInvoice === 'string' ? JSON.parse(rawInvoice) : rawInvoice;
        invoice.status = status;
        console.log("updateInvoiceStatus.invoice", invoice);
        return await this.daprClient.state.save(STATE_STORE_NAME, [
            {
                key: key,
                value: invoice
            }
        ]);

    }

}
module.exports = InvoicesRepository;