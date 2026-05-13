# Nemesis Videos AI

Nemesis Videos AI hilft dir, **KI-Videos**, Visuals und cineastische Inhalte zu erzeugen — mit **Next.js**-Oberfläche und Anbindung an **ComfyUI**.

Der lauffähige Code liegt im Ordner **`web/`**.

## Schnellstart (lokal)

1. Ordner `web` öffnen  
2. **`APP STARTEN.bat`** ausführen (Windows) oder: `cd web && npm install && npm run dev`  
3. Browser: **http://localhost:3040**

## Server (DigitalOcean)

Anleitung und Automatik-Skripte: **[`web/deploy/README.md`](web/deploy/README.md)**

## Repository

- **App-Code:** `web/` (Next.js 16, React 19)  
- **Domain:** z. B. `nemesis-video-ai.ch` + optional `comfy.nemesis-video-ai.ch` (siehe Deploy-README)

## Was nicht im Repo liegt

- Lokale **KI-Modelle** unter `/models/` (Projektroot)  
- **Keystore**, `key.properties`, `backup.txt` mit Zugangsdaten  
- `web/android/dist/` (Build-Artefakte)

## Lizenz

Private Nutzung / wie vom Eigentümer festgelegt.
