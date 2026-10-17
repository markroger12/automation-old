import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  // tsconfig keeps JSX for Next; tests that render a page component need it compiled.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    // Several test files start and close real browsers; under load closing one can take longer than the 10 s default.
    hookTimeout: 60_000,
  },
});
