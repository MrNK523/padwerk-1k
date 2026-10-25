import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
const get = <T>(page: Page, fn: (h: any) => T) => page.evaluate(`(${fn.toString()})(window.__padwerk)`) as Promise<T>;
const btn = (page: Page, id: string) => page.locator(`[data-btn="${id}"]`).first();
const pad = (page: Page, n: number) => page.locator(`.pad[data-pad="${n}"]`);
async function wheel(page: Page, steps: number) {
  for (let i = 0; i < Math.abs(steps); i++) await page.keyboard.press(steps > 0 ? 'PageUp' : 'PageDown');
}
const trim = (page: Page) => get(page, (h) => {
  const t = h.app.screens.trim;
  const m = t.meta;
  return { cursor: t.cursor as string, page: t.page as string, chopNo: t.chopNo as number, region: t.region as number,
    name: m?.name as string, frames: m?.frames as number, start: m?.start as number, end: m?.end as number,
    loopOn: m?.loopOn as boolean, chopOn: m?.chopOn as boolean, chops: (m?.chops.length ?? 0) as number,
    cuts: t.cuts().length - 1 as number };
});

async function startTrim(page: Page, selectPad = 2) {
  await page.goto('/');
  await page.locator('#unlock').click();
  await expect.poll(() => get(page, (h) => h.store.state.samples.length)).toBe(16);
  await pad(page, selectPad).click(); // Pad wählen
  await btn(page, 'MODE').click();
  await pad(page, 5).click(); // PAD 6 = TRIM
  expect(await get(page, (h) => h.app.screenId)).toBe('trim');
}

test('TRIM zeigt das Sample des gewählten Pads; Wheel verschiebt den Startpunkt', async ({ page }) => {
  await startTrim(page, 6); // A07 = offene HiHat, klingt lange genug zum Prüfen
  const t0 = await trim(page);
  expect(t0.name).toBe(await get(page, (h) => h.store.sample(h.store.currentProgram.pads[6].layers[0].sampleId).name));
  await btn(page, 'CURSOR_DOWN').click(); // → St
  expect((await trim(page)).cursor).toBe('st');
  await wheel(page, 3);
  expect((await trim(page)).start).toBeGreaterThan(0);
  await page.screenshot({ path: `test-results/m3-trim-${test.info().project.name}.png` });
  // PAD 5 = ONE SHOT vom Start- bis Endpunkt
  await pad(page, 4).click();
  await expect.poll(() => get(page, (h) => h.app.activeVoices)).toBeGreaterThan(0);
  // Programm-Pad wurde nicht verändert
  expect(await get(page, (h) => h.store.currentProgram.pads[6].layers[0].chop)).toBe(0);
});

test('Loop ein, Felder Lp/Schloss erscheinen, Fine-Fenster öffnet', async ({ page }) => {
  await startTrim(page);
  await btn(page, 'F4').click();
  expect((await trim(page)).loopOn).toBe(true);
  expect(await get(page, (h) => h.app.screens.trim.fields())).toContain('lp');
  await btn(page, 'CURSOR_DOWN').click();
  await btn(page, 'WINDOW').click();
  expect(await get(page, (h) => h.app.screenId)).toBe('fine');
  await btn(page, 'F3').click(); // Nulldurchgang rechts
  await page.screenshot({ path: `test-results/m3-fine-${test.info().project.name}.png` });
  await btn(page, 'F4').click();
  expect(await get(page, (h) => h.app.screenId)).toBe('trim');
});

test('Non-Destructive Chop: 32 Chops, Pad wählt Chop, neues Program', async ({ page }) => {
  await startTrim(page);
  await btn(page, 'CURSOR_RIGHT').click(); // → Chop
  expect((await trim(page)).cursor).toBe('chop');
  await wheel(page, 1);
  const t = await trim(page);
  expect(t.chopOn).toBe(true);
  expect(t.chops).toBe(32);
  await btn(page, 'CURSOR_RIGHT').click(); // → Chop-Nummer
  await btn(page, 'CURSOR_RIGHT').click(); // → St (Pads wählen jetzt Chops)
  await pad(page, 5).click(); // A06 → Chop 6
  expect((await trim(page)).chopNo).toBe(6);
  await page.screenshot({ path: `test-results/m3-chop-${test.info().project.name}.png` });
  // SLICE 16 und übernehmen
  await btn(page, 'F5').click();
  await btn(page, 'F6').click();
  expect((await trim(page)).chops).toBe(16);
  // NEW PGM
  await btn(page, 'F6').click();
  await btn(page, 'F5').click();
  const layers = await get(page, (h) => h.store.currentProgram.pads.slice(0, 17).map((p: any) => p.layers[0].chop));
  expect(layers.slice(0, 3)).toEqual([1, 2, 3]);
  expect(layers[16]).toBe(0);
});

test('Edit: DISCARD kürzt, SILENCE → Keep or Retry → KEEP legt ein neues Sample an', async ({ page }) => {
  await startTrim(page);
  await btn(page, 'CURSOR_DOWN').click(); // St
  await wheel(page, 5);
  const before = await trim(page);
  await btn(page, 'F6').click();
  expect(await get(page, (h) => h.app.screenId)).toBe('sample-edit');
  await btn(page, 'F5').click(); // DISCARD
  const after = await trim(page);
  expect(after.frames).toBe(before.end - before.start);
  expect(after.start).toBe(0);
  const count = await get(page, (h) => h.store.state.samples.length);
  await btn(page, 'F6').click();
  await wheel(page, 2); // DISCARD → DELETE → SILENCE
  await btn(page, 'F5').click();
  expect(await get(page, (h) => h.app.screenId)).toBe('keep-retry');
  await page.screenshot({ path: `test-results/m3-keep-${test.info().project.name}.png` });
  await btn(page, 'F5').click(); // KEEP
  expect(await get(page, (h) => h.store.state.samples.length)).toBe(count + 1);
  expect((await trim(page)).name).toMatch(/-1$/);
});

test('CHOP-Regionen: DIVIDE, COMBINE und Extract mit neuem Program', async ({ page }) => {
  await startTrim(page);
  await btn(page, 'F5').click();
  expect((await trim(page)).page).toBe('chop');
  expect((await trim(page)).cuts).toBe(4);
  await btn(page, 'F4').click(); // DIVIDE
  expect((await trim(page)).cuts).toBe(5);
  await btn(page, 'CURSOR_DOWN').click(); // St
  await btn(page, 'CURSOR_RIGHT').click(); // End
  await btn(page, 'F5').click(); // COMBINE rechts
  expect((await trim(page)).cuts).toBe(4);
  await page.screenshot({ path: `test-results/m3-regions-${test.info().project.name}.png` });
  const count = await get(page, (h) => h.store.state.samples.length);
  await btn(page, 'F6').click();
  await btn(page, 'F5').click();
  expect(await get(page, (h) => h.store.state.samples.length)).toBe(count + 4);
  expect(await get(page, (h) => h.store.currentProgram.pads[3].layers[0].sampleId)).not.toBeNull();
});
