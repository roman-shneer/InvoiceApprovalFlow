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
                <td>expected reason</td>
                <td>ai status</td>
                <td>audit status</td>   
                <td>audit reason</td>                
                <td v-if="role=='submitter'">payment</td>                
                <td v-if="role=='approver'">&nbsp;</td>             
            </tr>
            <tr v-for="invoice of invoices" :key="invoice.key || invoice.tracking_id || invoice.id">
                <td @click="openInvoice(invoice)" title="tracking id">{{ invoice.tracking_id }}</td>
                <td @click="openInvoice(invoice)" title="invoice number">{{ invoice.invoiceNumber }}</td>
                <td @click="openInvoice(invoice)" title="correlation id">{{invoice.correlation_id}}</td>
                <td @click="openInvoice(invoice)" title="submitter">{{ invoice.submitter}}</td>
                <td @click="openInvoice(invoice)" title="submitted">{{ renderDate(invoice.submitted_at)}}</td>
                <td @click="openInvoice(invoice)" title="tax">{{renderCurrency(invoice.currency)}}{{invoice.taxAmount}}</td>
                <td @click="openInvoice(invoice)" title="total">{{renderCurrency(invoice.currency)}}{{invoice.total}}</td>
                <td @click="openInvoice(invoice)" title="expected route">{{ renderStatus(invoice?.expected?.route??'') }}</td>
                <td @click="openInvoice(invoice)" title="expected reason">{{ getExpectedReason(invoice) }}</td>
                <td @click="openInvoice(invoice)" title="ai status">{{ renderStatus(invoice?.audit_metadata?.aiRecommendation??'') }}</td>
                <td @click="openInvoice(invoice)" title="audit status">{{ renderStatus(invoice.status??'') }}</td>
                <td @click="openInvoice(invoice)" title="audit reason">{{ invoice?.audit_metadata?.reason }}</td>                
                <td @click="openInvoice(invoice)" title="payment status" v-if="role=='submitter'" >{{ renderPaymentStatus(invoice) }}</td>                
                <td v-if="role=='approver'">
                    <button @click="approveInvoice(invoice)">Approve</button>
                    <button @click="rejectInvoice(invoice)">Reject</button>
                </td>
            </tr>
        </tbody>
    </table>
    <div>
        {{ conclusion }}
    </div>
</template>
<script>

export default {
    name:'Invoices',
    props: {
        api: {
            type: Object,
            required: true
        },
        role: {
            type: String,
            required: true
        }
    },
    data(){
        return {
            invoice:"",
            invoices:[],
            showInvoice:null,
            eventHandlers: {},
            conclusion: ''
        }
    },
    methods:{
        renderStatus(status){
            status=status?.toUpperCase() || '';
            if(!status){
                return '';
            }
            let displayStatus ="";
            if(status=="HUMAN_REVIEW" || status=="DECLINE" || status=="REJECT"){
                displayStatus="❌ "+status;
            }else if(status=="AUTO_APPROVE" || status=="APPROVED"){
                displayStatus="✅ "+status;
            }else{
                displayStatus=status;
            }
            
            return displayStatus;
        },
        renderPaymentStatus(invoice){
            if(!invoice || !invoice.payment || !invoice.payment.status){
                return '';
            }
            let status = invoice.payment.status;
            if(invoice.payment.status=="CONFIRMED"){
                const amount = invoice.payment.amount;
                const currency = invoice.payment.currency;  

                status="✅"+invoice.payment.status+" "+this.renderCurrency(currency)+amount;
            }else if(invoice.payment.status=="FAILED" || invoice.payment.status=="REJECTED_ROLLBACK"){
                status="❌"+invoice.payment.status+" "+(invoice.payment?.reason || '');
            }
            
            return status;
        },       
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
            const status = this.role == 'approver' ? 'HUMAN_REVIEW' : null;
            const result = await this.api.GetInvoices(status);
            this.invoices = Array.isArray(result) ? result : [];
            let correct=0;            
            for (const invoice of this.invoices) {
                console.log(invoice.expected?.route.toUpperCase(), invoice.audit_metadata?.aiRecommendation, (invoice.expected?.route.toUpperCase() === invoice.audit_metadata?.aiRecommendation));
                if(invoice.expected?.route.toUpperCase() === invoice.audit_metadata?.aiRecommendation){
                    correct++;
                }
            }
            let resultPercentage="(0%)";
            if(this.invoices.length>0){
                resultPercentage=`(${(correct*100/this.invoices.length).toFixed(2)}%)`;
            }
            this.conclusion= `Correct invoices: ${correct} from  ${this.invoices.length} ${resultPercentage}`;
        },
        applyNotificationToLocalInvoices(payload){
            if (!payload || !payload.tracking_id) {
                return false;
            }

            // Approvers only show HUMAN_REVIEW invoices, so if the notified invoice has
            // moved out of HUMAN_REVIEW we must refresh the filtered list.
            if (this.role === 'approver' && payload.status && payload.status !== 'HUMAN_REVIEW') {
                return false;
            }

            const updated = this.invoices.map((invoice) => {
                if (invoice.tracking_id === payload.tracking_id || invoice.id === payload.tracking_id) {
                    return { ...invoice, status: payload.status, audit_metadata: payload.audit_metadata || invoice.audit_metadata };
                }
                return invoice;
            });
            const found = updated.some((invoice) => invoice.tracking_id === payload.tracking_id && invoice.status === payload.status);
            if (found) {
                this.invoices = updated;
                return true;
            }
            return false;
        },
        onInvoiceEvent(payload){            
            if (!this.applyNotificationToLocalInvoices(payload)) {
                this.getInvoices();
            }
        },
        onInvoiceRefresh(payload) {            
            if (payload && Array.isArray(payload.invoices)) {
                this.invoices = payload.invoices;
            } else {
                this.getInvoices();
            }
        },
        renderDate(d){
            if (!d) {
                return '-';
            }
            const parsed = new Date(d);
            if (Number.isNaN(parsed.valueOf())) {
                return String(d);
            }
            return parsed.toLocaleString();
        },
        
        getExpectedReason(invoice) {
            if (!invoice || !invoice.expected || typeof invoice.expected !== 'object') {
                return '';
            }
            return invoice.expected.reason || '';
        },


    },
    mounted(){
        this.getInvoices();
        if (this.api && typeof this.api.subscribe === 'function') {
            this.eventHandlers.created = this.onInvoiceEvent.bind(this);
            this.eventHandlers.updated = this.onInvoiceEvent.bind(this);
            this.eventHandlers.processed = this.onInvoiceEvent.bind(this);
            this.eventHandlers.refreshed = this.onInvoiceRefresh.bind(this);
            this.api.subscribe('invoice-created', this.eventHandlers.created);
            this.api.subscribe('invoice-updated', this.eventHandlers.updated);
            this.api.subscribe('invoice-processed', this.eventHandlers.processed);
            this.api.subscribe('invoice-refresh', this.eventHandlers.refreshed);
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
            if (this.eventHandlers.refreshed) this.api.unsubscribe('invoice-refresh', this.eventHandlers.refreshed);
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