import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '**/*.js']
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        // Test files are excluded from tsconfig.json (not built), so let the
        // project service type-check them with default options.
        projectService: { allowDefaultProject: ['src/*.test.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Keep recommended defaults, only override what we need
      '@typescript-eslint/no-unused-vars': ['error', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
      'curly': ['error', 'all'],
      'no-throw-literal': 'error'
    }
  }
);
