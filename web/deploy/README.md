# Nemesis Videos AI auf DigitalOcean (nemesis-video-ai.ch)

## Fertig einrichten (empfohlen): ein Script

Auf dem **Ubuntu-Droplet** (22.04 oder 24.04):

1. **DNS** — `@`, `www`, `comfy` als **A-Record** auf die Droplet-IP (siehe unten).
2. **Projekt hochladen** — Ordner **`web`** des Repos nach z.B.  
   `/var/www/nemesis-video-ai/web` kopieren  
   (SCP, rsync, Git clone — wie du willst).
3. **Ein Befehl** (Domain und E-Mail anpassen):

```bash
cd /var/www/nemesis-video-ai/web
sudo chmod +x deploy/bootstrap-droplet.sh deploy/install-comfyui-do.sh
sudo DOMAIN=nemesis-video-ai.ch CERTBOT_EMAIL=deine@email.ch bash deploy/bootstrap-droplet.sh
```

Das Script:

- legt bei wenig RAM automatisch **2 GB Swap** an (wichtig für **2 GB**-Droplets),
- installiert **Node 22**, **Nginx**, **Certbot**,
- baut die App (`npm ci` + `npm run build`),
- richtet **systemd** `nemesis-video-ai` ein (Port **3040**, User **www-data**),
- stellt **Nginx** auf **HTTP** ein und holt mit **certbot** **HTTPS** inkl. Weiterleitung,
- installiert **ComfyUI** nur, wenn du **`INSTALL_COMFY=1`** setzt (unter 2 GB RAM riskant).

Ohne E-Mail (nur HTTP testen):

```bash
sudo DOMAIN=nemesis-video-ai.ch bash deploy/bootstrap-droplet.sh
```

Später TLS nachziehen:

```bash
sudo DOMAIN=nemesis-video-ai.ch CERTBOT_EMAIL=deine@email.ch bash deploy/bootstrap-droplet.sh
```

**Logs:** `sudo journalctl -u nemesis-video-ai -f`  
**Status:** `sudo systemctl status nemesis-video-ai`

---

## Droplet-Größe (2 GB RAM)

| Setup | Einschätzung |
|--------|----------------|
| **Nginx + Next.js (dieses Script)** | Mit **2 GB RAM + Swap** für den **Betrieb der Website** oft noch machbar — keine Garantie bei Last-Spitzen. |
| **Zusätzlich ComfyUI auf demselben 2 GB** | **Nicht empfohlen** — eher **OOM** oder extrem langsam. Comfy besser auf **anderem Server/GPU** oder größerem Droplet. |
| **Echtes KI-Video** | Braucht typischerweise **GPU + viel VRAM**, nicht dieses Kleinst-Droplet. |

Die HTTP-only-Vorlage: `deploy/nginx-nemesis-video-ai.http-only.conf`  
Nach Certbot pflegt certbot die HTTPS-Serverblöcke in dieselbe Site ein.

---

## 1. DNS bei deinem Domain-Anbieter

| Name | Typ | Ziel |
|------|-----|------|
| `@` | A | Droplet-IP |
| `www` | A | Droplet-IP |
| `comfy` | A | Droplet-IP |

Erreichbar:

- **`https://nemesis-video-ai.ch`** → Nemesis Videos AI (Next.js)
- **`https://comfy.nemesis-video-ai.ch`** → ComfyUI (wenn installiert und Dienst läuft)

Die Web-App nutzt automatisch **`wss://comfy.<deine-domain>`** für WebSockets (siehe `src/lib/comfy/config.ts`). HTTP-Anfragen an Comfy gehen weiter über **`/api/comfy/…`** auf derselben Origin (`nemesis-video-ai.ch`) zum serverinternen `COMFY_URL`.

---

## 2. Firewall

Öffnen: **22** (SSH), **80**, **443**.  
**8188** und **3040** nicht öffentlich öffnen — nur **localhost**, Nginx nach außen.

---

## ComfyUI nur wenn Platz ist

Manuell (ohne Bootstrap-Ende):

```bash
sudo bash deploy/install-comfyui-do.sh
```

ComfyUI nur über Bootstrap mitinstallieren:

```bash
sudo DOMAIN=nemesis-video-ai.ch CERTBOT_EMAIL=deine@email.ch INSTALL_COMFY=1 bash deploy/bootstrap-droplet.sh
```

---

## Manuell (ohne Bootstrap)

Siehe ältere Schritte: `deploy/nginx-nemesis-video-ai.conf` (Referenz mit SSL-Kommentaren), `deploy/env.production.example`, `deploy/nextjs-nemesis.service.example`.

---

## Sicherheit

Öffentliches ComfyUI ist sensibel — VPN, Basic Auth oder eingeschränkte IPs erwägen.

---

## Workflow aus Comfy

ComfyUI: **Save (API Format)** → JSON in die App unter **Workflow** einfügen.
