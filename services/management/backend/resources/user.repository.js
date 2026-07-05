
const STATE_STORE_NAME = "mongo-users";

class UserRepository {
    constructor(daprClient) {
        this.daprClient = daprClient;
    }


    async findByUsername(username) {
        const user = await this.daprClient.state.get(STATE_STORE_NAME, username);
        return user || null;
    }


    async create(username, role, passwordHash) {
        const key = `doc_${randomUUID()}`;
        const result = await this.daprClient.state.save(STATE_STORE_NAME, [
            {
                key: key,
                value: { username, role, 'password_hash': passwordHash }
            }
        ]);
        return result;

    }


    async updateWithPassword(key, username, role, passwordHash) {
        const data = { username, role, 'password_hash': passwordHash };
        console.log("updateWithPassword", data);
        const result = await this.daprClient.state.save(STATE_STORE_NAME, [
            {
                key: key,
                value: data
            }
        ]);
        return result;
    }

    async updateWithoutPassword(key, username, role) {
        const user = await this.daprClient.state.get(STATE_STORE_NAME, username);
        const data = { username, role, 'password_hash': user.password_hash };
        console.log("updateWithoutPassword", data);
        const result = await this.daprClient.state.save(STATE_STORE_NAME, [
            {
                key: key,
                value: data
            }
        ]);
        return result;
    }

    async findAll() {
        const response = await this.daprClient.state.query(STATE_STORE_NAME, {
            filter: {},
            page: { limit: 100 }
        });


        const users = response.results.map(item => {
            let data = item.data || item.value;

            return {
                key: item.key,
                username: data.username,
                role: data.role
            };
        });
        return users;
    }

    async delete(id) {
        return await this.daprClient.state.delete(STATE_STORE_NAME, id);
    }


}
module.exports = UserRepository;