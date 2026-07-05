class PoliciesManager {
    constructor(resource, engine) {
        this.resource = resource;
        this.engine = engine;
    }

    /**
     * Coordinates the workflow for loading system settings
     */
    async loadPolicies() {
        return await this.resource.find();
    }

    /**
     * Coordinates the workflow for saving system settings
     */
    async savePolicy(policy) {

        // Validate the incoming data payload using the engine
        if (!this.engine.isValidPolicy(policy)) {

            return { success: false, error: 'Invalid data format' };
        }
        if (!policy.created_at) {
            policy.created_at = new Date().toISOString();
        }
        const savedPolicy = await this.resource.save(policy);
        return { success: true, data: savedPolicy };
    }


    async deletePolicy(id) {
        return await this.resource.delete(id);
    }
}

module.exports = PoliciesManager;
