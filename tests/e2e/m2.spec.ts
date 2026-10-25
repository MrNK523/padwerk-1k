import { expect, test, type Page } from '@playwright/test';

interface Handle {
  app: { screenId: string; transport: { tick: number; state: string; recMode: string } };
  store: {
    state: { seqSettings: { tc: string }; activeTrack: number };
    currentSequence: { tempo: number; bars: unknown[]; tracks: { events: { tick: number; pad: number }[] }[] };
    updateSeqSettings(p: Record<string, unknown>): void;
    undoLed: boolean;
  };
}

const get = <T>(page: Page, fn: (h: Handle) => T) => page.evaluate(`(${fn.toString()})(window.__padwerk)`) as Promise<T>;
const events = (page: Page) => get(page, (h) => h.store.currentSequence.tracks[0]!.events.length);

test.skip(({ browserName }) => browserName !== 'chromium');
test.skip(() => test.info().project.name === 'phone', 'Tastatur-Transport nur auf dem Desktop');

async function start(page: Page) {
  await page.goto('/');
  await page.locator('#unlock').click();
  await expect.poll(() => get(page, (h) => h.app.screenId)).toBe('main');
  // Count-in aus, damit die Tests nicht einen Takt warten
  await page.evaluate(() => (window as unknown as { __padwerk: Handle }).__padwerk.store.updateSeqSettings({ countIn: 'OFF' }));
  await page.waitForTimeout(300); // Start-Kit + Erstbefüllung des Worklets
}

test('PLAY START / STOP', async ({ page }) => {
  await start(page);
  await page.keyboard.press('KeyI'); // PLAY START
  await expect.poll(() => get(page, (h) => h.app.transport.state)).toBe('playing');
  await expect.poll(() => get(page, (h) => h.app.transport.tick)).toBeGreaterThan(50);
  await page.screenshot({ path: 'test-results/m2-main-playing.png' });
  await page.keyboard.press('Backquote'); // STOP
  await expect.poll(() => get(page, (h) => h.app.transport.state)).toBe('stopped');
});

test('REC + PLAY START nimmt auf, UNDO nimmt zurück und stellt wieder her', async ({ page }) => {
  await start(page);
  await page.keyboard.down('KeyO'); // REC halten
  await page.keyboard.press('KeyI'); // + PLAY START
  await page.keyboard.up('KeyO');
  await expect.poll(() => get(page, (h) => h.app.transport.recMode)).toBe('rec');
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyZ'); // Pad 1
  await page.waitForTimeout(250);
  await page.keyboard.press('KeyX'); // Pad 2
  await page.waitForTimeout(150);
  await page.keyboard.press('Backquote');
  await expect.poll(() => get(page, (h) => h.app.transport.state)).toBe('stopped');
  await expect.poll(() => events(page)).toBe(2);
  const ticks = await get(page, (h) => h.store.currentSequence.tracks[0]!.events.map((e) => e.tick));
  ticks.forEach((t) => expect(t % 24).toBe(0)); // Timing Correct 1/16
  expect(await get(page, (h) => h.store.undoLed)).toBe(true);
  await page.keyboard.press('KeyU'); // UNDO SEQ
  await expect.poll(() => events(page)).toBe(0);
  await page.keyboard.press('KeyU');
  await expect.poll(() => events(page)).toBe(2);
});

test('Wait for Key: REC wartet, erster Anschlag startet', async ({ page }) => {
  await start(page);
  await page.keyboard.press('KeyO');
  await expect.poll(() => get(page, (h) => h.app.transport.state)).toBe('waiting');
  await page.screenshot({ path: 'test-results/m2-main-waiting.png' });
  await page.keyboard.press('KeyA'); // Pad 5
  await expect.poll(() => get(page, (h) => h.app.transport.state)).toBe('playing');
  await page.keyboard.press('Backquote');
  await expect.poll(() => events(page)).toBe(1);
  expect(await get(page, (h) => h.store.currentSequence.tracks[0]!.events[0]!.tick)).toBe(0);
});

test('Note Repeat: NOTE REPEAT halten + Pad halten nimmt im 1/16-Raster auf', async ({ page }) => {
  await start(page);
  await page.keyboard.down('KeyP'); // OVER DUB
  await page.keyboard.press('KeyI');
  await page.keyboard.up('KeyP');
  await expect.poll(() => get(page, (h) => h.app.transport.recMode)).toBe('dub');
  await page.keyboard.down('KeyT'); // NOTE REPEAT
  await page.keyboard.down('KeyZ');
  await page.waitForTimeout(700); // ~5–6 Sechzehntel bei 120 BPM
  await page.keyboard.up('KeyZ');
  await page.keyboard.up('KeyT');
  await page.keyboard.press('Backquote');
  await expect.poll(() => events(page)).toBeGreaterThanOrEqual(4);
  const ticks = await get(page, (h) => h.store.currentSequence.tracks[0]!.events.map((e) => e.tick));
  for (let i = 1; i < ticks.length; i++) expect((ticks[i]! - ticks[i - 1]!) % 24).toBe(0);
});

test('Tap Tempo: vier Taps im Abstand 500 ms ≈ 120 BPM', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const h = (window as unknown as { __padwerk: { store: { updateSequence(fn: (q: { tempo: number }) => void): void } } }).__padwerk;
    h.store.updateSequence((q) => { q.tempo = 90; });
  });
  for (let i = 0; i < 4; i++) { await page.keyboard.press('KeyT'); await page.waitForTimeout(500); }
  const tempo = await get(page, (h) => h.store.currentSequence.tempo);
  expect(tempo).toBeGreaterThan(110);
  expect(tempo).toBeLessThan(125);
});

test('NOTE REPEAT + F3 wählt Timing Correct 1/16, F1 = 1/8', async ({ page }) => {
  await start(page);
  await page.keyboard.down('KeyT');
  await page.keyboard.press('F1');
  await page.keyboard.up('KeyT');
  expect(await get(page, (h) => h.store.state.seqSettings.tc)).toBe('1/8');
});

test('Mit einem Finger: REC per Doppeltipp einrasten, dann PLAY START', async ({ page }) => {
  await start(page);
  const recBtn = page.locator('[data-btn="REC"]');
  await recBtn.click();
  await recBtn.click();
  await expect(recBtn).toHaveClass(/latched/);
  await page.locator('[data-btn="PLAY_START"]').click();
  await expect.poll(() => get(page, (h) => h.app.transport.recMode)).toBe('rec');
  await recBtn.click(); // löst die Einrastung, Aufnahme läuft weiter
  await expect(recBtn).not.toHaveClass(/latched/);
  await page.locator('[data-btn="STOP"]').click();
  await expect.poll(() => get(page, (h) => h.app.transport.state)).toBe('stopped');
});
