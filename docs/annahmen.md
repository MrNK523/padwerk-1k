# Offene Annahmen

Verhalten, das in den Quellen (MPC1000 v2 Operator's Manual, JJ OS2XL Manual) nicht oder widersprüchlich beschrieben ist. Jede Annahme ist im Code mit ihrer Nummer markiert.

| Nr. | Annahme | Grund | Status |
| --- | --- | --- | --- |
| A-01 | Swing-Bereich 50–75 % | in keinem Handbuch genannt, nur Standardwert 50 % belegt | offen (M2) |
| A-02 | Swing-Formel: 2. Rasterschritt liegt bei 2 · Raster · Swing % | Handbuch: „even numbered events … off the rhythm“, ohne Formel | offen (M2) |
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
