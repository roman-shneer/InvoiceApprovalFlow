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
                <td>correlation_id</td>
                <td>submitter</td>
                <td>submitted</td>
                <td>tax</td>
                <td>total</td>
                <td>expected</td>
                <td>status</td>   
                <td v-if="role=='approver'">&nbsp;</td>             
            </tr>
            <tr v-for="invoice of invoices">
                <td @click="openInvoice(invoice)">{{ invoice.tracking_id }}</td>
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
            await this.api.ApproveInvoice(invoice);
            this.getInvoices();
        },
        async rejectInvoice(invoice){
            await this.api.RejectInvoice(invoice);
            this.getInvoices();
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
        renderDate(d){            
            const isoDateStr= d.toLocaleString();            
            return new Date(isoDateStr).toLocaleString();            
        },


    },
    mounted(){
        this.getInvoices();
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