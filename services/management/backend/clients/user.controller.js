class UserController {
    constructor(userManagementManager) {
        this.userManagementManager = userManagementManager;
    }

    saveUser = async (req, res) => {
        try {
            // Извлекаем роль из сессии, если сессия существует
            const currentUserRole = req.user?.role || null;

            const { key, username, password, role } = req.body;
            const result = await this.userManagementManager.saveUserByAdmin(currentUserRole, {
                key,
                username,
                password,
                role
            });

            return res.json({ result: result });
        } catch (error) {
            console.error("Controller Error:", error);
            return res.status(500).json({ result: false, error: 'Internal Server Error' });
        }
    }

    getUsers = async (req, res) => {
        try {
            // Extract the authenticated session user if it exists
            const currentUser = req?.user || null;

            // Execute the business process manager
            const result = await this.userManagementManager.getUserList(currentUser);

            if (!result.success) {
                return res.status(401).json({ error: result.error });
            }

            return res.json({ users: result.data });
        } catch (error) {
            console.error("Client Layer Execution Error:", error);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    deleteUser = async (req, res) => {
        try {
            const currentUserRole = req?.user?.role || null;
            const { id } = req.body;

            // Execute the isolated business process manager
            const result = await this.userManagementManager.deleteUserByAdmin(currentUserRole, id);

            if (!result.success) {
                return res.json({ result: false });
            }

            return res.json({ result: result.data });
        } catch (error) {
            console.error("Client Layer Execution Error:", error);
            return res.status(500).json({ result: false, error: 'Internal Server Error' });
        }
    }
}

module.exports = UserController;
