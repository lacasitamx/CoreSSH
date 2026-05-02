#!/bin/bash
# Auto-install script for SSH Panel + Xray-core (Ubuntu/Debian/CentOS)
# Usage:  sudo bash install.sh
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[x]${NC} $*"; exit 1; }

# ── config ──────────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/sshpanel"
SERVICE_NAME="sshpanel"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GO_VERSION="${GO_VERSION:-$(awk '$1 == "go" {print $2; exit}' "$SCRIPT_DIR/go.mod" 2>/dev/null || echo "1.22.5")}"
# ────────────────────────────────────────────────────────────────────────────

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash $0"

echo -e "\n${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}   SSH Panel + Xray-core  ·  Installer     ${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}\n"

# ── 1. OS detection ──────────────────────────────────────────────────────────
info "[1/9] Detecting OS…"
if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID="${ID:-unknown}"
else
  OS_ID="unknown"
fi

case "$OS_ID" in
  ubuntu|debian|linuxmint)
    PKG_UPDATE="apt-get update -qq"
    PKG_INSTALL="DEBIAN_FRONTEND=noninteractive apt-get install -y"
    PKG_DEPS="curl wget git build-essential postgresql postgresql-contrib ca-certificates unzip openssh-client openssl"
    ;;
  centos|rhel|rocky|almalinux)
    PKG_UPDATE="yum makecache -q"
    PKG_INSTALL="yum install -y"
    PKG_DEPS="curl wget git gcc make postgresql-server postgresql-contrib ca-certificates unzip openssh-clients openssl"
    ;;
  fedora)
    PKG_UPDATE="dnf makecache -q"
    PKG_INSTALL="dnf install -y"
    PKG_DEPS="curl wget git gcc make postgresql-server postgresql-contrib ca-certificates unzip openssh-clients openssl"
    ;;
  *)
    warn "Unknown OS '$OS_ID' — attempting apt-get…"
    PKG_UPDATE="apt-get update -qq"
    PKG_INSTALL="DEBIAN_FRONTEND=noninteractive apt-get install -y"
    PKG_DEPS="curl wget git build-essential postgresql postgresql-contrib ca-certificates unzip openssh-client openssl"
    ;;
esac
info "  OS: $OS_ID"

# ── 2. System dependencies ───────────────────────────────────────────────────
info "[2/9] Installing system packages…"
eval "$PKG_UPDATE"
eval "$PKG_INSTALL $PKG_DEPS"

# ── 3. Go ────────────────────────────────────────────────────────────────────
info "[3/9] Installing Go ${GO_VERSION}…"
NEED_GO=true
if command -v go &>/dev/null; then
  CURRENT_GO=$(go version 2>/dev/null | awk '{print $3}' | sed 's/go//')
  if [[ "$(printf '%s\n' "$GO_VERSION" "$CURRENT_GO" | sort -V | head -1)" == "$GO_VERSION" ]]; then
    info "  Go $CURRENT_GO already installed — skipping"
    NEED_GO=false
  fi
fi

if $NEED_GO; then
  MACHINE=$(uname -m)
  case "$MACHINE" in
    x86_64)  GOARCH="amd64" ;;
    aarch64) GOARCH="arm64" ;;
    armv7l)  GOARCH="armv6l" ;;
    *)       GOARCH="amd64" ;;
  esac
  GO_URL="https://go.dev/dl/go${GO_VERSION}.linux-${GOARCH}.tar.gz"
  info "  Downloading $GO_URL"
  wget -q --show-progress -O /tmp/go.tar.gz "$GO_URL"
  rm -rf /usr/local/go
  tar -C /usr/local -xzf /tmp/go.tar.gz
  rm -f /tmp/go.tar.gz
  echo 'export PATH=$PATH:/usr/local/go/bin' > /etc/profile.d/go.sh
  chmod +x /etc/profile.d/go.sh
fi

export PATH=$PATH:/usr/local/go/bin
go version

# ── 4. Directory layout ──────────────────────────────────────────────────────
info "[4/9] Setting up ${INSTALL_DIR}…"
mkdir -p "$INSTALL_DIR/admin" "$INSTALL_DIR/keys" "$INSTALL_DIR/logs"

# ── 5. Build SSH panel binary ────────────────────────────────────────────────
info "[5/9] Building SSH Panel binary…"
cd "$SCRIPT_DIR"
export GOPATH=/tmp/gopath_sshpanel
export GOCACHE=/tmp/gocache_sshpanel
go mod download
go build -ldflags="-s -w" -o "$INSTALL_DIR/sshpanel" .
info "  Binary: $INSTALL_DIR/sshpanel"
cp -r "$SCRIPT_DIR/admin/"* "$INSTALL_DIR/admin/"
info "  Admin panel copied"

# ── 6. Xray binary ──────────────────────────────────────────────────────────
info "[6/9] Downloading Xray-core…"
XRAY_VER=$(curl -sf "https://api.github.com/repos/XTLS/Xray-core/releases/latest" \
  | grep '"tag_name"' | head -1 | cut -d'"' -f4 || echo "v24.11.30")
MACHINE=$(uname -m)
case "$MACHINE" in
  x86_64)  XRAY_ARCH="64" ;;
  aarch64) XRAY_ARCH="arm64-v8a" ;;
  armv7l)  XRAY_ARCH="arm32-v7a" ;;
  *)       XRAY_ARCH="64" ;;
esac
XRAY_URL="https://github.com/XTLS/Xray-core/releases/download/${XRAY_VER}/Xray-linux-${XRAY_ARCH}.zip"
info "  Xray ${XRAY_VER} (${XRAY_ARCH})"
wget -q --show-progress -O /tmp/xray.zip "$XRAY_URL"
unzip -o /tmp/xray.zip xray -d "$INSTALL_DIR" > /dev/null 2>&1 || {
  mkdir -p /tmp/xray_extract
  unzip -o /tmp/xray.zip -d /tmp/xray_extract > /dev/null 2>&1
  mv /tmp/xray_extract/xray "$INSTALL_DIR/xray"
}
chmod +x "$INSTALL_DIR/xray"
rm -f /tmp/xray.zip
"$INSTALL_DIR/xray" version

# ── 7. PostgreSQL ────────────────────────────────────────────────────────────
info "[7/9] Configuring PostgreSQL…"
case "$OS_ID" in
  centos|rhel|rocky|almalinux|fedora)
    postgresql-setup --initdb 2>/dev/null || true ;;
esac
systemctl start postgresql  2>/dev/null || service postgresql start 2>/dev/null || true
systemctl enable postgresql 2>/dev/null || true

DB_NAME="sshpanel"
DB_USER="sshpanel"
DB_PASS=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32 || true)
if [[ ${#DB_PASS} -lt 32 ]]; then
  DB_PASS=$(openssl rand -hex 16 2>/dev/null || date +%s%N)
fi

su -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\" | grep -q 1 || \
       psql -c \"CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';\"" postgres
# Reinstall-safe: if the role already existed, make the new .env password valid.
su -c "psql -c \"ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASS}';\"" postgres

su -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\" | grep -q 1 || \
       psql -c \"CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};\"" postgres
# Reinstall-safe: if the database already existed, make sshpanel its owner.
su -c "psql -c \"ALTER DATABASE ${DB_NAME} OWNER TO ${DB_USER};\"" postgres

su -c "psql -d ${DB_NAME} -c \"
CREATE TABLE IF NOT EXISTS ssh_users (
  username              TEXT PRIMARY KEY,
  password              TEXT NOT NULL DEFAULT '',
  max_connections       INT  NOT NULL DEFAULT 0,
  expires_at            TEXT,
  limit_mbps_up         INT  NOT NULL DEFAULT 0,
  limit_mbps_down       INT  NOT NULL DEFAULT 0,
  totp_secret           TEXT NOT NULL DEFAULT '',
  totp_period           INT  NOT NULL DEFAULT 60,
  totp_window           INT  NOT NULL DEFAULT 1,
  totp_digits           INT  NOT NULL DEFAULT 6,
  allow_static_password BOOLEAN NOT NULL DEFAULT FALSE,
  owner_username        TEXT NOT NULL DEFAULT ''
);
ALTER TABLE ssh_users ADD COLUMN IF NOT EXISTS totp_secret TEXT NOT NULL DEFAULT '';
ALTER TABLE ssh_users ADD COLUMN IF NOT EXISTS totp_period INT NOT NULL DEFAULT 60;
ALTER TABLE ssh_users ADD COLUMN IF NOT EXISTS totp_window INT NOT NULL DEFAULT 1;
ALTER TABLE ssh_users ADD COLUMN IF NOT EXISTS totp_digits INT NOT NULL DEFAULT 6;
ALTER TABLE ssh_users ADD COLUMN IF NOT EXISTS allow_static_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ssh_users ADD COLUMN IF NOT EXISTS owner_username TEXT NOT NULL DEFAULT '';
ALTER TABLE ssh_users ALTER COLUMN password SET DEFAULT '';

CREATE TABLE IF NOT EXISTS ssh_iface_totals (
  iface                TEXT PRIMARY KEY,
  total_rx_bytes       BIGINT NOT NULL DEFAULT 0,
  total_tx_bytes       BIGINT NOT NULL DEFAULT 0,
  last_kernel_rx_bytes BIGINT NOT NULL DEFAULT 0,
  last_kernel_tx_bytes BIGINT NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE ssh_iface_totals ADD COLUMN IF NOT EXISTS total_rx_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ssh_iface_totals ADD COLUMN IF NOT EXISTS total_tx_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ssh_iface_totals ADD COLUMN IF NOT EXISTS last_kernel_rx_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ssh_iface_totals ADD COLUMN IF NOT EXISTS last_kernel_tx_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ssh_iface_totals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS admin_users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'reseller',
  max_users     INT  NOT NULL DEFAULT 30,
  expires_at    TIMESTAMPTZ,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS xray_clients (
  uuid        TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  inbound_tag TEXT NOT NULL DEFAULT '',
  expires_at  TIMESTAMPTZ,
  max_conns   INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER SCHEMA public OWNER TO ${DB_USER};
ALTER TABLE IF EXISTS ssh_users OWNER TO ${DB_USER};
ALTER TABLE IF EXISTS ssh_iface_totals OWNER TO ${DB_USER};
ALTER TABLE IF EXISTS admin_users OWNER TO ${DB_USER};
ALTER TABLE IF EXISTS xray_clients OWNER TO ${DB_USER};
ALTER SEQUENCE IF EXISTS admin_users_id_seq OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
GRANT ALL PRIVILEGES ON SCHEMA public TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};
\"" postgres

info "  PostgreSQL database '${DB_NAME}' ready"

# ── 8. Config files ──────────────────────────────────────────────────────────
info "[8/9] Generating config files…"

# Admin token
ADMIN_TOKEN=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 48 || true)
if [[ ${#ADMIN_TOKEN} -lt 48 ]]; then
  ADMIN_TOKEN=$(openssl rand -hex 24 2>/dev/null || date +%s%N)
fi

# Admin panel login password. The web panel login is username/password;
# ADMIN_TOKEN is only for bearer-token API access and is not the login password.
ADMIN_PASSWORD=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 20 || true)
if [[ ${#ADMIN_PASSWORD} -lt 20 ]]; then
  ADMIN_PASSWORD=$(openssl rand -hex 10 2>/dev/null || date +%s%N)
fi
ADMIN_PASSWORD_HASH=$(printf '%s' "${ADMIN_PASSWORD}" | sha256sum | awk '{print $1}')
su -c "psql -d ${DB_NAME}" postgres <<SQL
INSERT INTO admin_users (username, password_hash, role, max_users, expires_at, is_active)
VALUES ('admin', '${ADMIN_PASSWORD_HASH}', 'superadmin', 0, NULL, TRUE)
ON CONFLICT (username) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role = 'superadmin',
  max_users = 0,
  expires_at = NULL,
  is_active = TRUE;
SQL

# .env
cat > "$INSTALL_DIR/.env" <<EOF
PG_DSN=postgres://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}?sslmode=disable
ADMIN_TOKEN=${ADMIN_TOKEN}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_HTTP_ADDR=0.0.0.0:9090
EOF
chmod 600 "$INSTALL_DIR/.env"

# SSH host key (RSA, required by current build)
if [[ ! -f "$INSTALL_DIR/ssh_host_rsa_key" ]]; then
  ssh-keygen -t rsa -b 2048 -f "$INSTALL_DIR/ssh_host_rsa_key" -N "" -C "sshpanel-hostkey" -q
  info "  Generated RSA host key"
fi

# Server public IP (best-effort)
SERVER_IP=$(curl -sf --max-time 5 https://checkip.amazonaws.com 2>/dev/null \
         || curl -sf --max-time 5 https://api.ipify.org 2>/dev/null \
         || hostname -I | awk '{print $1}')

# config.json
cat > "$INSTALL_DIR/config.json" <<EOF
{
  "listen": "0.0.0.0:80",
  "extra_listen": ["0.0.0.0:8080"],
  "local_ssh_listen": "127.0.0.1:2222",
  "host_key_file": "${INSTALL_DIR}/ssh_host_rsa_key",
  "quiet": false,
  "admin_dir": "${INSTALL_DIR}/admin",
  "banner_file": "${INSTALL_DIR}/banner.txt",
  "xray": {
    "enabled": true,
    "bin_path": "${INSTALL_DIR}/xray",
    "config_file": "${INSTALL_DIR}/xray_config.json"
  }
}
EOF
touch "$INSTALL_DIR/banner.txt"

# UUID for default VLESS client
UUID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null \
    || python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null \
    || echo "11111111-2222-3333-4444-555555555555")

# xray_config.json  (default VLESS + SOCKS inbounds — no geoip routing needed)
cat > "$INSTALL_DIR/xray_config.json" <<EOF
{
  "log": { "loglevel": "warning" },
  "inbounds": [
    {
      "tag": "vless-in",
      "port": 10086,
      "listen": "0.0.0.0",
      "protocol": "vless",
      "settings": {
        "clients": [{ "id": "${UUID}", "level": 0 }],
        "decryption": "none"
      },
      "streamSettings": { "network": "tcp" }
    },
    {
      "tag": "socks-local",
      "port": 10088,
      "listen": "127.0.0.1",
      "protocol": "socks",
      "settings": { "auth": "noauth", "udp": true }
    }
  ],
  "outbounds": [
    { "tag": "direct",  "protocol": "freedom",  "settings": {} },
    { "tag": "blocked", "protocol": "blackhole", "settings": {} }
  ]
}
EOF
chmod 600 "$INSTALL_DIR/xray_config.json"
info "  VLESS UUID: ${UUID}"

# ── 9. Systemd service ───────────────────────────────────────────────────────
info "[9/9] Creating systemd service '${SERVICE_NAME}'…"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=SSH Panel + Xray-core Server
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=${INSTALL_DIR}/sshpanel -config ${INSTALL_DIR}/config.json
Restart=always
RestartSec=5
User=root
LimitNOFILE=65536
StandardOutput=append:${INSTALL_DIR}/logs/panel.log
StandardError=append:${INSTALL_DIR}/logs/panel.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable  "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

sleep 2
echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}   Installation complete!                  ${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo -e "  Server IP    : ${YELLOW}${SERVER_IP}${NC}"
echo -e "  SSH ports    : 80, 8080  (HTTP-injected SSH)"
echo -e "  VLESS port   : 10086"
echo -e "  VLESS UUID   : ${YELLOW}${UUID}${NC}"
echo ""
echo -e "  Admin panel  : ${YELLOW}http://${SERVER_IP}:9090${NC}"
echo -e "  Admin login  : ${YELLOW}admin${NC}"
echo -e "  Admin password: ${YELLOW}${ADMIN_PASSWORD}${NC}"
echo -e "  Admin token  : ${YELLOW}${ADMIN_TOKEN}${NC}"
echo ""
echo -e "  Token + DB creds stored in: ${INSTALL_DIR}/.env"
echo -e "  Logs: journalctl -u ${SERVICE_NAME} -f"
echo -e "        tail -f ${INSTALL_DIR}/logs/panel.log"
echo ""
echo -e "${YELLOW}Save your admin login/password. The admin token is for API bearer-token access only.${NC}"
echo ""
systemctl status "$SERVICE_NAME" --no-pager -l || true
