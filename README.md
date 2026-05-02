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
/etc/systemd/system/sshpanel.service
```

### Portas padrão

```text
80      SSH com HTTP Injection
8080    SSH extra com HTTP Injection
9090    Painel web + API pública /check
10086   Xray VLESS
10087   Xray VMess
10088   SOCKS local em 127.0.0.1
```

Libere no firewall apenas as portas que você realmente usa. Exemplo com `ufw`:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 8080/tcp
sudo ufw allow 9090/tcp
sudo ufw allow 10086/tcp
sudo ufw allow 10087/tcp
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

### Atualização

Entre na pasta do projeto atualizado e execute:

```bash
sudo bash update.sh
```

O update recompila o binário e atualiza os arquivos do painel web, mantendo as configurações e dados existentes.

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
/etc/systemd/system/sshpanel.service
```

### Default ports

```text
80      SSH with HTTP Injection
8080    Extra SSH with HTTP Injection
9090    Web panel + public /check API
10086   Xray VLESS
10087   Xray VMess
10088   Local SOCKS on 127.0.0.1
```

Open only the ports that you actually use. Example with `ufw`:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 8080/tcp
sudo ufw allow 9090/tcp
sudo ufw allow 10086/tcp
sudo ufw allow 10087/tcp
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

Restart service:

```bash
systemctl restart sshpanel
```

### Update

Enter the updated source-code folder and run:

```bash
sudo bash update.sh
```

The update script rebuilds the binary and updates the web panel files while keeping existing configuration and user data.

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
