// ESLint flat config for the legacy vanilla-JS codebase.
// Cross-file globals mean no-undef/no-unused-vars would be noise, so they are
// scoped off while keeping the bug-catching "possible problems" rules active.

const js = require('@eslint/js');

module.exports = [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                window: 'readonly',
                document: 'readonly',
                navigator: 'readonly',
                localStorage: 'readonly',
                console: 'readonly',
                alert: 'readonly',
                prompt: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                requestAnimationFrame: 'readonly',
                cancelAnimationFrame: 'readonly',
                Blob: 'readonly',
                FileReader: 'readonly',
                XMLSerializer: 'readonly',
                URL: 'readonly',
                Image: 'readonly',
                Node: 'readonly',
                HTMLElement: 'readonly',
                HTMLInputElement: 'readonly',
                HTMLTableRowElement: 'readonly',
                HTMLTableElement: 'readonly',
                KeyboardEvent: 'readonly',
                PointerEvent: 'readonly',
                Event: 'readonly',
                Intl: 'readonly'
            }
        },
        rules: {
            // Cross-file globals are an intentional architectural choice here.
            'no-undef': 'off',
            'no-unused-vars': 'off',
            // Some intentional fallback paths use empty catch blocks.
            'no-empty': ['error', { allowEmptyCatch: true }]
        }
    }
];
