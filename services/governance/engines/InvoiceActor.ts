import { AbstractActor, DaprClient, ActorId } from '@dapr/dapr';
import { Temporal } from "@js-temporal/polyfill";
// ---- INLINE TYPES ----
interface InvoicePayload {
    tracking_id: string;
    [key: string]: any;
}

interface InvoiceState {
    status: 'PROCESSING' | 'AUTO_APPROVE' | 'HUMAN_REVIEW' | 'REJECT' | string;
    [key: string]: any;
}

interface StartTimerResponse {
    success: boolean;
}

export class InvoiceActor extends AbstractActor {
    // Dapr SDK инжектит daprClient, но в типах его нет - кастим
    private get dapr(): DaprClient {
        return (this as any).daprClient as DaprClient;
    }

    async startProcessingTimer(payload: InvoicePayload): Promise<StartTimerResponse> {
        await this.getStateManager().setState("invoicePayload", payload);
        await this.registerActorReminder(
            "checkStatus", // reminderName
            Temporal.Duration.from({ seconds: 30 }), // dueTime: Temporal.Duration
            Temporal.Duration.from({ seconds: 30 }), // period: Temporal.Duration
            undefined, // ttl
            Buffer.from("") // data в конце!
        )
        console.log(`[Actor ${this.getActorId().getId()}] Reminder registered for 30 seconds.`);
        return { success: true };
    }

    async checkStatus(): Promise<void> {
        const actorId: string = this.getActorId().getId();
        console.log(`[Actor ${actorId}] Reminder fired! Checking if invoice is stuck...`);

        const stateStoreName = 'approval-state';
        const invoiceState = await this.dapr.state.get(stateStoreName, actorId) as InvoiceState | null;

        if (!invoiceState || invoiceState.status === 'PROCESSING') {
            console.log(`[Actor ${actorId}] Invoice is STUCK. Reclaiming and reposting to Pub/Sub...`);

            const payload = await this.getStateManager().getState("invoicePayload") as InvoicePayload;
            const pubSubName = "approval-pubsub";

            await this.dapr.pubsub.publish(pubSubName, "invoice.pending", payload);
        } else {
            console.log(`[Actor ${actorId}] Invoice is already processed (${invoiceState.status}). Nothing to do.`);
        }
        await this.unregisterActorReminder("stuck-invoice-check");
    }

    async receiveReminder(): Promise<void> {
        await this.checkStatus();
    }

    async stopTimer(): Promise<void> {
        try {
            await this.unregisterActorReminder("stuck-invoice-check");
            console.log(`[Actor ${this.getActorId().getId()}] Reminder canceled successfully.`);
        } catch (e: any) {
            console.error(`[Actor ${this.getActorId().getId()}] Failed to cancel reminder:`, e.message);
            throw e;
        }
    }

    async markAsDone(): Promise<StartTimerResponse> {
        console.log(`[Actor ${this.getActorId().getId()}] Stopping reminder via markAsDone...`);
        await this.unregisterActorReminder("stuck-invoice-check");
        return { success: true };
    }
}