import express, { NextFunction, Request, Response } from 'express';
import { DaprClient, ActorId, ActorProxyBuilder } from '@dapr/dapr';
import crypto from 'node:crypto';
import fs from 'node:fs';

const DAPR_HOST = process.env.DAPR_HOST || 'ingestion-dapr-sidecar';
const DAPR_PORT = process.env.DAPR_PORT || '3500';
const PORT = process.env.PORT || '8001';

const STATE_STORE_NAME = 'approval-state';
const PUB_SUB_NAME = 'approval-pubsub';
const MONGO_STATE_STORE = 'mongo-state';
const MONGO_INVOICES_STORE = 'mongo-invoices';

const NOTIFICATION_PENDING_TOPIC = 'invoice.pending';

const daprClient = new DaprClient({ daprHost: DAPR_HOST, daprPort: DAPR_PORT });
export const app = express();

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

type JwtPayload = {
  role?: string;
  exp?: number;
  [key: string]: unknown;
};

type InvoicePayload = {
  idempotency_key: string;
  correlation_id: string;
  submitted_at: string;
  tracking_id: string;
  submitter: string;
  department: string;
  vendor: string;
  vendorKnown: boolean;
  invoiceNumber: string;
  currency: string;
  category: string;
  attendees: number;
  lineItems: unknown[];
  taxAmount: number;
  total: number;
  receiptPresent: boolean;
  date: string;
  notes: string;
  scenario: string;
  expected: unknown;
  note: unknown;
  status: string;
};

app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  next();
});

function logMessage(level: LogLevel, correlationId: string, message: string): void {
  const log = {
    timestamp: new Date().toISOString(),
    level,
    service: 'ingestion-service',
    correlation_id: correlationId,
    message,
  };

  const formattedMsg = `${JSON.stringify(log)}\n`;
  process.stdout.write(formattedMsg);

  fs.appendFile('server.log', formattedMsg, (err) => {
    if (err) {
      console.error('Error writing log to file:', err);
    }
  });
}

function decodeJwtPayload(token?: string): JwtPayload | null {
  if (!token) {
    return null;
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(jsonPayload) as JwtPayload;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown JWT decode error';
    console.error('[JWT Error] Failed to decode token payload:', message);
    return null;
  }
}

async function saveInvoiceToMongo(invoice: Record<string, unknown>): Promise<void> {
  const pendingInvoice = {
    ...invoice,
    createdAt: new Date().toISOString(),
  };

  try {
    const trackingId = String((invoice as Record<string, unknown>).tracking_id ?? 'unknown');
    await daprClient.state.save(MONGO_INVOICES_STORE, [
      {
        key: trackingId,
        value: pendingInvoice,
      },
    ]);
  } catch (dbErr) {
    const message = dbErr instanceof Error ? dbErr.message : 'Unknown database error';
    const trackingId = String((invoice as Record<string, unknown>).tracking_id ?? 'unknown');
    const correlationId = String((invoice as Record<string, unknown>).correlation_id ?? 'unknown');
    console.log(`[${trackingId}] ERROR: ${correlationId}: Failed to save audit record in MongoDB: ${message}`);
  }
}

async function publishInvoiceNotification(pendingInvoice: Record<string, unknown>, topic = NOTIFICATION_PENDING_TOPIC): Promise<void> {
  if (!pendingInvoice) {
    return;
  }

  try {
    await daprClient.pubsub.publish(PUB_SUB_NAME, topic, pendingInvoice);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown publish error';
    console.error(`[${String(pendingInvoice.tracking_id)}] Failed to publish invoice processed notification:`, message);
  }
}

async function saveOutboxEvent(eventPayload: InvoicePayload): Promise<{ key: string; value: Record<string, unknown> }> {
  const outboxKey = `outbox_${eventPayload.idempotency_key}`;
  const outboxValue = {
    pubsub_name: PUB_SUB_NAME,
    topic: NOTIFICATION_PENDING_TOPIC,
    processed: false,
    payload: eventPayload,
    created_at: new Date().toISOString(),
    correlation_id: eventPayload.correlation_id,
  };

  await daprClient.state.save(MONGO_STATE_STORE, [{ key: outboxKey, value: outboxValue }]);

  return { key: outboxKey, value: outboxValue };
}

async function markOutboxProcessed(outboxKey: string, outboxValue: Record<string, unknown>): Promise<void> {
  await daprClient.state.save(MONGO_STATE_STORE, [
    {
      key: outboxKey,
      value: {
        ...outboxValue,
        processed: true,
        processed_at: new Date().toISOString(),
      },
    },
  ]);
}

class InvoiceActor { }

async function registerActorTimer(idempotencyKey: string, eventPayload: InvoicePayload) {
  try {
    const actorId = new ActorId(idempotencyKey);

    // 2. Передаем наш класс-заглушку в билдер. 
    // Билдер автоматически считает имя "InvoiceActor" и не упадет в рантайме!
    const builder = new ActorProxyBuilder<any>(InvoiceActor, daprClient);
    const actorProxy = builder.build(actorId);

    // 3. Вызываем кастомный метод, приводя прокси к типу any
    await actorProxy.startProcessingTimer(eventPayload);

    logMessage('INFO', eventPayload.correlation_id, `Successfully registered actor timer for key ${idempotencyKey}`);
  } catch (actorErr) {
    const msg = actorErr instanceof Error ? actorErr.message : 'Unknown actor error';
    logMessage('ERROR', eventPayload.correlation_id, `Failed to register actor: ${msg}`);
  }
}

/*
async function registerActor(idempotencyKey: string, eventPayload: InvoicePayload): Promise<void> {
  const actorId = new ActorId(idempotencyKey);
  const builder = new ActorProxyBuilder("InvoiceActor" as any, daprClient);
  
  //const actorProxy = builder.build(actorId);
  //await (actorProxy as any).startProcessingTimer(eventPayload);
  await daprClient.actor.invokeActorMethod(
    'InvoiceActor',
    actorId,
    'startProcessingTimer',
    eventPayload
  );

}*/

logMessage('INFO', '0', 'Ingestion service bootstrap complete. Listening for incoming traffic.');

app.post('/api/v1/expenses', async (req: Request, res: Response) => {
  const correlationId = String(req.headers['x-correlation-id'] || `corr_${crypto.randomUUID()}`);
  logMessage('INFO', correlationId, 'Received raw invoice submission request.');

  const authHeader = req.headers['authorization'];
  let userPayload: JwtPayload | null = null;
  if (authHeader) {
    let token: string | null = null;

    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1] ?? null;
    }
    userPayload = decodeJwtPayload(token ?? undefined);
  }

  if (!authHeader || !userPayload || userPayload.role !== 'submitter' || !userPayload.exp) {
    logMessage('WARN', correlationId, 'Unauthorized submission attempt.');
    return res.status(403).json({ error: 'Forbidden: Invalid or missing token.' });
  }

  const currentUnixTimestamp = Math.floor(Date.now() / 1000);
  if (currentUnixTimestamp > userPayload.exp) {
    logMessage('WARN', correlationId, 'Token has expired.');
    return res.status(403).json({ error: 'Forbidden: Token has expired.' });
  }

  logMessage('INFO', correlationId, 'Token is valid.');

  const body = req.body as Record<string, unknown> | undefined;

  if (!body || !body.id) {
    logMessage('WARN', correlationId, 'Rejected due to invalid JSON schema.');
    return res.status(400).json({ error: 'Invalid schema. Required: id' });
  }

  const vendor = String(body.vendor ?? 'UnknownVendor');
  const invoiceNumber = String(body.invoiceNumber ?? 'NoNumber');
  const total = Number(body.total ?? 0.0);

  const hashString = `${vendor}_${invoiceNumber}_${total}`;
  const idempotencyKey = crypto.createHash('md5').update(hashString).digest('hex');

  try {
    const existingState = (await daprClient.state.get(STATE_STORE_NAME, idempotencyKey)) as Record<string, unknown> | null;

    if (existingState && Object.keys(existingState).length > 0) {
      const trackingId = String(existingState.tracking_id ?? body.id);
      logMessage('INFO', correlationId, `Duplicate detected: ${idempotencyKey}.`);

      return res.status(200).json({
        tracking_id: trackingId,
        status: String(existingState.status ?? 'PROCESSING'),
        message: 'Duplicate request detected. Invoice is already being processed.',
      });
    }

    const trackingId = String(body.id);
    const category = String(body.category ?? 'General');

    const eventPayload: InvoicePayload = {
      idempotency_key: idempotencyKey,
      correlation_id: correlationId,
      submitted_at: new Date().toISOString(),
      tracking_id: trackingId,
      submitter: String(body.submitter ?? 'anonymous@example.com'),
      department: String(body.department ?? 'unassigned'),
      vendor,
      vendorKnown: Boolean(body.vendorKnown ?? true),
      invoiceNumber,
      currency: String(body.currency ?? 'USD'),
      category,
      attendees: Number(body.attendees ?? 1),
      lineItems: Array.isArray(body.lineItems) ? body.lineItems : [],
      taxAmount: Number(body.taxAmount ?? 0.0),
      total,
      receiptPresent: Boolean(body.receiptPresent ?? true),
      date: String(body.date ?? new Date().toISOString().split('T')[0]),
      notes: String(body.notes ?? ''),
      scenario: String(body.scenario ?? 'standard-ingest'),
      expected: body.expected ?? null,
      note: body.note ?? null,
      status: 'PENDING',
    };

    registerActorTimer(idempotencyKey, eventPayload).catch((err) => {
      const message = err instanceof Error ? err.message : 'Unknown actor registration error';
      logMessage('ERROR', correlationId, `Failed to register actor for idempotency key ${idempotencyKey}: ${message}`);
    });

    await daprClient.state.save(STATE_STORE_NAME, [
      {
        key: idempotencyKey,
        value: {
          tracking_id: trackingId,
          correlation_id: correlationId,
          status: 'PROCESSING',
          lockedAt: new Date().getTime(),
          payload: eventPayload,
          lockedBy: process.env.HOSTNAME,
          createdAt: new Date().toISOString(),
        },
      },
    ]);

    const outboxEvent = await saveOutboxEvent(eventPayload);
    logMessage('INFO', correlationId, `Publish notification to ${PUB_SUB_NAME} ${NOTIFICATION_PENDING_TOPIC}.`);
    await publishInvoiceNotification(eventPayload, NOTIFICATION_PENDING_TOPIC);
    await markOutboxProcessed(outboxEvent.key, outboxEvent.value);
    await saveInvoiceToMongo({ ...eventPayload, status: 'PENDING' });

    return res.status(202).json({
      tracking_id: trackingId,
      status: 'ACCEPTED',
      message: 'Invoice submitted successfully and queued for processing.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown processing error';
    logMessage('ERROR', correlationId, `Critical failure in ingestion processing: ${message}`);
    const statusCode = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: number }).status ?? 500) : 500;
    const errorMessage = statusCode === 500 ? 'Internal Server Error' : message;
    return res.status(statusCode).json({ error: errorMessage });
  }
});

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found' });
});

module.exports = app;
module.exports.app = app;

if (process.env.NODE_ENV !== 'test') {
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`🚀 Ingestion Service successfully started on port ${PORT}`);
  });
}

export default app;
