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
