#!/usr/bin/env bash
#
# Nemesis Videos AI — Droplet einrichten (Ubuntu 22.04/24.04)
# Ausführung auf dem Server im Projektordner web/:
#   sudo DOMAIN=nemesis-video-ai.ch CERTBOT_EMAIL=du@mail.ch bash deploy/bootstrap-droplet.sh
#
# Optional:
#   INSTALL_COMFY=1     — ComfyUI zusätzlich installieren (2 GB RAM: nur mit Swap, siehe README)
#   SKIP_SWAP=1         — keinen 2G-Swap anlegen
#
set -euo pipefail

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Bitte mit sudo ausführen."
  exit 1
fi

DOMAIN="${DOMAIN:-nemesis-video-ai.ch}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "==> WEB_ROOT=${WEB_ROOT}"
if [[ ! -f "${WEB_ROOT}/package.json" ]]; then
  echo "Fehler: Kein package.json — dieses Script muss aus dem Ordner .../web/deploy laufen"
  echo "(Projekt auf den Server nach z.B. /var/www/nemesis-video-ai/web kopieren)."
  exit 1
fi

echo "==> Pakete (apt)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates git nginx certbot python3-certbot-nginx

echo "==> Node.js 22"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null || true)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

echo "==> ACME webroot"
mkdir -p /var/www/html

MEM_KB="$(grep MemTotal /proc/meminfo | awk '{print $2}')"
SKIP_SWAP="${SKIP_SWAP:-0}"
if [[ "${SKIP_SWAP}" != "1" ]] && [[ "${MEM_KB:-0}" -lt 3500000 ]]; then
  if ! swapon --show 2>/dev/null | grep -q '/swapfile'; then
    echo "==> Swap 2G (RAM < ~3.5G)"
    if [[ ! -f /swapfile ]]; then
      fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
      chmod 600 /swapfile
      mkswap /swapfile
    fi
    swapon /swapfile || true
    grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    sysctl vm.swappiness=10 || true
    grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
  fi
fi

if [[ ! -f "${WEB_ROOT}/.env.local" ]]; then
  echo "==> .env.local aus deploy/env.production.example"
  cp "${SCRIPT_DIR}/env.production.example" "${WEB_ROOT}/.env.local"
fi

echo "==> npm ci + build"
cd "${WEB_ROOT}"
npm ci
npm run build

echo "==> Rechte für www-data"
chown -R www-data:www-data "${WEB_ROOT}"

echo "==> systemd: nemesis-video-ai.service"
NPM_BIN="$(command -v npm)"
echo "    npm=${NPM_BIN}"
cat >/etc/systemd/system/nemesis-video-ai.service <<EOF
[Unit]
Description=Nemesis Videos AI (Next.js)
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=${WEB_ROOT}
Environment=NODE_ENV=production
ExecStart=${NPM_BIN} run start
Restart=on-failure
RestartSec=15

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nemesis-video-ai.service
systemctl restart nemesis-video-ai.service

echo "==> Nginx (HTTP zuerst — TLS durch certbot)"
sed "s/__DOMAIN__/${DOMAIN}/g" "${SCRIPT_DIR}/nginx-nemesis-video-ai.http-only.conf" \
  >/etc/nginx/sites-available/nemesis-video-ai.conf
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/nemesis-video-ai.conf /etc/nginx/sites-enabled/nemesis-video-ai.conf
nginx -t
systemctl reload nginx

if [[ -n "${CERTBOT_EMAIL}" ]]; then
  echo "==> Let's Encrypt (certbot)"
  if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    echo "    Zertifikat existiert bereits unter /etc/letsencrypt/live/${DOMAIN}/"
    certbot renew --quiet || true
  else
    certbot --nginx --non-interactive --agree-tos --email "${CERTBOT_EMAIL}" \
      -d "${DOMAIN}" -d "www.${DOMAIN}" -d "comfy.${DOMAIN}" \
      --redirect || {
        echo "Hinweis: Certbot ist fehlgeschlagen — DNS A-Records (@, www, comfy) prüfen."
      }
  fi
else
  echo "==> Certbot übersprungen. Später:"
  echo "    CERTBOT_EMAIL=du@mail.ch sudo -E bash deploy/bootstrap-droplet.sh"
  echo "    oder: sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN} -d comfy.${DOMAIN}"
fi

if [[ "${INSTALL_COMFY:-0}" == "1" ]]; then
  echo "==> ComfyUI installieren"
  bash "${SCRIPT_DIR}/install-comfyui-do.sh"
  systemctl restart comfyui.service || true
else
  echo "==> ComfyUI nicht installiert (INSTALL_COMFY=1 zum Aktivieren)."
  echo "    Unter comfy.${DOMAIN} kommt 502, bis ComfyUI läuft — App unter https://${DOMAIN} funktioniert trotzdem."
fi

echo ""
echo "Fertig."
systemctl --no-pager status nemesis-video-ai.service --lines=3 || true
echo ""
echo "Öffnen: http://${DOMAIN} oder nach certbot https://${DOMAIN}"
echo "Logs:   journalctl -u nemesis-video-ai -f"
