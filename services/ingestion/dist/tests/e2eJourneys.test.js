"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const mockStateGet = jest.fn();
const mockStateSave = jest.fn();
const mockPubSubPublish = jest.fn();
jest.mock('@dapr/dapr', () => ({
    DaprClient: jest.fn().mockImplementation(() => ({
        state: { get: mockStateGet, save: mockStateSave, query: jest.fn().mockResolvedValue({ results: [] }), delete: jest.fn().mockResolvedValue(true) },
        pubsub: { publish: mockPubSubPublish.mockResolvedValue(true) },
    })),
}));
const app_1 = require("../app");
function token() {
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
    ])('accepts journey %s', async (id, total, receiptPresent) => {
        mockStateGet.mockResolvedValue(null);
        mockStateSave.mockResolvedValue(true);
        const response = await (0, supertest_1.default)(app_1.app).post('/api/v1/expenses').set('Authorization', `Bearer ${token()}`).send({
            id, vendor: 'Acme Corp', invoiceNumber: `${id}-001`, total, currency: 'USD', receiptPresent, vendorKnown: id !== 'INV-1012',
        });
        expect(response.status).toBe(202);
        expect(response.body.status).toBe('ACCEPTED');
    });
});
