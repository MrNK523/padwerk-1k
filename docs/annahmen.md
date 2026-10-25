# Offene Annahmen

Verhalten, das in den Quellen (MPC1000 v2 Operator's Manual, JJ OS2XL Manual) nicht oder widersprüchlich beschrieben ist. Jede Annahme ist im Code mit ihrer Nummer markiert.

| Nr. | Annahme | Grund | Status |
| --- | --- | --- | --- |
| A-01 | Swing-Bereich 50–75 % | in keinem Handbuch genannt, nur Standardwert 50 % belegt | offen (M2) |
| A-02 | Swing-Formel: 2. Rasterschritt liegt bei 2 · Raster · Swing % | Handbuch: „even numbered events … off the rhythm“, ohne Formel | offen (M2) |
| A-03 | MODE + PAD11 = Looping Recorder | JJOS2XL-Handbuch nennt PAD11 auch für Global Program Edit | offen |
| A-04 | Hüllkurven-Werte 0–100 → Millisekunden (Kurve geschätzt) | keine Zeitangaben im Handbuch | offen (M1) |
| A-05 | Voice-Stealing: älteste Stimme zuerst | nicht dokumentiert | umgesetzt (M0) |
| A-06 | Pad-Gefühl / Empfindlichkeitskurve (JJ-Standard 23) | ohne Gerät nicht messbar | offen |
| A-07 | Velocity aus Tap-Position: oben 127, unten 16, linear | Touchscreens liefern keinen Anschlagdruck | umgesetzt (M0) |
