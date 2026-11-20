# OcheCam – Darts zählen mit der Handykamera

Web-App (PWA) für das Handy: erkennt Darts über die Kamera, zählt X01 (301/501/701), gibt Checkout-Wege vor und sagt die Würfe an. Alles läuft lokal im Browser – keine Cloud, kein Konto.

## Starten

1. Am PC (gleiches WLAN wie das Handy): `start.bat` doppelklicken oder `python serve.py`
2. Die angezeigte Adresse `https://<PC-IP>:8443` am Handy öffnen.
3. Zertifikatswarnung einmal bestätigen („Erweitert“ → „Weiter zu …“). Das ist das selbst erstellte Zertifikat des PCs – nötig, weil Browser die Kamera nur über https freigeben.
4. Optional: Im Browser-Menü „Zum Startbildschirm hinzufügen“.

## Aufbau

- Handy fest montieren (Stativ/Regal), ca. 1–2 m vom Board, leicht seitlich oder unterhalb, sodass das ganze Board im Bild ist.
- Gleichmäßiges Licht (Ringlicht ideal), keine starken Schatten.
- **Kalibrieren:** Die 4 Punkte auf die äußere Kante des Doppelrings ziehen, mittig in 20, 6, 3 und 11. Das gelbe Gitter muss danach auf dem Board liegen. Wird gespeichert.

## Spielen

- Werfen → die App erkennt jeden Dart, sobald das Bild wieder ruhig ist.
- Nach 3 Darts (oder Bust/Checkout): Darts ziehen → nächster Spieler startet automatisch.
- Falsch erkannt? Dart-Feld unten antippen und korrigieren. Nicht erkannt (Bounce-out, daneben)? „Miss“ oder „Eintippen“.
- Auge-Symbol zeigt, welche Bildbereiche die Erkennung als verändert sieht (gut zum Einstellen der Empfindlichkeit).

## Wie die Erkennung funktioniert

Differenzbild gegenüber einem Referenzbild des Boards → größter veränderter Bereich = neuer Dart → Hauptachse per PCA → schmales Ende = Spitze → über eine Homographie (aus den 4 Kalibrierpunkten) in Board-Millimeter umgerechnet → Feld/Ring bestimmen. Eine Kamera liefert keine Tiefe; Darts direkt auf einem Draht oder stark verdeckte Darts können danebenliegen, deshalb die Korrektur per Antippen.

## Dateien

`index.html` Oberfläche · `app.js` Spielablauf, Kamera, Kalibrierung · `core.js` Board-Geometrie, Checkouts, Bildanalyse · `serve.py` lokaler HTTPS-Server · `sw.js`/`manifest.webmanifest` PWA

## Erkennung – wie sie arbeitet
- **Board-Ausschnitt in voller Auflösung:** Analysiert wird nur der Bereich ums Board, immer gleich fein – auch wenn das Handy weit weg steht und nicht gezoomt ist.
- **Kameramodell:** Aus den 4 Kalibrierpunkten berechnet die App Brennweite und Blickwinkel. Damit weiß sie für jede Stelle, in welche Richtung und wie lang ein steckender Dart im Bild aussehen muss – das bestimmt, welches Ende die Spitze ist, fügt zerfallene Dart-Teile zusammen und lässt frontal gesehene (kurze) Darts zu.
- **Spitzen-Suche:** Von Flight und Schaft aus folgt die App der Dart-Achse mit feinerer Schwelle bis zur Spitze (z. B. silberner Barrel auf hellem Feld).
- **Live-Vorschau:** Gelber Ring „T20?“, sobald ein Dart steckt; nach ca. 0,5 s bestätigt.
- **Lernt aus Korrekturen:** Von Hand eingetippte, übersehene Darts machen die Erkennung empfindlicher bzw. lassen solche Formen zu; auf „Miss“ korrigierte Phantom-Darts machen sie strenger. Zurücksetzen in den Einstellungen.
- **Bildstabilisierung:** Wackeln und Verrutschen des Handys werden bei jedem Bild ausgeglichen.
- **Dart-Zählung:** Werden die Darts gezogen, bevor drei gezählt sind (einer ging ins Aus oder wurde übersehen), zählt die App die fehlenden als „daneben“ (Miss) und gibt an den nächsten Spieler ab – statt den nächsten Wurf dem falschen Spieler zu geben. Ein angestoßener Dart zählt nicht als neuer Dart; ein Bild mit einer Person davor wird nie als Referenz übernommen.
- **Ein Wurf = ein Dart:** Die App zählt die Wurfbewegungen. Eine Bewegung bringt höchstens einen Dart – Flight, Spitze oder Schatten, die getrennt erscheinen, werden nicht doppelt gezählt. Sackt ein steckender Dart nach (an seiner alten Stelle wird das Board wieder sichtbar), zählt das nicht als neuer Dart.
- **Nach einer Korrektur:** Wurde ein Dart von Hand eingetippt oder korrigiert, geht es erst mit „Weiter“ zum nächsten Spieler (auch kein Countdown gegen den Bot).

## Finish-Wege, Ausbullen, Nachkalibrieren
- **Finish-Wege:** Im Finish-Bereich zeigt die Leiste den besten Weg und bis zu zwei Alternativen (z. B. 100: T20 · D20, oder Bull · Bull). Die anderen Spieler sehen ihren Weg auf ihrer Karte. Die Stimme sagt den Weg zu Beginn der Aufnahme und nach jedem Dart den Rest-Weg an.
- **Ausbullen:** Beim Start wirft jeder einen Dart auf Bull, der nächste beginnt. Die Kamera misst den Abstand in Millimetern; zwei Bulls oder gleiches Ergebnis = Stechen. Bots werfen mit. Abschaltbar unter „Wer beginnt“, „Überspringen“ lässt Spieler 1 beginnen.
- **Nachkalibrieren:** Ist das Board leer und ruhig, sucht die App etwa alle 20 s das Board neu und führt die Kalibrierung nach, wenn sie sich zweimal gleich verschoben hat (Feinkorrekturen von Hand bleiben erhalten). Verliert die Bildstabilisierung den Halt (Handy verdreht), wird nichts gezählt, bis das Board wiedergefunden ist. Abschaltbar in den Einstellungen.

## Sprüche
Lob bei Triple 20 und Triple 19, Lästern bei 1, 5 und daneben – aber nur, solange kein Finish möglich ist. Abschaltbar in den Einstellungen.
