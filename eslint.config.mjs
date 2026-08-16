import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

const sharedRules = {
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/explicit-function-return-type': [
    'error',
    {
      allowExpressions: true,
      allowTypedFunctionExpressions: true,
      allowHigherOrderFunctions: true,
    },
  ],
  '@typescript-eslint/consistent-type-imports': [
    'error',
    { prefer: 'type-imports' },
  ],
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-non-null-assertion': 'error',
};

const typeAwareRules = {
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'eslint.config.mjs',
      'vitest.config.ts',
      '.project/**',
    ],
  },
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    files: ['packages/*/tests/**/*.ts'],
    rules: {
      ...sharedRules,
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
    },
  },
  {
    files: ['packages/*/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { ...sharedRules, ...typeAwareRules },
  },
  prettierConfig,
);
