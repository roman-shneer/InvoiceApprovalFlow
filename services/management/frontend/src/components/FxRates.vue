<script setup>
const props = defineProps({
  api: {
    type: Object,
    required: true
  }
});
</script>

<template>
    <h1>FX Rates</h1>

    <div class="fx-toolbar">
        <button @click="startAdd">Add currency</button>
        <button @click="loadRates">Refresh</button>
    </div>

    <div v-if="editing" class="fx-editor">
        <h3>{{ editingMode === 'add' ? 'Add FX rate' : 'Edit FX rate' }}</h3>
        <div>
            <label>Currency code</label>
            <input :disabled="editingMode === 'edit'" v-model="form.code" maxlength="8" placeholder="USD" />
        </div>
        <div>
            <label>Rate</label>
            <input v-model="form.rate" type="number" min="0.000001" step="0.000001" placeholder="1.0" />
        </div>
        <div class="fx-actions">
            <button @click="saveRate">Save</button>
            <button @click="cancelEdit">Cancel</button>
        </div>
    </div>

    <table border="1" width="100%">
        <tbody>
            <tr>
                <td>Code</td>
                <td>Rate</td>
                <td>ETag</td>
                <td>&nbsp;</td>
            </tr>
            <tr v-for="rate in rates" :key="rate._id">
                <td>{{ rate._id }}</td>
                <td>{{ renderRate(rate.value?.rate) }}</td>
                <td>{{ rate._etag || '-' }}</td>
                <td>
                    <button @click="editRate(rate)">Edit</button>
                    <button @click="deleteRate(rate._id)">Delete</button>
                </td>
            </tr>
        </tbody>
    </table>
</template>

<script>
export default {
    name: 'FxRates',
    data() {
        return {
            rates: [],
            editing: false,
            editingMode: 'add',
            form: {
                code: '',
                rate: ''
            }
        };
    },
    methods: {
        renderRate(rate) {
            const num = parseFloat(rate || 0);
            if (Number.isNaN(num)) return '0';
            return num.toFixed(6);
        },
        async loadRates() {
            const data = await this.api.GetFxRates();
            this.rates = Array.isArray(data?.rates) ? data.rates : [];
        },
        startAdd() {
            this.editingMode = 'add';
            this.editing = true;
            this.form = { code: '', rate: '' };
        },
        editRate(rate) {
            this.editingMode = 'edit';
            this.editing = true;
            this.form = {
                code: String(rate?._id || '').toUpperCase(),
                rate: String(rate?.value?.rate ?? '')
            };
        },
        cancelEdit() {
            this.editing = false;
            this.form = { code: '', rate: '' };
        },
        async saveRate() {
            const code = String(this.form.code || '').trim().toUpperCase();
            const rate = parseFloat(this.form.rate);

            if (!code) {
                alert('Currency code is required');
                return;
            }
            if (!/^[A-Z0-9_-]+$/.test(code)) {
                alert('Currency code must contain only A-Z, 0-9, _ or -');
                return;
            }
            if (Number.isNaN(rate) || rate <= 0) {
                alert('Rate must be a positive number');
                return;
            }

            await this.api.SaveFxRate({
                _id: code,
                _key: code,
                value: { rate }
            });

            this.cancelEdit();
            await this.loadRates();
        },
        async deleteRate(code) {
            if (!confirm(`Delete FX rate ${code}?`)) {
                return;
            }
            await this.api.DeleteFxRate(code);
            await this.loadRates();
        }
    },
    mounted() {
        this.loadRates();
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

.fx-toolbar {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
}

.fx-editor {
    border: 1px solid #ccc;
    padding: 10px;
    margin-bottom: 12px;
    max-width: 420px;
}

.fx-editor label {
    display: inline-block;
    min-width: 110px;
}

.fx-editor div {
    margin-bottom: 8px;
}

.fx-actions {
    display: flex;
    gap: 8px;
}
</style>