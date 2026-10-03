import { defineConfig } from 'vitest/config';
import { artifactPath } from './tools/artifact-paths.mjs';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  cacheDir: artifactPath('cache', 'vitest'),
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    coverage: { reportsDirectory: artifactPath('coverage') },
  },
});
