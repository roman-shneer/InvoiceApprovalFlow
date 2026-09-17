// @ts-nocheck
const bcrypt = require("bcrypt");
class UserEngine {
    constructor() {
        this.saltRounds = 10;
    }

    async hashPassword(password) {
        return await bcrypt.hash(password, this.saltRounds);
    }

    shouldUpdatePassword(password) {
        return typeof password !== 'undefined' && password !== null && password !== "";
    }

    sanitizePassword(password) {
        if (typeof password === 'undefined' || password === null) {

            return "";
        }
        return password;
    }
}

module.exports = UserEngine;