class InvoiceManager {
    constructor(resource) {
        this.resource = resource;
    }

    async sendInvoices(jsonString) {

        try {
            const data = JSON.parse(jsonString);
            const invoices = [];
            if (typeof data.id != "undefined") {
                invoices.push(data);
            }
            else if (typeof data.fixtures != "undefined") {
                data.fixtures.map((d) => invoices.push(d));
            } else {
                data.map((d) => invoices.push(d));
            }
            const results = await this.resource.sendInvoices(invoices);
            return { success: true, message: "ok", results: results };
        } catch (error) {
            console.error("JSON parsing error:", error.message);
            return { success: false, message: `JSON parsing error:${error.message}` };
        }

    }

    async getInvoices(status) {
        return await this.resource.getInvoices(status);
    }

    async updateInvoiceStatus(key, status) {

        return await this.resource.updateInvoiceStatus(key, status);
    }

}

module.exports = InvoiceManager;