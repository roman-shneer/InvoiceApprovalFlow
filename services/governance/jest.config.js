// ВАЖНО: без preset
module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.test.ts'],
    moduleFileExtensions: ['ts', 'js', 'json'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            isolatedModules: true,
            diagnostics: false,
            // inline конфиг - не читает файл с диска
            tsconfig: {
                target: 'ES2022',
                module: 'CommonJS',
                moduleResolution: 'Node',
                esModuleInterop: true,
                skipLibCheck: true,
                strict: false
            }
        }]
    },
    testPathIgnorePatterns: ['/node_modules/', 'aiManager'],
    passWithNoTests: true,
    forceExit: true
};