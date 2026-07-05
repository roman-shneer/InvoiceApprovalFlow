const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];


    if (!token) {

        return res.status(401).json({
            error: "Authentication required",
            message: "Access token is missing. Please log in."
        });
    }


    jwt.verify(token, process.env.JWT_SECRET || 'jwt_secret_key_999', (err, userPayload) => {
        if (err) {
            return res.status(401).json({
                error: "Invalid token",
                message: "Your session has expired or the token is invalid. Please log in again."
            });

        }
        req.user = userPayload;

        next();
    });
}



module.exports = { authenticateToken };