# DragonCoreSSH V40

## PT-BR

DragonCoreSSH V40 é um painel/servidor em Go para SSH com HTTP Injection, painel web, PostgreSQL, integração com Xray-core/V2Ray e API pública para consultar status de usuários SSH e clientes Xray.

### Recursos principais

- SSH com HTTP Injection
- Endpoint SSH raw interno sempre ativo em `127.0.0.1:2222` para proxies e túneis locais
- Painel web administrativo
- Banco de dados PostgreSQL
- Integração com Xray-core/V2Ray
- Configurador visual para VLESS e VMess
- Editor visual completo de inbounds (criar, editar, duplicar e remover)
- Endpoint XHTTP compartilhado no modo nativo: VLESS **ou** VMess em `/` e SSH em `/ssh`, usando o mesmo domínio/porta/TLS
- Área compacta de infraestrutura com Servidores, Status, Monitoramento e Tráfego no mesmo seletor visual
- Cartões de status ao vivo nos espaços SSH, Xray e Infraestrutura, com confirmações integradas ao painel
- Listas de usuários SSH e Xray com botões de ordenação e filtros por status, conexão, uso, validade e cota, além de cabeçalhos clicáveis
- Velocidade ao vivo (subida/descida) por conta nas listas SSH e Xray, somando todas as conexões do usuário, com ordenação por velocidade
- Listas de usuários em formato de cartão no celular: cada linha vira um cartão com rótulos, sem rolagem lateral
- Navegação interna consistente com o Bot: SSH/SlowDNS e Revendedores separam consulta de cadastro; Xray separa Usuários, Criar usuário, Configuração e Logs; Configurações separa Rede/SSH, SlowDNS, UDP, TLS e Xray
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

### Endpoint XHTTP compartilhado

Na aba **Xray → Configuração Xray → Visual**, o cartão **Shared XHTTP endpoint** cria dois inbounds na mesma porta:

- VLESS **ou** VMess em `/` (selecione um protocolo raiz);
- SSH sobre XHTTP em `/ssh`, autenticado pelas contas SSH normais do painel.

O listener HTTP interno escolhe o caminho mais específico, portanto `/ssh` é encaminhado ao servidor SSH antes do inbound raiz. Todos os inbounds na mesma porta devem usar a mesma opção TLS e o mesmo certificado. Esse recurso exige o modo **Internal native emulator**; o binário Xray externo não reconhece o protocolo `ssh` específico do DragonCore.

Para configurações XHTTP antigas, carregue a configuração visual e clique em **Ativar SSH /ssh** no cartão VLESS/VMess existente. O painel preserva o inbound original, seus clientes, path, host, modo, opções avançadas e TLS; cria apenas o inbound SSH correspondente na mesma porta e salva/reinicia o Xray. Não é necessário recriar clientes ou o endpoint.

A confirmação dessa migração é exibida dentro do próprio painel. Se a gravação falhar, o inbound SSH temporário é removido do rascunho e o inbound antigo permanece intacto, permitindo tentar novamente após corrigir o erro exibido.

### Cota de tráfego e proteção de recursos

Contas SSH e clientes VLESS/VMess do modo nativo podem usar `data_quota_bytes` com ação `block` ou `throttle`. O botão **Reset/Zerar tráfego** limpa apenas os contadores; não renova validade, senha ou configuração da conta. Não existe reset periódico automático no servidor: qualquer período comercial mostrado no site é independente e o reset ocorre somente por ação explícita no painel/API. O valor `max_conns` é aplicado no momento em que o usuário VLESS/VMess é autenticado e vale em conjunto para TCP, UDP, WebSocket, XHTTP e conexões Mux (uma conexão Mux autenticada conta como uma conexão, independentemente dos streams filhos).

As antigas chaves globais de admissão continuam no JSON somente para compatibilidade, mas são sempre normalizadas para `-1` (ilimitado), inclusive quando um `config.json` antigo ainda contém `4096`, `8192`, `32768` ou outro valor positivo:

- `max_concurrent_connections`: sem limite global de conexões de transporte;
- `max_concurrent_xhttp_requests`: sem limite global de requisições XHTTP;
- `xhttp_max_sessions`: sem limite global de sessões XHTTP.

O painel não expõe mais esses três controles como limites ajustáveis. Xray XHTTP e XHTTP SSH usam o mesmo listener VPN sem teto por quantidade de requisições, streams HTTP/2, conexões de transporte ou sessões XHTTP. Rajadas de `packet-up` e a remontagem fora de ordem usam backpressure cancelável contabilizado em bytes; até pacotes vazios consomem um custo mínimo de memória contabilizada, portanto remover o limite por quantidade não cria uma fila de metadados sem limite. Não existem respostas `429` nem rejeições `503` por capacidade global. As políticas reais por usuário (`max_conns`, cota e banda) continuam ativas. Cada transporte Mux aceita no máximo 64 sessões filhas, com limite global padrão de 32768. Parar/reiniciar o Xray nativo fecha conexões e sessões existentes. Atualizações de tráfego e de conexões ativas são agregadas e persistidas em lote a cada cinco segundos, sem criar uma goroutine ou consulta PostgreSQL por conexão. Entradas pendentes de usuários removidos são descartadas para manter os mapas de retry limitados ao conjunto atual de contas.

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
2222    SSH raw interno em 127.0.0.1 (não público)
53/udp  DNS público para DNSTT, redirecionado para 5300/udp
5300/udp DNSTT interno
8880    BHTTP (BHP1/BHP2) — desativado por padrão; pode compartilhar 80/8080/443
7300    BTUN TCP — desativado por padrão; pode compartilhar 80/8080/443
8181    HCR (HTTP/Custom Relay) — desativado por padrão; pode compartilhar 80/8080/443
7300/udp BTUN UDP — desativado por padrão
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

### Endpoint SSH interno para proxies locais

O processo do DragonCore mantém um listener SSH raw separado em `127.0.0.1:2222`. Ele usa as mesmas contas, autenticação, cotas, limites de conexão e banda do SSH público, mas não executa a limpeza de cabeçalhos HTTP. O listener inicia junto com o serviço `sshpanel`, continua aberto durante reinícios automáticos dos listeners públicos e pode ser configurado em **Configurações → Rede/SSH → Internal Raw SSH**.

Um proxy/túnel executado no mesmo servidor pode usar diretamente:

```text
Host: 127.0.0.1
Porta: 2222
Tipo: SSH raw
Usuário/senha: uma conta SSH do painel
```

Por exemplo, para criar um SOCKS local com o cliente OpenSSH:

```bash
ssh -N -D 127.0.0.1:1080 -p 2222 usuario@127.0.0.1
```

Não abra a porta `2222` no firewall: o servidor aceita para `local_ssh_listen` somente IPs loopback numéricos (`127.0.0.0/8` ou `::1`) e volta ao padrão seguro se receber um endereço público, wildcard ou inválido. Em contêineres, `127.0.0.1` aponta para o próprio contêiner; use rede host ou outra integração local apropriada para alcançar o listener do host.


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
  "udp_listen": "0.0.0.0:5300",
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
  "udp_listen": "0.0.0.0:5300",
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

### BHTTP (BHP1 / BHP2)

O BHTTP é o transporte TCP ofuscado usado pelos apps da família DTunnel. O cliente abre um socket TCP comum, opcionalmente envia uma requisição HTTP como cobertura, e em seguida fala o enquadramento BHTTP (cabeçalho de 29 bytes) com os modos *probe*, *upload*, *download*, *batch* e *ACK*. O BHP2 adiciona *lanes* persistentes com `resume` e ACK cumulativo de upload.

Cada sessão BHTTP é entregue ao **servidor SSH embutido do próprio painel**, exatamente como o DNSTT faz. Não existe conexão com o `sshd` do sistema, nem com PAM ou `/etc/shadow`: as contas, validade, TOTP, `max_connections`, limites de banda e cotas de dados do painel valem sem nenhuma configuração extra.

#### Compartilhar as portas 80, 8080 e 443

O BHTTP pode atender **nas portas que o painel já usa**, sem porta dedicada e sem atrapalhar o resto. Isso funciona porque os três protocolos começam de formas incompatíveis: um quadro BHTTP começa com o número do modo (`0`–`5`), o SSH começa com `S` (`0x53`) e uma linha HTTP começa com a letra do método. O primeiro byte já separa os três.

Como um cliente de injeção HTTP pode mandar lixo antes do payload, um byte baixo sozinho não basta. Então o cabeçalho de 29 bytes também é validado e, nos dois modos que carregam assinatura — o *probe* que abre toda sessão e o *lane hello* do v2 — a assinatura (`BHP1`/`BHP2`, `BLN2`) é descriptografada e conferida. Como a chave vem do próprio session ID do cabeçalho, lixo não passa por acaso. Nada é consumido quando o veredito é negativo: a conexão segue para o caminho HTTP/SSH normal com os bytes intactos.

Ligue em **Configurações → BHTTP → Compartilhar as portas do painel**. Vale para `listen`, `extra_listen` e todos os encaminhadores TLS. Com isso ligado o campo **Listen** pode ficar vazio: o BHTTP passa a existir só nas portas compartilhadas.

Uma única coisa muda para os outros clientes: hoje a porta do proxy responde `HTTP/1.1 101` assim que o socket abre, antes de ler qualquer coisa; com o compartilhamento ligado ela espera os primeiros bytes do cliente (no máximo 3s) antes de decidir. Isso é necessário porque um cliente BHTTP não pode receber esse 101 sem querer. Todo cliente conhecido — de injeção HTTP ou BHTTP — envia seus bytes imediatamente ao conectar, e um cliente que não enviar nada em 3s cai no caminho antigo. Se algum cliente seu aguardar o 101 antes de falar, desmarque a opção.

Configure em **Configurações → BHTTP**:

- **Compartilhar as portas do painel** — aceita BHTTP em 80/8080 e 443 junto com SSH e injeção HTTP, como descrito acima.
- **Listen** — porta dedicada, um endereço por linha, opcional quando o compartilhamento está ligado. As portas 80 e 8080 pertencem ao proxy HTTP+SSH: para usá-las, ligue o compartilhamento em vez de listá-las aqui. O padrão, sem compartilhamento, é `0.0.0.0:8880`.
- **Session Timeout** — tempo sem tráfego antes de derrubar a sessão e fechar seu SSH. Também limita por quanto tempo um `resume` do BHP2 continua possível.
- **Max v2 Lanes Per Session** — teto de lanes simultâneas por sessão (`0` usa 128).
- **Max Sessions** / **Max Client Sockets** — tetos globais. `0` usa o padrão (10000) e `-1` remove o limite. Sockets acima do teto são fechados antes de qualquer trabalho de protocolo.
- **Auto Restart Interval** / **Restart Grace Delay** — restart forte que fecha somente os listeners BHTTP e suas sessões. Não reinicia o painel nem a VPS. Intervalo mínimo de 1m.
- **Disable Console Log** / **Verbose Connection Logs** — os logs continuam disponíveis em `/api/bhttp/logs` mesmo com o console desligado.

O card **Status BHTTP** na mesma aba mostra sessões e sockets ativos, bytes trafegados, probes BHP1/BHP2, lanes anexadas e rejeitadas, falhas ao abrir o alvo SSH e erros de protocolo.

### BTUN (DTUNNEL/1.1)

O BTUN é a VPN nativa por pacotes IP: o cliente faz o handshake `DTUNNEL/1.1 CLIENT_HELLO` em TCP ou UDP, autentica, recebe um IPv4 de uma sub-rede privada e passa a trocar pacotes IP com uma interface TUN criada por este processo.

Diferente do BHTTP e do DNSTT, o BTUN **não** carrega um fluxo SSH — ele carrega pacotes IP. Por isso a autenticação não passa pelo `handleConn`, e sim direto pelo banco de contas do painel: mesmo usuário e senha (ou TOTP), mesma validade, mesmo dono/revendedor, mesma cota de dados e o mesmo `max_connections`. **Não existe caminho PAM nem `/etc/shadow` no BTUN**, e a opção `pam_auth_enabled` (que é uma configuração do SSH) não se aplica a ele.

Cada sessão BTUN conta no `max_connections` da conta junto com as conexões SSH, respeita `limit_mbps_up`/`limit_mbps_down` e consome a mesma cota de dados. Excluir, editar ou expirar um usuário derruba as sessões BTUN dele igual às conexões SSH.

#### Compartilhar as portas 80, 8080 e 443

O BTUN também pode atender nas portas que o painel já usa. A detecção aqui é ainda mais direta que a do BHTTP: uma sessão BTUN começa com o marcador fixo `DTUNNEL/1.1 CLIENT_HELLO`, que nenhum banner SSH e nenhuma linha HTTP pode igualar. A conexão só vai para o BTUN quando esses 25 bytes batem exatamente no início; qualquer outra coisa segue intacta para o caminho normal.

Duas limitações, ambas por natureza do compartilhamento:

- **Vale só para TCP.** O painel não tem porta UDP compartilhada, então clientes UDP continuam precisando de **UDP Listen**.
- **Cover bytes.** Numa porta dedicada o BTUN tolera lixo arbitrário antes do hello. Numa porta compartilhada o marcador precisa estar no começo, porque não dá para guardar um prefixo sem limite enquanto o SSH espera atrás. Cover em forma de requisição HTTP funciona — a limpeza de injeção do painel consome a requisição e o marcador reaparece no início — mas nesse caso o cliente recebe antes a resposta `101`/`200` do painel e precisa ignorá-la. Para qualquer outro formato de cover, use a porta dedicada.

Ligue em **Configurações → BTUN → Compartilhar as portas do painel**. Com isso ligado, **TCP Listen** pode ficar vazio.

Configure em **Configurações → BTUN**:

- **Compartilhar as portas do painel** — aceita BTUN em 80/8080 e 443 junto com SSH, injeção HTTP e BHTTP, como descrito acima. Somente TCP.
- **TCP Listen** / **UDP Listen** — deixe um em branco para desativar aquele transporte. Sem o compartilhamento, pelo menos um é obrigatório; o padrão é `0.0.0.0:7300` nos dois.
- **TUN Interface** — interface criada e usada por este processo (padrão `btun0`). Não pode colidir com uma interface de outro serviço.
- **Client Subnet** / **Gateway** / **MTU** — faixa IPv4 entregue aos clientes (padrão `10.77.0.0/16`), endereço da própria interface (derivado da sub-rede quando vazio) e MTU (padrão 1400).
- **Manage Routing** — quando ligado, o painel configura o endereço da interface, `net.ipv4.ip_forward` e as regras de NAT/forward da sub-rede. Desligue apenas se um script externo já cuidar disso.
- **WAN Interface** — uplink usado no NAT. Vazio detecta pela rota IPv4 padrão, o que é correto numa VPS com um único uplink.
- **Handshake Timeout** / **Idle Timeout** — limite do handshake+autenticação e tempo sem tráfego antes de reciclar a sessão.
- **Max Packet Size** / **Max Cover Bytes** — tamanho máximo do payload de um frame (`0` usa 64 KiB) e quanto lixo um cliente TCP pode enviar antes do `CLIENT_HELLO`, que é o que permite ao BTUN se esconder atrás de um preâmbulo parecido com HTTP.
- **Max Sessions** — teto global de sessões. `0` usa o padrão (10000) e `-1` remove o limite.
- **Auto Restart Interval** / **Restart Grace Delay** — restart forte que recria apenas os listeners e o dispositivo TUN do BTUN.

O BTUN precisa de `/dev/net/tun` e de privilégio para criar a interface e alterar as regras de NAT. O serviço `sshpanel` já roda como root, então em uma VPS comum funciona direto; em containers sem `/dev/net/tun` o card **Status BTUN** mostra o erro de inicialização. Libere as portas escolhidas no firewall:

```bash
sudo ufw allow 8880/tcp
sudo ufw allow 7300/tcp
sudo ufw allow 7300/udp
```

Ambos os serviços vêm **desativados** por padrão, então uma atualização não abre portas novas sozinha. Ative na aba de configurações; a mudança é aplicada ao vivo, sem reiniciar o painel.

### Compilar e testar em Linux com Docker

O painel é um serviço Linux, mas costuma ser desenvolvido em Windows ou macOS, onde três coisas não podem ser verificadas: o código com build tag de Linux (o dispositivo TUN do BTUN), o detector de corrida (precisa de cgo) e qualquer caminho que use `/dev/net/tun`. A imagem `Dockerfile.build` cobre os três.

```bash
docker build -f Dockerfile.build -t dragoncore-build .

# build + vet + testes
docker run --rm -v "$PWD:/src" -v dragoncore-cache:/cache dragoncore-build

# detector de corrida
docker run --rm -v "$PWD:/src" -v dragoncore-cache:/cache dragoncore-build race

# binários de release em dist/ (amd64 e arm64)
docker run --rm -v "$PWD:/src" -v dragoncore-cache:/cache dragoncore-build dist
```

Os testes do TUN do BTUN — criar a interface e instalar/remover as regras de NAT — precisam de privilégios que o container não tem por padrão:

```bash
docker run --rm --cap-add NET_ADMIN --device /dev/net/tun   -v "$PWD:/src" -v dragoncore-cache:/cache dragoncore-build tun
```

Sem esses privilégios eles são pulados, e o resto da suíte roda normalmente. O volume `dragoncore-cache` guarda os caches de módulos e de build entre execuções.

### HCR (HTTP/Custom Relay)

O HCR é um túnel de requisição/resposta do ecossistema UDP-Custom: o cliente envia quadros com cabeçalho fixo de 62 bytes (connect, data, poll, ack, close, ping) e o servidor relaciona o fluxo a um alvo. Como o BHTTP, cada sessão HCR é entregue ao **servidor SSH interno do painel**, então as contas, validade, TOTP, `max_connections`, limites de banda e cotas de dados valem sem configuração extra — sem `sshd`, PAM ou `/etc/shadow`.

O ponto central: o HCR foi feito para **coexistir com o BHTTP na mesma porta**. Os dois se sobrepõem no primeiro byte (opcodes 1..4 significam upload/download nos dois), mas o HCR tem cabeçalho de 62 bytes e byte de versão fixo `0x01` em `[1]`, enquanto o BHTTP tem cabeçalho de 29 bytes cujo byte `[1]` é aleatório. O classificador confere o cabeçalho completo do HCR **antes** do BHTTP; um quadro BHTTP limpo é rejeitado em dois bytes, sem espera. Assim SSH, injeção HTTP, BHTTP e HCR ficam todos ligados na mesma porta ao mesmo tempo.

Configure em **Configurações → HCR**:

- **Compartilhar as portas do painel** — aceita HCR em 80/8080 e 443 junto com BHTTP e o resto. Com isso ligado, o campo Listen pode ficar vazio.
- **Listen** — porta dedicada opcional; sem compartilhamento o padrão é `0.0.0.0:8181`.
- **Max Sessions / Max Connections / Max Sessions Per IP** — tetos; `0` usa o padrão e `-1` (nas duas primeiras) remove o limite.
- **Max Download Frame** — maior registro lido do alvo por quadro (padrão 16384).
- **Download Poll Timeout / Idle Session Timeout** — tempo de um long-poll sem dados e tempo ocioso antes de reciclar a sessão.
- **Auto Restart Interval / Restart Grace Delay** — restart forte só dos listeners HCR.

O card **Status HCR** mostra sessões e sockets ativos, bytes trafegados, sessões criadas/rejeitadas e erros de protocolo.

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

O script atualiza o usuário `admin` no PostgreSQL com hash bcrypt, ativa ele como `superadmin`, remove qualquer `ADMIN_PASSWORD` legado em texto puro de `/opt/sshpanel/.env` e reinicia o serviço `sshpanel` para recarregar o cache interno de admins.

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
- Always-on internal raw SSH endpoint at `127.0.0.1:2222` for local proxies and tunnels
- Administrative web panel
- PostgreSQL database
- Xray-core/V2Ray integration
- Visual configurator for VLESS and VMess
- Full visual inbound editor (create, edit, duplicate, and remove)
- Native shared XHTTP endpoint: VLESS **or** VMess on `/` and SSH on `/ssh`, using the same domain/port/TLS
- Compact infrastructure workspace with Servers, Status, Monitoring, and Traffic in one visual switcher
- Live status cards across SSH, Xray, and Infrastructure, with panel-native confirmations
- Live per-account up/down speed in the SSH and Xray user lists, summed across every connection the account has open, sortable by speed
- User lists collapse into labelled cards on phones, so there is no sideways scrolling
- Bot-style section navigation throughout the panel: SSH/SlowDNS and Resellers separate lists from creation; Xray separates Users, Create User, Configuration, and Logs; Settings separates Network/SSH, SlowDNS, UDP, TLS, and Xray
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

### Shared XHTTP endpoint

In **Xray → Xray Config → Visual**, the **Shared XHTTP endpoint** card creates two inbounds on the same port:

- VLESS **or** VMess on `/` (select one root protocol);
- SSH over XHTTP on `/ssh`, authenticated by the panel's regular SSH accounts.

The internal HTTP listener selects the most specific path, so `/ssh` reaches the SSH server before the root inbound. Every inbound sharing a port must use the same TLS setting and certificate. This feature requires **Internal native emulator** mode; the external Xray binary does not recognize DragonCore's custom `ssh` protocol.

For older XHTTP configurations, load the visual configuration and click **Enable SSH /ssh** on the existing VLESS/VMess card. The panel preserves the original inbound, clients, path, host, mode, advanced options, and TLS; it only creates the matching SSH inbound on the same port and then saves/restarts Xray. There is no need to recreate clients or the endpoint.

The migration confirmation is rendered inside the panel. If saving fails, the temporary SSH inbound is removed from the draft and the old inbound remains intact, so the operation can be retried after fixing the displayed error.

### Traffic quotas and resource protection

SSH accounts and native-mode VLESS/VMess clients can use `data_quota_bytes` with either the `block` or `throttle` action. The **Reset traffic** action clears only usage counters; it does not renew expiry, change a password, or alter account settings. The server does not perform an automatic periodic reset: any commercial period shown on the website is independent, and counters reset only through an explicit panel/API action. `max_conns` is enforced when a native VLESS/VMess user is authenticated and is shared across TCP, UDP, WebSocket, XHTTP, and Mux transports (one authenticated Mux transport counts as one connection, regardless of its child streams).

The old global admission keys remain in JSON for compatibility, but they are always normalized to `-1` (unlimited), including when an old `config.json` still contains `4096`, `8192`, `32768`, or any other positive value:

- `max_concurrent_connections`: no global transport-connection count cap;
- `max_concurrent_xhttp_requests`: no global XHTTP-request count cap;
- `xhttp_max_sessions`: no global XHTTP-session count cap.

The panel no longer exposes those three controls as adjustable ceilings. Xray XHTTP and XHTTP SSH share the same VPN listener with no count ceiling for requests, HTTP/2 streams, transport connections, or XHTTP sessions. Packet-up bursts and out-of-order reassembly use cancelable byte-accounted backpressure; even empty packets are charged a minimum accounted-memory cost, so removing the request-count limit does not create an unbounded metadata queue. There are no `429` responses or global-capacity `503` rejections. Real per-user policies (`max_conns`, quota, and bandwidth) remain active. Each Mux transport accepts at most 64 child sessions, with a default global ceiling of 32768. Stopping/restarting native Xray closes existing transports and XHTTP sessions. Traffic and active-connection changes are aggregated and written in five-second batches rather than creating a PostgreSQL query or goroutine for every connection. Pending retry entries for deleted clients are removed so retry maps stay bounded by the current account set.

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
2222    Internal raw SSH on 127.0.0.1 (not public)
53/udp  Public DNS for DNSTT, redirected to 5300/udp
5300/udp Internal DNSTT listener
8880    BHTTP (BHP1/BHP2) — disabled by default; can share 80/8080/443
7300    BTUN TCP — disabled by default; can share 80/8080/443
8181    HCR (HTTP/Custom Relay) — disabled by default; can share 80/8080/443
7300/udp BTUN UDP — disabled by default
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

### Internal SSH endpoint for local proxies

The DragonCore process keeps a separate raw SSH listener on `127.0.0.1:2222`. It uses the same accounts, authentication, quotas, connection caps, and bandwidth limits as public SSH, but does not perform HTTP-header cleanup. The listener starts with the `sshpanel` service, remains bound while public listeners are automatically restarted, and can be configured under **Settings → Network/SSH → Internal Raw SSH**.

A proxy or tunnel running on the same server can point directly to:

```text
Host: 127.0.0.1
Port: 2222
Type: raw SSH
Username/password: a panel SSH account
```

For example, to create a local SOCKS proxy with the OpenSSH client:

```bash
ssh -N -D 127.0.0.1:1080 -p 2222 username@127.0.0.1
```

Do not open port `2222` in the firewall. `local_ssh_listen` accepts only numeric loopback IPs (`127.0.0.0/8` or `::1`) and falls back to the safe default when given a public, wildcard, or invalid address. Inside a container, `127.0.0.1` means that container itself; use host networking or another suitable local integration to reach the host listener.


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
  "udp_listen": "0.0.0.0:5300",
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
  "udp_listen": "0.0.0.0:5300",
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

### BHTTP (BHP1 / BHP2)

BHTTP is the obfuscated TCP transport used by the DTunnel-family clients. The client opens a plain TCP socket, optionally sends an HTTP request as cover, then speaks the BHTTP framing (29-byte header) with the *probe*, *upload*, *download*, *batch* and *ACK* modes. BHP2 adds persistent lanes with `resume` and cumulative upload ACKs.

Every BHTTP session is handed to the panel's **own built-in SSH server**, exactly the way DNSTT does it. Nothing connects to the system `sshd`, PAM or `/etc/shadow`: the panel's accounts, expiry, TOTP, `max_connections`, bandwidth limits and data quotas all apply with no extra setup.

#### Sharing ports 80, 8080 and 443

BHTTP can serve **on the ports the panel already uses**, with no dedicated port and without disturbing anything else. This works because the three protocols open in incompatible ways: a BHTTP frame starts with its mode number (`0`–`5`), SSH starts with `S` (`0x53`), and an HTTP request or status line starts with a method or version letter. The first byte alone separates all three.

Because an HTTP-injection client may send junk before its payload, a low first byte is not proof on its own. So the 29-byte frame header is range-checked too, and for the two modes that carry a signature — the *probe* that opens every session and the v2 *lane hello* — the signature (`BHP1`/`BHP2`, `BLN2`) is decrypted and verified. That check is keyed by the session ID in the same header, so junk cannot pass it by chance. Nothing is consumed on a negative verdict: the connection continues to the normal HTTP/SSH path with its bytes intact.

Turn it on under **Settings → BHTTP → Share the panel's ports**. It covers `listen`, `extra_listen` and every TLS forwarder. With it on, the **Listen** field may be left empty and BHTTP exists only on the shared ports.

Exactly one thing changes for other clients: today the proxy port answers `HTTP/1.1 101` the moment a socket opens, before reading anything; with sharing on it waits for the client's first bytes (at most 3s) before deciding. That is required because a BHTTP client cannot receive that unsolicited 101. Every known client — HTTP-injection or BHTTP — sends immediately on connect, and a client that sends nothing within 3s falls through to the old path. If a client of yours waits for the 101 before speaking, leave the option off.

Configure it under **Settings → BHTTP**:

- **Share the panel's ports** — accepts BHTTP on 80/8080 and 443 alongside SSH and HTTP injection, as described above.
- **Listen** — a dedicated port, one address per line, optional when sharing is on. Ports 80 and 8080 belong to the HTTP+SSH proxy: to use them, turn sharing on rather than listing them here. Without sharing, the default is `0.0.0.0:8880`.
- **Session Timeout** — how long a session may sit with no traffic before it is dropped and its SSH connection closed. It also bounds how long a BHP2 `resume` stays possible.
- **Max v2 Lanes Per Session** — ceiling on concurrent lanes per session (`0` uses 128).
- **Max Sessions** / **Max Client Sockets** — global ceilings. `0` uses the default (10000) and `-1` disables the cap. Sockets past the cap are closed before any protocol work.
- **Auto Restart Interval** / **Restart Grace Delay** — hard restart that closes only the BHTTP listeners and their sessions. It does not restart the panel or the VPS. Minimum interval is 1m.
- **Disable Console Log** / **Verbose Connection Logs** — logs remain available at `/api/bhttp/logs` even with the console output turned off.

The **Status BHTTP** card in the same tab shows active sessions and sockets, bytes moved, BHP1/BHP2 probes, lanes attached and rejected, SSH target failures and protocol errors.

### BTUN (DTUNNEL/1.1)

BTUN is the native IP-packet VPN: the client performs the `DTUNNEL/1.1 CLIENT_HELLO` handshake over TCP or UDP, authenticates, receives an IPv4 address from a private subnet, and then exchanges IP packets with a TUN interface this process creates.

Unlike BHTTP and DNSTT, BTUN does **not** carry an SSH stream — it carries IP packets. Authentication therefore does not go through `handleConn`; it goes straight to the panel's account database: the same username and password (or TOTP), the same expiry, the same reseller owner, the same data quota and the same `max_connections`. **There is no PAM or `/etc/shadow` path in BTUN at all**, and `pam_auth_enabled` (an SSH setting) does not apply to it.

Each BTUN session counts against the account's `max_connections` together with its SSH connections, honours `limit_mbps_up`/`limit_mbps_down`, and draws on the same data quota. Deleting, editing or expiring a user drops its BTUN sessions the same way it drops SSH connections.

#### Sharing ports 80, 8080 and 443

BTUN can serve on the panel's existing ports too. The detection here is even more direct than BHTTP's: a BTUN session opens with the fixed marker `DTUNNEL/1.1 CLIENT_HELLO`, which no SSH banner and no HTTP line can match. A connection is routed to BTUN only when those 25 bytes match at the very start; anything else continues untouched to the normal path.

Two limits, both inherent to sharing:

- **TCP only.** The panel owns no shared UDP port, so UDP clients still need **UDP Listen**.
- **Cover bytes.** On a dedicated port BTUN tolerates arbitrary junk before the hello. On a shared port the marker has to be at the start, because an unbounded prefix cannot be buffered while SSH waits behind it. Cover shaped as an HTTP request does work — the panel's injection cleanup consumes the request and the marker reappears at the start — but the client then receives the panel's `101`/`200` reply first and has to skip it. For any other cover shape, use the dedicated port.

Turn it on under **Settings → BTUN → Share the panel's ports**. With it on, **TCP Listen** may be left empty.

Configure it under **Settings → BTUN**:

- **Share the panel's ports** — accepts BTUN on 80/8080 and 443 alongside SSH, HTTP injection and BHTTP, as described above. TCP only.
- **TCP Listen** / **UDP Listen** — leave one empty to disable that transport. Without sharing at least one is required; both default to `0.0.0.0:7300`.
- **TUN Interface** — the interface this process creates and owns (default `btun0`). It must not collide with an interface another service owns.
- **Client Subnet** / **Gateway** / **MTU** — the IPv4 range handed to clients (default `10.77.0.0/16`), the address on the interface itself (derived from the subnet when empty) and the MTU (default 1400).
- **Manage Routing** — when on, the panel configures the interface address, `net.ipv4.ip_forward` and the subnet's NAT/forward rules itself. Turn it off only when an external script already owns those rules.
- **WAN Interface** — the uplink used for NAT. Empty auto-detects it from the default IPv4 route, which is correct on a single-uplink VPS.
- **Handshake Timeout** / **Idle Timeout** — bound the hello+authentication exchange, and how long a session may sit with no traffic before it is reaped.
- **Max Packet Size** / **Max Cover Bytes** — the largest frame payload (`0` uses 64 KiB) and how much junk a TCP client may send before its `CLIENT_HELLO`, which is what lets BTUN hide behind an HTTP-looking preamble.
- **Max Sessions** — global session ceiling. `0` uses the default (10000) and `-1` disables the cap.
- **Auto Restart Interval** / **Restart Grace Delay** — hard restart that recreates only the BTUN listeners and TUN device.

BTUN needs `/dev/net/tun` and the privilege to create the interface and change NAT rules. The `sshpanel` service already runs as root, so a normal VPS works out of the box; in a container without `/dev/net/tun` the **Status BTUN** card shows the startup error. Open the chosen ports in the firewall:

```bash
sudo ufw allow 8880/tcp
sudo ufw allow 7300/tcp
sudo ufw allow 7300/udp
```

Both services are **disabled** by default, so an update never opens new ports on its own. Enable them in the settings tab; the change is applied live, with no panel restart.

### Building and testing on Linux with Docker

The panel is a Linux service but is often developed on Windows or macOS, where three things cannot be checked: the Linux-tagged code (BTUN's TUN device), the race detector (which needs cgo), and anything touching `/dev/net/tun`. The `Dockerfile.build` image covers all three.

```bash
docker build -f Dockerfile.build -t dragoncore-build .

# build + vet + tests
docker run --rm -v "$PWD:/src" -v dragoncore-cache:/cache dragoncore-build

# race detector
docker run --rm -v "$PWD:/src" -v dragoncore-cache:/cache dragoncore-build race

# release binaries in dist/ (amd64 and arm64)
docker run --rm -v "$PWD:/src" -v dragoncore-cache:/cache dragoncore-build dist
```

The BTUN TUN tests — creating the interface and installing/removing the NAT rules — need privileges the container does not have by default:

```bash
docker run --rm --cap-add NET_ADMIN --device /dev/net/tun   -v "$PWD:/src" -v dragoncore-cache:/cache dragoncore-build tun
```

Without those privileges they skip and the rest of the suite runs normally. The `dragoncore-cache` volume keeps the module and build caches between runs.

### HCR (HTTP/Custom Relay)

HCR is a request/response tunnel from the UDP-Custom ecosystem: the client sends 62-byte-header frames (connect, data, poll, ack, close, ping) and the server relays the stream to a target. Like BHTTP, every HCR session is handed to the panel's **own built-in SSH server**, so the panel's accounts, expiry, TOTP, `max_connections`, bandwidth limits and data quotas all apply with no extra setup — no system `sshd`, PAM or `/etc/shadow`.

The key point: HCR is built to **coexist with BHTTP on the same port**. The two overlap on the first byte (opcodes 1..4 mean upload/download in both), but HCR has a 62-byte header with a fixed version byte `0x01` at `[1]`, while a BHTTP frame has a 29-byte header whose byte `[1]` is random. The classifier checks HCR's full header **before** BHTTP; a clean BHTTP frame is rejected at two bytes with no wait. So SSH, HTTP injection, BHTTP and HCR are all live on the same port at once.

Configure it under **Settings → HCR**:

- **Share the panel's ports** — accepts HCR on 80/8080 and 443 alongside BHTTP and the rest. With it on, the Listen field may be empty.
- **Listen** — an optional dedicated port; without sharing the default is `0.0.0.0:8181`.
- **Max Sessions / Max Connections / Max Sessions Per IP** — ceilings; `0` uses the default and `-1` (on the first two) disables the cap.
- **Max Download Frame** — the largest record read from the target per frame (default 16384).
- **Download Poll Timeout / Idle Session Timeout** — how long a long-poll waits with no data, and how long a session may sit idle before it is reaped.
- **Auto Restart Interval / Restart Grace Delay** — a hard restart of the HCR listeners only.

The **Status HCR** card shows active sessions and sockets, bytes moved, sessions created/rejected and protocol errors.

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

The script updates the `admin` user in PostgreSQL with a bcrypt hash, enables it as `superadmin`, removes any legacy plaintext `ADMIN_PASSWORD` from `/opt/sshpanel/.env`, and restarts `sshpanel` so the in-memory admin cache is reloaded.

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
- `200`: array of user objects: `username` (string), `active_conns` (int), `max_connections` (int), `expires_at` (string/null), `limit_mbps_up` (int), `limit_mbps_down` (int), `data_quota_bytes` (int64), `quota_action` (`block` or `throttle`), `quota_throttle_mbps` (int), `total_uplink_bytes`, `total_downlink_bytes`, `total_bytes`, `up_bytes_per_sec` (float, live account-wide upload speed), `down_bytes_per_sec` (float, live account-wide download speed), `quota_exceeded`, `totp_secret` (string, omitempty), `totp_period` (int), `totp_window` (int), `totp_digits` (int), `allow_static_password` (bool), `totp_enabled` (bool), `owner_username` (string, omitempty), `server_id` (string, omitempty).

#### `POST /api/users/create` — session
Creates or updates (upsert) an SSH user.
- Body: `username` (string, required); `password` (string, optional — empty keeps the existing password on an existing user; for a new user either `password` or `totp_secret` is required); `max_connections` (0–10000); `expires_at` (RFC3339 string); `limit_mbps_up` and `limit_mbps_down` (0–1000000); `data_quota_bytes` (non-negative int64); `quota_action` (`block` or `throttle`); `quota_throttle_mbps` (0–1000000; zero defaults to 1); `reset_usage` (bool); `totp_secret` (string); `totp_period` (int); `totp_window` (int); `totp_digits` (int); `allow_static_password` (bool); `owner_username` (string, optional — honored only for superadmin; resellers are forced to themselves); `server_id` (string, optional).
- `201 Created` (empty body). A proxied create returns the remote node's status/body.
- Errors: `400 username required`, `400 password or totp_secret required for new user`; `403 user limit reached (N)`; `403 SSH creation is disabled for this server`; `503 database not configured`.

#### `POST /api/users/reset-traffic` — session
- Body: `username` (required), `server_id` (optional). Resets only byte counters. Resellers may reset only their own users.

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

### BHTTP and BTUN

#### `GET /api/bhttp` — superadmin
- Optional query: `server_id`.
- `200`: BHTTP snapshot: `enabled` (bool), `running` (bool), `listen` (string, omitempty — the dedicated addresses, plus `shared proxy/TLS ports` when port sharing is on), `startedAt` (string); `activeConnections` and `activeSessions` (int64); uint counters `accepted`, `connectionsRejected`, `sessionsRejected`, `sessionsExpired`, `probes`, `probesV2`, `httpUpgrades`, `lanesAttached`, `lanesRejected`, `uploadBytes`, `downloadBytes`, `targetFailures`, `protocolErrors`.

#### `GET /api/bhttp/logs` — superadmin
- `200`: array of log line strings (empty array if uninitialized). Does not proxy to managed servers.

#### `GET /api/btun` — superadmin
- Optional query: `server_id`.
- `200`: BTUN snapshot: `enabled` (bool), `running` (bool), `listen` (string, omitempty — the dedicated listeners, plus `shared proxy/TLS ports` when port sharing is on), `tunName` (string, omitempty), `subnet` (string, omitempty), `startedAt` (string); uint counters `activeSessions`, `accepted`, `authSucceeded`, `authRejected`, `clientPackets`, `internetPackets`, `clientBytes`, `internetBytes`, `droppedPackets`, `sessionsRejected`.

#### `GET /api/btun/logs` — superadmin
- `200`: array of log line strings (empty array if uninitialized). Does not proxy to managed servers.

#### `GET /api/hcr` — superadmin
- Optional query: `server_id`.
- `200`: HCR snapshot: `enabled` (bool), `running` (bool), `listen` (string, omitempty — the dedicated addresses, plus `shared proxy/TLS ports` when port sharing is on), `startedAt` (string); `activeConnections` and `activeSessions` (int64); uint counters `accepted`, `connectionsRejected`, `sessionsCreated`, `sessionsRejected`, `uploadBytes`, `downloadBytes`, `protocolErrors`.

#### `GET /api/hcr/logs` — superadmin
- `200`: array of log line strings (empty array if uninitialized). Does not proxy to managed servers.

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
- **XrayClientInfo**: `id` (string, the UUID), `password` (string, omitempty), `email` (string), `level` (int), `online` (bool), `last_active` (string/null), `uplink_bytes` (int64), `downlink_bytes` (int64), `total_bytes` (int64), `up_bytes_per_sec` (float, live client-wide upload speed), `down_bytes_per_sec` (float, live client-wide download speed), `active_connections` (int), `name` (string), `expires_at` (string/null), `expiration_days` (int; `-1` = no expiry, `0` = expired), `max_conns`, `data_quota_bytes`, `quota_action`, `quota_throttle_mbps`, `quota_exceeded`, `owner_username`, `expired`.

#### `POST /api/xray/clients/add` — session
- Body: `inbound_tag` (string, required), `uuid` (valid UUID, required), `email` (string, optional — defaults to name then uuid), `name` (string, optional), `expires_at` (RFC3339, `YYYY-MM-DDThh:mm`, or `YYYY-MM-DD`), `max_connections` (0–10000), `data_quota_bytes`, `quota_action`, `quota_throttle_mbps`, `owner_username` (string, optional — superadmin only), `server_id` (string, optional).
- `201 Created` (empty). Errors: `400 inbound_tag and uuid required` / `UUID already exists in database`; `403 reseller account suspended or expired` / `user limit reached (N)` / `Xray creation is disabled for this server`; `500`.

#### `POST /api/xray/clients/update` — session
- Body: `uuid` (valid UUID, required), `name` (string), `email` (string), `expires_at` (string), `max_connections` (0–10000), `data_quota_bytes`, `quota_action`, `quota_throttle_mbps`, `reset_usage` (bool), `server_id` (string, optional). Inbound tag and owner are preserved from existing metadata. Resellers may update only their own clients.
- `200`. Errors: `400 uuid required`; `403 forbidden`; `404 client metadata not found`; `500`.

#### `POST /api/xray/clients/reset-traffic` — session
- Body: `uuid` (required), `server_id` (optional). Resets only byte counters. Resellers may reset only their own clients.

#### `DELETE /api/xray/clients/remove` — session
- Query: `inbound_tag` (string, required), `uuid` (string, required); optional `server_id`. Resellers may remove only their own clients.
- `204 No Content`. Errors: `400 inbound_tag and uuid required`; `403 forbidden`; `500`.

---

### TLS certificates (superadmin only)

All endpoints support `server_id` proxying, so a certificate can also be listed/updated on a managed slave node. The three issue/upload endpoints below accept `POST` only.

#### `POST /api/tls/generate-selfsigned`
- Body: `domain` (string, required). Writes a self-signed ECDSA (P-256) cert (10-year validity) to `/opt/sshpanel/certs/<domain>/`.
- `200`: `{ "cert_file": string, "key_file": string }`. Errors: `400 domain required`; `500`.

#### `POST /api/tls/letsencrypt`
- Body: `domain` (string, required), `email` (string, required). Runs `certbot certonly --standalone` (requires certbot and a free port 80).
- `200`: `{ "cert_file": string, "key_file": string, "output": string }`. Errors: `400 domain and email required`; `500 certbot failed: ...`.

#### `POST /api/tls/upload-pem`
- Body: `name` (string, required), `cert` (string, required — PEM), `key` (string, required — PEM). Saves to `/opt/sshpanel/certs/<name>/`.
- `200`: `{ "cert_file": string, "key_file": string }`. Errors: `400 name, cert, and key required` / `invalid name`; `500`.

#### `GET /api/tls/certs`
Lists every certificate this node knows about: the ones stored under `/opt/sshpanel/certs/`, the ones referenced by `tls_forwarders`, and the ones referenced by Xray inbound `tlsSettings` (inbounds that enable TLS without naming a certificate are reported against the first TLS forwarder's material, which is what `buildInboundTLS` falls back to).
- `200`: `{ "certs_dir": string, "certs": [ { "name", "cert_file", "key_file", "managed", "exists", "subject", "issuer", "domains": [string], "not_before", "not_after", "days_left", "expired", "expiring", "self_signed", "chain_length", "key_type", "key_ok", "modified", "error", "used_by": [ { "kind": "tls_forwarder"|"xray_inbound", "ref": string } ] } ] }`.

#### `POST /api/tls/certs/update`
Replaces a certificate's `fullchain.pem` + `privkey.pem`. The panel's **Configuração → TLS → Certificados TLS** card uses this for renewals.
- Body: `fullchain` (string, required — PEM; `cert` accepted as alias), `privkey` (string, required — PEM; `key` accepted as alias), plus **either** `cert_file` (+ optional `key_file`) to replace an existing certificate in place, **or** `name` to create/replace `/opt/sshpanel/certs/<name>/`. Optional `reload` (bool, default `true`) and `force` (bool, default `false`).
- The pair is validated with `tls.X509KeyPair` before anything is written; the previous content is kept as `<file>.bak`; existing file modes are preserved; symlinked targets (certbot layout) are followed so the link structure survives.
- `cert_file` must be inside `/opt/sshpanel/certs/` or already referenced by the running config / Xray config — this endpoint is not an arbitrary file-write primitive.
- Because the paths do not change, no other configuration needs editing. With `reload` on, the TLS forwarders serving the certificate are rebound (established connections are untouched) and Xray is restarted if one of its inbounds uses it.
- `200`: `{ "cert_file": string, "key_file": string, "cert": <same shape as the list entry>, "reloaded": { "tls_forwarders": [string], "xray_inbounds": [string], "xray_restarted": bool }, "warnings": [string] }`. Warnings cover a leaf-only PEM (no intermediates), a not-yet-valid certificate, a domain change versus the previous certificate, and certbot-managed paths.
- Errors: `400` for a missing/mismatched pair, an expired certificate without `force=true`, or a path outside the allowed set; `413` for PEM over 1 MiB; `500` on write failure.

---

### Panel config

#### `/api/server/config` — superadmin (GET or POST)
Reads/writes the panel's `config.json` and hot-applies changes.
- **GET**: returns the raw config file JSON.
- **POST**: body is the full config JSON (≤ 512 KiB). Validated (`listen` required), the file-based `users` array is preserved, ports normalized, then written to disk and applied live.
  - `local_ssh_listen` defaults to `127.0.0.1:2222`, is always enabled, and is restricted to a numeric loopback address. Its live status is returned as `services.local_ssh`.
  - `200`: reload report `{ "applied": bool, "warnings": string[], "services": { "<name>": ServiceReloadStatus } }`.
  - Errors: `400 invalid JSON: ...` / `listen address required`; `500 config path not set` / read/write errors.

---

### Public — CheckUser

#### `GET /check` — none
Public status lookup for SSH users and Xray/V2Ray UUIDs (CORS `*`). See the **Public CheckUser API** section above for query params, response fields, and examples.

---

## Bot de Vendas (Telegram + Mercado Pago)

**PT-BR:** O painel inclui um bot de Telegram integrado ao próprio binário para vender contas **SSH e Xray** por **PIX** (Mercado Pago), com **teste grátis**, **renovação**, e um **sistema de revendedores por créditos**. Toda a gestão fica na aba **Bot / Vendas** do painel (somente superadmin).

### Como configurar
1. Abra o painel → aba **Bot / Vendas**.
2. Em **Configuração**: marque *Bot ativo*, cole o **Token do Telegram** (via @BotFather) e o **Access Token do Mercado Pago**. Clique **Testar conexão** e depois **Salvar**.
3. **Confirmação do pagamento — Webhook × Polling** (o painel deixa você escolher): 
   - **Polling** (padrão): o bot consulta o status do PIX a cada intervalo. Não precisa de domínio/HTTPS.
   - **Webhook**: configure no painel do Mercado Pago a URL `https://SEU_DOMINIO/api/mp/webhook`. O painel mostra a URL exata quando você seleciona esse modo.
   - O **Telegram** usa long-polling automático — não requer domínio, webhook nem configuração extra.
4. Em **Planos**: crie planos SSH e/ou Xray (dias, conexões, preço em R$, e — para Xray — o *inbound* e protocolo). Para revendedores, defina o *custo em créditos*.
5. Em **Pacotes de Crédito**: defina os valores de recarga dos revendedores.
6. Em **Clientes do Bot**: promova um usuário a **revendedor** (vinculando-o a uma conta de revendedor em *Revendedores*), ajuste créditos ou bloqueie.
7. Em **Mensagens**: edite os textos de boas-vindas, contato e link do app.

### Segurança dos segredos
Os tokens (Telegram, Mercado Pago e segredos de webhook) são gravados **criptografados (AES-256-GCM)** na tabela `bot_config` do PostgreSQL. A **chave-mestra** fica **fora do banco**: variável de ambiente `BOT_MASTER_KEY` (64 caracteres hex) ou, se ausente, um arquivo `0600` em `/opt/sshpanel/bot_master.key` gerado automaticamente no primeiro uso. **Faça backup desse arquivo** junto com o banco — sem ele os segredos não podem ser decifrados. A API do painel nunca retorna os tokens em texto puro.

### Endpoints (superadmin, exceto webhooks)
- `GET/POST /api/bot/config` — lê/grava a configuração (segredos só entram no POST; campo vazio mantém o atual; o GET retorna apenas `has_*`).
- `GET/POST/DELETE /api/bot/plans` — CRUD de planos (`?id=` no DELETE).
- `GET/POST/DELETE /api/bot/credit-packages` — CRUD de pacotes de crédito.
- `GET/POST /api/bot/users` — lista clientes; POST com `action` = `set_role` \| `block` \| `unblock` \| `adjust_credits`.
- `GET/POST /api/bot/transactions` — lista pagamentos; POST com `action` = `refund` \| `reprocess`.
- `GET/POST /api/bot/settings` — textos do bot (chave/valor).
- `POST /api/bot/test` — testa token do Telegram e do Mercado Pago.
- `POST /api/mp/webhook` — **público**, chamado pelo Mercado Pago quando o modo de confirmação é *webhook* (valida `x-signature` se houver segredo; sempre reconfirma o pagamento na API antes de liberar). Ignorado em modo *polling*.

**EN-US:** The panel ships an in-process Telegram bot that sells **SSH and Xray** accounts via **PIX (Mercado Pago)**, with free trial, renewal, and a **credit-based reseller system** — all managed from the superadmin **Bot / Vendas** tab. Bot secrets are stored **AES-256-GCM encrypted** in PostgreSQL; the master key lives outside the DB (`BOT_MASTER_KEY` env or a `0600` `/opt/sshpanel/bot_master.key` auto-generated on first use — back it up). Telegram runs on long-polling (no domain needed); only **Mercado Pago confirmation** is toggleable between **polling** (default) and **webhook** in the panel.
