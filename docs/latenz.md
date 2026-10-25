# Latenz

## Was die App misst
- **Basis** = `AudioContext.baseLatency` (Verarbeitung im Browser).
- **Ausgabe** = `AudioContext.outputLatency` (Treiber/Hardware; nicht jeder Browser liefert den Wert).
- **Block** = 128 Frames – so lange wartet ein Pad-Anschlag höchstens, bis das Worklet ihn spielt.
- **Round-Trip** (F1 MESSEN im Diagnose-Screen): Klick ausgeben, über das Mikrofon wieder aufnehmen, Versatz zählen. Enthält Ausgabe + Eingabe + Schallweg; die reine Pad-zu-Ton-Latenz ist kleiner.

Was nicht messbar ist: die Zeit vom Finger auf dem Glas bis zum Pointer-Event (Touch-Digitizer). Sie liegt je nach Gerät typischerweise im Bereich weniger bis gut zehn Millisekunden.

## Messwerte

| Gerät | Browser | Samplerate | Basis ms | Ausgabe ms | Round-Trip ms | Datum |
| --- | --- | --- | --- | --- | --- | --- |
| Headless-Chromium (CI, virtuelles Audio) | Chromium 1.63-Build | 44,1 kHz | 10,0 | 32,0 | – | 2026-10-25 |
| Surface | Edge/Chrome | | | | | offen |
| MacBook Pro 16 | Chrome / Safari | | | | | offen |
| iPhone | Safari | | | | | offen |

Die CI-Werte stammen aus einer virtuellen Audioumgebung und sagen nichts über echte Geräte aus.
