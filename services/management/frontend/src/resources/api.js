class Api {

    constructor() {
        this.token = localStorage.getItem("token");
    }

    LogOut() {
        localStorage.removeItem("token");
        this.token = null;
    }

    async SendLogin(form) {
        const response = await fetch("/api/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(form),
        });

        const result = await response.json();

        if (result.success) {
            this.token = result.token;
            localStorage.setItem("token", this.token);
        }
        return result;
    }

    async CheckAuth() {
        if (this.token == null) {
            return { Success: false };
        }
        const response = await fetch("/api/check-auth", {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.token}`,
            },
        });
        const data = await response.json();
        if (!data || !data.Success) {
            localStorage.removeItem("token");
        }
        return data;
    }

    async GetPolicies() {
        const response = await fetch('/api/policies', {
            method: 'GET',
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.token}`,
            },
        })
        return await response.json();
    }

    async DeletePolicy(rule_id) {
        const response = await fetch('/api/policy', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                "Authorization": `Bearer ${this.token}`,
            },
            body: JSON.stringify({ rule_id: rule_id })
        });


        const result = await response.json();
        return result;
    }

    async SavePolicy(policy) {
        const method = policy.id > 0 ? 'PATCH' : 'POST';
        const response = await fetch('/api/policy', {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                "Authorization": `Bearer ${this.token}`,
            },
            body: JSON.stringify({
                policy: policy
            })
        });


        if (!response.ok) {
            throw new Error(`Server returned error status context: ${response.status}`);
        }

        return await response.json();

    }

    async GetUsers() {
        const response = await fetch('/api/users', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                "Authorization": `Bearer ${this.token}`,
            },
        })
        const data = await response.json()
        return data;
    }

    async DeleteUser(id) {
        const response = await fetch('/api/user', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                "Authorization": `Bearer ${this.token}`,
            },
            body: JSON.stringify({ id: id })
        });


        const result = await response.json();
        return result;
    }

    async SaveUser(user) {
        const response = await fetch('/api/user', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "Authorization": `Bearer ${this.token}`,
            },
            body: JSON.stringify(user)
        });


        const result = await response.json();
        return result;
    }

    async SendInvoice(invoice) {
        console.log("SendInvoice", invoice);
        const response = await fetch('/api/invoice', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "Authorization": `Bearer ${this.token}`,
            },
            body: JSON.stringify({ invoice: invoice })
        });
        return await response.json();
    }

    async GetInvoices(status) {
        const response = await fetch('/api/invoices?status=' + status, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                "Authorization": `Bearer ${this.token}`,
            },
        });


        return await response.json();
    }

    async ApproveInvoice(invoice) {
        const response = await fetch('/api/invoice/approve?key=' + invoice.key, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                "Authorization": `Bearer ${this.token}`,
            },
        });


        return await response.json();
    }
    async RejectInvoice(invoice) {
        const response = await fetch('/api/invoice/reject?key=' + invoice.key, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                "Authorization": `Bearer ${this.token}`,
            },
        });


        return await response.json();

    }


}

export default Api;