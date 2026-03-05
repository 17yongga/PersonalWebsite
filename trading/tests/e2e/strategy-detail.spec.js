const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';

test.describe('Strategy Detail Page', () => {
    test('strategy detail page loads chart', async ({ page }) => {
        await page.goto(`${BASE_URL}/trading`);
        // Find and click a strategy card to open detail view
        const strategyCard = page.locator('.strategy-card').first();
        if (await strategyCard.count() > 0) {
            await strategyCard.locator('.btn').filter({ hasText: /View Details/i }).click();
            const chartMount = page.locator('#strategy-chart-mount');
            await chartMount.waitFor({ timeout: 10000 });
            await expect(chartMount).toBeVisible();
            // Chart should contain a canvas from Lightweight Charts
            const canvas = chartMount.locator('canvas');
            await canvas.first().waitFor({ timeout: 10000 });
            await expect(canvas.first()).toBeVisible();
        }
    });

    test('decision log renders', async ({ page }) => {
        await page.goto(`${BASE_URL}/trading`);
        const strategyCard = page.locator('.strategy-card').first();
        if (await strategyCard.count() > 0) {
            await strategyCard.locator('.btn').filter({ hasText: /View Details/i }).click();
            // Either trade rows or empty state should be present
            const dlRow = page.locator('.dl-row');
            const dlEmpty = page.locator('.dl-empty');
            await page.waitForSelector('.dl-row, .dl-empty', { timeout: 10000 });
            const hasRows = await dlRow.count() > 0;
            const hasEmpty = await dlEmpty.count() > 0;
            expect(hasRows || hasEmpty).toBeTruthy();
        }
    });

    test('timeframe switcher exists', async ({ page }) => {
        await page.goto(`${BASE_URL}/trading`);
        const strategyCard = page.locator('.strategy-card').first();
        if (await strategyCard.count() > 0) {
            await strategyCard.locator('.btn').filter({ hasText: /View Details/i }).click();
            await page.waitForSelector('.chart-timeframe-switcher', { timeout: 10000 });
            const buttons = page.locator('.chart-tf-btn');
            const labels = await buttons.allTextContents();
            expect(labels).toContain('Today');
            expect(labels).toContain('1W');
            expect(labels).toContain('1M');
            expect(labels).toContain('All');
        }
    });
});
