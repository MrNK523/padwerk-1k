# Padwerk 1K – Arbeitsregeln

- Sprache: Code-Kommentare, Doku und UI-Texte auf Deutsch; Bezeichner auf Englisch.
- Recht: keine Marken („Akai“, „MPC“, „JJ OS“) in App-Name, UI oder Assets. Kein fremder Code, keine Firmware, Samples, Grafiken oder Fonts. Verhalten nachbauen ist erlaubt, Gestaltung bleibt eigen. Im Zweifel nachfragen statt umgehen.
- Verhalten: Referenz ist JJOS2XL, für Grundfunktionen das MPC1000 v2 Operator's Manual. Unbelegtes Verhalten → Eintrag in `docs/annahmen.md` (A-xx) und Kommentar im Code. Bewusste Unterschiede → `docs/abweichungen.md` (D-xx).
- Architektur: Eingabe → Hardware-Ereignisse → Screens → Store → Engine. Screens kennen nur `HwEvent`. Sequencer und DSP bleiben rein (ohne Browser-API) und unit-getestet.
- Timing: niemals `setTimeout` für musikalisches Timing; Scheduling nur im AudioWorklet, 96 PPQ.
- Vor jedem Commit: `npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e`.
