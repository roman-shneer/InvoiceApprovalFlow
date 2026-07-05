require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { DaprClient } = require('@dapr/dapr');
const daprHost = process.env.DAPR_HTTP_HOST || "127.0.0.1";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";
const daprClient = new DaprClient({
    daprHost: daprHost,
    daprPort: daprPort,
    communicationTimeoutMs: 300000
});

const MONGO_USERS = "mongo-users";

const UsersInit = require('./resources/users.init.js');


async function start() {
    const UserRepository = require('./resources/user.repository.js');

    const CryptoEngine = require('./engines/crypto.engine.js');
    const UserEngine = require('./engines/user.engine.js');

    const AuthManager = require('./managers/auth.manager.js');
    const UserManagementManager = require('./managers/user-management.manager.js');


    const AuthController = require('./clients/auth.controller.js');
    const UserController = require('./clients/user.controller.js');

    const PoliciesRepository = require('./resources/policies.repository.js');
    const PoliciesEngine = require('./engines/policies.engine.js');
    const PoliciesManager = require('./managers/policies.manager.js');
    const PoliciesController = require('./clients/policies.controller.js');


    const { authenticateToken } = require('./clients/auth.middleware.js');



    const jwt = require('jsonwebtoken');


    const app = express();
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(express.json());
    app.use(cors({
        origin: 'http://localhost:5173',
        credentials: true
    }));
    app.use(session({
        secret: 'super_secret_key_123',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false,
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 1 день
        }
    }));




    const userResource = new UserRepository(daprClient);          // Передали пул БД в ресурс!
    const cryptoEngine = new CryptoEngine();
    const authManager = new AuthManager(userResource, cryptoEngine);
    const authController = new AuthController(authManager);

    const userEngine = new UserEngine();
    const userManagementManager = new UserManagementManager(userResource, userEngine, cryptoEngine);
    const userController = new UserController(userManagementManager);



    //LOGIN endpoint
    app.post('/api/login', authController.login.bind(authController));
    app.get('/api/check-auth', authenticateToken, authController.checkAuth.bind(authController));


    //User List
    app.get('/api/users', authenticateToken, userController.getUsers);
    //SAVE USER
    app.post('/api/user', authenticateToken, userController.saveUser);
    app.delete('/api/user', authenticateToken, userController.deleteUser);


    //send invoice
    const InvoiceManager = require('./managers/invoice.manager.js');
    const InvoiceController = require('./clients/invoice.controller.js');
    const InvoicesRepository = require('./resources/invoices.repository.js');
    const invoicesRepository = new InvoicesRepository(daprClient);
    const invoiceManager = new InvoiceManager(invoicesRepository);
    const invoiceController = new InvoiceController(invoiceManager);
    app.post('/api/invoice', authenticateToken, invoiceController.sendInvoice);
    app.get('/api/invoices', authenticateToken, invoiceController.getInvoices);
    app.get('/api/invoice/approve', authenticateToken, invoiceController.approveInvoice);
    app.get('/api/invoice/reject', authenticateToken, invoiceController.rejectInvoice);

    const policiesResource = new PoliciesRepository(daprClient);
    const policiesEngine = new PoliciesEngine();
    const policiesManager = new PoliciesManager(policiesResource, policiesEngine);
    const policiesController = new PoliciesController(policiesManager);


    app.get('/api/policies', authenticateToken, policiesController.loadPolicies);
    app.post('/api/policy', authenticateToken, policiesController.savePolicy);
    app.patch('/api/policy', authenticateToken, policiesController.savePolicy);
    app.delete('/api/policy', authenticateToken, policiesController.deletePolicy);
    app.get('/api/v1/policies', async (req, res) => {
        try {
            console.log("📥 [POSTGRES] Governance service is requesting active corporate policies...");


            const query = 'SELECT rule_id, category, rule_text, is_active FROM policies WHERE is_active = true;';
            const { rows } = await pool.query(query);
            console.log(`✨ [POSTGRES] Extracted ${rows.length} active rules. Sending payload.`);
            res.json(rows);

        } catch (err) {
            console.error("❌ Failed to fetch policies from PostgreSQL:", err.message);
            res.status(500).json({ error: "Database error while fetching compliance policies" });
        }
    });


    //Main UI
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    const PORT = process.env.APP_PORT || 80;
    app.listen(PORT, () => {
        console.log(`[SERVER] running on port ${PORT}`);
    });
    UsersInit(daprClient, MONGO_USERS).catch(console.error);

};

start().catch(console.error);