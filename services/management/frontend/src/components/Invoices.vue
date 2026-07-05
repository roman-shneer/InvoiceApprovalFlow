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
                <td @click="openInvoice(invoice)">{{ invoice.expected.route}}</td>
                <td @click="openInvoice(invoice)" title="invoice.audit_metadata?.reason">{{ invoice.status}}</td>
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
            showInvoice:null
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
            console.log("GetInvoices",result);
            this.invoices=result;
        },
        onInvoiceEvent(){
            this.getInvoices();
        },
        renderDate(d){            
            const isoDateStr= d.toLocaleString();            
            return new Date(isoDateStr).toLocaleString();            
        },


    },
    mounted(){
        this.getInvoices();
        if (this.api && typeof this.api.subscribe === 'function') {
            this.api.subscribe('invoice-created', this.onInvoiceEvent);
            this.api.subscribe('invoice-updated', this.onInvoiceEvent);
            if (typeof this.api.connectWebSocket === 'function') {
                this.api.connectWebSocket();
            }
        }
    },
    beforeUnmount(){
        if (this.api && typeof this.api.unsubscribe === 'function') {
            this.api.unsubscribe('invoice-created', this.onInvoiceEvent);
            this.api.unsubscribe('invoice-updated', this.onInvoiceEvent);
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