<script setup>
const props = defineProps({
  api: {
    type: Object,
    required: true
  }
});

</script>
<template>
    <h1>Send Invoice</h1>
    <textarea class="send-invoice" placeholder="Paste JSON here" v-model="invoice"></textarea>
    <br/>
    <button @click="sendInvoice">Send</button>
    <br/>    
   
</template>
<script>

export default {
    name:'InvoiceForm',
    
    data(){
        return {
            invoice:"",           
        }
    },
    methods:{        
        async sendInvoice(){
            
            const result=await this.api.SendInvoice(this.invoice);           
            //this.getInvoices();
        },
    },
}
</script>
<style scoped>
.send-invoice{
    width:calc(100% - 20px);
    min-height:400px;
}

</style>