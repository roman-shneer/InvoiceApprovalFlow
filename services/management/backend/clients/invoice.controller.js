class InvoiceController {
    constructor(manager, websocketBroadcast) {
        this.manager = manager;
        this.websocketBroadcast = websocketBroadcast;
    }

    broadcastEvent(type, invoice) {
        if (!this.websocketBroadcast || !invoice) {
            return;
        }
        this.websocketBroadcast({ type, invoice });
    }

    sendInvoice = async (req, res) => {
        const currentUserRole = req?.user?.role || null;
        const { invoice } = req.body;

        if (currentUserRole == 'submitter') {
            const result = await this.manager.sendInvoices(invoice);
            if (Array.isArray(result)) {
                result.forEach(item => this.broadcastEvent('invoice-created', item));
            } else {
                this.broadcastEvent('invoice-created', result);
            }
            return res.json(result);

        } else {
            return res.status(403).json({ error: 'Unauthorized' });
        }

    }

    getInvoices = async (req, res) => {
        const currentUserRole = req?.user?.role || null;
        const status = req.query.status;
        if (currentUserRole == 'submitter' || currentUserRole == 'approver') {
            const result = await this.manager.getInvoices(status);
            return res.json(result);

        } else {
            return res.status(403).json({ error: 'Unauthorized' });
        }
    }

    approveInvoice = async (req, res) => {
        const currentUserRole = req?.user?.role || null;
        const key = req.query.key;
        if (currentUserRole == 'approver') {

            const result = await this.manager.updateInvoiceStatus(key, "APPROVED");
            if (result) {
                this.broadcastEvent('invoice-updated', result);
            }
            return res.json(result);

        } else {
            return res.status(403).json({ error: 'Unauthorized' });
        }
    }

    rejectInvoice = async (req, res) => {
        const currentUserRole = req?.user?.role || null;
        const key = req.query.key;
        if (currentUserRole == 'approver') {

            const result = await this.manager.updateInvoiceStatus(key, "DECLINE");
            if (result) {
                this.broadcastEvent('invoice-updated', result);
            }
            return res.json(result);

        } else {
            return res.status(403).json({ error: 'Unauthorized' });
        }
    }

}

module.exports = InvoiceController;