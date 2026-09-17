import request from 'supertest';

const mockStateGet = jest.fn();
const mockStateSave = jest.fn();
const mockPubSubPublish = jest.fn();

jest.mock('@dapr/dapr', () => ({
  DaprClient: jest.fn().mockImplementation(() => ({
    state: { get: mockStateGet, save: mockStateSave, query: jest.fn().mockResolvedValue({ results: [] }), delete: jest.fn().mockResolvedValue(true) },
    pubsub: { publish: mockPubSubPublish.mockResolvedValue(true) },
  })),
}));

import { app } from '../app';

function generateMockTestToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify({ role: 'submitter', exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64');
  return `${header}.${payload}.mock_signature_hash_bytes`;
}

describe('Ingestion Service API Tests', () => {
  let mockToken: string;

  beforeEach(() => {
    jest.clearAllMocks();
    mockToken = generateMockTestToken();
  });

  test('rejects an invoice without an ID', async () => {
    const response = await request(app).post('/api/v1/expenses').set('Authorization', `Bearer ${mockToken}`).send({ vendor: 'City Cabs', total: 48.0 });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid schema. Required: id' });
    expect(mockStateGet).not.toHaveBeenCalled();
    expect(mockPubSubPublish).not.toHaveBeenCalled();
  });

  test('accepts a unique invoice and publishes invoice.pending', async () => {
    mockStateGet.mockResolvedValue(null);
    mockStateSave.mockResolvedValue(true);
    const response = await request(app).post('/api/v1/expenses').set('Authorization', `Bearer ${mockToken}`).send({ id: 'INV-1016', vendor: 'City Cabs', invoiceNumber: 'CC-4410', total: 48.0 });
    expect(response.status).toBe(202);
    expect(response.body.status).toBe('ACCEPTED');
    expect(mockPubSubPublish).toHaveBeenCalledWith('approval-pubsub', 'invoice.pending', expect.objectContaining({ tracking_id: 'INV-1016', total: 48 }));
  });

  test('returns the existing state for a duplicate invoice', async () => {
    mockStateGet.mockResolvedValue({ tracking_id: 'INV-1016', status: 'PROCESSING' });
    const response = await request(app).post('/api/v1/expenses').set('Authorization', `Bearer ${mockToken}`).send({ id: 'INV-1016', vendor: 'City Cabs', invoiceNumber: 'CC-4410', total: 48.0 });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('PROCESSING');
    expect(mockStateSave).not.toHaveBeenCalled();
    expect(mockPubSubPublish).not.toHaveBeenCalled();
  });

  test('returns 404 for an unknown route', async () => {
    const response = await request(app).get('/unknown-route');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Not Found' });
  });
});