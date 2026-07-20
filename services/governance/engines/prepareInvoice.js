const { getFxRate } = require('../resources/db');
async function prepareInvoice(invoice) {
    if (invoice.currency !== 'USD') {
        const rateEntry = await getFxRate(invoice.currency, invoice.date);
        // Convert to USD using a mock conversion rate for demonstration purposes
        if (rateEntry && rateEntry.rate) {
            const conversionRate = rateEntry.rate;
            invoice.total = (parseFloat(invoice.total) * conversionRate).toFixed(2);
            invoice.currency = 'USD';
            invoice.taxAmount = (parseFloat(invoice.taxAmount) * conversionRate).toFixed(2);
            invoice.lineItems = invoice.lineItems.map(item => ({
                ...item,
                unitPrice: (parseFloat(item.unitPrice) * conversionRate).toFixed(2)
            }));
        }
    }
    return invoice;
}

module.exports = { prepareInvoice };