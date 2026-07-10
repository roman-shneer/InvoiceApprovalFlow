<script setup>
const props = defineProps({
  api: {
    type: Object,
    required: true
  }
});
</script>

<template>
    <h1>Budgets</h1>

    <div class="budget-toolbar">
        <button @click="startAdd">Add budget</button>
        <button @click="loadBudgets">Refresh</button>
    </div>

    <div v-if="editing" class="budget-editor">
        <h3>{{ editingMode === 'add' ? 'Add budget' : 'Edit budget' }}</h3>
        <div>
            <label>Department</label>
            <input :disabled="editingMode === 'edit'" v-model="form.department" maxlength="120" placeholder="marketing-2026Q2" />
        </div>
        <div>
            <label>Amount</label>
            <input v-model="form.amount" type="number" min="0" step="0.01" placeholder="1000.00" />
        </div>
        <div class="budget-actions">
            <button @click="saveBudget">Save</button>
            <button @click="cancelEdit">Cancel</button>
        </div>
    </div>

    <table border="1" width="100%">
        <tbody>
            <tr>
                <td>Department</td>
                <td>Amount</td>
                <td>ETag</td>
                <td>&nbsp;</td>
            </tr>
            <tr v-for="budget in budgets" :key="budget._id">
                <td>{{ budget._id }}</td>
                <td>{{ renderAmount(budget.value?.amount) }}</td>
                <td>{{ budget._etag || '-' }}</td>
                <td>
                    <button @click="editBudget(budget)">Edit</button>
                    <button @click="deleteBudget(budget._id)">Delete</button>
                </td>
            </tr>
        </tbody>
    </table>
</template>

<script>
export default {
    name: 'Budgets',
    data() {
        return {
            budgets: [],
            editing: false,
            editingMode: 'add',
            form: {
                department: '',
                amount: ''
            }
        };
    },
    methods: {
        renderAmount(amount) {
            const num = parseFloat(amount || 0);
            if (Number.isNaN(num)) return '0.00';
            return num.toFixed(2);
        },
        async loadBudgets() {
            const data = await this.api.GetBudgets();
            this.budgets = Array.isArray(data?.budgets) ? data.budgets : [];
        },
        startAdd() {
            this.editingMode = 'add';
            this.editing = true;
            this.form = { department: '', amount: '' };
        },
        editBudget(budget) {
            this.editingMode = 'edit';
            this.editing = true;
            this.form = {
                department: String(budget?._id || ''),
                amount: String(budget?.value?.amount ?? '')
            };
        },
        cancelEdit() {
            this.editing = false;
            this.form = { department: '', amount: '' };
        },
        async saveBudget() {
            const department = String(this.form.department || '').trim();
            const amount = parseFloat(this.form.amount);

            if (!department) {
                alert('Department is required');
                return;
            }
            if (Number.isNaN(amount) || amount < 0) {
                alert('Amount must be a non-negative number');
                return;
            }

            await this.api.SaveBudget({
                _id: department,
                _key: department,
                value: {
                    department,
                    amount
                }
            });

            this.cancelEdit();
            await this.loadBudgets();
        },
        async deleteBudget(department) {
            if (!confirm(`Delete budget ${department}?`)) {
                return;
            }
            await this.api.DeleteBudget(department);
            await this.loadBudgets();
        }
    },
    mounted() {
        this.loadBudgets();
    }
};
</script>

<style scoped>
table {
    border-collapse: collapse;
}

td {
    text-align: left;
    padding: 6px;
}

.budget-toolbar {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
}

.budget-editor {
    border: 1px solid #ccc;
    padding: 10px;
    margin-bottom: 12px;
    max-width: 460px;
}

.budget-editor label {
    display: inline-block;
    min-width: 110px;
}

.budget-editor div {
    margin-bottom: 8px;
}

.budget-actions {
    display: flex;
    gap: 8px;
}
</style>