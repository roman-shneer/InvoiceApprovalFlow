const AuthManager = require('../../backend/managers/auth.manager');

describe('AuthManager', () => {
    test('returns user details on successful login', async () => {
        const userResource = {
            findByUsername: jest.fn().mockResolvedValue({
                id: 'user-1',
                username: 'alice',
                role: 'admin',
                password_hash: 'encoded-hash'
            })
        };
        const cryptoEngine = {
            decodeHash: jest.fn().mockResolvedValue('decoded-hash'),
            verifyPassword: jest.fn().mockResolvedValue(true)
        };
        const manager = new AuthManager(userResource, cryptoEngine);

        await expect(manager.login('alice', 'secret')).resolves.toEqual({
            success: true,
            user: { id: 'user-1', username: 'alice', role: 'admin' }
        });
        expect(cryptoEngine.decodeHash).toHaveBeenCalledWith('encoded-hash');
        expect(cryptoEngine.verifyPassword).toHaveBeenCalledWith('secret', 'decoded-hash');
    });

    test('fails login when the user is missing or password does not match', async () => {
        const userResource = {
            findByUsername: jest.fn().mockResolvedValue(null)
        };
        const cryptoEngine = {
            decodeHash: jest.fn(),
            verifyPassword: jest.fn()
        };
        const manager = new AuthManager(userResource, cryptoEngine);

        await expect(manager.login('missing', 'secret')).resolves.toEqual({ success: false });
        expect(cryptoEngine.decodeHash).not.toHaveBeenCalled();

        userResource.findByUsername.mockResolvedValueOnce({
            id: 'user-1',
            username: 'alice',
            role: 'admin',
            password_hash: 'encoded-hash'
        });
        cryptoEngine.decodeHash.mockResolvedValueOnce('decoded-hash');
        cryptoEngine.verifyPassword.mockResolvedValueOnce(false);

        await expect(manager.login('alice', 'wrong')).resolves.toEqual({ success: false });
    });
});
