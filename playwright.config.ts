import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src/tests/e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    headless: true
  }
});
