const UserManagementManager = require('../../backend/managers/user-management.manager');

describe('UserManagementManager', () => {
    test('rejects non-admin user save attempts', async () => {
        const manager = new UserManagementManager({}, {}, {});

        await expect(manager.saveUserByAdmin('submitter', { username: 'alice' })).resolves.toEqual({
            success: false,
            message: 'No permission'
        });
    });

    test('creates a new user when no key is provided', async () => {
        const userResource = {
            create: jest.fn().mockResolvedValue({ id: 'user-1' })
        };
        const userEngine = {
            shouldUpdatePassword: jest.fn()
        };
        const cryptoEngine = {
            hashPassword: jest.fn().mockResolvedValue('hashed-password')
        };
        const manager = new UserManagementManager(userResource, userEngine, cryptoEngine);

        await expect(manager.saveUserByAdmin('admin', {
            username: 'alice',
            password: 'secret',
            role: 'approver'
        })).resolves.toEqual({
            success: true,
            data: { id: 'user-1' }
        });
        expect(cryptoEngine.hashPassword).toHaveBeenCalledWith('secret');
        expect(userResource.create).toHaveBeenCalledWith('alice', 'approver', 'hashed-password');
    });

    test('updates a user with or without password depending on the engine decision', async () => {
        const userResource = {
            updateWithPassword: jest.fn().mockResolvedValue({ id: 'user-2', mode: 'with-password' }),
            updateWithoutPassword: jest.fn().mockResolvedValue({ id: 'user-2', mode: 'without-password' }),
            findAll: jest.fn().mockResolvedValue([{ key: 'u1' }]),
            delete: jest.fn().mockResolvedValue(true)
        };
        const userEngine = {
            shouldUpdatePassword: jest.fn()
        };
        const cryptoEngine = {
            hashPassword: jest.fn().mockResolvedValue('hashed-password')
        };
        const manager = new UserManagementManager(userResource, userEngine, cryptoEngine);

        userEngine.shouldUpdatePassword.mockReturnValueOnce(true);
        await expect(manager.saveUserByAdmin('admin', {
            key: 'user-2',
            username: 'alice',
            password: 'new-secret',
            role: 'approver'
        })).resolves.toEqual({
            success: true,
            data: { id: 'user-2', mode: 'with-password' }
        });
        expect(userResource.updateWithPassword).toHaveBeenCalledWith('user-2', 'alice', 'approver', 'hashed-password');

        userEngine.shouldUpdatePassword.mockReturnValueOnce(false);
        await expect(manager.saveUserByAdmin('admin', {
            key: 'user-2',
            username: 'alice',
            password: '',
            role: 'approver'
        })).resolves.toEqual({
            success: true,
            data: { id: 'user-2', mode: 'without-password' }
        });
        expect(userResource.updateWithoutPassword).toHaveBeenCalledWith('user-2', 'alice', 'approver');
    });

    test('enforces authentication and admin rules for list and delete operations', async () => {
        const userResource = {
            findAll: jest.fn().mockResolvedValue([{ key: 'u1' }]),
            delete: jest.fn().mockResolvedValue(true)
        };
        const manager = new UserManagementManager(userResource, {}, {});

        await expect(manager.getUserList(null)).resolves.toEqual({
            success: false,
            error: 'Unauthorized'
        });
        await expect(manager.getUserList({ id: 'user-1' })).resolves.toEqual({
            success: true,
            data: [{ key: 'u1' }]
        });
        await expect(manager.deleteUserByAdmin('approver', 'user-1')).resolves.toEqual({
            success: false,
            error: 'Unauthorized'
        });
        await expect(manager.deleteUserByAdmin('admin', 'user-1')).resolves.toEqual({
            success: true,
            data: true
        });
    });
});
