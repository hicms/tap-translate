import { defineConfig } from '@playwright/test';
import { artifactPath } from './tools/artifact-paths.mjs';

// Keep CLI-selected reporters under the same root without enabling extra reports.
process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ??= artifactPath('reports', 'html');
process.env.PLAYWRIGHT_BLOB_OUTPUT_DIR ??= artifactPath('reports', 'blob');

export default defineConfig({
  testDir: './e2e',
  outputDir: artifactPath('test-results'),
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-ext',
      testMatch: /(popup|translate|lab|perf|connection|site-content)\.spec\.ts/,
    },
    {
      name: 'firefox-ext',
      testMatch: /firefox\.spec\.ts/,
      use: { browserName: 'firefox' },
    },
  ],
});
