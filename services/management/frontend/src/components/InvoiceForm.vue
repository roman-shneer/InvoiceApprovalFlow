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
    <p v-if="feedbackMessage" :class="['feedback', feedbackType]">{{ feedbackMessage }}</p>
</template>
<script>

export default {
    name:'InvoiceForm',
    
    data(){
        return {
            invoice:"",
            feedbackMessage: '',
            feedbackType: 'info'
        }
    },
    methods:{        
        async sendInvoice(){
            this.feedbackMessage = '';
            this.feedbackType = 'info';

            let invoiceData;
            try {
                invoiceData = JSON.parse(this.invoice);
            } catch (err) {
                this.feedbackType = 'error';
                this.feedbackMessage = 'Invalid JSON: ' + err.message;
                return;
            }

            try {
                const result = await this.api.SendInvoice(invoiceData);
                this.feedbackType = 'success';
                this.feedbackMessage = result?.results?.[0]?.message || result?.message || 'Invoice sent successfully.';
                this.invoice = '';
            } catch (err) {
                this.feedbackType = 'error';
                this.feedbackMessage = err.message || 'Failed to send invoice.';
            }
        },
    },
}
</script>
<style scoped>
.send-invoice{
    width:calc(100% - 20px);
    min-height:400px;
}
.feedback {
    margin-top: 10px;
    padding: 10px;
    border-radius: 4px;
}
.feedback.info {
    background: #eef3ff;
    color: #1f3c88;
}
.feedback.success {
    background: #e6ffed;
    color: #1e6f29;
}
.feedback.error {
    background: #ffe8e8;
    color: #a12a2a;
}
</style>
<style scoped>
.send-invoice{
    width:calc(100% - 20px);
    min-height:400px;
}

</style>