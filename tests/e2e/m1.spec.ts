import { expect, test, type Page } from '@playwright/test';

interface Handle {
  app: { screenId: string; activeVoices: number; ui: { selectedPad: number; lastVelocity: number | null; levels16On: boolean } };
  store: {
    state: { samples: { name: string }[] };
    currentProgram: { pads: { mixLevel: number; layers: { sampleId: string | null; level: number }[] }[] };
    sample(id: string | null): { name: string } | undefined;
  };
}

const get = <T>(page: Page, fn: (h: Handle) => T) =>
  page.evaluate(`(${fn.toString()})(window.__padwerk)`) as Promise<T>;

async function start(page: Page) {
  await page.goto('/');
  await page.locator('#unlock').click();
  await expect.poll(() => get(page, (h) => h.store.state.samples.length)).toBe(16);
}

const btn = (page: Page, id: string) => page.locator(`[data-btn="${id}"]`).first();
const pad = (page: Page, n: number) => page.locator(`.pad[data-pad="${n}"]`);

/** Wheel über Tastatur (Bild ↑/↓) – funktioniert auf Desktop und Telefon-Emulation gleich. */
async function wheel(page: Page, steps: number) {
  for (let i = 0; i < Math.abs(steps); i++) await page.keyboard.press(steps > 0 ? 'PageUp' : 'PageDown');
}

test('Start-Kit liegt auf Bank A und erklingt', async ({ page }) => {
  await start(page);
  const name = await get(page, (h) => h.store.sample(h.store.currentProgram.pads[0]!.layers[0]!.sampleId)?.name);
  expect(name).toBe('PW Kick Rund');
  await pad(page, 6).click(); // offene HiHat, klingt lange
  await expect.poll(() => get(page, (h) => h.app.activeVoices)).toBeGreaterThan(0);
});

test('MODE + Pad 7 öffnet PROGRAM, Wheel ändert den Pegel des gewählten Pads', async ({ page }) => {
  await start(page);
  await pad(page, 2).click(); // A03 wählen
  await btn(page, 'MODE').click();
  expect(await get(page, (h) => h.app.screenId)).toBe('mode-select');
  await pad(page, 6).click(); // Pad 7 = PROGRAM
  expect(await get(page, (h) => h.app.screenId)).toBe('program');
  expect(await get(page, (h) => h.app.ui.selectedPad)).toBe(2);
  // Cursor auf LEV (PAD → SAMPLE → CH → SND → DIR → LEV)
  for (let i = 0; i < 4; i++) await btn(page, 'CURSOR_RIGHT').click();
  await wheel(page, -5);
  expect(await get(page, (h) => h.store.currentProgram.pads[2]!.layers[0]!.level)).toBe(95);
  // OUT-Seite, Mixer-Pegel
  await btn(page, 'F6').click(); // Spalte bleibt erhalten (hier: Spalte 5 = FX)
  for (let i = 0; i < 3; i++) await btn(page, 'CURSOR_LEFT').click(); // → LEV
  await wheel(page, -2);
  expect(await get(page, (h) => h.store.currentProgram.pads[2]!.mixLevel)).toBe(98);
  await page.screenshot({ path: `test-results/m1-program-${test.info().project.name}.png` });
});

test('Sample-Liste: WINDOW auf SAMPLE, Auswahl übernehmen', async ({ page }) => {
  await start(page);
  await btn(page, 'MODE').click();
  await pad(page, 6).click();
  await btn(page, 'WINDOW').click(); // Cursor steht anfangs in der SAMPLE-Spalte
  expect(await get(page, (h) => h.app.screenId)).toBe('sample-list');
  await page.screenshot({ path: `test-results/m1-samplelist-${test.info().project.name}.png` });
  await wheel(page, 1);
  await btn(page, 'F4').click();
  expect(await get(page, (h) => h.app.screenId)).toBe('program');
  const name = await get(page, (h) => h.store.sample(h.store.currentProgram.pads[0]!.layers[0]!.sampleId)?.name);
  expect(name).toBeTruthy();
  expect(name).not.toBe('PW Kick Rund');
});

test('WAV laden und per „Auf Pad legen“ zuweisen', async ({ page }) => {
  await start(page);
  await btn(page, 'MODE').click();
  await pad(page, 1).click(); // Pad 2 = LADEN
  expect(await get(page, (h) => h.app.screenId)).toBe('load');
  // kleines 16-Bit-WAV erzeugen
  const wav = (() => {
    const n = 4410, buf = Buffer.alloc(44 + n * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(44100, 24); buf.writeUInt32LE(88200, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 10) * 12000), 44 + i * 2);
    return buf;
  })();
  const chooser = page.waitForEvent('filechooser');
  await btn(page, 'F6').click();
  await (await chooser).setFiles({ name: 'Mein Test.wav', mimeType: 'audio/wav', buffer: wav });
  await expect.poll(() => get(page, (h) => h.app.screenId)).toBe('assign-pad');
  await btn(page, 'BANK_B').click();
  await pad(page, 0).click(); // B01
  await btn(page, 'F5').click();
  const assigned = await get(page, (h) => h.store.sample(h.store.currentProgram.pads[16]!.layers[0]!.sampleId)?.name);
  expect(assigned).toBe('Mein Test');
});

test('16 Levels: Velocity-Stufen über alle Pads', async ({ page }) => {
  await start(page);
  await pad(page, 2).click(); // Quelle A03
  await btn(page, 'LEVELS_16').click();
  expect(await get(page, (h) => h.app.screenId)).toBe('levels16');
  await btn(page, 'F5').click();
  expect(await get(page, (h) => h.app.ui.levels16On)).toBe(true);
  await pad(page, 15).click();
  expect(await get(page, (h) => h.app.ui.lastVelocity)).toBe(127);
  await pad(page, 0).click();
  expect(await get(page, (h) => h.app.ui.lastVelocity)).toBe(8);
  await expect(btn(page, 'LEVELS_16')).toHaveClass(/lit/);
  await btn(page, 'LEVELS_16').click();
  expect(await get(page, (h) => h.app.ui.levels16On)).toBe(false);
});
