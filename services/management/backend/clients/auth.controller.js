const jwt = require('jsonwebtoken');
class AuthController {
    constructor(authManager) {
        this.authManager = authManager;
    }


    async login(req, res) {
        try {
            const { username, password } = req.body;

            const result = await this.authManager.login(username, password);

            if (result.success && result.user) {

                const token = jwt.sign(
                    result.user,
                    process.env.JWT_SECRET || 'jwt_secret_key_999',
                    { expiresIn: '30d' }
                );

                res.json({ success: result.success, user: result.user || null, token: token });
            } else {

                res.json({ success: false, user: null, token: null });
            }

        } catch (error) {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    checkAuth(req, res) {

        try {
            if (req.user) {
                return res.json({
                    Success: true,
                    user: req.user
                });
            }

            return res.json({
                Success: false,
                user: null
            });
        } catch (error) {
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }
}

module.exports = AuthController;