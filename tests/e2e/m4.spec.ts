import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/* eslint-disable @typescript-eslint/no-explicit-any */
const get = <T>(page: Page, fn: (h: any) => T) => page.evaluate(`(${fn.toString()})(window.__padwerk)`) as Promise<T>;
const btn = (page: Page, id: string) => page.locator(`[data-btn="${id}"]`).first();
const pad = (page: Page, n: number) => page.locator(`.pad[data-pad="${n}"]`);
const events = (page: Page) => get(page, (h) => h.store.activeTrack.events.map((e: any) => [e.tick, e.pad]));

async function start(page: Page) {
  // Dateidialog abschalten → Speichern löst einen normalen Download aus
  await page.addInitScript(() => { (window as any).showSaveFilePicker = undefined; });
  await page.goto('/');
  await page.locator('#unlock').click();
  await expect.poll(() => get(page, (h) => h.store.state.samples.length)).toBe(16);
}
async function mode(page: Page, padIndex: number) {
  await btn(page, 'MODE').click();
  await pad(page, padIndex).click();
}

test('Step Edit: Step-Aufnahme, Auto Step, Löschen, UNDO', async ({ page }) => {
  await start(page);
  await mode(page, 13);
  expect(await get(page, (h) => h.app.screenId)).toBe('step');
  await btn(page, 'OVER_DUB').click();
  expect(await get(page, (h) => h.app.ui.stepRec)).toBe(true);
  await pad(page, 0).click();
  await pad(page, 1).click();
  expect(await events(page)).toEqual([[0, 0], [24, 1]]);
  expect(await get(page, (h) => h.app.transport.tick)).toBe(48);
  await page.screenshot({ path: `test-results/m4-step-${test.info().project.name}.png` });
  await btn(page, 'STOP').click();
  // erstes Event wählen und löschen
  await btn(page, 'BAR_PREV').click();
  await btn(page, 'CURSOR_DOWN').click();
  await btn(page, 'F4').click();
  expect(await events(page)).toEqual([[24, 1]]);
  await btn(page, 'UNDO_SEQ').click();
  expect(await events(page)).toEqual([[0, 0], [24, 1]]);
});

test('Grid Edit: Eingabe am Marker und Loop Edit', async ({ page }) => {
  await start(page);
  await mode(page, 14);
  expect(await get(page, (h) => h.app.screenId)).toBe('grid');
  await btn(page, 'OVER_DUB').click();
  await pad(page, 2).click(); // A03 am Marker 0
  expect(await events(page)).toEqual([[0, 2]]);
  expect(await get(page, (h) => h.app.transport.tick)).toBe(24); // Auto Step
  await get(page, (h) => h.store.updateSequence((q: any) => {
    for (let i = 4; i < 32; i += 3) q.tracks[0].events.push({ tick: i * 24, pad: i % 6, velocity: 100, duration: 20 });
    q.tracks[0].events.sort((a: any, b: any) => a.tick - b.tick);
  }));
  await page.screenshot({ path: `test-results/m4-grid-${test.info().project.name}.png` });
  await btn(page, 'STOP').click();
  await btn(page, 'BAR_PREV').click();
  await btn(page, 'F1').click(); // Loop Edit, Pad-Zeile A03
  expect(await get(page, (h) => h.app.screens.grid.loopEdit?.bar)).toBe(0);
  expect(await get(page, (h) => h.store.currentSequence.loopLast)).toBe(1);
  await pad(page, 4).click(); // Schritt 5 = Tick 96
  await pad(page, 0).click(); // Schritt 1 → vorhandenes Event wird entfernt
  expect((await events(page)).filter((e: number[]) => e[1] === 2 && e[0]! < 384)).toEqual([[96, 2]]);
  await page.screenshot({ path: `test-results/m4-loopedit-${test.info().project.name}.png` });
  await btn(page, 'F1').click();
  expect(await get(page, (h) => h.store.currentSequence.loopLast)).toBeNull();
});

test('NUMERIC: Tempo mit Ziffern eingeben', async ({ page }) => {
  await start(page);
  await btn(page, 'CURSOR_RIGHT').click(); // BPM
  await btn(page, 'NUMERIC').click();
  expect(await get(page, (h) => h.app.screenId)).toBe('numeric');
  for (const p of [0, 9, 9, 4]) await pad(page, p).click(); // 1 0 0 5
  await pad(page, 11).click(); // PAD 12 = Enter
  expect(await get(page, (h) => h.store.currentSequence.tempo)).toBe(100.5);
});

test('Speichern als .padwerk, Laden ersetzt den Speicher', async ({ page }) => {
  await start(page);
  await get(page, (h) => h.store.updateSequence((q: any) => { q.tempo = 133; }));
  await mode(page, 2);
  expect(await get(page, (h) => h.app.screenId)).toBe('save');
  const dl = page.waitForEvent('download');
  await btn(page, 'F6').click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe('Projekt01.padwerk');
  const path = await file.path();
  await get(page, (h) => h.store.updateSequence((q: any) => { q.tempo = 90; }));
  // Laden über den Dateidialog
  await page.locator('input[type=file]').setInputFiles({ name: 'Projekt01.padwerk', mimeType: 'application/octet-stream', buffer: readFileSync(path!) });
  await expect.poll(() => get(page, (h) => h.app.screenId)).toBe('confirm');
  await btn(page, 'F5').click();
  expect(await get(page, (h) => h.store.currentSequence.tempo)).toBe(133);
  expect(await get(page, (h) => h.store.state.samples.length)).toBe(16);
});

test('Namenseingabe mit der Computertastatur', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Tastatur nur am Desktop');
  await start(page);
  await mode(page, 2);
  await btn(page, 'F1').click();
  expect(await get(page, (h) => h.app.screenId)).toBe('name');
  await page.keyboard.type('Beat 7');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('8');
  await page.keyboard.press('Enter');
  expect(await get(page, (h) => h.app.screenId)).toBe('save');
  expect(await get(page, (h) => h.app.screens.save.projectName)).toBe('Beat 8');
});

test('Autosave: Stand übersteht Neuladen', async ({ page }) => {
  await start(page);
  await get(page, (h) => h.store.updateSequence((q: any) => { q.tempo = 111; }));
  await get(page, (h) => h.app.autosave.save());
  await page.reload();
  await page.locator('#unlock').click();
  await expect.poll(() => get(page, (h) => h.store.currentSequence.tempo)).toBe(111);
  expect(await get(page, (h) => h.store.state.samples.length)).toBe(16);
});
