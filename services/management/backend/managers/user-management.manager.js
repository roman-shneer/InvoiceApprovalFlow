class UserManagementManager {
    constructor(userResource, userEngine, cryptoEngine) {
        this.userResource = userResource;
        this.userEngine = userEngine;
        this.cryptoEngine = cryptoEngine;
    }

    async saveUserByAdmin(adminRole, userData) {

        if (adminRole !== 'admin') {
            return { success: false, message: "No permission" };
        }

        const { key, username, password, role } = userData;
        if (!key) {
            const passwordHash = await this.cryptoEngine.hashPassword(password);
            const newUser = await this.userResource.create(username, role, passwordHash);
            return { success: true, data: newUser };
        }

        if (this.userEngine.shouldUpdatePassword(password)) {

            const passwordHash = await this.cryptoEngine.hashPassword(password);
            const updatedUser = await this.userResource.updateWithPassword(key, username, role, passwordHash);
            return { success: true, data: updatedUser };
        } else {

            const updatedUser = await this.userResource.updateWithoutPassword(key, username, role);
            return { success: true, data: updatedUser };
        }
    }


    async getUserList(currentUser) {
        // Enforce structural security rule: user must be authenticated
        if (!currentUser) {
            return { success: false, error: 'Unauthorized' };
        }
        const users = await this.userResource.findAll();

        return { success: true, data: users };
    }


    async deleteUserByAdmin(adminRole, userId) {
        // Structural security rule: enforcement of admin privilege
        if (adminRole !== 'admin') {

            return { success: false, error: 'Unauthorized' };
        }



        // Trigger the infrastructure resource layer
        const isDeleted = await this.userResource.delete(userId);

        return { success: true, data: isDeleted };
    }
}

module.exports = UserManagementManager;
