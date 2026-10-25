import { expect, test, type Page } from '@playwright/test';

interface TestHandle {
  engine: { running: boolean };
  state: { audio: string; lastPad: string; lastVelocity: number | null; bank: number; fullLevel: boolean; lastButton: string; wheel: number };
}

const handle = (page: Page) => page.evaluate(() => {
  const h = (window as unknown as { __padwerk: TestHandle }).__padwerk;
  return { running: h.engine.running, ...h.state };
});

test('Audio startet nach erster Berührung, Pad spielt mit Velocity aus Tap-Position', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('#unlock')).toBeVisible();
  await page.locator('#unlock').click();
  await expect.poll(async () => (await handle(page)).running).toBe(true);
  await expect(page.locator('#unlock')).toBeHidden();

  const pad1 = page.locator('.pad[data-pad="0"]');
  const box = (await pad1.boundingBox())!;
  // oben antippen = laut
  await page.mouse.click(box.x + box.width / 2, box.y + 2);
  let s = await handle(page);
  expect(s.lastPad).toBe('A01');
  expect(s.lastVelocity).toBeGreaterThan(120);
  // unten antippen = leise
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 2);
  s = await handle(page);
  expect(s.lastVelocity).toBeLessThan(25);

  // Bank wechseln, Full Level
  await page.locator('[data-btn="BANK_C"]').click();
  await page.locator('[data-btn="FULL_LEVEL"]').click();
  await page.locator('.pad[data-pad="15"]').click();
  s = await handle(page);
  expect(s.lastPad).toBe('C16');
  expect(s.lastVelocity).toBe(127);
  await expect(page.locator('[data-btn="BANK_C"]')).toHaveClass(/lit/);

  await page.screenshot({ path: `test-results/m0-${info.project.name}.png`, fullPage: true });
});

test('Tastatur: Pads, Funktionstasten, Wheel', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'Tastatur nur auf dem Desktop');
  await page.goto('/');
  await page.keyboard.press('KeyQ'); // Pad 9 → startet auch Audio
  await expect.poll(async () => (await handle(page)).running).toBe(true);
  await page.keyboard.press('KeyQ');
  expect((await handle(page)).lastPad).toBe('A09');
  await page.keyboard.press('KeyJ');
  await page.keyboard.press('Digit4');
  expect((await handle(page)).lastPad).toBe('C16');
  await page.keyboard.press('PageUp');
  await page.keyboard.press('PageUp');
  expect((await handle(page)).wheel).toBe(2);
});

test('SHIFT rastet per Doppeltipp ein und löst per Tipp', async ({ page }) => {
  await page.goto('/');
  await page.locator('#unlock').click();
  const shift = page.locator('[data-btn="SHIFT"]');
  await shift.click();
  await shift.click();
  await expect(shift).toHaveClass(/latched/);
  await shift.click();
  await expect(shift).not.toHaveClass(/latched/);
  await expect(shift).not.toHaveClass(/down/);
});

test('Display zeigt den Diagnose-Screen', async ({ page }) => {
  await page.goto('/');
  await page.locator('#unlock').click();
  // Titelzeile: invertiert → oberste Pixelreihe ist überwiegend „an“
  const onRatio = await page.evaluate(() => {
    const fb = (window as unknown as { __padwerk: { fb: { get(x: number, y: number): number } } }).__padwerk.fb;
    let on = 0;
    for (let x = 0; x < 240; x++) on += fb.get(x, 7);
    return on / 240;
  });
  expect(onRatio).toBeGreaterThan(0.9);
});
