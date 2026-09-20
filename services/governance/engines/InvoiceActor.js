const { AbstractActor } = require('@dapr/dapr');

class InvoiceActor extends AbstractActor {
    async startProcessingTimer(payload) {
        await this.getStateManager().setState("invoicePayload", payload);
        await this.registerReminder(
            "stuck-invoice-check",
            "30s",
            "0s",
            "checkStatus"
        );
        console.log(`[Actor ${this.getActorId().getId()}] Reminder registered for 5 minutes.`);
        return { success: true };
    }


    async checkStatus() {
        const actorId = this.getActorId().getId();
        console.log(`[Actor ${actorId}] Reminder fired! Checking if invoice is stuck...`);

        const stateStoreName = 'approval-state';
        const invoiceState = await this.daprClient.state.get(stateStoreName, actorId);
        if (!invoiceState || invoiceState.status === 'PROCESSING' || invoiceState.status === 'PROCESSING') {
            console.log(`[Actor ${actorId}] Invoice is STUCK. Reclaiming and reposting to Pub/Sub...`);

            const payload = await this.getStateManager().getState("invoicePayload");
            const pubSubName = "approval-pubsub";

            await this.daprClient.pubsub.publish(pubSubName, "invoice.pending", payload);

        } else {
            console.log(`[Actor ${actorId}] Invoice is already processed (${invoiceState.status}). Nothing to do.`);
        }
        await this.unregisterReminder("stuck-invoice-check");
    }


    async stopTimer() {
        try {
            await this.unregisterReminder("stuck-invoice-check");
            console.log(`[Actor ${this.getActorId().getId()}] Reminder canceled successfully.`);
        } catch (e) {
            console.error(`[Actor ${this.getActorId().getId()}] Failed to cancel reminder:`, e.message);
            throw e;
        }
    }

    async markAsDone() {
        console.log(`[Actor ${this.getActorId().getId()}] Stopping reminder via markAsDone...`);
        await this.unregisterReminder("stuck-invoice-check");
        return { success: true };
    }
}
module.exports = { InvoiceActor };