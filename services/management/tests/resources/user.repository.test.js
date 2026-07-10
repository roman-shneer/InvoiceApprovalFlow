const crypto = require('crypto');
const UserRepository = require('../../backend/resources/user.repository');

describe('UserRepository', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
    });

    test('creates and queries users in the mongo-users store', async () => {
        jest.spyOn(crypto, 'randomUUID').mockReturnValue('uuid-1');
        const daprClient = {
            state: {
                get: jest.fn().mockResolvedValue(null),
                save: jest.fn().mockResolvedValue(true),
                query: jest.fn().mockResolvedValue({ results: [{ key: 'user-1', data: { username: 'alice', role: 'admin' } }] }),
                delete: jest.fn().mockResolvedValue(true)
            }
        };
        const repository = new UserRepository(daprClient);

        await expect(repository.findByUsername('alice')).resolves.toBeNull();
        await expect(repository.create('alice', 'admin', 'hash')).resolves.toBe(true);
        await expect(repository.findAll()).resolves.toEqual([{ key: 'user-1', username: 'alice', role: 'admin' }]);
        await expect(repository.delete('user-1')).resolves.toBe(true);

        expect(daprClient.state.save).toHaveBeenCalledWith('mongo-users', [
            { key: 'doc_uuid-1', value: { username: 'alice', role: 'admin', password_hash: 'hash' } }
        ]);
    });

    test('updates users with and without password', async () => {
        const daprClient = {
            state: {
                get: jest.fn().mockResolvedValue({ password_hash: 'existing-hash' }),
                save: jest.fn().mockResolvedValue(true),
                query: jest.fn(),
                delete: jest.fn()
            }
        };
        const repository = new UserRepository(daprClient);

        await expect(repository.updateWithPassword('user-1', 'alice', 'approver', 'hash')).resolves.toBe(true);
        await expect(repository.updateWithoutPassword('user-2', 'alice', 'approver')).resolves.toBe(true);

        expect(daprClient.state.save).toHaveBeenNthCalledWith(1, 'mongo-users', [
            { key: 'user-1', value: { username: 'alice', role: 'approver', password_hash: 'hash' } }
        ]);
        expect(daprClient.state.save).toHaveBeenNthCalledWith(2, 'mongo-users', [
            { key: 'user-2', value: { username: 'alice', role: 'approver', password_hash: 'existing-hash' } }
        ]);
    });
});
