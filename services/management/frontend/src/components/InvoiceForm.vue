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
            let invoices=[];
            if(invoiceData.fixtures && Array.isArray(invoiceData.fixtures)){
                invoices=invoiceData.fixtures;
            }else if (Array.isArray(invoiceData)){
                invoices=invoiceData;
            }else{
                invoices=[invoiceData];
            }

            // 2. Define an inline promise-based delay helper to prevent event-loop blockages
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const delayTime = 12000; // 12 seconds pause to strictly respect the Envoy Gateway rate limiter bounds
    
    let successCount = 0;
    let failedCount = 0;

    // 3. Execute the single external entry point pipeline routing sequentially using for...of loop
    for (let i = 0; i < invoices.length; i++) {
        const currentInvoice = invoices[i];
        const trackingId = currentInvoice.id || currentInvoice.tracking_id || `Index-${i}`;
        
        this.feedbackType = 'info';
        this.feedbackMessage = `Sending invoice [${trackingId}] (${i + 1}/${invoices.length})...`;

        try {
            // Actively drive the live gateway container by sending one single invoice object at a time
            const result = await this.api.SendInvoice(currentInvoice);
            successCount++;

            // Only apply the sleep delay pacing if there are remaining invoices left in the background queue
            if (i < invoices.length - 1) {
                await delay(delayTime);
            }
        } catch (err) {
            console.error(`[UI Batch Error] Failed to dispatch invoice ${trackingId}:`, err.message);
            failedCount++;
            
            // Re-throw or continue based on your defensive architecture compliance goals
            if (i < invoices.length - 1) {
                await delay(delayTime);
            }
        }
    }

    // 4. Compile the final systemic verification outcomes report metadata summary for the supervisor
    if (failedCount === 0) {
        this.feedbackType = 'success';
        this.feedbackMessage = `Successfully processed all ${successCount} invoices in sequence grid loop.`;
        this.invoice = ''; // Clear text area inputs safely
    } else {
        this.feedbackType = 'error';
        this.feedbackMessage = `Batch routine complete. Sent successfully: ${successCount}, Failed: ${failedCount}. Check sidecars logs context.`;
    }
            /*
            try {
                const result = await this.api.SendInvoice(invoiceData);
                this.feedbackType = 'success';
                this.feedbackMessage = result?.results?.[0]?.message || result?.message || 'Invoice sent successfully.';
                this.invoice = '';
            } catch (err) {
                this.feedbackType = 'error';
                this.feedbackMessage = err.message || 'Failed to send invoice.';
            }*/
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