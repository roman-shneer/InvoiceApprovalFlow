class AuthManager {
    constructor(userResource, cryptoEngine) {
        this.userResource = userResource;
        this.cryptoEngine = cryptoEngine;
    }

    async login(username, password) {

        const user = await this.userResource.findByUsername(username);
        if (!user) {
            return { success: false };
        }

        const hash = await this.cryptoEngine.decodeHash(user.password_hash);
        const isPasswordValid = await this.cryptoEngine.verifyPassword(password, hash);
        if (!isPasswordValid) {
            return { success: false };
        }


        return {
            success: true,
            user: { id: user.id, username: user.username, role: user.role }
        };
    }
}

module.exports = AuthManager;