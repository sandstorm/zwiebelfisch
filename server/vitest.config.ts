import { defineConfig } from 'vitest/config';

// The collaboration server's tests (`mise run server:test`): Node, in-process.
export default defineConfig({
  test: {
    root: 'server',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
