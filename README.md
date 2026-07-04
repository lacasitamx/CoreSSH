# DragonCoreSSH V40

## PT-BR

DragonCoreSSH V40 é um painel/servidor em Go para SSH com HTTP Injection, painel web, PostgreSQL, integração com Xray-core/V2Ray e API pública para consultar status de usuários SSH e clientes Xray.

### Recursos principais

- SSH com HTTP Injection
- Painel web administrativo
- Banco de dados PostgreSQL
- Integração com Xray-core/V2Ray
- Configurador visual para VLESS e VMess
- API pública `/check` para consultar usuário ou UUID
- Aba de logs no painel para ver logs do sistema, DNSTT e Xray
- Salvamento live das configurações principais, com checagem se o serviço realmente subiu
- Serviço `systemd` para iniciar automaticamente com o sistema

### Protocolos suportados no configurador Xray/V2Ray

O painel possui suporte para criação e gerenciamento de configurações Xray/V2Ray com:

```text
VLESS
VMess
Trojan
Shadowsocks
SOCKS
```

Para VMess, o painel gera clientes com `alterId: 0`.

Transportes disponíveis para VLESS/VMess no configurador visual:

```text
TCP
WebSocket
XHTTP
HTTPUpgrade
HTTP/2
gRPC
```

Observação: Reality deve ser usado apenas em protocolos compatíveis. No configurador visual, VMess não usa Reality.

### Requisitos

- Servidor Linux com `systemd`
- Acesso `root` ou `sudo`
- Gerenciador de pacotes `apt`, `yum` ou `dnf`
- Portas liberadas no firewall/security group conforme a configuração usada

Distribuições alvo:

- Ubuntu / Debian / Linux Mint
- CentOS / RHEL / Rocky / AlmaLinux
- Fedora

### Instalação

Clone o projeto e execute o instalador:

```bash
git clone https://git.dr2.site/penguinehis/DragonCoreSSH-NewWEB
cd DragonCoreSSH-NewWEB
sudo bash install.sh
```

Durante a instalação, o script instala/configura:

- Go
- PostgreSQL
- Xray-core
- Binário do DragonCoreSSH V40
- Serviço `systemd` chamado `sshpanel`
- Painel web
- Arquivos de runtime em `/opt/sshpanel`

Ao finalizar, o instalador mostra os dados principais:

```text
Server IP
SSH ports
VLESS port
VLESS UUID
VMess port
Admin panel URL
Admin login/password, quando aplicável
Admin token
```

### Caminhos principais

```text
/opt/sshpanel/sshpanel
/opt/sshpanel/.env
/opt/sshpanel/config.json
/opt/sshpanel/xray_config.json
/opt/sshpanel/admin/
/opt/sshpanel/logs/panel.log
/opt/sshpanel/update.sh
/opt/sshpanel/change_admin_password.sh
/etc/systemd/system/sshpanel.service
```

O instalador monta `/opt/sshpanel/logs` como tmpfs de 15 MiB quando possível, para reduzir gravações no SD card. O `panel.log` é limpo automaticamente quando passa de 1 MiB, e também pode ser limpo manualmente pela aba Logs do painel.

### Portas padrão

```text
80      SSH com HTTP Injection
8080    SSH extra com HTTP Injection
53/udp  DNS público para DNSTT, redirecionado para 5300/udp
5300/udp DNSTT interno
9090    Painel web + API pública /check
10086   Xray VLESS
10087   Xray VMess
10088   SOCKS local em 127.0.0.1
```

Libere no firewall apenas as portas que você realmente usa. Exemplo com `ufw`:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 8080/tcp
sudo ufw allow 53/udp
sudo ufw allow 9090/tcp
sudo ufw allow 10086/tcp
sudo ufw allow 10087/tcp
```


### DNSTT na porta DNS 53

O instalador cria o serviço `sshpanel-dnstt-redirect.service`, que libera a porta 53 removendo o `systemd-resolved` quando ele existe, fixa `/etc/resolv.conf` com `1.1.1.1` e adiciona uma regra NAT para redirecionar DNS UDP público da porta `53` para o DNSTT em `5300`.

Comandos manuais equivalentes em sistemas com `iptables`:

```bash
sudo systemctl disable --now systemd-resolved.service || true
sudo rm -f /etc/resolv.conf
echo "nameserver 1.1.1.1" | sudo tee /etc/resolv.conf
sudo iptables -t nat -C PREROUTING -p udp --dport 53 -j REDIRECT --to-ports 5300 2>/dev/null \
  || sudo iptables -t nat -A PREROUTING -p udp --dport 53 -j REDIRECT --to-ports 5300
```

Verificar o redirect:

```bash
systemctl status sshpanel-dnstt-redirect --no-pager -l
sudo iptables -t nat -S PREROUTING | grep 5300
```

### Reinício automático do DNSTT

O DNSTT pode ser reiniciado automaticamente sem reiniciar a VPS e sem derrubar o painel inteiro. No painel, abra **DragonCore → DNSTT Tunnel** e configure:

- **Auto Restart Interval**: intervalo como `30m`, `2h` ou `6h`; use `0s`, `off` ou deixe vazio para desativar.
- **Restart Grace Delay**: pausa antes de reabrir a porta UDP; padrão `2s`.

Também é possível editar diretamente o `config.json`:

```json
"dnstt": {
  "domain": "t.example.com",
  "udp_listen": "[::]:5300",
  "privkey_file": "/opt/sshpanel/dnstt.key",
  "auto_restart_interval": "6h",
  "auto_restart_grace": "2s"
}
```

### Vários domínios/NS no DNSTT

O DNSTT aceita múltiplos domínios raiz no mesmo listener UDP e com a mesma chave. No painel, abra **DragonCore → DNSTT Tunnel → NS / Root Domains** e coloque um domínio por linha. Isso permite usar um domínio público e outro domínio local da sua rede no mesmo servidor.

Exemplo:

```json
"dnstt": {
  "domain": "t.example.com",
  "domains": [
    "t.example.com",
    "t.local.lan"
  ],
  "udp_listen": "[::]:5300",
  "privkey_file": "/opt/sshpanel/dnstt.key"
}
```

`domain` continua existindo para compatibilidade. O primeiro item de `domains` é usado como domínio principal.

Para testar com DNS local, aponte o NS/A do domínio local para o IP LAN do servidor DNSTT ou configure seu DNS local para encaminhar essa zona para o IP/porta UDP do DNSTT.

### Reinício automático do proxy e UDPGW

O proxy e o UDPGW também podem ser reiniciados por intervalo. Estes reinícios são **hard restart** para substituir o temporizador em `screen` que reiniciava tudo:

- **Proxy Auto Restart Interval** reinicia os listeners públicos (`listen`, `extra_listen` e TLS forwarders) e fecha as sessões SSH ativas.
- **UDPGW Auto Restart Interval** fecha o listener UDPGW e todos os clientes UDPGW conectados antes de subir novamente.
- Use valores como `6h`, `12h` ou `24h`; `0s`, `off` ou vazio desativa.
- **Restart Grace Delay** define a pausa antes de abrir novamente; padrão `2s`.

Exemplo no `config.json`:

```json
{
  "listen": "0.0.0.0:80",
  "extra_listen": ["0.0.0.0:8080"],
  "proxy_auto_restart_interval": "24h",
  "proxy_auto_restart_grace": "2s",
  "udpgw": {
    "listen": "0.0.0.0:7400",
    "auto_restart_interval": "24h",
    "auto_restart_grace": "2s"
  }
}
```

### Comandos úteis

Ver status do serviço:

```bash
systemctl status sshpanel --no-pager -l
```

Ver logs pelo `journalctl`:

```bash
journalctl -u sshpanel -f
```

Ver log direto do painel:

```bash
tail -f /opt/sshpanel/logs/panel.log
```

Reiniciar serviço:

```bash
systemctl restart sshpanel
```

### Trocar senha perdida do admin

Se o dono perdeu a senha do painel, acesse o servidor como `root` e execute:

```bash
sudo bash /opt/sshpanel/change_admin_password.sh
```

Também é possível passar a senha direto no comando:

```bash
sudo bash /opt/sshpanel/change_admin_password.sh admin 'NovaSenhaForteAqui'
```

Ou gerar uma senha nova automaticamente:

```bash
sudo bash /opt/sshpanel/change_admin_password.sh --user admin --generate
```

O script atualiza o usuário `admin` no PostgreSQL, ativa ele como `superadmin`, salva `ADMIN_PASSWORD` em `/opt/sshpanel/.env` e reinicia o serviço `sshpanel` para recarregar o cache interno de admins.

### Atualização automática pelo Git

Depois da instalação, o `update.sh` fica salvo em `/opt/sshpanel/update.sh`. Para atualizar o servidor, o dono só precisa executar:

```bash
sudo bash /opt/sshpanel/update.sh
```

O script baixa automaticamente os arquivos mais recentes do Git:

```text
https://git.dr2.site/penguinehis/DragonCoreSSH-NewWEB.git
```

Depois ele recompila o binário e atualiza o painel web e os scripts auxiliares, mantendo as configurações e dados existentes.

O update preserva:

```text
/opt/sshpanel/.env
/opt/sshpanel/config.json
/opt/sshpanel/xray_config.json
Banco de dados PostgreSQL
Usuários SSH/Xray
Chaves SSH
Certificados
Logs
```

Se quiser forçar uma branch/ref específica:

```bash
sudo UPDATE_REF=main bash /opt/sshpanel/update.sh
```

Se quiser usar outro repositório:

```bash
sudo REPO_URL=https://git.dr2.site/penguinehis/DragonCoreSSH-NewWEB.git bash /opt/sshpanel/update.sh
```

### API pública CheckUser

Endpoint:

```http
GET /check
```

URL padrão:

```text
http://SERVER_IP:9090/check
```

Consultar usuário SSH:

```bash
curl "http://SERVER_IP:9090/check?user=testuser"
```

Consultar UUID Xray/V2Ray:

```bash
curl "http://SERVER_IP:9090/check?uuid=a499cb67-6c73-43cc-a84d-92cbb68d22d1"
```

Se `user` e `uuid` forem enviados juntos, `user` tem prioridade.

Resposta de sucesso:

```json
{
  "username": "testuser",
  "count_connections": 1,
  "expiration_date": "31/12/2026",
  "expiration_days": 243,
  "limit_connections": 2
}
```

Conta ilimitada:

```json
{
  "username": "testuser",
  "count_connections": 0,
  "expiration_date": "Unlimited",
  "expiration_days": -1,
  "limit_connections": 1
}
```

Campos da resposta:

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `username` | string | Usuário SSH, nome do cliente Xray/V2Ray ou UUID. |
| `count_connections` | number | Conexões SSH ativas no momento. |
| `expiration_date` | string | Data de expiração em `DD/MM/YYYY` ou `Unlimited`. |
| `expiration_days` | number | Dias restantes. `-1` significa ilimitado. |
| `limit_connections` | number | Limite máximo de conexões. |

Erros comuns:

```json
{"error":"user or uuid parameter required"}
```

```json
{"error":"user not found"}
```

```json
{"error":"uuid not found"}
```

```json
{"error":"database not configured"}
```

---

## EN-US

DragonCoreSSH V40 is a Go-based SSH HTTP Injection server with a web panel, PostgreSQL, Xray-core/V2Ray integration, and a public API for checking SSH users and Xray clients.

### Main features

- SSH with HTTP Injection
- Administrative web panel
- PostgreSQL database
- Xray-core/V2Ray integration
- Visual configurator for VLESS and VMess
- Public `/check` API for checking username or UUID
- Logs tab in the panel for system, DNSTT, and Xray logs
- Live-save for main service settings, with checks that enabled services actually started
- `systemd` service for automatic startup

### Supported protocols in the Xray/V2Ray configurator

The panel supports creating and managing Xray/V2Ray configurations with:

```text
VLESS
VMess
Trojan
Shadowsocks
SOCKS
```

For VMess, the panel generates clients with `alterId: 0`.

Available transports for VLESS/VMess in the visual configurator:

```text
TCP
WebSocket
XHTTP
HTTPUpgrade
HTTP/2
gRPC
```

Note: Reality should only be used with compatible protocols. In the visual configurator, VMess does not use Reality.

### Requirements

- Linux server with `systemd`
- `root` or `sudo` access
- `apt`, `yum`, or `dnf` package manager
- Required ports opened in the firewall/security group

Target distributions:

- Ubuntu / Debian / Linux Mint
- CentOS / RHEL / Rocky / AlmaLinux
- Fedora

### Installation

Clone the project and run the installer:

```bash
git clone https://git.dr2.site/penguinehis/DragonCoreSSH-NewWEB
cd DragonCoreSSH-NewWEB
sudo bash install.sh
```

During installation, the script installs/configures:

- Go
- PostgreSQL
- Xray-core
- DragonCoreSSH V40 binary
- `systemd` service named `sshpanel`
- Web panel
- Runtime files in `/opt/sshpanel`

When finished, the installer prints the main access details:

```text
Server IP
SSH ports
VLESS port
VLESS UUID
VMess port
Admin panel URL
Admin login/password, when applicable
Admin token
```

### Main paths

```text
/opt/sshpanel/sshpanel
/opt/sshpanel/.env
/opt/sshpanel/config.json
/opt/sshpanel/xray_config.json
/opt/sshpanel/admin/
/opt/sshpanel/logs/panel.log
/opt/sshpanel/update.sh
/opt/sshpanel/change_admin_password.sh
/etc/systemd/system/sshpanel.service
```

### Default ports

```text
80      SSH with HTTP Injection
8080    Extra SSH with HTTP Injection
53/udp  Public DNS for DNSTT, redirected to 5300/udp
5300/udp Internal DNSTT listener
9090    Web panel + public /check API
10086   Xray VLESS
10087   Xray VMess
10088   Local SOCKS on 127.0.0.1
```

Open only the ports that you actually use. Example with `ufw`:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 8080/tcp
sudo ufw allow 53/udp
sudo ufw allow 9090/tcp
sudo ufw allow 10086/tcp
sudo ufw allow 10087/tcp
```


### DNSTT on DNS port 53

The installer creates `sshpanel-dnstt-redirect.service`. It frees port 53 by stopping `systemd-resolved` when present, writes `/etc/resolv.conf` with `1.1.1.1`, and adds a NAT rule that redirects public UDP DNS traffic from port `53` to DNSTT on `5300`.

Equivalent manual commands on systems with `iptables`:

```bash
sudo systemctl disable --now systemd-resolved.service || true
sudo rm -f /etc/resolv.conf
echo "nameserver 1.1.1.1" | sudo tee /etc/resolv.conf
sudo iptables -t nat -C PREROUTING -p udp --dport 53 -j REDIRECT --to-ports 5300 2>/dev/null \
  || sudo iptables -t nat -A PREROUTING -p udp --dport 53 -j REDIRECT --to-ports 5300
```

Check the redirect:

```bash
systemctl status sshpanel-dnstt-redirect --no-pager -l
sudo iptables -t nat -S PREROUTING | grep 5300
```

### DNSTT auto restart

DNSTT can be restarted automatically without rebooting the VPS and without restarting the whole panel. In the panel, open **DragonCore → DNSTT Tunnel** and configure:

- **Auto Restart Interval**: duration like `30m`, `2h`, or `6h`; use `0s`, `off`, or leave it empty to disable.
- **Restart Grace Delay**: pause before reopening the UDP port; default is `2s`.

You can also edit `config.json` directly:

```json
"dnstt": {
  "domain": "t.example.com",
  "udp_listen": "[::]:5300",
  "privkey_file": "/opt/sshpanel/dnstt.key",
  "auto_restart_interval": "6h",
  "auto_restart_grace": "2s"
}
```

### Multiple DNSTT NS/root domains

DNSTT can accept multiple root domains on the same UDP listener with the same key. In the panel, open **DragonCore → DNSTT Tunnel → NS / Root Domains** and enter one domain per line. This lets you use a public domain and a local network domain on the same server.

Example:

```json
"dnstt": {
  "domain": "t.example.com",
  "domains": [
    "t.example.com",
    "t.local.lan"
  ],
  "udp_listen": "[::]:5300",
  "privkey_file": "/opt/sshpanel/dnstt.key"
}
```

`domain` is kept for backward compatibility. The first item in `domains` is mirrored as the primary domain.

For local DNS testing, point the local domain's NS/A record to the DNSTT server LAN IP or configure your local DNS server to forward that zone to the DNSTT UDP IP/port.

### Proxy and UDPGW auto restart

The proxy and UDPGW can also restart by interval. These are **hard restarts**, intended to replace a `screen` timer that restarted everything:

- **Proxy Auto Restart Interval** restarts public listeners (`listen`, `extra_listen`, and TLS forwarders) and closes active SSH sessions.
- **UDPGW Auto Restart Interval** closes the UDPGW listener and all connected UDPGW clients before starting again.
- Use values like `6h`, `12h`, or `24h`; `0s`, `off`, or empty disables it.
- **Restart Grace Delay** controls the pause before reopening; default is `2s`.

Example `config.json`:

```json
{
  "listen": "0.0.0.0:80",
  "extra_listen": ["0.0.0.0:8080"],
  "proxy_auto_restart_interval": "24h",
  "proxy_auto_restart_grace": "2s",
  "udpgw": {
    "listen": "0.0.0.0:7400",
    "auto_restart_interval": "24h",
    "auto_restart_grace": "2s"
  }
}
```

### Useful commands

Check service status:

```bash
systemctl status sshpanel --no-pager -l
```

Follow logs with `journalctl`:

```bash
journalctl -u sshpanel -f
```

Follow panel log file:

```bash
tail -f /opt/sshpanel/logs/panel.log
```

When possible, `/opt/sshpanel/logs` is mounted as a 15 MiB tmpfs RAM disk by the service. `panel.log` is automatically cleaned after it exceeds 1 MiB, and the Logs tab also has a manual clean button.

Restart service:

```bash
systemctl restart sshpanel
```

### Reset lost admin password

If the owner loses the web panel password, access the server as `root` and run:

```bash
sudo bash /opt/sshpanel/change_admin_password.sh
```

You can also pass the password directly:

```bash
sudo bash /opt/sshpanel/change_admin_password.sh admin 'NewStrongPasswordHere'
```

Or generate a new password automatically:

```bash
sudo bash /opt/sshpanel/change_admin_password.sh --user admin --generate
```

The script updates the `admin` user in PostgreSQL, enables it as `superadmin`, saves `ADMIN_PASSWORD` in `/opt/sshpanel/.env`, and restarts `sshpanel` so the in-memory admin cache is reloaded.

### Automatic Git update

After installation, `update.sh` is saved at `/opt/sshpanel/update.sh`. To update the server, the owner only needs to run:

```bash
sudo bash /opt/sshpanel/update.sh
```

The script automatically downloads the latest files from Git:

```text
https://git.dr2.site/penguinehis/DragonCoreSSH-NewWEB.git
```

Then it rebuilds the binary and updates the web panel and helper scripts while keeping existing configuration and user data.

The update preserves:

```text
/opt/sshpanel/.env
/opt/sshpanel/config.json
/opt/sshpanel/xray_config.json
PostgreSQL database
SSH/Xray users
SSH keys
Certificates
Logs
```

To force a specific branch/ref:

```bash
sudo UPDATE_REF=main bash /opt/sshpanel/update.sh
```

To use another repository:

```bash
sudo REPO_URL=https://git.dr2.site/penguinehis/DragonCoreSSH-NewWEB.git bash /opt/sshpanel/update.sh
```

### Public CheckUser API

Endpoint:

```http
GET /check
```

Default URL:

```text
http://SERVER_IP:9090/check
```

Check SSH username:

```bash
curl "http://SERVER_IP:9090/check?user=testuser"
```

Check Xray/V2Ray UUID:

```bash
curl "http://SERVER_IP:9090/check?uuid=a499cb67-6c73-43cc-a84d-92cbb68d22d1"
```

If both `user` and `uuid` are sent, `user` has priority.

Success response:

```json
{
  "username": "testuser",
  "count_connections": 1,
  "expiration_date": "31/12/2026",
  "expiration_days": 243,
  "limit_connections": 2
}
```

Unlimited account:

```json
{
  "username": "testuser",
  "count_connections": 0,
  "expiration_date": "Unlimited",
  "expiration_days": -1,
  "limit_connections": 1
}
```

Response fields:

| Field | Type | Description |
| --- | --- | --- |
| `username` | string | SSH username, Xray/V2Ray client name, or UUID. |
| `count_connections` | number | Current active SSH connections. |
| `expiration_date` | string | Expiration date in `DD/MM/YYYY` or `Unlimited`. |
| `expiration_days` | number | Remaining days. `-1` means unlimited. |
| `limit_connections` | number | Maximum connection limit. |

Common errors:

```json
{"error":"user or uuid parameter required"}
```

```json
{"error":"user not found"}
```

```json
{"error":"uuid not found"}
```

```json
{"error":"database not configured"}
```

### DNSTT scale guard for high-user servers

The integrated DNSTT service includes overload protection so thousands of DNS tunnel users cannot exhaust RAM or crash the whole panel as easily.

DNSTT config fields:

```json
{
  "dnstt": {
    "max_sessions": 10000,
    "max_streams": 15000,
    "pending_responses": 20000,
    "stream_buffer": 262144,
    "udp_read_buffer": 16777216,
    "udp_write_buffer": 16777216,
    "log_connections": false
  }
}
```

Values can be changed in the admin panel under **DNSTT Tunnel**. Use `0` to keep the safe default. Use `-1` only for `max_sessions` or `max_streams` if you intentionally want no hard limit.

Recommended busy-server values:

- `max_sessions`: `10000`
- `max_streams`: `15000`
- `pending_responses`: `20000`
- `stream_buffer`: `262144`
- `udp_read_buffer`: `16777216`
- `udp_write_buffer`: `16777216`
- `log_connections`: `false`

DNSTT now also recovers panics inside DNSTT goroutines, rejects new sessions/streams when limits are reached, and reports these counters in `/api/dnstt`. The admin panel shows them on the main **Dashboard** when DNSTT is enabled. If `dnstt` is disabled in the config, the dashboard card is hidden completely. `/api/dnstt` also returns an `enabled` flag. The old dashboard quick-action button card was removed:

- `active_sessions`
- `active_streams`
- `sess_rejected`
- `stream_rejected`
- `panic_recovered`
- `rec_dropped`
- `parse_err`
- `ch_len`

For very large DNSTT deployments, raise Linux socket buffer limits too, for example:

```bash
cat >/etc/sysctl.d/99-dragon-dnstt.conf <<'SYSCTL'
net.core.rmem_max=67108864
net.core.wmem_max=67108864
net.core.netdev_max_backlog=250000
net.ipv4.udp_mem=262144 524288 1048576
SYSCTL
sysctl --system
```

### DNSTT built-in local DNS / fake DNS over IPv6

DNSTT can now open an extra internal DNS listener for local testing without a second DNS server.
This listener feeds DNS tunnel packets directly into the same integrated DNSTT session pool and private key.

Example IPv6-only config:

```json
{
  "dnstt": {
    "domain": "t.example.com",
    "domains": ["t.example.com", "t.local.lan"],
    "udp_listen": "[::]:5300",
    "fake_dns_enabled": true,
    "fake_dns_listen": "[2001:db8::1234]:53",
    "fake_dns_domain": "t.local.lan",
    "fake_dns_workers": 4,
    "dns_response_workers": 1,
    "privkey_file": "/opt/sshpanel/dnstt.key"
  }
}
```

Notes:

- `fake_dns_listen` accepts IPv6 bracket syntax such as `[2001:db8::1234]:53` or `[::]:53`.
- IPv6 listeners are opened with `udp6`, so they do not try to reserve IPv4 port 53. This lets an existing IPv4 master DNS keep using IPv4 port 53 while DNSTT uses a new IPv6 address.
- The built-in local DNS listener only accepts `fake_dns_domain`, for example `t.local.lan`.
- `fake_dns_workers` adds concurrent UDP read/parse workers for the local DNS listener. Use `0` for the automatic default; `4` to `8` is a good starting range for busy servers.
- `dns_response_workers` shards DNS response sending. Keep it at `0` or `1` unless the DNSTT **Queue** grows under load; then test `2` to `4`.
- The normal `udp_listen` listener still accepts the full `domains` list.
- Port 53 may require root privileges or the `CAP_NET_BIND_SERVICE` capability.
- These fields can be changed from the admin panel under **DNSTT Tunnel**.
