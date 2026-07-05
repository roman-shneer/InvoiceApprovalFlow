<script setup>
const props = defineProps({
  api: {
    type: Object,
    required: true
  },
  role: {
    type: String,
    required: true
  }
});

</script>
<template>
    <div v-if="showInvoice!=null" class="show-invoice">
        <button class="show-invoice-close" @click="showInvoice=null">x</button>
        <pre>{{ showInvoice }}</pre>
    </div>
    <table border="1">
        <tbody>
            <tr>
                <td>tracking_id</td>
                <td>invoiceNumber</td>
                <td>correlation_id</td>
                <td>submitter</td>
                <td>submitted</td>
                <td>tax</td>
                <td>total</td>
                <td>expected</td>
                <td>status</td>   
                <td v-if="role=='approver'">&nbsp;</td>             
            </tr>
            <tr v-for="invoice of invoices" :key="invoice.key || invoice.tracking_id || invoice.id">
                <td @click="openInvoice(invoice)">{{ invoice.tracking_id }}</td>
                <td @click="openInvoice(invoice)">{{ invoice.invoiceNumber }}</td>
                <td @click="openInvoice(invoice)">{{invoice.correlation_id}}</td>
                <td @click="openInvoice(invoice)">{{ invoice.submitter}}</td>
                <td @click="openInvoice(invoice)">{{ renderDate(invoice.submitted_at)}}</td>
                <td @click="openInvoice(invoice)">{{renderCurrency(invoice.currency)}}{{invoice.taxAmount}}</td>
                <td @click="openInvoice(invoice)">{{renderCurrency(invoice.currency)}}{{invoice.total}}</td>
                <td @click="openInvoice(invoice)" :title="invoice.expected?.reason">{{ invoice.expected.route}}</td>
                <td @click="openInvoice(invoice)" :title="invoice.audit_metadata?.reason">{{ invoice.status}}</td>
                <td v-if="role=='approver'">
                    <button @click="approveInvoice(invoice)">Approve</button>
                    <button @click="rejectInvoice(invoice)">Reject</button>
                </td>
            </tr>
        </tbody>
    </table>
</template>
<script>

export default {
    name:'Invoices',
    data(){
        return {
            invoice:"",
            invoices:[],
            showInvoice:null,
            eventHandlers: {}
        }
    },
    methods:{
        async approveInvoice(invoice){
            try {
                const key = invoice.key || invoice.tracking_id || invoice.id;
                if (!key) {
                    throw new Error('Invoice key is missing');
                }
                await this.api.ApproveInvoice({ key });
                this.getInvoices();
            } catch (err) {
                console.error('Approve failed', err);
                alert('Approve failed: ' + err.message);
            }
        },
        async rejectInvoice(invoice){
            try {
                const key = invoice.key || invoice.tracking_id || invoice.id;
                if (!key) {
                    throw new Error('Invoice key is missing');
                }
                await this.api.RejectInvoice({ key });
                this.getInvoices();
            } catch (err) {
                console.error('Reject failed', err);
                alert('Reject failed: ' + err.message);
            }
        },
        openInvoice(invoice){                       
            this.showInvoice=JSON.stringify(invoice, null, 2);
        },
        renderCurrency(currency){
            if(currency=='USD'){
                return "$";
            }else if(currency=="EUR"){
                return "€";
            }else{
                return '?';
            }
        },
        async getInvoices(){
            const status=this.role=='approver'?'HUMAN_REVIEW':null;
            const result=await this.api.GetInvoices(status);            
            this.invoices=result;
        },
        applyNotificationToLocalInvoices(payload){
            if (!payload || !payload.tracking_id) {
                return false;
            }
            const updated = this.invoices.map((invoice) => {
                if (invoice.tracking_id === payload.tracking_id || invoice.id === payload.tracking_id) {
                    return { ...invoice, status: payload.status, audit_metadata: payload.audit_metadata || invoice.audit_metadata };
                }
                return invoice;
            });
            const found = updated.some((invoice, index) => invoice.tracking_id === payload.tracking_id && invoice.status === payload.status);
            if (found) {
                this.invoices = updated;
                return true;
            }
            return false;
        },
        onInvoiceEvent(payload){
            console.log('Invoice notification received', payload);
            if (!this.applyNotificationToLocalInvoices(payload)) {
                this.getInvoices();
            }
        },
        renderDate(d){            
            const isoDateStr= d.toLocaleString();            
            return new Date(isoDateStr).toLocaleString();            
        },


    },
    mounted(){
        this.getInvoices();
        if (this.api && typeof this.api.subscribe === 'function') {
            this.eventHandlers.created = this.onInvoiceEvent.bind(this);
            this.eventHandlers.updated = this.onInvoiceEvent.bind(this);
            this.eventHandlers.processed = this.onInvoiceEvent.bind(this);
            this.api.subscribe('invoice-created', this.eventHandlers.created);
            this.api.subscribe('invoice-updated', this.eventHandlers.updated);
            this.api.subscribe('invoice-processed', this.eventHandlers.processed);
            if (typeof this.api.connectWebSocket === 'function') {
                this.api.connectWebSocket();
            }
            if (typeof this.api.connectNotificationStream === 'function') {
                this.api.connectNotificationStream();
            }
        }
    },
    beforeUnmount(){
        if (this.api && typeof this.api.unsubscribe === 'function') {
            if (this.eventHandlers.created) this.api.unsubscribe('invoice-created', this.eventHandlers.created);
            if (this.eventHandlers.updated) this.api.unsubscribe('invoice-updated', this.eventHandlers.updated);
            if (this.eventHandlers.processed) this.api.unsubscribe('invoice-processed', this.eventHandlers.processed);
        }
    }
}
</script>
<style scoped>
.show-invoice-close{
    float:right;
}
.show-invoice{
    position: fixed;
    top:20%;
    left:20%;
    width:60%;
    height:60%;
    border:solid black 1px;
    background: #fff;
    padding:10px;
}
.show-invoice pre{
    width:100%;
    height:90%;   
    text-align: left;
    overflow: auto;
}
table td{
    text-align:left;
    font-size:14px;
}

</style>