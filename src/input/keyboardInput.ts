import type { HwBus } from './events';
import { KEYBOARD_PAD_VELOCITY, keyTarget } from './keyboard';

/** Verbindet die Computertastatur mit dem Hardware-Bus. Gibt eine Abmeldefunktion zurück. */
export function attachKeyboard(target: Window, bus: HwBus, onAnyKey?: () => void): () => void {
  const down = new Set<string>();
  const isTyping = (ev: KeyboardEvent) => {
    const t = ev.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };

  const onDown = (ev: KeyboardEvent) => {
    if (isTyping(ev) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const t = keyTarget(ev.code);
    if (!t) return;
    ev.preventDefault();
    onAnyKey?.();
    if (t.kind === 'wheel') { bus.emit({ kind: 'wheel', delta: t.delta, source: 'keyboard' }); return; }
    if (ev.repeat || down.has(ev.code)) return;
    down.add(ev.code);
    if (t.kind === 'pad') bus.emit({ kind: 'pad', pad: t.pad, down: true, velocity: KEYBOARD_PAD_VELOCITY, source: 'keyboard' });
    else bus.emit({ kind: 'button', id: t.id, down: true, source: 'keyboard' });
  };

  const onUp = (ev: KeyboardEvent) => {
    if (!down.delete(ev.code)) return;
    const t = keyTarget(ev.code);
    if (!t || t.kind === 'wheel') return;
    ev.preventDefault();
    if (t.kind === 'pad') bus.emit({ kind: 'pad', pad: t.pad, down: false, velocity: 0, source: 'keyboard' });
    else bus.emit({ kind: 'button', id: t.id, down: false, source: 'keyboard' });
  };

  // Fenster verliert Fokus → alle gehaltenen Tasten loslassen (sonst „klebt“ SHIFT)
  const onBlur = () => {
    for (const code of [...down]) onUp(new KeyboardEvent('keyup', { code }));
  };

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);
  return () => {
    target.removeEventListener('keydown', onDown);
    target.removeEventListener('keyup', onUp);
    target.removeEventListener('blur', onBlur);
  };
}
