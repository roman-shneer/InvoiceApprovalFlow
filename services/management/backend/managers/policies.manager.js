class PoliciesManager {
    constructor(resource, engine) {
        this.resource = resource;
        this.engine = engine;
    }

    normalizeCreatedAt(createdAt) {
        if (!createdAt) {
            return new Date().toISOString();
        }
        if (typeof createdAt === 'string') {
            return createdAt;
        }
        if (createdAt instanceof Date) {
            return createdAt.toISOString();
        }
        if (typeof createdAt === 'object') {
            if ('$date' in createdAt) {
                const value = createdAt.$date;
                if (typeof value === 'string') {
                    return value;
                }
                return new Date(Number(value)).toISOString();
            }
            if ('$numberLong' in createdAt) {
                return new Date(Number(createdAt.$numberLong)).toISOString();
            }
            if ('$numberInt' in createdAt) {
                return new Date(Number(createdAt.$numberInt)).toISOString();
            }
        }
        const fallback = new Date(createdAt);
        return Number.isNaN(fallback.valueOf()) ? new Date().toISOString() : fallback.toISOString();
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
    async savePolicy(policy, originalRuleId = null) {
        // Validate the incoming data payload using the engine
        if (!this.engine.isValidPolicy(policy)) {
            return { success: false, error: 'Invalid data format' };
        }
        policy.created_at = this.normalizeCreatedAt(policy.created_at);
        const savedPolicy = await this.resource.save(policy);
        if (originalRuleId && originalRuleId !== policy.rule_id) {
            await this.resource.delete(originalRuleId);
        }
        return { success: true, data: savedPolicy };
    }


    async deletePolicy(id) {
        return await this.resource.delete(id);
    }
}

module.exports = PoliciesManager;
