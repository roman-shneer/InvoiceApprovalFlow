const bcrypt = require('bcrypt');
const CryptoEngine = new (require('../engines/crypto.engine.js'))();
async function UsersInit(daprClient, STATE_STORE_NAME) {

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
                return;
            }

            console.log("⚠️ [BOOTSTRAP] No users discovered in MongoDB. Commencing secure 3-role seed pipeline...");
            const adminHash = await CryptoEngine.hashPassword(process.env.DEFAULT_USER_ADMIN_PASSWORD);
            const approverHash = await CryptoEngine.hashPassword(process.env.DEFAULT_USER_APPROVER_PASSWORD);
            const submitterHash = await CryptoEngine.hashPassword(process.env.DEFAULT_USER_SUBMITTER_PASSWORD);

            const seedUsers = [
                {
                    key: process.env.DEFAULT_USER_ADMIN_USERNAME,
                    value: {
                        username: process.env.DEFAULT_USER_ADMIN_USERNAME,
                        password_hash: adminHash,
                        role: "admin"
                    }
                },
                {
                    key: process.env.DEFAULT_USER_APPROVER_USERNAME,
                    value: {
                        username: process.env.DEFAULT_USER_APPROVER_USERNAME,
                        password_hash: approverHash,
                        role: "approver"
                    }
                },
                {
                    key: process.env.DEFAULT_USER_SUBMITTER_USERNAME,
                    value: {
                        username: process.env.DEFAULT_USER_SUBMITTER_USERNAME,
                        password_hash: submitterHash,
                        role: "submitter"
                    }
                }
            ];

            await daprClient.state.save(STATE_STORE_NAME, seedUsers);


            console.log("🍏 [BOOTSTRAP] Successfully persisted 3 compliant role envelopes into MongoDB store.");

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