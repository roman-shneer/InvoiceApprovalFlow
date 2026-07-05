class Api {

    constructor() {
        this.token = localStorage.getItem("token");
        this.ws = null;
        this.subscribers = {};
        this.pendingRequests = new Map();
        this.connecting = null;
    }

    LogOut() {
        localStorage.removeItem("token");
        this.token = null;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.pendingRequests.forEach(({ reject }) => reject(new Error('WebSocket closed')));
        this.pendingRequests.clear();
    }

    subscribe(eventType, callback) {
        if (!this.subscribers[eventType]) {
            this.subscribers[eventType] = [];
        }
        this.subscribers[eventType].push(callback);
    }

    unsubscribe(eventType, callback) {
        if (!this.subscribers[eventType]) {
            return;
        }
        this.subscribers[eventType] = this.subscribers[eventType].filter((cb) => cb !== callback);
    }

    notifySubscribers(eventType, payload) {
        const callbacks = this.subscribers[eventType] || [];
        callbacks.forEach((callback) => {
            try {
                callback(payload);
            } catch (err) {
                console.error('[WS] subscriber error', err);
            }
        });
    }

    _sendSocketMessage(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not open');
        }
        this.ws.send(JSON.stringify(message));
    }

    connectWebSocket() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return Promise.resolve();
        }

        if (this.connecting) {
            return this.connecting;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        this.ws = new WebSocket(wsUrl);

        this.connecting = new Promise((resolve, reject) => {
            this.ws.onopen = () => {
                console.log('[WS] connected to', wsUrl);
                this.connecting = null;
                resolve();
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (!data || !data.type) {
                        return;
                    }

                    if (data.type === 'response' && data.requestId) {
                        const pending = this.pendingRequests.get(data.requestId);
                        if (pending) {
                            clearTimeout(pending.timeout);
                            this.pendingRequests.delete(data.requestId);
                            if (data.error) {
                                pending.reject(new Error(data.error));
                            } else {
                                pending.resolve(data.payload);
                            }
                        }
                        return;
                    }

                    this.notifySubscribers(data.type, data.invoice || data.payload || data);
                } catch (err) {
                    console.error('[WS] invalid message', err);
                }
            };

            this.ws.onclose = () => {
                console.log('[WS] connection closed, reconnecting in 2s');
                this.ws = null;
                this.connecting = null;
                setTimeout(() => this.connectWebSocket(), 2000);
            };

            this.ws.onerror = (err) => {
                console.error('[WS] connection error', err);
                reject(err);
                this.connecting = null;
            };
        });

        return this.connecting;
    }

    async sendWsRequest(type, data = {}) {
        if (!this.token && type !== 'login') {
            throw new Error('Authentication token is not available');
        }

        await this.connectWebSocket();

        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const payload = {
            type,
            requestId,
            ...(this.token ? { token: this.token } : {}),
            ...data
        };

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    reject(new Error('WebSocket request timed out'));
                }
            }, 10000);

            this.pendingRequests.set(requestId, { resolve, reject, timeout });
            try {
                this._sendSocketMessage(payload);
            } catch (err) {
                clearTimeout(timeout);
                this.pendingRequests.delete(requestId);
                reject(err);
            }
        });
    }

    async SendLogin(form) {
        const result = await this.sendWsRequest('login', {
            username: form.username,
            password: form.password
        });

        if (result.success) {
            this.token = result.token;
            localStorage.setItem('token', this.token);
        }

        return result;
    }

    async CheckAuth() {
        if (this.token == null) {
            return { Success: false };
        }

        const data = await this.sendWsRequest('check-auth');
        if (!data || !data.Success) {
            localStorage.removeItem('token');
        }
        return data;
    }

    async GetPolicies() {
        return await this.sendWsRequest('load-policies');
    }

    async DeletePolicy(rule_id) {
        return await this.sendWsRequest('delete-policy', { rule_id });
    }

    async SavePolicy(policy) {
        return await this.sendWsRequest('save-policy', { policy });
    }

    async GetUsers() {
        return await this.sendWsRequest('get-users');
    }

    async DeleteUser(id) {
        return await this.sendWsRequest('delete-user', { id });
    }

    async SaveUser(user) {
        return await this.sendWsRequest('save-user', { user });
    }

    async SendInvoice(invoice) {
        console.log("SendInvoice WS", invoice);
        return await this.sendWsRequest('send-invoice', { invoice });
    }

    async GetInvoices(status) {
        return await this.sendWsRequest('get-invoices', { status });
    }

    async ApproveInvoice(invoice) {
        const tracking_id = invoice.tracking_id || invoice.id || invoice.key?.split('||').pop();
        return await this.sendWsRequest('approve-invoice', { tracking_id, state_key: invoice.key });
    }

    async RejectInvoice(invoice) {
        const tracking_id = invoice.tracking_id || invoice.id || invoice.key?.split('||').pop();
        return await this.sendWsRequest('reject-invoice', { tracking_id, state_key: invoice.key });
    }


}

export default Api;