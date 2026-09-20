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

describe('End-to-End Enterprise Journey Verification Harness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    ['INV-1001', 45, true],
    ['INV-1003', 85, false],
    ['INV-1007', 1250, true],
    ['INV-1012', 5000, true],
  ] as [string, number, boolean][])('accepts journey %s', async (id: string, total: number, receiptPresent: boolean) => {
    mockStateGet.mockResolvedValue(null);
    mockStateSave.mockResolvedValue(true);
    const response = await request(app).post('/api/v1/expenses').set('Authorization', `Bearer ${token()}`).send({
      id, vendor: 'Acme Corp', invoiceNumber: `${id}-001`, total, currency: 'USD', receiptPresent, vendorKnown: id !== 'INV-1012',
    });
    expect(response.status).toBe(202);
    expect(response.body.status).toBe('ACCEPTED');
  });
});