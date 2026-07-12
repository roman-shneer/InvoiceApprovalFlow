const bcrypt = require('bcrypt');
const CryptoEngine = new (require('../engines/crypto.engine.js'))();
async function UsersInit(daprClient, STATE_STORE_NAME) {

    const defaultUsers = {
        admin: {
            username: process.env.DEFAULT_USER_ADMIN_USERNAME || 'admin',
            password: process.env.DEFAULT_USER_ADMIN_PASSWORD || 'admin'
        },
        approver: {
            username: process.env.DEFAULT_USER_APPROVER_USERNAME || 'approver',
            password: process.env.DEFAULT_USER_APPROVER_PASSWORD || 'approver'
        },
        submitter: {
            username: process.env.DEFAULT_USER_SUBMITTER_USERNAME || 'submitter',
            password: process.env.DEFAULT_USER_SUBMITTER_PASSWORD || 'submitter'
        }
    };

    let isInitialized = false;
    let attempts = 0;
    while (!isInitialized && attempts < 30) {
        attempts++;

        try {
            console.log("⏳ [BOOTSTRAP] Checking for existing user records via Dapr State Query API...");


            const queryResponse = await daprClient.state.query(STATE_STORE_NAME, {
                filter: {},
                select: [],
                page: { limit: 1 }
            });

            if (queryResponse.results && queryResponse.results.length > 0) {
                console.log(`🍏 [BOOTSTRAP] Users collection is already initialized. Found existing accounts.`);
                isInitialized = true;
                return;
            }

            console.log("⚠️ [BOOTSTRAP] No users discovered in MongoDB. Commencing secure 3-role seed pipeline...");
            const adminHash = await CryptoEngine.hashPassword(defaultUsers.admin.password);
            const approverHash = await CryptoEngine.hashPassword(defaultUsers.approver.password);
            const submitterHash = await CryptoEngine.hashPassword(defaultUsers.submitter.password);

            const seedUsers = [
                {
                    key: defaultUsers.admin.username,
                    value: {
                        username: defaultUsers.admin.username,
                        password_hash: adminHash,
                        role: "admin"
                    }
                },
                {
                    key: defaultUsers.approver.username,
                    value: {
                        username: defaultUsers.approver.username,
                        password_hash: approverHash,
                        role: "approver"
                    }
                },
                {
                    key: defaultUsers.submitter.username,
                    value: {
                        username: defaultUsers.submitter.username,
                        password_hash: submitterHash,
                        role: "submitter"
                    }
                }
            ];

            await daprClient.state.save(STATE_STORE_NAME, seedUsers);


            console.log("🍏 [BOOTSTRAP] Successfully persisted 3 compliant role envelopes into MongoDB store.");
            isInitialized = true;
            return;

        } catch (err) {
            console.error("🚨 [BOOTSTRAP CRITICAL] Users self-healing initialization failed:", err.message);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    if (!isInitialized) {
        console.error("🚨 [BOOTSTRAP CRITICAL] Dapr sidecar failed to start within 60 seconds limit.");
    }
}

module.exports = UsersInit;