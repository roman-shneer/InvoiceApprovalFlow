class Api {

    constructor() {
        this.token = localStorage.getItem("token");
        this.ws = null;
        this.eventSource = null;
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
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        this.pendingRequests.forEach(({ reject }) => reject(new Error('WebSocket closed')));
        this.pendingRequests.clear();
    }

    connectSseNotifications() {
        if (this.eventSource) {
            return;
        }

        const sseUrl = `${window.location.origin}/api/v1/notifications/stream`;
        console.log('[SSE] connecting to', sseUrl);
        this.eventSource = new EventSource(sseUrl);

        this.eventSource.onopen = () => {
            console.log('[SSE] connected to notification stream');
        };

        this.eventSource.onmessage = (event) => {
            try {
                const notification = JSON.parse(event.data);
                console.log('[SSE] received notification', notification);
                this.notifySubscribers('invoice-processed', notification);
            } catch (err) {
                console.error('[SSE] invalid event data', err);
            }
        };

        this.eventSource.onerror = (err) => {
            console.error('[SSE] connection error', err);
        };
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

    async SavePolicy(policy, originalRuleId = null) {
        return await this.sendWsRequest('save-policy', { policy, original_rule_id: originalRuleId });
    }

    async GetFxRates() {
        return await this.sendWsRequest('get-fx-rates');
    }

    async SaveFxRate(rate) {
        return await this.sendWsRequest('save-fx-rate', { rate });
    }

    async DeleteFxRate(code) {
        return await this.sendWsRequest('delete-fx-rate', { code });
    }

    async GetBudgets() {
        return await this.sendWsRequest('get-budgets');
    }

    async SaveBudget(budget) {
        return await this.sendWsRequest('save-budget', { budget });
    }

    async DeleteBudget(department) {
        return await this.sendWsRequest('delete-budget', { department });
    }

    async GetStatistics() {
        return await this.sendWsRequest('get-statistics');
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

    async connectNotificationStream() {
        this.connectSseNotifications();
    }

}

export default Api;