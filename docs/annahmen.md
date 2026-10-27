# Offene Annahmen

Verhalten, das in den Quellen (MPC1000 v2 Operator's Manual, JJ OS2XL Manual) nicht oder widersprüchlich beschrieben ist. Jede Annahme ist im Code mit ihrer Nummer markiert.

| Nr. | Annahme | Grund | Status |
| --- | --- | --- | --- |
| A-01 | Swing-Bereich 50–75 % | in keinem Handbuch genannt, nur Standardwert 50 % belegt | umgesetzt (M2) |
| A-02 | Swing-Formel: jeder 2. Rasterschritt liegt bei 2 · Raster · Swing %; bei Triolen-Rastern kein Swing | Handbuch: „even numbered events … off the rhythm“, ohne Formel | umgesetzt (M2) |
| A-03 | MODE + PAD11 = Looping Recorder | JJOS2XL-Handbuch nennt PAD11 auch für Global Program Edit | offen |
| A-04 | Hüllkurven 0–100 → Zeit quadratisch: Attack bis 3 s, Decay/Release bis 5 s; Attack linear, Decay/Release exponentiell | keine Zeitangaben im Handbuch | umgesetzt (M1) |
| A-05 | Voice-Stealing: älteste Stimme zuerst | nicht dokumentiert | umgesetzt (M0) |
| A-06 | Pad-Gefühl / Empfindlichkeitskurve (JJ-Standard 23) | ohne Gerät nicht messbar | offen |
| A-07 | Velocity aus Tap-Position: oben 127, unten 16, linear | Touchscreens liefern keinen Anschlagdruck | umgesetzt (M0) |
| A-08 | 16 Levels: VELOCITY/LAYER in 16 Stufen 8…127; FILTER/ATTACK/DECAY 0…100 gleichmäßig; TUNE ±1 Halbton je Pad ab Original-Pad | Stufenwerte nicht dokumentiert | umgesetzt (M1) |
| A-09 | Filter: Cutoff 0–100 → 20 Hz…20 kHz exponentiell; Resonanz 0–100 → Güte 0,7…14,7; EQL/EQH ±12 dB bei 250 Hz / 5 kHz | Einheiten nicht dokumentiert | umgesetzt (M1) |
| A-10 | Bis zu 128 Programs | kein Limit dokumentiert | umgesetzt (M1) |
| A-11 | Pegel 0–100 wirkt linear auf die Amplitude | nicht dokumentiert | umgesetzt (M1) |
| A-12 | ONE SHOT mit Release > 0: Ausblenden beginnt so, dass es mit dem Sample-Ende endet | JJOS2XL-Grafik zeigt nur das Prinzip | umgesetzt (M1) |
| A-13 | Velocity-Bereich je Layer 0–127 (Standard: voller Bereich) | Akai-Handbuch zeigt Bereiche, JJOS2XL nur die Spalte | umgesetzt (M1) |
| A-14 | Echtzeit-Löschen nur mit ERASE + Pad (nicht ERASE allein) | Handbuch beschreibt nur ERASE + Pad | umgesetzt (M2) |
| A-15 | Standard-Tempo neuer Sequenzen 120,0 BPM | nicht genannt | umgesetzt (M2) |
| A-16 | Anschläge in der letzten Rasterweite des Count-ins landen auf dem Aufnahmestart | nicht dokumentiert | umgesetzt (M2) |
| A-17 | Note Repeat im Stillstand läuft frei im Tempo, erster Schlag sofort; bei laufendem Sequencer auf dem nächsten Rasterschritt | nicht dokumentiert | umgesetzt (M2) |
| A-18 | Ende einer Sequenz ohne Loop: Stopp, Position zurück an den Anfang | nicht dokumentiert | umgesetzt (M2) |
| A-19 | Aufgenommene Note-Repeat-Noten dauern ein halbes Raster | nicht dokumentiert | umgesetzt (M2) |
| A-20 | Tap Tempo: mindestens 2, höchstens 4 Taps innerhalb von 2 s | Handbuch: Durchschnitt von 4 Taps | umgesetzt (M2) |
| A-21 | Taktbalken unter der Position zeigt den Fortschritt im Loop | eigene Anzeige | umgesetzt (M2) |
| A-22 | Auto Slice: Recovery time 10–100 = Mindestabstand in ms; Threshold 0–100 = −60…0 dB relativ zur lautesten Stelle, Hysterese bei halber Schwelle, Schnitt 1 ms vor dem Anschlag; Startwerte 30 / 50 | Handbuch nennt nur Bereiche | umgesetzt (M3) |
| A-23 | Crossfade-Loop blendet über 100 ms (weniger, wenn vor dem Loop-Punkt nicht genug Material liegt); Loops bis 100 ms laufen wie FWD | Handbuch: „100mSEC or less cannot carry out cross fade“, Blendlänge nicht genannt | umgesetzt (M3) |
| A-24 | REV (Program-Layer) spielt den Bereich Start–Ende bzw. den Chop rückwärts, ohne Loop | nicht dokumentiert | umgesetzt (M3) |
| A-25 | Vorhören im TRIM-Modus mit voller Lautstärke unabhängig von VELO, Velocity des Pads zählt | nicht dokumentiert | umgesetzt (M3) |
| A-26 | Non-Destructive Chop: F4 REVERS, F5 SLICE (Wheel 2–32, F4 AUTO, F6 DO IT, F5 ABBR.), F6 NEW PGM; Edit-Funktionen über SHIFT + F1–F6 | Handbuch nennt die Tasten, aber nicht durchgehend die Seite | umgesetzt (M3) |
| A-27 | SHIFT + F1–F6 im TRIM: DELETE, SILENCE, NORMALIZE, REVERSE, FADE IN, FADE OUT (öffnet das Edit-Fenster mit dieser Funktion) | JJOS2XL: „only 6 fixed functions“, welche genau ist nicht belegt | umgesetzt (M3) |
| A-28 | Pads 13–16: PAD13 Loop (Loop-Punkt–Ende, gehalten), PAD14 PLAY TO (Anfang bis Cursor-Punkt), PAD15 PLAY FROM (Cursor-Punkt bis Ende), PAD16 ganzes Sample | MPC1000-Handbuch S. 54/65, „Cursor-Punkt“ übertragen | umgesetzt (M3) |
| A-29 | Pads 9–12: 200 ms vor dem Start, 200 ms ab Start, 200 ms vor dem Ende, 200 ms ab Ende; SHIFT + Pad im Chop-Modus: letzte 200 ms des Chops | JJOS2XL zeigt Abbildung, Längen geschätzt (200 ms für SHIFT + Pad belegt) | umgesetzt (M3) |
| A-30 | Destruktives Schneiden (F5 CHOP) beginnt mit 4 gleichen Regionen zwischen Start und Ende; Regionen gelten bis zum Wechsel des Samples und werden nicht gespeichert | nicht dokumentiert | umgesetzt (M3) |
| A-31 | Nach DELETE umfassen Start/Ende wieder das ganze Sample; bei DISCARD/INSERT SILENCE wandern Start/Ende/Loop/Chops mit | nicht dokumentiert | umgesetzt (M3) |
| A-32 | Grid Edit: Ein Event liegt „unter dem Marker“, wenn es im Fenster [Marker, Marker + 24 Ticks) beginnt; COPY/DELETE ohne Bewegung betreffen genau dieses Event | nicht dokumentiert | umgesetzt (M4) |
| A-33 | Grid Edit: ◀ ▶ und STEP bewegen den senkrechten Marker um einen T.C.-Schritt; oberste Zeile = Pad 1 der Bank | nicht dokumentiert | umgesetzt (M4) |
| A-34 | Loop Edit: neue Schritte mit der Anschlagstärke des Pads, Dauer = TC VALUE % einer 1/16 | JJOS2XL nennt sieben Velocity-Stufen ohne Werte | umgesetzt (M4) |
| A-35 | Step Edit F5 INSERT legt sofort eine Note des zuletzt gewählten Pads an (Velocity 100, Dauer nach T.C.) – ohne Insert-Fenster, da es nur Pad-Events gibt | Handbuch: Insert-Fenster mit Event-Typ | umgesetzt (M4) |
| A-36 | NUMERIC beim Tempo: letzte Ziffer ist die Zehntelstelle (1 0 0 5 → 100,5) | Handbuch nennt Tempo nicht | umgesetzt (M4) |
| A-37 | PASTE (Step und Grid) behält die Pads und verschiebt nur die Zeit: Anfang der Auswahl → Position | nicht dokumentiert | umgesetzt (M4) |
| A-38 | Step-Aufnahme: Standard „Auto step increment YES“, „Duration TC VALUE 100 %“; Schritt = T.C.-Wert (bei OFF 1/16) | Handbuch nennt keine Startwerte | umgesetzt (M4) |
