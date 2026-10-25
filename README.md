# Padwerk 1K

Pad-Sampler und Sequencer im Browser – inspiriert von klassischen Pad-Samplern mit Community-Betriebssystem.
Eigener Name, eigener Code, eigene Gestaltung; keine Marken, Firmware, Samples, Grafiken oder Schriften Dritter.

**Stand: M1 – Pads und Programs.** Architektur und Meilensteinplan: siehe Architektur-Dokument (Claude-Doc „Padwerk 1K – Architektur & Meilensteinplan“).

## Entwickeln

```bash
npm install
npm run dev          # Entwicklungsserver
npm test             # Unit-Tests (Vitest)
npm run build        # Typecheck + Produktions-Build nach dist/
npm run test:e2e     # Browser-Tests (Playwright, Desktop + Telefon)
npm run icons        # App-Icons aus public/icons/icon.svg rendern
```

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `src/core/` | Sequencer, Timing, Datenmodell – ohne Browser (ab M2) |
| `src/dsp/` | Stimmen-Pool, später Filter, Hüllkurven, Chop |
| `src/engine/` | AudioWorklet-Prozessor und Brücke zum Hauptthread |
| `src/state/` | Store, Befehle, Undo, Speicherung (ab M1) |
| `src/ui/display/` | 240×64-Bildspeicher, eigene Pixelschrift, LCD-Renderer |
| `src/ui/screens/` | Modi/Screens |
| `src/ui/panel/` | Pads, Tasten, Data Wheel, Slider |
| `src/input/` | Hardware-Ereignisse, Tastatur, Velocity |
| `docs/` | Abweichungen, Annahmen, Latenz, Tastatur |

## Quellen für das Verhalten
- MPC1000 v2 Operator's Manual rev 1.0
- JJ OS2XL Manual (Stand 25.07.2011)

Nicht dokumentiertes Verhalten steht in `docs/annahmen.md`, bewusste Unterschiede in `docs/abweichungen.md`.
