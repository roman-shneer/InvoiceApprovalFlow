class InvoiceController {
    constructor(manager) {
        this.manager = manager;
    }

    sendInvoice = async (req, res) => {
        const currentUserRole = req?.user?.role || null;
        const { invoice } = req.body;

        if (currentUserRole == 'submitter') {
            const result = await this.manager.sendInvoices(invoice);
            return res.json(result);

        } else {
            return res.status(403).json({ error: 'Unauthorized' });
        }

    }

    getInvoices = async (req, res) => {
        const currentUserRole = req?.user?.role || null;
        const status = req.query.status;
        if (currentUserRole == 'submitter' || currentUserRole == 'approver') {
            console.log(status);
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
            return res.json(result);

        } else {
            return res.status(403).json({ error: 'Unauthorized' });
        }
    }

    rejectInvoice = async (req, res) => {
        const currentUserRole = req?.user?.role || null;
        const key = req.query.key;
        if (currentUserRole == 'approver') {

            const result = await this.manager.updateInvoiceStatus(key, "REJECTED");
            return res.json(result);

        } else {
            return res.status(403).json({ error: 'Unauthorized' });
        }
    }

}

module.exports = InvoiceController;