# DragonCoreSSH V40

## PT-BR

DragonCoreSSH V40 é um painel/servidor em Go para SSH com HTTP Injection, painel web, PostgreSQL, integração com Xray-core/V2Ray e API pública para consultar status de usuários SSH e clientes Xray.

### Recursos principais

- SSH com HTTP Injection
- Painel web administrativo
- Banco de dados PostgreSQL
- Integração com Xray-core/V2Ray
- Configurador visual para VLESS e VMess
- Contas de revendedor (reseller) com cota de usuários e escopo próprio
- Gerenciamento multi-servidor (master/slave) direto pelo painel
- API HTTP completa para bots/automações (ver **HTTP API Reference**)
- API pública `/check` para consultar usuário ou UUID
- Aba de logs no painel para ver logs do sistema, DNSTT e Xray
- Túnel DNSTT integrado com proteção de escala e reinício automático
- DNS local embutido (fake DNS) em IPv4 ou IPv6 para testes sem um segundo servidor DNS
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

O painel do superadmin também mostra um cartão **Atualizações do painel** na tela inicial. Ele compara o commit compilado no servidor com o commit mais recente da branch configurada no Git. A verificação usa cache de 5 minutos; o botão **Verificar agora** força uma nova consulta.

Variáveis opcionais do serviço para apontar a verificação para outro Git/branch:

```text
DRAGON_UPDATE_REPO_URL=https://git.dr2.site/penguinehis/DragonCoreSSH-NewWEB.git
DRAGON_UPDATE_BRANCH=main
```

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

### Proteção de escala do DNSTT para servidores com muitos usuários

O serviço DNSTT integrado inclui proteção contra sobrecarga para que milhares de usuários do túnel DNS não esgotem a RAM nem derrubem o painel inteiro com facilidade.

Campos de configuração do DNSTT:

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

Os valores podem ser alterados no painel admin em **DNSTT Tunnel**. Use `0` para manter o padrão seguro. Use `-1` apenas em `max_sessions` ou `max_streams` se quiser intencionalmente não ter limite máximo.

Valores recomendados para servidor movimentado:

- `max_sessions`: `10000`
- `max_streams`: `15000`
- `pending_responses`: `20000`
- `stream_buffer`: `262144`
- `udp_read_buffer`: `16777216`
- `udp_write_buffer`: `16777216`
- `log_connections`: `false`

O DNSTT também recupera panics dentro das goroutines do DNSTT, rejeita novas sessões/streams quando os limites são atingidos e reporta esses contadores em `/api/dnstt`. O painel admin os mostra no **Dashboard** principal quando o DNSTT está ativado. Se `dnstt` estiver desativado na config, o card do dashboard fica oculto. `/api/dnstt` também retorna um campo `enabled`. Contadores expostos:

- `active_sessions`
- `active_streams`
- `sess_rejected`
- `stream_rejected`
- `panic_recovered`
- `rec_dropped`
- `parse_err`
- `ch_len`

Para implantações muito grandes, aumente também os limites de buffer de socket do Linux, por exemplo:

```bash
cat >/etc/sysctl.d/99-dragon-dnstt.conf <<'SYSCTL'
net.core.rmem_max=67108864
net.core.wmem_max=67108864
net.core.netdev_max_backlog=250000
net.ipv4.udp_mem=262144 524288 1048576
SYSCTL
sysctl --system
```

### DNS local embutido / fake DNS (IPv4 e IPv6)

O DNSTT pode abrir um listener DNS interno extra para testes locais/LAN sem precisar de um segundo servidor DNS. Esse listener injeta os pacotes do túnel DNS diretamente no mesmo pool de sessões e chave privada do DNSTT integrado.

O DNS local embutido funciona em **IPv4 e IPv6**. A família de endereço é escolhida automaticamente a partir de `fake_dns_listen`: um endereço IPv4 abre um socket `udp4`, e um endereço IPv6 (entre colchetes) abre um socket `udp6`.

Exemplo IPv4:

```json
{
  "dnstt": {
    "domain": "t.example.com",
    "domains": ["t.example.com", "t.local.lan"],
    "udp_listen": "0.0.0.0:5300",
    "fake_dns_enabled": true,
    "fake_dns_listen": "192.168.0.10:53",
    "fake_dns_domain": "t.local.lan",
    "fake_dns_workers": 4,
    "dns_response_workers": 1,
    "privkey_file": "/opt/sshpanel/dnstt.key"
  }
}
```

Exemplo IPv6:

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

Notas:

- `fake_dns_listen` aceita um endereço IPv4 (`192.168.0.10:53`, `0.0.0.0:53`) ou um endereço IPv6 entre colchetes (`[2001:db8::1234]:53`, `[::]:53`). Se ficar vazio com `fake_dns_enabled` em `true`, o padrão é `[::]:53`.
- A família do socket é escolhida pelo endereço: IPv4 → `udp4`, IPv6 → `udp6`. Um listener `udp6` não tenta reservar a porta 53 em IPv4, então um DNS master IPv4 existente pode continuar usando a porta 53 em IPv4 enquanto o DNSTT usa um novo endereço IPv6. Da mesma forma, um listener `udp4` num IPv4 específico evita conflito com um servidor DNS IPv6.
- O DNS local embutido só aceita `fake_dns_domain`, por exemplo `t.local.lan`. Se vazio, o padrão é `t.local.lan`. Essa zona também é adicionada à lista `domains` do listener principal.
- Se `fake_dns_listen` apontar para o mesmo endereço de `udp_listen`, o listener separado é ignorado e o listener DNSTT principal é usado.
- `fake_dns_workers` adiciona workers de leitura/parse UDP concorrentes para o DNS local. Use `0` para o padrão automático; `4` a `8` é uma boa faixa inicial para servidores movimentados.
- `dns_response_workers` distribui o envio de respostas DNS em shards. Mantenha em `0` ou `1` a menos que a **Queue** do DNSTT cresça sob carga; então teste `2` a `4`.
- O listener normal `udp_listen` continua aceitando toda a lista `domains`.
- A porta 53 pode exigir privilégios de root ou a capability `CAP_NET_BIND_SERVICE`.
- Esses campos podem ser alterados no painel admin em **DNSTT Tunnel**.

---

## EN-US

DragonCoreSSH V40 is a Go-based SSH HTTP Injection server with a web panel, PostgreSQL, Xray-core/V2Ray integration, and a public API for checking SSH users and Xray clients.

### Main features

- SSH with HTTP Injection
- Administrative web panel
- PostgreSQL database
- Xray-core/V2Ray integration
- Visual configurator for VLESS and VMess
- Reseller accounts with a user quota and self-scoped access
- Multi-server (master/slave) management directly from the panel
- Full HTTP API for bots/automations (see **HTTP API Reference**)
- Public `/check` API for checking username or UUID
- Logs tab in the panel for system, DNSTT, and Xray logs
- Integrated DNSTT tunnel with scale protection and auto restart
- Built-in local DNS (fake DNS) on IPv4 or IPv6 for testing without a second DNS server
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

The superadmin dashboard also shows a **Panel Updates** card. It compares the commit compiled into the running server with the latest commit on the configured Git branch. Results are cached for 5 minutes; **Check now** forces a fresh lookup.

Optional service variables for a different repository/branch:

```text
DRAGON_UPDATE_REPO_URL=https://git.dr2.site/penguinehis/DragonCoreSSH-NewWEB.git
DRAGON_UPDATE_BRANCH=main
```

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

### DNSTT built-in local DNS / fake DNS (IPv4 and IPv6)

DNSTT can open an extra internal DNS listener for local/LAN testing without a second DNS server.
This listener feeds DNS tunnel packets directly into the same integrated DNSTT session pool and private key.

The built-in local DNS listener works on **both IPv4 and IPv6**. The address family is chosen
automatically from `fake_dns_listen`: an IPv4 address opens a `udp4` socket, and an IPv6 address
(bracket form) opens a `udp6` socket.

IPv4 example:

```json
{
  "dnstt": {
    "domain": "t.example.com",
    "domains": ["t.example.com", "t.local.lan"],
    "udp_listen": "0.0.0.0:5300",
    "fake_dns_enabled": true,
    "fake_dns_listen": "192.168.0.10:53",
    "fake_dns_domain": "t.local.lan",
    "fake_dns_workers": 4,
    "dns_response_workers": 1,
    "privkey_file": "/opt/sshpanel/dnstt.key"
  }
}
```

IPv6 example:

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

- `fake_dns_listen` accepts an IPv4 address (`192.168.0.10:53`, `0.0.0.0:53`) or an IPv6 address in bracket form (`[2001:db8::1234]:53`, `[::]:53`). If left empty while `fake_dns_enabled` is `true`, it defaults to `[::]:53`.
- The socket family is selected from the address: IPv4 → `udp4`, IPv6 → `udp6`. A `udp6` listener does not try to reserve IPv4 port 53, so an existing IPv4 master DNS can keep IPv4 port 53 while DNSTT uses a new IPv6 address. Likewise a `udp4` listener on a specific IPv4 address avoids clashing with an IPv6 DNS server.
- The built-in local DNS listener only accepts `fake_dns_domain`, for example `t.local.lan`. If empty, it defaults to `t.local.lan`. The zone is also added to the main listener's `domains` list.
- If `fake_dns_listen` resolves to the same address as `udp_listen`, the separate listener is skipped and the main DNSTT listener is used instead.
- `fake_dns_workers` adds concurrent UDP read/parse workers for the local DNS listener. Use `0` for the automatic default; `4` to `8` is a good starting range for busy servers.
- `dns_response_workers` shards DNS response sending. Keep it at `0` or `1` unless the DNSTT **Queue** grows under load; then test `2` to `4`.
- The normal `udp_listen` listener still accepts the full `domains` list.
- Port 53 may require root privileges or the `CAP_NET_BIND_SERVICE` capability.
- These fields can be changed from the admin panel under **DNSTT Tunnel**.

---

## HTTP API Reference

**PT-BR:** Esta seção documenta todos os endpoints HTTP do painel para quem quer integrar bots do Telegram, painéis web externos, automações, etc., sem precisar ler o código-fonte. Além da API pública `/check` (sem autenticação), todos os endpoints administrativos usam o cabeçalho `X-Session-Token`.

**EN-US:** This section documents every HTTP endpoint of the panel so you can build Telegram bots, external web panels, automations, etc. without reading the source. Besides the public `/check` API (no auth), all admin endpoints use the `X-Session-Token` header.

Base URL: `http://SERVER_IP:9090` (the web panel + API port).

### Authentication model

- All authenticated calls use the `X-Session-Token` request header (no cookies). Obtain a token from `POST /api/auth/login`.
- Auth levels used in this doc:
  - **None** — public, no token required.
  - **Session** — any valid logged-in session (superadmin or reseller). Missing/invalid token → `401`.
  - **Superadmin** — a valid session whose role is `superadmin`. Non-superadmin → `403`; missing token → `401`.
- Roles: `superadmin` and `reseller`. Resellers are automatically scoped to their own users/clients and limited by their user quota.
- Method mismatch on most handlers returns `405`. Invalid JSON bodies return `400 invalid json`.
- Error responses from the API are `text/plain` bodies (the message strings shown below) with the noted HTTP status code — **not** JSON. Success bodies are JSON (or empty for `201`/`204`).
- Send `Content-Type: application/json` on every POST that takes a body.
- `expires_at` accepts RFC3339 (e.g. `2026-12-31T23:59:59Z`). Xray client endpoints additionally accept `YYYY-MM-DDThh:mm` and `YYYY-MM-DD`.
- Only `/check` sends permissive CORS (`*`). The authenticated routes have no CORS/OPTIONS handling and are meant for server-to-server or same-origin use.

### Managed servers (`server_id`) — master/slave

Many endpoints accept an optional `server_id` query param (alias `server`), or `server_id` JSON field on create/add calls. When it names a remote managed slave node, the master proxies the request to that node and returns its response verbatim. Empty, `0`, `local`, or the local id means "this server". Proxy failures return `502` with `remote server error: ...`. Endpoints below note when `server_id` is supported.

### Quick auth example

```bash
# 1) Log in and capture the token
TOKEN=$(curl -s -X POST "http://SERVER_IP:9090/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_PASSWORD"}' | jq -r .token)

# 2) Use the token on any authenticated endpoint
curl -s "http://SERVER_IP:9090/api/users" -H "X-Session-Token: $TOKEN"
```

---

### Auth

#### `POST /api/auth/login` — none
- Body: `username` (string, required), `password` (string, required).
- `200`: `{ "token": string, "username": string, "role": string }`.
- Errors: `400` username/password required or invalid json; `401 invalid credentials`; `403 account suspended` / `account expired`.

#### `POST /api/auth/logout` — session
- No body. Deletes the session for the supplied `X-Session-Token`. Returns `200` (empty).

#### `GET /api/auth/me` — session
- `200`: `{ "username": string, "role": string }`. If the role is `reseller`, it also includes `max_users` (int), `used_users` (int, combined SSH+Xray), `used_ssh_users` (int), `used_xray_users` (int), `expires_at` (string RFC3339 or null), `is_active` (bool).

---

### SSH users

#### `GET /api/users` — session
- Optional query: `server_id`. Resellers see only their own users; superadmins see all.
- `200`: array of user objects: `username` (string), `active_conns` (int), `max_connections` (int), `expires_at` (string/null), `limit_mbps_up` (int), `limit_mbps_down` (int), `totp_secret` (string, omitempty), `totp_period` (int), `totp_window` (int), `totp_digits` (int), `allow_static_password` (bool), `totp_enabled` (bool), `owner_username` (string, omitempty), `server_id` (string, omitempty).

#### `POST /api/users/create` — session
Creates or updates (upsert) an SSH user.
- Body: `username` (string, required); `password` (string, optional — empty keeps the existing password on an existing user; for a new user either `password` or `totp_secret` is required); `max_connections` (int); `expires_at` (string); `limit_mbps_up` (int); `limit_mbps_down` (int); `totp_secret` (string); `totp_period` (int); `totp_window` (int); `totp_digits` (int); `allow_static_password` (bool); `owner_username` (string, optional — honored only for superadmin; resellers are forced to themselves); `server_id` (string, optional).
- `201 Created` (empty body). A proxied create returns the remote node's status/body.
- Errors: `400 username required`, `400 password or totp_secret required for new user`; `403 user limit reached (N)`; `403 SSH creation is disabled for this server`; `503 database not configured`.

#### `DELETE /api/users/delete` — session
- Query: `username` (string, required); optional `server_id`. Resellers may delete only their own users.
- `204 No Content`. Errors: `400 username required`; `403 forbidden`; `503 database not configured`.

---

### Stats & bandwidth

#### `GET /api/stats` — session
- Optional query: `server_id`.
- `200`: `{ "cpu_percent": float, "mem_total_bytes": uint, "mem_used_bytes": uint, "mem_avail_bytes": uint, "mem_percent": float, "interfaces": [ { "name": string, "rx_bytes": uint, "tx_bytes": uint, "rx_mbps": float, "tx_mbps": float } ] }`.

#### `POST /api/stats/interfaces/reset` — superadmin
- No body. Resets persisted per-interface byte totals to the current kernel counters. `200`: `{ "ok": true }`. Errors: `503`, `500`.

#### `GET /api/vnstat` — superadmin
- Query: `days` (int, optional, default 31), `months` (int, optional, default 12).
- `200`: interface usage dataset (daily/monthly aggregates). Errors: `503 database not configured`; `500 db error`.

#### `POST /api/vnstat/reset` — superadmin
- No body. Clears stored vnstat usage. `200`: `{ "ok": true }`. Errors: `503`, `500 db error`.

---

### Logs

#### `GET /api/system/logs` — superadmin
- Query: `source` (`panel` (default), `dnstt`, or `xray`); `lines` (int, optional, default 300, max 2000).
- `200`: `{ "source": string, "path": string (panel only), "lines": string[] }`.

#### `POST /api/system/logs/reset` — superadmin
- No body. Truncates the panel log file. `200`: `{ "ok": true, "path": string, "max_bytes": int }`. Error: `500`.

---

### DNSTT

#### `GET /api/dnstt` — superadmin
- Optional query: `server_id`.
- `200`: 5-second stats snapshot: `timestamp` (string), `enabled` (bool), `running` (bool); uint counters `dns_rx`, `parse_err`, `no_edns`, `limit512`, `rec_queued`, `rec_dropped`, `resp_sent`, `resp_bytes`, `resp_empty`, `resp_data`, `resp_oversize`, `kcp_new`, `kcp_end`, `smux_new`, `smux_end`, `sess_rejected`, `stream_rejected`, `panic_recovered`; `active_sessions` (int64), `active_streams` (int64), `ch_len` (int), `fake_dns_workers` (int, omitempty), `dns_response_workers` (int, omitempty).

#### `GET /api/dnstt/logs` — superadmin
- `200`: array of log line strings (empty array if uninitialized). Does not proxy to managed servers.

#### `POST /api/dnstt/genkey` — superadmin
- No body. Generates a new Noise keypair and writes the private key to the configured key file. `200`: `{ "privkey_file": string, "pubkey": string }`. Error: `500`. Supports `server_id` proxying.

#### `GET /api/dnstt/pubkey` — superadmin
- No body. Returns the public key derived from the configured private key. `200`: `{ "pubkey": string }`. Error: `500`. Supports `server_id` proxying.

---

### Resellers (superadmin only)

#### `GET /api/resellers` — superadmin
- `200`: array of `{ "id": int, "username": string, "role": string, "max_users": int, "used_users": int, "used_ssh_users": int, "used_xray_users": int, "expires_at": string/null, "is_active": bool, "created_at": string }`.

#### `POST /api/resellers/create` — superadmin
Creates or updates a reseller (upsert by username).
- Body: `username` (string, required); `password` (string, optional — required only when creating; if given on an existing account it is changed); `max_users` (int); `expires_at` (string, optional RFC3339; empty clears expiry); `is_active` (bool).
- `201 Created` (empty). Errors: `400 username required`, `400 password required for new account`, `400 invalid expires_at (RFC3339 required)`; `500 db error`.

#### `DELETE /api/resellers/delete` — superadmin
- Query: `username` (string, required). Also disconnects/removes the reseller's owned SSH users and Xray clients.
- `204 No Content`. Errors: `400 username required`; `500 db error`.

---

### Managed servers (superadmin, except list)

#### `/api/servers` — GET: session · POST/DELETE: superadmin
Accepts `GET`, `POST`, `DELETE`.
- **GET**: list servers. Resellers see only active servers with `admin_username` blanked. The local server is always first. `200`: array of `{ "id": string, "name": string, "base_url": string, "admin_username": string, "enable_ssh": bool, "enable_xray": bool, "is_active": bool, "is_local": bool, "created_at": string, "updated_at": string }`.
- **POST**: upsert a slave node. Body: `id` (string), `name` (string), `base_url` (string), `admin_username` (string), `admin_key` (string), `enable_ssh` (bool), `enable_xray` (bool), `is_active` (bool). `200`: the created/updated server object.
- **DELETE**: query `id` (int, required, > 0). `204`. Errors: `400 invalid server id`; `403 forbidden`.
- All methods: `503 database not configured`.

#### `POST /api/servers/test` — superadmin
Tests connectivity/credentials to a managed node (remote login + `/api/auth/me`).
- Body: `base_url`, `admin_key` (or password), `admin_username` (default `admin`), `id`, `enable_ssh`, `enable_xray`. If `id` matches a stored server, missing fields are filled from the DB.
- `200`: `{ "ok": true, "message": "remote login ok" }`. Errors: `400 base url and admin key/password required`; `502` on remote failure; `503`.

#### `/api/servers/config` — superadmin (GET or POST)
Read/write a managed server's `config.json`. Query: `server_id`. Local delegates to `/api/server/config`; remote proxies GET/POST to that node (POST body ≤ 512 KiB).

---

### Xray-core

#### `GET /api/xray/status` — session
- Optional query: `server_id`. For resellers, `online_users` counts only their own clients.
- `200`: `{ "enabled": bool, "running": bool, "mode": string, "native": bool, "pid": int, "uptime": string, "error": string, "online_users": int, "stats_error": string, "stats_configured": bool, "stats_missing": string[], "api_server": string, "last_stats_poll": string/null, "online_window_seconds": int }`.

#### `POST /api/xray/start` · `POST /api/xray/stop` · `POST /api/xray/restart` — superadmin
- No body; optional `server_id`. `200` (empty) on success; `500` with message on error.

#### `POST /api/xray/stats/repair` — superadmin
- No body; optional `server_id`. Ensures the Stats API config and restarts Xray if it was running.
- `200`: `{ "changed": bool, "restarted": bool, "stats_configured": bool, "stats_missing": string[], "api_server": string }`. Errors: `400`, `500`.

#### `/api/xray/config` — superadmin (GET or POST)
- Optional `server_id`. **GET** returns the raw Xray config JSON. **POST** replaces it — body is the full Xray config JSON (≤ 512 KiB), validated then saved. `200` on success; `400` on invalid config; `500` on read.

#### `GET /api/xray/logs` — superadmin
- Optional `server_id`. `200`: `{ "lines": string[] }`.

#### `GET /api/xray/inbounds` — session
- Optional `server_id`. Lists only inbounds that carry client lists (vless/vmess/trojan). Resellers see all inbounds but only their own clients. Clients are enriched with DB metadata and runtime stats.
- `200`: array of `{ "tag": string, "protocol": string, "port": <raw>, "listen": string, "clients": [ XrayClientInfo ] }`.
- **XrayClientInfo**: `id` (string, the UUID), `password` (string, omitempty), `email` (string), `level` (int), `online` (bool), `last_active` (string/null), `uplink_bytes` (int64), `downlink_bytes` (int64), `total_bytes` (int64), `active_connections` (int), `name` (string), `expires_at` (string/null), `expiration_days` (int; `-1` = no expiry, `0` = expired), `max_conns`, `owner_username`, `expired`.

#### `POST /api/xray/clients/add` — session
- Body: `inbound_tag` (string, required), `uuid` (string, required), `email` (string, optional — defaults to name then uuid), `name` (string, optional), `expires_at` (string, optional), `max_connections` (int), `owner_username` (string, optional — superadmin only), `server_id` (string, optional).
- `201 Created` (empty). Errors: `400 inbound_tag and uuid required` / `UUID already exists in database`; `403 reseller account suspended or expired` / `user limit reached (N)` / `Xray creation is disabled for this server`; `500`.

#### `POST /api/xray/clients/update` — session
- Body: `uuid` (string, required), `name` (string), `email` (string), `expires_at` (string), `max_connections` (int), `server_id` (string, optional). Inbound tag and owner are preserved from existing metadata. Resellers may update only their own clients.
- `200`. Errors: `400 uuid required`; `403 forbidden`; `404 client metadata not found`; `500`.

#### `DELETE /api/xray/clients/remove` — session
- Query: `inbound_tag` (string, required), `uuid` (string, required); optional `server_id`. Resellers may remove only their own clients.
- `204 No Content`. Errors: `400 inbound_tag and uuid required`; `403 forbidden`; `500`.

---

### TLS certificates (superadmin only)

All three accept `POST` only and support `server_id` proxying.

#### `POST /api/tls/generate-selfsigned`
- Body: `domain` (string, required). Writes a self-signed ECDSA (P-256) cert (10-year validity) to `/opt/sshpanel/certs/<domain>/`.
- `200`: `{ "cert_file": string, "key_file": string }`. Errors: `400 domain required`; `500`.

#### `POST /api/tls/letsencrypt`
- Body: `domain` (string, required), `email` (string, required). Runs `certbot certonly --standalone` (requires certbot and a free port 80).
- `200`: `{ "cert_file": string, "key_file": string, "output": string }`. Errors: `400 domain and email required`; `500 certbot failed: ...`.

#### `POST /api/tls/upload-pem`
- Body: `name` (string, required), `cert` (string, required — PEM), `key` (string, required — PEM). Saves to `/opt/sshpanel/certs/<name>/`.
- `200`: `{ "cert_file": string, "key_file": string }`. Errors: `400 name, cert, and key required` / `invalid name`; `500`.

---

### Panel config

#### `/api/server/config` — superadmin (GET or POST)
Reads/writes the panel's `config.json` and hot-applies changes.
- **GET**: returns the raw config file JSON.
- **POST**: body is the full config JSON (≤ 512 KiB). Validated (`listen` required), the file-based `users` array is preserved, ports normalized, then written to disk and applied live.
  - `200`: reload report `{ "applied": bool, "warnings": string[], "services": { "<name>": ServiceReloadStatus } }`.
  - Errors: `400 invalid JSON: ...` / `listen address required`; `500 config path not set` / read/write errors.

---

### Public — CheckUser

#### `GET /check` — none
Public status lookup for SSH users and Xray/V2Ray UUIDs (CORS `*`). See the **Public CheckUser API** section above for query params, response fields, and examples.
