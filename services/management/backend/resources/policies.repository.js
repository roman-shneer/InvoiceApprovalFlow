const STATE_STORE_NAME = "mongo-policies";

class PoliciesRepository {

    constructor(daprClient) {
        this.daprClient = daprClient;
    }

    /**
     * Retrieves all settings from the database
     */
    async find() {
        const response = await this.daprClient.state.query(STATE_STORE_NAME, {
            filter: {},
            page: { limit: 100 }
        });

        const activeRules = response.results.map(item => {
            return item.data || item.value;
        });
        return activeRules || [];

    }

    /**
     * Persists or updates a specific setting key-value pair
     */
    async save(policy) {
        return await this.daprClient.state.save(STATE_STORE_NAME, [
            {
                key: policy.rule_id,
                value: policy
            }
        ]);
    }

    async delete(id) {
        return await this.daprClient.state.delete(STATE_STORE_NAME, id);
    }
}

module.exports = PoliciesRepository;
