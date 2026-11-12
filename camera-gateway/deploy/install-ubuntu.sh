#!/bin/sh
set -eu
if [ "$(id -u)" -ne 0 ]; then echo 'Run this installer as root.' >&2; exit 1; fi
command -v node >/dev/null
command -v npm >/dev/null
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
node -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)'
test -f /opt/lunavision-gateway/camera-gateway/server.mjs
test -f /etc/lunavision-gateway/config.json
if ! id lunavision-gateway >/dev/null 2>&1; then useradd --system --home /opt/lunavision-gateway --no-create-home --shell /usr/sbin/nologin lunavision-gateway; fi
install -d -o lunavision-gateway -g lunavision-gateway -m 0700 /opt/lunavision-gateway/.vercel
chown root:lunavision-gateway /etc/lunavision-gateway/config.json
chmod 0640 /etc/lunavision-gateway/config.json
chmod 0750 /etc/lunavision-gateway
chgrp lunavision-gateway /etc/lunavision-gateway /opt/lunavision-gateway
chmod 0750 /opt/lunavision-gateway
chmod 0750 /etc/lunavision-gateway
install -m 0644 /opt/lunavision-gateway/camera-gateway/deploy/lunavision-gateway.service /etc/systemd/system/lunavision-gateway.service
systemctl daemon-reload
systemctl enable --now lunavision-gateway.service
systemctl is-active lunavision-gateway.service
