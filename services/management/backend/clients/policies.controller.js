class PoliciesController {
    constructor(manager) {
        this.manager = manager;
    }



    /**
     * Express route handler to fetch settings
     */
    loadPolicies = async (req, res) => {
        const currentUserRole = req?.user?.role || null;
        if (currentUserRole == 'admin') {
            const policies = await this.manager.loadPolicies();
            return res.status(200).json({ policies: policies });
        } else {
            return res.status(403).json({ error: 'Unauthorized' });
        }

    }

    /**
     * Express route handler to mutation/save settings
     */

    savePolicy = async (req, res) => {

        const currentUserRole = req?.user?.role || null;
        const { policy } = req.body;
        if (currentUserRole == 'admin') {
            const result = await this.manager.savePolicy(policy);
            return res.json({ success: result.data });

        } else {
            return res.status(403).json({ error: 'Unauthorized' });
        }

    }

    deletePolicy = async (req, res) => {
        const currentUserRole = req?.user?.role || null;
        const { rule_id } = req.body;
        if (currentUserRole == 'admin') {
            await this.manager.deletePolicy(rule_id);
            return res.json({ success: true });

        } else {
            return res.status(403).json({ error: 'Unauthorized' });
        }
    }
}

module.exports = PoliciesController;
