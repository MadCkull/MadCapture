import { test, expect } from '@playwright/test';
import path from 'path';

test('demo fixture renders capture subtree', async ({ page }) => {
  const filePath = path.resolve('src/tests/fixtures/demo.html');
  await page.goto(`file://${filePath}`);
  await expect(page.locator('#capture img')).toHaveCount(2);
  await expect(page.locator('#capture video')).toHaveCount(1);
});
