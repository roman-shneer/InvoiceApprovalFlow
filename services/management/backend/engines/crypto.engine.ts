// @ts-nocheck
const bcrypt = require("bcrypt");
const saltRounds = parseInt(process.env.SALT_ROUNDS, 10) || 10;
class CryptoEngine {

    async hashPassword(password) {
        const hash = await bcrypt.hash(password, saltRounds);
        return Buffer.from(hash).toString('base64');
    }

    async decodeHash(hash) {
        const decodedHash = Buffer.from(hash, 'base64').toString('utf-8');
        return decodedHash;
    }

    async verifyPassword(password, hash) {
        return bcrypt.compare(password, hash);
    }
}

module.exports = CryptoEngine;