const bcrypt = require('bcrypt');

jest.mock('bcrypt', () => ({
    hash: jest.fn(),
    compare: jest.fn()
}));

const CryptoEngine = require('../../backend/engines/crypto.engine');

describe('CryptoEngine', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('hashPassword base64-encodes the bcrypt hash', async () => {
        bcrypt.hash.mockResolvedValue('hashed-value');
        const engine = new CryptoEngine();

        const result = await engine.hashPassword('secret');

        expect(result).toBe(Buffer.from('hashed-value').toString('base64'));
        expect(bcrypt.hash).toHaveBeenCalledWith('secret', 10);
    });

    test('decodeHash converts base64 back to utf-8', async () => {
        const engine = new CryptoEngine();

        await expect(engine.decodeHash(Buffer.from('hashed-value').toString('base64'))).resolves.toBe('hashed-value');
    });

    test('verifyPassword delegates to bcrypt.compare', async () => {
        bcrypt.compare.mockResolvedValue(true);
        const engine = new CryptoEngine();

        await expect(engine.verifyPassword('secret', 'hash')).resolves.toBe(true);
        expect(bcrypt.compare).toHaveBeenCalledWith('secret', 'hash');
    });
});
