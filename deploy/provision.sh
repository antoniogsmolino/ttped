#!/usr/bin/env bash
# Provisioning TTPED Studio su VM Ubuntu (Oracle Cloud Always Free o simili).
# Eseguito via SSH dal Mac: installa Node 22, Caddy (HTTPS automatico), systemd service.
# Uso: sudo bash provision.sh <ACCESS_PASSWORD> <DOMINIO>
#   es: sudo bash provision.sh 'PasswordForte123' '140-238-1-2.sslip.io'
set -euo pipefail

ACCESS_PASSWORD="${1:?Manca ACCESS_PASSWORD}"
DOMAIN="${2:?Manca il dominio (es. <IP-con-trattini>.sslip.io)}"
APP_DIR=/opt/ttped
DATA_DIR=/opt/ttped-data

echo "== Node 22 =="
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "== Caddy (HTTPS automatico) =="
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

echo "== Dipendenze app =="
mkdir -p "$DATA_DIR"
cd "$APP_DIR"
npm install --omit=dev

echo "== Firewall locale (Oracle usa anche iptables sulla VM) =="
iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 80 -j ACCEPT
iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 443 -j ACCEPT
command -v netfilter-persistent >/dev/null && netfilter-persistent save || true

echo "== Servizio systemd =="
cat > /etc/systemd/system/ttped.service <<EOF
[Unit]
Description=TTPED Studio
After=network.target

[Service]
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=HOST=127.0.0.1
Environment=PORT=4280
Environment=DATA_DIR=$DATA_DIR
Environment=ACCESS_PASSWORD=$ACCESS_PASSWORD
Environment=PUBLIC_URL=https://$DOMAIN

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now ttped
systemctl restart ttped

echo "== Caddy reverse proxy con HTTPS =="
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:4280
}
EOF
systemctl reload caddy || systemctl restart caddy

sleep 2
systemctl --no-pager -l status ttped | head -5
echo
echo "✅ Fatto: https://$DOMAIN"
