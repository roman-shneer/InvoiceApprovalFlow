const bcrypt = require('bcrypt');

jest.mock('bcrypt', () => ({
    hash: jest.fn()
}));

const UserEngine = require('../../backend/engines/user.engine');

describe('UserEngine', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('hashPassword delegates to bcrypt with the configured salt rounds', async () => {
        bcrypt.hash.mockResolvedValue('hashed-password');
        const engine = new UserEngine();

        await expect(engine.hashPassword('secret')).resolves.toBe('hashed-password');
        expect(bcrypt.hash).toHaveBeenCalledWith('secret', 10);
    });

    test('shouldUpdatePassword returns false only for empty values', () => {
        const engine = new UserEngine();

        expect(engine.shouldUpdatePassword('value')).toBe(true);
        expect(engine.shouldUpdatePassword('')).toBe(false);
        expect(engine.shouldUpdatePassword(null)).toBe(false);
        expect(engine.shouldUpdatePassword(undefined)).toBe(false);
    });

    test('sanitizePassword normalizes missing values to an empty string', () => {
        const engine = new UserEngine();

        expect(engine.sanitizePassword(undefined)).toBe('');
        expect(engine.sanitizePassword(null)).toBe('');
        expect(engine.sanitizePassword('abc')).toBe('abc');
    });
});
