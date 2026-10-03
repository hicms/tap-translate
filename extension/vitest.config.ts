import { defineConfig } from 'vitest/config';
import { artifactPath } from './tools/artifact-paths.mjs';

export default defineConfig({
  cacheDir: artifactPath('cache', 'vitest'),
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: { reportsDirectory: artifactPath('coverage') },
  },
});
