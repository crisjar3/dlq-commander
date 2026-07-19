import eslint from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out', 'release', 'coverage', 'node_modules', 'design-system'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node, ...globals.browser }
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error'
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['electron', 'node:*'] }]
    }
  }
)
