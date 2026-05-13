#!/usr/bin/env bash
#
# ComfyUI auf Ubuntu (DigitalOcean) installieren — als systemd-Dienst, nur localhost:8188.
# Ausführung: sudo bash install-comfyui-do.sh
#
set -euo pipefail

COMFY_USER="${COMFY_USER:-comfy}"
COMFY_HOME="/opt/comfy"
COMFY_REPO="${COMFY_REPO:-https://github.com/comfyanonymous/ComfyUI.git}"

echo "==> Nutzer ${COMFY_USER}"
if ! id "${COMFY_USER}" &>/dev/null; then
  useradd --system --create-home --home-dir "${COMFY_HOME}" --shell /bin/bash "${COMFY_USER}"
fi

apt-get update -qq
apt-get install -y -qq git python3 python3-venv python3-pip ffmpeg

COMFY_APP="${COMFY_HOME}/ComfyUI"
if [[ ! -d "${COMFY_APP}/.git" ]]; then
  echo "==> Klone ComfyUI nach ${COMFY_APP}"
  mkdir -p "$(dirname "${COMFY_APP}")"
  git clone --depth 1 "${COMFY_REPO}" "${COMFY_APP}"
else
  echo "==> ComfyUI liegt schon vor, git pull"
  sudo -u "${COMFY_USER}" git -C "${COMFY_APP}" pull --ff-only || true
fi

chown -R "${COMFY_USER}:${COMFY_USER}" "${COMFY_HOME}"

echo "==> Python venv + Abhängigkeiten (CPU-PyTorch — für GPU siehe README)"
sudo -u "${COMFY_USER}" bash << 'INNER'
set -euo pipefail
cd /opt/comfy/ComfyUI
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip wheel
# CPU (auf GPU-Droplet: siehe deploy/README.md CUDA-Zeile)
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
INNER

echo "==> systemd: comfyui.service"
cat >/etc/systemd/system/comfyui.service << EOF
[Unit]
Description=ComfyUI (Nemesis Videos AI)
After=network.target

[Service]
Type=simple
User=${COMFY_USER}
WorkingDirectory=${COMFY_APP}
ExecStart=${COMFY_APP}/venv/bin/python main.py --listen 127.0.0.1 --port 8188
Restart=on-failure
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable comfyui.service
systemctl restart comfyui.service

echo "==> Fertig. Status:"
systemctl --no-pager status comfyui.service || true
echo ""
echo "Lokal testen auf dem Server: curl -sS http://127.0.0.1:8188/system_stats | head"
echo "Öffentlich nur über Nginx (TLS + comfy.nemesis-video-ai.ch) — siehe nginx-nemesis-video-ai.conf"
