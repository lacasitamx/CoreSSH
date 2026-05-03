#!/bin/bash
# Update script for SSH Panel  —  updates the binary and admin panel in place.
# Preserves: .env, config.json, xray_config.json, SSH keys, database, certs.
# Usage:  sudo bash update.sh
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[x]${NC} $*"; exit 1; }

# ── config ────────────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/sshpanel"
SERVICE_NAME="sshpanel"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GO_VERSION="${GO_VERSION:-$(awk '$1 == "go" {print $2; exit}' "$SCRIPT_DIR/go.mod" 2>/dev/null || echo "1.22.5")}"
# ─────────────────────────────────────────────────────────────────────────────

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash $0"

echo -e "\n${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}   SSH Panel  ·  Updater                   ${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}\n"

# ── 1. Pre-flight checks ──────────────────────────────────────────────────────
info "[1/6] Pre-flight checks…"

[[ -d "$INSTALL_DIR" ]]          || error "Install dir $INSTALL_DIR not found — run install.sh first."
[[ -f "$INSTALL_DIR/.env" ]]     || error "$INSTALL_DIR/.env not found — run install.sh first."
[[ -f "$SCRIPT_DIR/go.mod" ]]    || error "go.mod not found — run this script from the source directory."

info "  Install dir : $INSTALL_DIR"
info "  Source dir  : $SCRIPT_DIR"
info "  Go version  : $GO_VERSION"

# ── 2. Go toolchain ───────────────────────────────────────────────────────────
info "[2/6] Checking Go toolchain…"

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
  info "  Downloading Go ${GO_VERSION} (${GOARCH})…"
  wget -q --show-progress -O /tmp/go.tar.gz "$GO_URL"
  rm -rf /usr/local/go
  tar -C /usr/local -xzf /tmp/go.tar.gz
  rm -f /tmp/go.tar.gz
  echo 'export PATH=$PATH:/usr/local/go/bin' > /etc/profile.d/go.sh
  chmod +x /etc/profile.d/go.sh
fi

export PATH=$PATH:/usr/local/go/bin
go version

# ── 3. Build new binary ───────────────────────────────────────────────────────
info "[3/6] Building new sshpanel binary…"

cd "$SCRIPT_DIR"
export GOPATH=/tmp/gopath_sshpanel
export GOCACHE=/tmp/gocache_sshpanel
go mod download
go build -ldflags="-s -w" -o /tmp/sshpanel_new .
info "  Build complete."

# ── 4. Apply update ───────────────────────────────────────────────────────────
info "[4/6] Applying update…"

# Stop the service
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  info "  Stopping $SERVICE_NAME…"
  systemctl stop "$SERVICE_NAME"
  RESTART_NEEDED=true
else
  RESTART_NEEDED=false
fi

# Backup old binary
if [[ -f "$INSTALL_DIR/sshpanel" ]]; then
  cp "$INSTALL_DIR/sshpanel" "$INSTALL_DIR/sshpanel.bak"
  info "  Old binary backed up to sshpanel.bak"
fi

# Replace binary
mv /tmp/sshpanel_new "$INSTALL_DIR/sshpanel"
chmod +x "$INSTALL_DIR/sshpanel"
info "  Binary updated."

# Update admin panel files
mkdir -p "$INSTALL_DIR/admin"
cp -r "$SCRIPT_DIR/admin/"* "$INSTALL_DIR/admin/"
info "  Admin panel updated."
if [[ -f "$SCRIPT_DIR/change_admin_password.sh" ]]; then
  cp "$SCRIPT_DIR/change_admin_password.sh" "$INSTALL_DIR/change_admin_password.sh"
  chmod 700 "$INSTALL_DIR/change_admin_password.sh"
  info "  Admin password recovery script updated."
fi

# Ensure banner file exists (new in this version)
if [[ ! -f "$INSTALL_DIR/banner.txt" ]]; then
  touch "$INSTALL_DIR/banner.txt"
  info "  Created banner.txt"
fi

# Ensure certs directory exists (new in this version)
mkdir -p "$INSTALL_DIR/certs"

# Patch config.json to add missing fields introduced in this version
# without overwriting user-configured values.
CFG="$INSTALL_DIR/config.json"
if [[ -f "$CFG" ]]; then
  # Add banner_file if not present
  if ! python3 -c "import json,sys; d=json.load(open('$CFG')); sys.exit(0 if 'banner_file' in d else 1)" 2>/dev/null; then
    python3 - "$CFG" << 'PYEOF'
import json, sys
path = sys.argv[1]
with open(path) as f:
    d = json.load(f)
if 'banner_file' not in d:
    d['banner_file'] = '/opt/sshpanel/banner.txt'
with open(path, 'w') as f:
    json.dump(d, f, indent=2)
PYEOF
    info "  Added banner_file to config.json"
  fi

  # Remove legacy local_ssh_listen. DragonCore now handles DNSTT in-process.
  python3 - "$CFG" << 'PYEOF'
import json, sys
path = sys.argv[1]
with open(path) as f:
    d = json.load(f)
changed = d.pop('local_ssh_listen', None) is not None
if changed:
    with open(path, 'w') as f:
        json.dump(d, f, indent=2)
PYEOF

  # Fix routing: remove geoip:private rules that require geoip.dat from xray_config.json
  XCFG="$INSTALL_DIR/xray_config.json"
  if [[ -f "$XCFG" ]]; then
    if grep -q '"geoip:private"' "$XCFG" 2>/dev/null; then
      python3 - "$XCFG" << 'PYEOF'
import json, sys
path = sys.argv[1]
with open(path) as f:
    d = json.load(f)
routing = d.get('routing', {})
rules = routing.get('rules', [])
# Remove rules that reference geoip:private
new_rules = [r for r in rules if 'geoip:private' not in r.get('ip', [])]
if new_rules != rules:
    if new_rules:
        d['routing']['rules'] = new_rules
    else:
        d.pop('routing', None)
    with open(path, 'w') as f:
        json.dump(d, f, indent=2)
PYEOF
      info "  Removed geoip:private routing rule from xray_config.json"
    fi
  fi
fi

# ── 5. DNSTT DNS/53 redirect ─────────────────────────────────────────────────
info "[5/6] Ensuring DNSTT DNS redirect (UDP 53 -> 5300)…"
cat > /usr/local/sbin/sshpanel-dnstt-redirect.sh <<'EOS'
#!/bin/bash
set -euo pipefail
DNS_UPSTREAM="${DNS_UPSTREAM:-1.1.1.1}"
DNSTT_PORT="${DNSTT_PORT:-5300}"
if command -v systemctl >/dev/null 2>&1; then
  systemctl disable --now systemd-resolved.service >/dev/null 2>&1 || true
fi
rm -f /etc/resolv.conf
printf 'nameserver %s\n' "$DNS_UPSTREAM" > /etc/resolv.conf
if command -v ufw >/dev/null 2>&1; then
  ufw allow 53/udp >/dev/null 2>&1 || true
fi
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port=53/udp >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
fi
add_iptables_rule() {
  local bin="$1" chain="$2"
  "$bin" -t nat -C "$chain" -p udp --dport 53 -j REDIRECT --to-ports "$DNSTT_PORT" 2>/dev/null \
    || "$bin" -t nat -A "$chain" -p udp --dport 53 -j REDIRECT --to-ports "$DNSTT_PORT"
}
if command -v iptables >/dev/null 2>&1; then
  add_iptables_rule iptables PREROUTING
fi
if command -v ip6tables >/dev/null 2>&1; then
  add_iptables_rule ip6tables PREROUTING || true
fi
if ! command -v iptables >/dev/null 2>&1 && command -v nft >/dev/null 2>&1; then
  nft add table inet sshpanel_nat 2>/dev/null || true
  nft 'add chain inet sshpanel_nat prerouting { type nat hook prerouting priority dstnat; policy accept; }' 2>/dev/null || true
  nft list chain inet sshpanel_nat prerouting 2>/dev/null | grep -q "udp dport 53 redirect to :$DNSTT_PORT" \
    || nft add rule inet sshpanel_nat prerouting udp dport 53 redirect to :"$DNSTT_PORT"
fi
EOS
chmod +x /usr/local/sbin/sshpanel-dnstt-redirect.sh
cat > /etc/systemd/system/sshpanel-dnstt-redirect.service <<'EOF'
[Unit]
Description=SSH Panel DNSTT DNS redirect (UDP 53 to 5300)
After=network.target
Before=sshpanel.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/sshpanel-dnstt-redirect.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
mkdir -p /etc/systemd/system/sshpanel.service.d
cat > /etc/systemd/system/sshpanel.service.d/override.conf <<EOF
[Unit]
Wants=sshpanel-dnstt-redirect.service
After=sshpanel-dnstt-redirect.service

[Service]
Environment=PANEL_LOG_FILE=${INSTALL_DIR}/logs/panel.log
EOF
systemctl daemon-reload
systemctl enable --now sshpanel-dnstt-redirect.service || warn "DNSTT DNS redirect service failed; check: journalctl -u sshpanel-dnstt-redirect -e"

# ── 6. Restart service ────────────────────────────────────────────────────────
info "[6/6] Restarting service…"

if $RESTART_NEEDED; then
  systemctl start "$SERVICE_NAME"
  sleep 2
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    info "  $SERVICE_NAME is running."
  else
    warn "  $SERVICE_NAME failed to start — check logs:"
    warn "    journalctl -u $SERVICE_NAME -n 30 --no-pager"
    warn "  You can restore the old binary:"
    warn "    mv $INSTALL_DIR/sshpanel.bak $INSTALL_DIR/sshpanel && systemctl start $SERVICE_NAME"
    exit 1
  fi
else
  warn "  Service was not running; start it with: systemctl start $SERVICE_NAME"
fi

echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}   Update complete!                        ${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo -e "  Logs: ${YELLOW}journalctl -u ${SERVICE_NAME} -f${NC}"
echo -e "        ${YELLOW}tail -f ${INSTALL_DIR}/logs/panel.log${NC}"
echo ""
echo -e "  Backup: ${YELLOW}${INSTALL_DIR}/sshpanel.bak${NC}"
echo ""
echo -e "${YELLOW}What was updated:${NC}"
echo -e "  • sshpanel binary"
echo -e "  • Admin panel (admin/index.html)"
echo -e "${YELLOW}What was preserved:${NC}"
echo -e "  • .env  (DB credentials, tokens)"
echo -e "  • config.json  (your server settings)"
echo -e "  • xray_config.json  (your Xray settings)"
echo -e "  • SSH host keys"
echo -e "  • All user data in PostgreSQL"
echo ""
