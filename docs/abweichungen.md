# Abweichungen vom Original

Stellen, an denen Padwerk 1K bewusst oder zwangsläufig anders arbeitet als ein klassischer Pad-Sampler mit JJ OS2XL.

| Nr. | Abweichung | Grund | seit |
| --- | --- | --- | --- |
| D-01 | Velocity aus Tap-Position statt Anschlagdruck; Aftertouch nur über MIDI-Controller | Browser/Touchscreen | M0 |
| D-02 | Kein Sample-RAM-Limit (Original 16 MB, erweiterbar auf 128 MB) | Entscheidung | – |
| D-03 | Engine mit Geräte-Samplerate (meist 48 kHz) statt fest 44,1 kHz; Export 44,1 kHz / 16 Bit | Browser, Latenz | M0 |
| D-04 | Effekte, Time Stretch, Pitch Shift sind Eigenentwicklungen – ähnlicher Charakter, kein identischer Klang | Recht, kein Original-Code | – |
| D-05 | Kein Web MIDI unter Safari/iOS | Browser | – |
| D-06 | Eigenes Start-Kit statt Factory-Sounds; eigenes Projektformat statt .PGM/.SEQ/.SND | Recht | – |
| D-07 | Einzelausgänge 1–4 werden interne Busse für den Stem-Export | keine Hardware-Ausgänge | – |
| D-08 | Diagnose (Latenz, Eingaben) liegt unter OTHER (MODE + PAD 10) | eigene Hilfe | M1 |
| D-09 | Tastatur-Pads spielen mit fester Velocity 100 | keine Anschlagdynamik | M0 |
| D-10 | Zusätzliche Bedienhilfen: Doppeltipp rastet SHIFT, ERASE, TAP, MODE, REC, OVER DUB und UNDO SEQ ein (STOP nicht – dreimal STOP = alle Klänge aus); Wischen auf dem Display = Data Wheel | Touch- und Mausbedienung | M0 |
| D-11 | TUNE: Wheel = 1 Halbton, mit SHIFT 1 Cent (statt getrennter Halbton-/Cent-Felder) | Bedienhilfe | M1 |
| D-12 | Dateien per Drag & Drop laden; Ablegen auf einem Pad weist das Sample direkt zu | Browser statt CF-Karte | M1 |
| D-13 | LADEN liest Audiodateien vom Gerät (Datei-Dialog) statt eines Karten-Dateibrowsers; Projekte laden folgt in M4 | Browser | M1 |
| D-14 | Weicher Begrenzer auf der Summe (ab 0,8 sanft gegen 1) statt hartem Übersteuern | Schutz vor Verzerrung bei vielen Stimmen | M1 |
| D-15 | Samples werden in der Original-Samplerate gespeichert und beim Abspielen umgerechnet (Hermite-Interpolation) | verlustfrei, kein Neuberechnen beim Laden | M1 |
| D-16 | Start-Kit „PW …“ (16 per Code erzeugte Klänge) auf Bank A, HiHats in Mute-Gruppe 1 | Ersatz für Factory-Programs | M1 |
| D-17 | Seiten PITCH und LFO im Program-Modus zeigen bis M9 nur einen Hinweis | Meilensteinplan | M1 |
| D-18 | Tap Tempo zählt nur, wenn während des Haltens kein Pad angeschlagen wurde (NOTE REPEAT und TAP TEMPO teilen sich eine Taste) | verhindert versehentliche Tempoänderung | M2 |
| D-19 | Note Repeat behält die Velocity des ersten Anschlags (kein Druckverlauf) | Touch ohne Druck | M2 |
| D-20 | Tsig im Main-Screen gilt für alle Takte; Taktart je Takt folgt mit dem Change-Tsig-Fenster | Meilensteinplan (M5) | M2 |
| D-21 | FIX (T.C.-Fenster) korrigiert den ganzen aktiven Track; Zeitbereich und Pad-Auswahl folgen | Meilensteinplan (M5) | M2 |
| D-22 | Sequenz wechseln nur im Stillstand; Next Sequence folgt | Meilensteinplan (M5) | M2 |
| D-23 | Keine Latenzkompensation für Live-Aufnahmen: Anschläge landen am Beginn des nächsten Audioblocks (≤ 2,7 ms) plus Eingabeverzögerung des Geräts | Browser | M2 |
| D-24 | Tempo per Wheel in 1er-Schritten, mit SHIFT in 0,1er-Schritten | Bedienhilfe | M2 |
| D-25 | Wheel im TRIM bewegt Punkte um einen Bildpunkt der aktuellen Zoomstufe (mit SHIFT/TAP ×10) statt um einen Sample-Punkt mit Stellenwahl; im Fine-Fenster entsprechend feiner. Zifferneingabe mit NUMERIC folgt | Bedienhilfe; Zifferneingabe in M4 | M3 |
| D-26 | Wellenform zeigt immer den linken Kanal (kein View-Feld L/R); keine LOG-Ansicht, stattdessen Pegel-Zoom mit ▲ ▼ (wie JJOS2XL) | Platz im Display | M3 |
| D-27 | Kein Tune-Feld je Sample (Tonhöhe nur im Program je Layer) | Meilensteinplan (M9 mit PITCH) | M3 |
| D-28 | Kein Q1/Q2-Slider für Start/Ende/Loop (AFTER-Taste) | Meilensteinplan (M5 Q-Link) | M3 |
| D-29 | TIME STRETCH, PATCHED PHRASE und Pitch Shift fehlen im Edit-Fenster | Meilensteinplan (M10) | M3 |
| D-30 | Spielmodus LOOP&HOLD (JJOS2XL) fehlt noch | Meilensteinplan (M5) | M3 |
| D-31 | Namenseingabe nur mit Wheel und Cursor (plus ENTF/EINF); keine Eingabe über Pads/NUMERIC und keine Computertastatur | Bedienhilfe folgt mit M4 | M3 |
| D-32 | „Convert X-fade to Normal loop“ (F5 X to) fehlt; Crossfade-Loops kosten keine zusätzlichen Stimmen | kein Stimmenlimit nötig | M3 |
| D-33 | Sample-Fenster (WINDOW im Sample-Feld) vereint Liste, LÖSCH., NAME und KOPIE; „alle löschen“ fehlt | Bedienhilfe | M3 |
