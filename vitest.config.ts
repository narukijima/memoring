import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@core': r('./packages/core'),
      '@storage': r('./packages/storage'),
      '@intake': r('./packages/intake'),
      '@claim': r('./packages/claim'),
      '@retrieval': r('./packages/retrieval'),
      '@security': r('./packages/security'),
      '@integrations': r('./packages/integrations'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
