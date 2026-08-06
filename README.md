# Quiznacht Multiplayer

Party-Quiz für Freunde – jede Person spielt auf ihrem eigenen Gerät. Der
Spielstand liegt als JSON-Datei in Google Drive und wird von allen Geräten
per Polling synchron gehalten. Kein eigener Server nötig, nur eine statische
Website (z. B. GitHub Pages).

## Einmalige Einrichtung in der Google Cloud Console

1. Projekt anlegen/auswählen: https://console.cloud.google.com
2. **APIs & Services → Bibliothek** → "Google Drive API" aktivieren
3. **APIs & Services → OAuth-Zustimmungsbildschirm**:
   - Nutzertyp: *Extern*
   - Veröffentlichungsstatus: *Testing* lassen (keine Verifizierung nötig)
   - Scope hinzufügen: `https://www.googleapis.com/auth/drive`
   - Unter "Testnutzer" die Gmail-Adressen aller Mitspieler:innen eintragen
     (bis zu 100 möglich)
4. **APIs & Services → Zugangsdaten → Zugangsdaten erstellen → OAuth-Client-ID**:
   - Anwendungstyp: *Webanwendung*
   - Autorisierte JavaScript-Quellen: deine GitHub-Pages-URL
     (z. B. `https://<dein-github-name>.github.io`) und zum lokalen Testen
     `http://localhost:8000`
   - Client-ID kopieren und in `app.js` bei `CLIENT_ID` eintragen

## Beim ersten Login deiner Freunde

Weil sich die App noch im Testing-Status befindet, zeigt Google beim ersten
Login den Hinweis "Diese App wurde nicht verifiziert". Das ist normal für
private Test-Apps – auf **Erweitert → Weiter zu Quiznacht (unsicher)**
klicken. Nur Konten, die du als Testnutzer eingetragen hast, können sich
überhaupt anmelden.

## Spielablauf

- **Erstellen**: eine Person klickt "Spiel erstellen", meldet sich mit
  Google an, bekommt einen Link zum Teilen.
- **Beitreten**: alle anderen öffnen den Link, melden sich mit ihrem eigenen
  Google-Konto an und tragen ihren Namen ein.
- **Starten**: die Gastgeber:in (Host) startet, sobald mindestens 2 Personen
  beigetreten sind. Danach läuft das Spiel wie das bekannte Ein-Bildschirm-
  Quiz, nur dass jede:r auf dem eigenen Gerät sieht und antwortet, wenn sie
  am Zug ist.

Die Spieldatei landet sichtbar im Google Drive der Gastgeber:in (Name
beginnt mit "Quiznacht – Spiel …") und kann danach gelöscht werden.

## Lokal testen

Kein Build-Schritt nötig – ein beliebiger statischer Server reicht, z. B.:

```
npx serve .
```

oder Pythons `http.server`, falls installiert. Wichtig: `http://localhost:PORT`
muss als autorisierte JavaScript-Quelle in der OAuth-Client-ID eingetragen
sein (Schritt 4 oben).
