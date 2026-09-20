import request from 'supertest';

const mockStateGet = jest.fn();
const mockStateSave = jest.fn();
const mockPubSubPublish = jest.fn();

jest.mock('@dapr/dapr', () => ({
  ActorId: class ActorId { constructor(public readonly id: string) { } },
  DaprClient: jest.fn().mockImplementation(() => ({
    state: { get: mockStateGet, save: mockStateSave, query: jest.fn().mockResolvedValue({ results: [] }), delete: jest.fn().mockResolvedValue(true) },
    pubsub: { publish: mockPubSubPublish.mockResolvedValue(true) },
    actor: { actor: { invoke: jest.fn().mockResolvedValue({ success: true }) } },
  })),
}));

import { app } from '../app';

function token(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify({ role: 'submitter', exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64');
  return `${header}.${payload}.mock_signature_hash_bytes`;
}

describe('Ingestion Service Transactional Outbox Pattern', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('saves an outbox event, publishes it, and marks it processed', async () => {
    mockStateGet.mockResolvedValue(null);
    mockStateSave.mockResolvedValue(true);
    const response = await request(app).post('/api/v1/expenses').set('Authorization', `Bearer ${token()}`).send({ id: 'INV-OUTBOX-99', vendor: 'Cloud Providers Inc', invoiceNumber: 'CP-1234', total: 999.0 });
    expect(response.status).toBe(202);
    expect(mockPubSubPublish).toHaveBeenCalledWith('approval-pubsub', 'invoice.pending', expect.objectContaining({ tracking_id: 'INV-OUTBOX-99', total: 999 }));
    expect(mockStateSave).toHaveBeenNthCalledWith(2, 'mongo-state', expect.arrayContaining([expect.objectContaining({ value: expect.objectContaining({ topic: 'invoice.pending', processed: false }) })]));
    expect(mockStateSave.mock.calls.some(([store, items]) => store === 'mongo-state' && items.some((item: { value?: { processed?: boolean } }) => item.value?.processed === true))).toBe(true);
  });
});