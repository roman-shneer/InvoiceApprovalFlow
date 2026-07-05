require('dotenv').config();
const http = require('http');
const express = require('express');
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
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

    const PoliciesRepository = require('./resources/policies.repository.js');
    const PoliciesEngine = require('./engines/policies.engine.js');
    const PoliciesManager = require('./managers/policies.manager.js');





    const jwt = require('jsonwebtoken');


    const app = express();
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(express.json());
    app.use(cors({
        origin: 'http://localhost:5173',
        credentials: true
    }));

    const activeSseClients = new Map();

    async function resolveInvoiceForNotification(eventData) {
        const candidateId = eventData?.tracking_id || eventData?.trackingId || eventData?.id || eventData?.invoice?.tracking_id || eventData?.invoice?.id;
        if (candidateId) {
            try {
                const raw = await daprClient.state.get('mongo-invoices', candidateId);
                if (raw) {
                    return typeof raw === 'string' ? JSON.parse(raw) : raw;
                }
            } catch (err) {
                console.warn(`[Notification Channel] failed to load invoice by id ${candidateId}:`, err.message);
            }

            try {
                const response = await daprClient.state.query('mongo-invoices', {
                    filter: {
                        OR: [
                            { EQ: { tracking_id: candidateId } },
                            { EQ: { id: candidateId } }
                        ]
                    },
                    page: { limit: 1 }
                });
                const result = response?.results?.[0];
                if (result) {
                    return result.data || result.value;
                }
            } catch (err) {
                console.warn(`[Notification Channel] fallback query failed for ${candidateId}:`, err.message);
            }
        }

        if (eventData && (eventData.tracking_id || eventData.id)) {
            return eventData;
        }

        return null;
    }

    app.get('/api/v1/notifications/stream', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        res.write('retry: 10000\n\n');

        const clientId = Date.now().toString();
        activeSseClients.set(clientId, res);
        console.log(`[Notification Channel] Client ${clientId} connected to SSE stream.`);

        const keepAlive = setInterval(() => {
            if (!res.finished) {
                res.write(': keep-alive\n\n');
            }
        }, 25000);

        req.on('close', () => {
            clearInterval(keepAlive);
            activeSseClients.delete(clientId);
            console.log(`[Notification Channel] Client ${clientId} disconnected from SSE stream.`);
        });
    });

    app.get('/dapr/subscribe', (req, res) => {
        res.json([
            {
                pubsubname: 'approval-pubsub',
                topic: 'invoice.processed',
                route: '/events/invoice-processed'
            }
        ]);
    });

    app.post('/events/invoice-processed', express.text({ type: '*/*' }), async (req, res) => {
        const rawBody = req.body;
        let payload;
        if (typeof rawBody === 'string' && rawBody.length > 0) {
            try {
                payload = JSON.parse(rawBody);
            } catch (err) {
                console.warn('[Notification Channel] failed to parse raw request body as JSON:', err.message);
                payload = undefined;
            }
        } else if (typeof rawBody === 'object' && rawBody !== null) {
            payload = rawBody;
        }

        let invoice = payload?.data?.data || payload?.data || payload;

        console.log('invoice-processed.content-type', req.headers['content-type']);
        console.log('invoice-processed.rawBody', rawBody);
        console.log('invoice-processed.payload', payload);

        let trackingId = invoice?.tracking_id || invoice?.trackingId || invoice?.id || 'unknown';

        if (!invoice || trackingId === 'unknown') {
            console.warn('[Notification Channel] invoice.processed payload missing tracking_id, resolving from store');
            const resolvedInvoice = await resolveInvoiceForNotification(invoice || payload);
            if (resolvedInvoice) {
                invoice = resolvedInvoice;
                trackingId = invoice.tracking_id || invoice.id || 'unknown';
            }
        }

        if (trackingId === 'unknown') {
            console.warn('[Notification Channel] Failed to resolve invoice tracking_id from payload or store');
        }

        console.log(`[Notification Channel] Received invoice.processed for ${trackingId}. Broadcasting to SSE clients.`);

        const sseMessage = `data: ${JSON.stringify(invoice)}\n\n`;
        for (const [clientId, clientResponse] of activeSseClients.entries()) {
            clientResponse.write(sseMessage);
        }

        res.status(200).send();
    });

    const server = http.createServer(app);
    const wss = new WebSocket.Server({ server, path: '/ws' });

    const InvoiceManager = require('./managers/invoice.manager.js');
    const InvoicesRepository = require('./resources/invoices.repository.js');
    const invoicesRepository = new InvoicesRepository(daprClient);
    const invoiceManager = new InvoiceManager(invoicesRepository);

    const broadcastToClients = (payload) => {
        const payloadString = JSON.stringify(payload);
        for (const client of wss.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payloadString);
            }
        }
    };

    const sendSocketResponse = (socket, requestId, payload, error = null) => {
        const response = { type: 'response', requestId, payload };
        if (error) {
            response.error = error;
        }
        socket.send(JSON.stringify(response));
    };

    const verifyToken = (token) => new Promise((resolve, reject) => {
        if (!token) {
            return reject(new Error('Missing token'));
        }
        jwt.verify(token, process.env.JWT_SECRET || 'jwt_secret_key_999', (err, userPayload) => {
            if (err) {
                reject(err);
            } else {
                resolve(userPayload);
            }
        });
    });

    wss.on('connection', (socket) => {
        console.log('[WS] Client connected');
        socket.send(JSON.stringify({ type: 'connected', message: 'Management WebSocket connected' }));

        socket.on('message', async (message) => {
            let data;
            try {
                data = JSON.parse(message.toString());
            } catch (err) {
                console.error('[WS] invalid JSON message:', err.message);
                return;
            }

            const { type, requestId, token } = data;
            if (!type) {
                return;
            }

            if (type === 'ping') {
                return sendSocketResponse(socket, requestId, { message: 'pong' });
            }

            let user = null;
            if (type !== 'login') {
                try {
                    user = await verifyToken(token);
                } catch (err) {
                    console.error('[WS] auth failed:', err.message);
                    return sendSocketResponse(socket, requestId, null, 'Unauthorized');
                }
            }

            try {
                switch (type) {
                    case 'login': {
                        const result = await authManager.login(data.username, data.password);
                        if (result.success && result.user) {
                            const jwtToken = jwt.sign(
                                result.user,
                                process.env.JWT_SECRET || 'jwt_secret_key_999',
                                { expiresIn: '30d' }
                            );
                            return sendSocketResponse(socket, requestId, { success: true, user: result.user, token: jwtToken });
                        }
                        return sendSocketResponse(socket, requestId, { success: false, user: null, token: null });
                    }
                    case 'check-auth': {
                        if (!user) {
                            return sendSocketResponse(socket, requestId, { Success: false, user: null });
                        }
                        return sendSocketResponse(socket, requestId, { Success: true, user });
                    }
                    case 'get-users': {
                        const result = await userManagementManager.getUserList(user);
                        if (!result.success) {
                            return sendSocketResponse(socket, requestId, null, result.error);
                        }
                        return sendSocketResponse(socket, requestId, { users: result.data });
                    }
                    case 'save-user': {
                        if (user.role !== 'admin') {
                            return sendSocketResponse(socket, requestId, null, 'Unauthorized');
                        }
                        const result = await userManagementManager.saveUserByAdmin(user.role, data.user);
                        if (!result.success) {
                            return sendSocketResponse(socket, requestId, null, result.message || 'Save failed');
                        }
                        return sendSocketResponse(socket, requestId, { result: result.data });
                    }
                    case 'delete-user': {
                        if (user.role !== 'admin') {
                            return sendSocketResponse(socket, requestId, null, 'Unauthorized');
                        }
                        const result = await userManagementManager.deleteUserByAdmin(user.role, data.id);
                        if (!result.success) {
                            return sendSocketResponse(socket, requestId, null, result.error || 'Delete failed');
                        }
                        return sendSocketResponse(socket, requestId, { result: result.data });
                    }
                    case 'load-policies': {
                        if (user.role !== 'admin') {
                            return sendSocketResponse(socket, requestId, null, 'Unauthorized');
                        }
                        const policies = await policiesManager.loadPolicies();
                        return sendSocketResponse(socket, requestId, { policies });
                    }
                    case 'save-policy': {
                        console.log("save-policy", user.role)
                        if (user.role !== 'admin') {
                            return sendSocketResponse(socket, requestId, null, 'Unauthorized');
                        }
                        const result = await policiesManager.savePolicy(data.policy, data.original_rule_id);
                        if (!result.success) {
                            return sendSocketResponse(socket, requestId, null, result.error || 'Save failed');
                        }
                        return sendSocketResponse(socket, requestId, { success: true, policy: result.data });
                    }
                    case 'delete-policy': {
                        if (user.role !== 'admin') {
                            return sendSocketResponse(socket, requestId, null, 'Unauthorized');
                        }
                        await policiesManager.deletePolicy(data.rule_id);
                        return sendSocketResponse(socket, requestId, { success: true });
                    }
                    case 'send-invoice': {
                        if (user.role !== 'submitter') {
                            return sendSocketResponse(socket, requestId, null, 'Unauthorized');
                        }
                        const result = await invoiceManager.sendInvoices(data.invoice);
                        if (Array.isArray(result)) {
                            result.forEach(item => broadcastToClients({ type: 'invoice-created', invoice: item }));
                        } else if (result) {
                            broadcastToClients({ type: 'invoice-created', invoice: result });
                        }
                        return sendSocketResponse(socket, requestId, result);
                    }
                    case 'get-invoices': {
                        if (!['submitter', 'approver'].includes(user.role)) {
                            return sendSocketResponse(socket, requestId, null, 'Unauthorized');
                        }
                        const invoices = await invoiceManager.getInvoices(data.status);
                        return sendSocketResponse(socket, requestId, invoices);
                    }
                    case 'approve-invoice': {
                        if (user.role !== 'approver') {
                            return sendSocketResponse(socket, requestId, null, 'Unauthorized');
                        }
                        const approved = await invoiceManager.updateInvoiceStatus(data.tracking_id || data.state_key || data.key, 'APPROVED');
                        if (approved) {
                            broadcastToClients({ type: 'invoice-updated', invoice: approved });
                        }
                        return sendSocketResponse(socket, requestId, approved);
                    }
                    case 'reject-invoice': {
                        if (user.role !== 'approver') {
                            return sendSocketResponse(socket, requestId, null, 'Unauthorized');
                        }
                        const rejected = await invoiceManager.updateInvoiceStatus(data.tracking_id || data.state_key || data.key, 'REJECTED');
                        if (rejected) {
                            broadcastToClients({ type: 'invoice-updated', invoice: rejected });
                        }
                        return sendSocketResponse(socket, requestId, rejected);
                    }
                    default:
                        return sendSocketResponse(socket, requestId, null, `Unknown message type: ${type}`);
                }
            } catch (err) {
                console.error('[WS] request handler error:', err.message);
                return sendSocketResponse(socket, requestId, null, err.message);
            }
        });

        socket.on('close', () => {
            console.log('[WS] Client disconnected');
        });
    });




    const userResource = new UserRepository(daprClient);          // Передали пул БД в ресурс!
    const cryptoEngine = new CryptoEngine();
    const authManager = new AuthManager(userResource, cryptoEngine);

    const userEngine = new UserEngine();
    const userManagementManager = new UserManagementManager(userResource, userEngine, cryptoEngine);

    const policiesResource = new PoliciesRepository(daprClient);
    const policiesEngine = new PoliciesEngine();
    const policiesManager = new PoliciesManager(policiesResource, policiesEngine);

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
    server.listen(PORT, () => {
        console.log(`[SERVER] running on port ${PORT}`);
    });
    UsersInit(daprClient, MONGO_USERS).catch(console.error);

};

start().catch(console.error);