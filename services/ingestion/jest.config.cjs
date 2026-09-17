/** @type {import('jest').Config} */
module.exports = {
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: { types: ['node', 'jest'] } }],
    },
    testEnvironment: 'node',
    testMatch: ['<rootDir>/tests/**/*.test.ts'],
    moduleFileExtensions: ['ts', 'js', 'json'],
};