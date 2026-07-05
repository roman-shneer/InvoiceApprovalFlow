class InvoiceManager {
    constructor(resource) {
        this.resource = resource;
    }

    async sendInvoices(payload) {

        try {
            const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
            const invoices = [];
            if (!data) {
                throw new Error('No invoice data provided');
            }
            if (typeof data.id !== 'undefined') {
                invoices.push(data);
            } else if (typeof data.fixtures !== 'undefined') {
                data.fixtures.forEach((d) => invoices.push(d));
            } else if (Array.isArray(data)) {
                data.forEach((d) => invoices.push(d));
            } else {
                throw new Error('Unsupported invoice payload format');
            }
            const results = await this.resource.sendInvoices(invoices);
            return { success: true, message: 'ok', results: results };
        } catch (error) {
            console.error('JSON parsing error:', error.message);
            return { success: false, message: `JSON parsing error: ${error.message}` };
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