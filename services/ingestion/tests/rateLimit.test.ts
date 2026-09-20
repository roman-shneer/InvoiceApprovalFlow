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

test('handles upstream 429 errors', async () => {
  mockStateGet.mockRejectedValue(Object.assign(new Error('Too Many Requests'), { status: 429 }));
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify({ role: 'submitter', exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64');
  const response = await request(app).post('/api/v1/expenses').set('Authorization', `Bearer ${header}.${payload}.signature`).send({ id: 'INV-RTLIMIT', vendor: 'Express Courier', invoiceNumber: 'EC-9911', total: 120 });
  expect(response.status).toBe(429);
  expect(response.body.error).toContain('Too Many Requests');
  expect(mockPubSubPublish).not.toHaveBeenCalled();
});