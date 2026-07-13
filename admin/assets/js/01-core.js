
// ─── State ───────────────────────────────────────────────────────────────────
let sessionToken = sessionStorage.getItem("SESSION_TOKEN") || localStorage.getItem("SESSION_TOKEN") || "";
if (sessionToken) sessionStorage.setItem("SESSION_TOKEN", sessionToken);
localStorage.removeItem("SESSION_TOKEN");
let currentRole  = "";
let currentUser  = "";
let statsTimer   = null, usersTimer = null, xrayTimer = null;
let formCollapsed = true;
let tlsForwardersState = [];
let managedTlsForwardersState = [];
let editingXrayClientId = null;
let wzInbounds = [];
let wzLoadedFullConfig = null;
let wzLoadedConfigText = "";
let wzLoadedServerID = null;
let wzDirty = false;
let wzEditingIndex = -1;
let dashboardCache = { sshUsers: [], xrayInbounds: [], me: null };
let currentTab = "dashboard";
let inboundsRefreshInFlight = false;
let lastInboundsStructure = "";
let serversCache = [];
let selectedSSHServerID = localStorage.getItem("SSH_SERVER_ID") || "local";
let selectedXrayServerID = localStorage.getItem("XRAY_SERVER_ID") || "local";
let configuringServerID = "";


// ─── Language / i18n ─────────────────────────────────────────────────────────
const SUPPORTED_LANGS = ["pt-BR", "en-US"];
const LANG_STORAGE_KEY = "PANEL_LANG";
const I18N_TEXT = {
  "en-US": {
    "Dashboard":"Dashboard","Overview":"Overview","Accounts":"Accounts","Administration":"Administration","Server":"Server","System":"System","Settings":"Settings","Traffic":"Traffic","Monitoring":"Monitoring",
    "SSH / SlowDNS":"SSH / SlowDNS","Xray Users":"Xray Users","Resellers":"Resellers","Logs":"Logs","VnStat":"VnStat","VPN Control":"VPN Control","DragonCore":"DragonCore",
    "SSH Panel":"SSH Panel","Sign in with your admin or reseller credentials.":"Sign in with your admin or reseller credentials.","Username":"Username","Password":"Password","Sign in":"Sign in","Logout":"Logout","Open menu":"Open menu","Toggle theme":"Toggle theme","Language":"Language",
    "Total accounts":"Total accounts","active":"active","expired":"expired","available limit":"Available limit","Loading quota…":"Loading quota…","Active connections":"Active connections","SSH + Xray online now":"SSH + Xray online now","Ready for resellers":"Ready for resellers","Server monitoring in real time":"real-time monitoring","CPU":"CPU","RAM":"RAM","Network":"Network","Processor load":"Processor load","Memory used":"Memory used","Total":"Total","Total --":"Total --","RX -- · TX -- Mb/s":"RX -- · TX -- Mb/s",
    "Quick actions":"Quick actions","simple":"simple","Create SSH":"Create SSH","Create Xray":"Create Xray","New reseller":"New reseller","Configure services":"Configure services","User, password, expiry and limit.":"User, password, expiry and limit.","UUID, label, expiry and connections.":"UUID, label, expiry and connections.","Plan, expiry and account limit.":"Plan, expiry and account limit.","Ports, DNSTT, UDPGW and TLS.":"Ports, DNSTT, UDPGW and TLS.","My quota":"My quota","Loading…":"Loading…","Loading...":"Loading...",
    "My Account":"My Account","Users (used / max)":"Users (used / max)","Users (used/max)":"Users (used/max)","Expires":"Expires","Status":"Status","Users":"Users","User":"User","Auth":"Auth","Conn":"Conn","Max":"Max","Up":"Up","Dn":"Dn","Owner":"Owner","Actions":"Actions","Create / update user":"Create / update user","Create / edit user form":"Create / edit user form","Show form":"Show form","Hide form":"Hide form","TOTP Secret":"TOTP Secret","TOTP Period (s)":"TOTP Period (s)","TOTP Window":"TOTP Window","TOTP Digits":"TOTP Digits","Allow static password too":"Allow static password too","Max connections":"Max connections","Expires at":"Expires at","Max Upload (Mb/s)":"Max Upload (Mb/s)","Max Download (Mb/s)":"Max Download (Mb/s)","Save user":"Save user","Cancel":"Cancel","Gen":"Gen","Copy":"Copy","Edit":"Edit","Del":"Del","Reload":"Reload","Refresh":"Refresh","+ New":"+ New","+ Add":"+ Add","Add":"Add","Remove":"Remove",
    "Running":"Running","Stopped":"Stopped","running":"running","stopped":"stopped","disabled":"disabled","Counters API":"Counters API","Repair counters":"Repair counters","Start":"Start","Stop":"Stop","Restart":"Restart","Inbounds & Clients":"Inbounds & Clients","Inbounds & clients":"Inbounds & clients","Xray Config":"Xray Config","Visual":"Visual","JSON":"JSON","Config editor":"Config editor","Load JSON":"Load JSON","Save & Restart":"Save & Restart","System Logs":"System Logs","last 200 lines":"last 200 lines","Xray clients":"Xray clients","Xray Core":"Xray Core","Enabled":"Enabled","Online":"Online","PID":"PID","Uptime":"Uptime","Counters API ready.":"Counters API ready.","Counters API ready at {server}.":"Counters API ready at {server}.","Online counters need Stats API repair.":"Online counters need Stats API repair.","Online counters: {error}":"Online counters: {error}","Needs repair":"Needs repair","OK":"OK",
    "UUID":"UUID","Email":"Email","Email / label":"Email / label","Display Name":"Display Name","Expiry Date":"Expiry Date","Max Connections":"Max Connections","(0 = unlimited)":"(0 = unlimited)","auto-generate":"auto-generate","Name":"Name","Expiry":"Expiry","Online":"Online","Traffic":"Traffic","No clients.":"No clients.","No VLESS/VMess/Trojan inbounds found.":"No VLESS/VMess/Trojan inbounds found.","Add Client":"Add Client","+ Add Client":"+ Add Client","Copied client ID.":"Copied client ID.","UUID required.":"UUID required.","Client {id}… added. Restarting Xray…":"Client {id}… added. Restarting Xray…","Client removed. Restarting Xray…":"Client removed. Restarting Xray…","Remove client {id}… from {tag}?":"Remove client {id}… from {tag}?","New client data is available; editing was preserved.":"New client data is available; editing was preserved.","Config loaded.":"Config loaded.","Invalid JSON: {error}":"Invalid JSON: {error}","Saved. Restarting Xray…":"Saved. Restarting Xray…","Saved.":"Saved.","Saving…":"Saving…","Error: {error}":"Error: {error}","Error loading inbounds.":"Error loading inbounds.",
    "Active":"Active","Suspended":"Suspended","Expired":"Expired","Unlimited":"Unlimited","No expiration":"No expiration","Idle":"idle","online":"online","offline":"offline","idle":"idle","ago":"ago","Active ({days}d)":"Active ({days}d)","No limit set by admin":"No limit set by admin","{remaining} accounts available · {pct}% used":"{remaining} accounts available · {pct}% used","{used} used · unlimited":"{used} used · unlimited","{used}/{max} used · {pct}% of plan":"{used}/{max} used · {pct}% of plan","SSH {ssh} · Xray {xray}":"SSH {ssh} · Xray {xray}","{ssh} SSH · {xray} Xray online":"{ssh} SSH · {xray} Xray online","{online} online · {active} active · {expired} expired · Core: {core}":"{online} online · {active} active · {expired} expired · Core: {core}","{count} online":"{count} online","{count} total · {active} active · {online} online":"{count} total · {active} active · {online} online",
    "New user.":"New user.","TOTP secret generated.":"TOTP secret generated.","Loaded.":"Loaded.","Last reload: {time}":"Last reload: {time}","Error loading users.":"Error loading users.","Editing {name}":"Editing {name}","Deleting {name}…":"Deleting {name}…","Deleted.":"Deleted.","Error deleting.":"Error deleting.","Delete user \"{name}\"?":"Delete user \"{name}\"?","Invalid credentials.":"Invalid credentials.","Account suspended or expired.":"Account suspended or expired.","Login failed.":"Login failed.","Network error.":"Network error.","Session expired — please sign in again.":"Session expired — please sign in again.",
    "Create Reseller":"Create Reseller","Create / edit reseller form":"Create / edit reseller form","Save reseller":"Save reseller","New reseller.":"New reseller.","Edit: {name}":"Edit: {name}","Editing {name}.":"Editing {name}.","Deleting {name}…":"Deleting {name}…","Error loading.":"Error loading.","Resellers list":"Resellers list","Max SSH users (0 = unlimited)":"Max SSH users (0 = unlimited)",
    "Server Load":"Server Load","Interfaces":"Interfaces","Interface":"Interface","Rx Mbps":"Rx Mbps","Tx Mbps":"Tx Mbps","Rx Total":"Rx Total","Tx Total":"Tx Total","Updated: {time}":"Updated: {time}","Error loading stats.":"Error loading stats.","Normal load":"Normal load","Moderate load":"Moderate load","High load":"High load","Cleaning interface totals…":"Cleaning interface totals…","Interface totals cleaned. Auto-clean remains every 30 days.":"Interface totals cleaned. Auto-clean remains every 30 days.","Error cleaning totals: {error}":"Error cleaning totals: {error}",
    "VnStat Usage":"VnStat Usage","Today total":"Today total","This month total":"This month total","Interfaces tracked":"Interfaces tracked","daily / monthly":"daily / monthly","Daily usage":"Daily usage","Monthly usage":"Monthly usage","Day":"Day","Month":"Month","Clean usage":"Clean usage","Clean VnStat history":"Clean VnStat history","VnStat history does not auto-clean. Use the button when you want to reset it.":"VnStat history does not auto-clean. Use the button when you want to reset it.","Totals can be cleaned here and auto-clean every 30 days. VnStat history is separate.":"Totals can be cleaned here and auto-clean every 30 days. VnStat history is separate.","Loading VnStat usage…":"Loading VnStat usage…","VnStat history cleaned.":"VnStat history cleaned.","Error loading VnStat usage: {error}":"Error loading VnStat usage: {error}","Error cleaning VnStat history: {error}":"Error cleaning VnStat history: {error}",
    "Panel / system":"Panel / system","Select a log source and click Refresh.":"Select a log source and click Refresh.","Clean panel log":"Clean panel log","No log lines yet.":"No log lines yet.","Panel log cleaned · {path} · max {max}":"Panel log cleaned · {path} · max {max}","Cleaning panel log…":"Cleaning panel log…",
    "Network":"Network","Main Listen (SSH / HTTP)":"Main Listen (SSH / HTTP)","Extra Listen Addresses":"Extra Listen Addresses","(one per line, e.g. 0.0.0.0:8080)":"(one per line, e.g. 0.0.0.0:8080)","SSH & General":"SSH & General","Default Upload Limit (Mbps)":"Default Upload Limit (Mbps)","Default Download Limit (Mbps)":"Default Download Limit (Mbps)","Quiet Logs":"Quiet Logs","User Count Display":"User Count Display","SSH Banner":"SSH Banner","Banner Text":"Banner Text","(shown to connecting SSH clients)":"(shown to connecting SSH clients)","DNSTT Tunnel":"DNSTT Tunnel","Domain":"Domain","UDP Listen":"UDP Listen","Auto Restart Interval":"Auto Restart Interval","Restart Grace Delay":"Restart Grace Delay","0s/off disables":"0s/off disables","Private Key":"Private Key","Public Key":"Public Key","Disable Stats Log":"Disable Stats Log","Disable Console Log":"Disable Console Log","UDP Gateway":"UDP Gateway","Listen":"Listen","Idle Timeout":"Idle Timeout","Map TTL":"Map TTL","Debug Logging":"Debug Logging","TLS Forwarders":"TLS Forwarders","Listen Address":"Listen Address","Certificate":"Certificate","Generate Self-Signed":"Generate Self-Signed","Let's Encrypt (certbot)":"Let's Encrypt (certbot)","Paste PEM text":"Paste PEM text","Custom file paths":"Custom file paths","Cert File":"Cert File","Key File":"Key File","Certificate PEM":"Certificate PEM","Private Key PEM":"Private Key PEM","Add Forwarder":"Add Forwarder","Save Config":"Save Config","All service changes apply live.":"All service changes apply live.","Saved and applied live.":"Saved and applied live.","Saved live with warnings: {warnings}":"Saved live with warnings: {warnings}","Processing…":"Processing…","Listen address required.":"Listen address required.","Domain required.":"Domain required.","Domain and email required.":"Domain and email required.","Cert and key paths required.":"Cert and key paths required.","Added. Save config to apply.":"Added. Save config to apply.","Generating…":"Generating…","Generated ✓ paths set.":"Generated ✓ paths set.","Generating key…":"Generating key…","Key generated. Save config to apply.":"Key generated. Save config to apply.","Loading public key…":"Loading public key…","Self-signed cert generated.":"Self-signed cert generated.","Let's Encrypt cert issued.":"Let's Encrypt cert issued.","PEM saved.":"PEM saved.","Saved ✓ paths set.":"Saved ✓ paths set.","Name, cert PEM, and key PEM required.":"Name, cert PEM, and key PEM required.","Name, cert, and key required.":"Name, cert, and key required.","Name, cert PEM, and key PEM required.":"Name, cert PEM, and key PEM required.","Save Changes":"Save Changes"
  },
  "pt-BR": {
    "Dashboard":"Painel","Overview":"Visão geral","Accounts":"Contas","Administration":"Administração","Server":"Servidor","System":"Sistema","Settings":"Configurações","Traffic":"Tráfego","Monitoring":"Monitoramento",
    "SSH / SlowDNS":"SSH / SlowDNS","Xray Users":"Usuários Xray","Resellers":"Revendedores","Logs":"Logs","VnStat":"VnStat","VPN Control":"Controle VPN","DragonCore":"DragonCore",
    "SSH Panel":"Painel SSH","Sign in with your admin or reseller credentials.":"Entre com suas credenciais de admin ou revendedor.","Username":"Usuário","Password":"Senha","Sign in":"Entrar","Logout":"Sair","Open menu":"Abrir menu","Toggle theme":"Alternar tema","Language":"Idioma",
    "Total accounts":"Total de contas","active":"ativas","expired":"expiradas","available limit":"Limite disponível","Loading quota…":"Carregando cota…","Active connections":"Conexões ativas","SSH + Xray online now":"SSH + Xray online agora","Ready for resellers":"Pronto para revendedores","Server monitoring in real time":"monitoramento em tempo real","CPU":"CPU","RAM":"RAM","Network":"Rede","Processor load":"Carga do processador","Memory used":"Memória usada","Total":"Total","Total --":"Total --","RX -- · TX -- Mb/s":"RX -- · TX -- Mb/s",
    "Quick actions":"Ações rápidas","simple":"simples","Create SSH":"Criar SSH","Create Xray":"Criar Xray","New reseller":"Novo revendedor","Configure services":"Configurar serviços","User, password, expiry and limit.":"Usuário, senha, validade e limite.","UUID, label, expiry and connections.":"UUID, label, validade e conexões.","Plan, expiry and account limit.":"Plano, validade e limite de contas.","Ports, DNSTT, UDPGW and TLS.":"Portas, DNSTT, UDPGW e TLS.","My quota":"Minha cota","Loading…":"Carregando…","Loading...":"Carregando...",
    "My Account":"Minha conta","Users (used / max)":"Usuários (usado / máximo)","Users (used/max)":"Usuários (usado/máximo)","Expires":"Vence em","Status":"Status","Users":"Usuários","User":"Usuário","Auth":"Autenticação","Conn":"Conexões","Max":"Máximo","Up":"Upload","Dn":"Download","Owner":"Dono","Actions":"Ações","Create / update user":"Criar / atualizar usuário","Create / edit user form":"Formulário de criar / editar usuário","Show form":"Mostrar formulário","Hide form":"Ocultar formulário","TOTP Secret":"Segredo TOTP","TOTP Period (s)":"Período TOTP (s)","TOTP Window":"Janela TOTP","TOTP Digits":"Dígitos TOTP","Allow static password too":"Permitir senha estática também","Max connections":"Máx. conexões","Expires at":"Vence em","Max Upload (Mb/s)":"Upload máx. (Mb/s)","Max Download (Mb/s)":"Download máx. (Mb/s)","Save user":"Salvar usuário","Cancel":"Cancelar","Gen":"Gerar","Copy":"Copiar","Edit":"Editar","Del":"Excluir","Reload":"Recarregar","Refresh":"Atualizar","+ New":"+ Novo","+ Add":"+ Adicionar","Add":"Adicionar","Remove":"Remover",
    "Running":"Rodando","Stopped":"Parado","running":"rodando","stopped":"parado","disabled":"desativado","Counters API":"API de contadores","Repair counters":"Reparar contadores","Start":"Iniciar","Stop":"Parar","Restart":"Reiniciar","Inbounds & Clients":"Inbounds e clientes","Inbounds & clients":"Inbounds e clientes","Xray Config":"Configuração Xray","Visual":"Visual","JSON":"JSON","Config editor":"Editor de configuração","Load JSON":"Carregar JSON","Save & Restart":"Salvar e reiniciar","System Logs":"Logs do sistema","last 200 lines":"últimas 200 linhas","Xray clients":"Clientes Xray","Xray Core":"Núcleo Xray","Enabled":"Ativado","Online":"Online","PID":"PID","Uptime":"Tempo ativo","Counters API ready.":"API de contadores pronta.","Counters API ready at {server}.":"API de contadores pronta em {server}.","Online counters need Stats API repair.":"Contadores online precisam de reparo da Stats API.","Online counters: {error}":"Contadores online: {error}","Needs repair":"Precisa de reparo","OK":"OK",
    "UUID":"UUID","Email":"Email","Email / label":"Email / label","Display Name":"Nome de exibição","Expiry Date":"Data de vencimento","Max Connections":"Máx. conexões","(0 = unlimited)":"(0 = ilimitado)","auto-generate":"gerar automaticamente","Name":"Nome","Expiry":"Vencimento","Online":"Online","Traffic":"Tráfego","No clients.":"Nenhum cliente.","No VLESS/VMess/Trojan inbounds found.":"Nenhum inbound VLESS/VMess/Trojan encontrado.","Add Client":"Adicionar cliente","+ Add Client":"+ Adicionar cliente","Copied client ID.":"ID do cliente copiado.","UUID required.":"UUID obrigatório.","Client {id}… added. Restarting Xray…":"Cliente {id}… adicionado. Reiniciando Xray…","Client removed. Restarting Xray…":"Cliente removido. Reiniciando Xray…","Remove client {id}… from {tag}?":"Remover cliente {id}… de {tag}?","New client data is available; editing was preserved.":"Novos dados de cliente disponíveis; sua edição foi preservada.","Config loaded.":"Configuração carregada.","Invalid JSON: {error}":"JSON inválido: {error}","Saved. Restarting Xray…":"Salvo. Reiniciando Xray…","Saved.":"Salvo.","Saving…":"Salvando…","Error: {error}":"Erro: {error}","Error loading inbounds.":"Erro ao carregar inbounds.",
    "Active":"Ativo","Suspended":"Suspenso","Expired":"Expirado","Unlimited":"Ilimitado","No expiration":"Sem vencimento","Idle":"ocioso","online":"online","offline":"offline","idle":"ocioso","ago":"atrás","Active ({days}d)":"Ativo ({days}d)","No limit set by admin":"Sem limite definido pelo admin","{remaining} accounts available · {pct}% used":"{remaining} contas disponíveis · {pct}% usado","{used} used · unlimited":"{used} usadas · sem limite","{used}/{max} used · {pct}% of plan":"{used}/{max} usadas · {pct}% do plano","SSH {ssh} · Xray {xray}":"SSH {ssh} · Xray {xray}","{ssh} SSH · {xray} Xray online":"{ssh} SSH · {xray} Xray online","{online} online · {active} active · {expired} expired · Core: {core}":"{online} online · {active} ativos · {expired} expirados · Core: {core}","{count} online":"{count} online","{count} total · {active} active · {online} online":"{count} total · {active} ativas · {online} online",
    "New user.":"Novo usuário.","TOTP secret generated.":"Segredo TOTP gerado.","Loaded.":"Carregado.","Last reload: {time}":"Último reload: {time}","Error loading users.":"Erro ao carregar usuários.","Editing {name}":"Editando {name}","Deleting {name}…":"Excluindo {name}…","Deleted.":"Excluído.","Error deleting.":"Erro ao excluir.","Delete user \"{name}\"?":"Excluir usuário \"{name}\"?","Invalid credentials.":"Credenciais inválidas.","Account suspended or expired.":"Conta suspensa ou expirada.","Login failed.":"Falha no login.","Network error.":"Erro de rede.","Session expired — please sign in again.":"Sessão expirada — faça login novamente.",
    "Create Reseller":"Criar revendedor","Create / edit reseller form":"Formulário de criar / editar revendedor","Save reseller":"Salvar revendedor","New reseller.":"Novo revendedor.","Edit: {name}":"Editar: {name}","Editing {name}.":"Editando {name}.","Deleting {name}…":"Excluindo {name}…","Error loading.":"Erro ao carregar.","Resellers list":"Lista de revendedores","Max SSH users (0 = unlimited)":"Máximo de usuários SSH (0 = ilimitado)",
    "Server Load":"Carga do servidor","Interfaces":"Interfaces","Interface":"Interface","Rx Mbps":"Rx Mbps","Tx Mbps":"Tx Mbps","Rx Total":"Rx Total","Tx Total":"Tx Total","Updated: {time}":"Atualizado: {time}","Error loading stats.":"Erro ao carregar stats.","Normal load":"Carga normal","Moderate load":"Carga moderada","High load":"Carga alta","Cleaning interface totals…":"Limpando totais das interfaces…","Interface totals cleaned. Auto-clean remains every 30 days.":"Totais das interfaces limpos. A limpeza automática continua a cada 30 dias.","Error cleaning totals: {error}":"Erro ao limpar totais: {error}",
    "VnStat Usage":"Uso do VnStat","Today total":"Total hoje","This month total":"Total este mês","Interfaces tracked":"Interfaces monitoradas","daily / monthly":"diário / mensal","Daily usage":"Uso diário","Monthly usage":"Uso mensal","Day":"Dia","Month":"Mês","Clean usage":"Limpar uso","Clean VnStat history":"Limpar histórico VnStat","VnStat history does not auto-clean. Use the button when you want to reset it.":"O histórico VnStat não é limpo automaticamente. Use o botão quando quiser resetar.","Totals can be cleaned here and auto-clean every 30 days. VnStat history is separate.":"Os totais podem ser limpos aqui e têm limpeza automática a cada 30 dias. O histórico VnStat é separado.","Loading VnStat usage…":"Carregando uso do VnStat…","VnStat history cleaned.":"Histórico VnStat limpo.","Error loading VnStat usage: {error}":"Erro ao carregar uso do VnStat: {error}","Error cleaning VnStat history: {error}":"Erro ao limpar histórico VnStat: {error}",
    "Panel / system":"Painel / sistema","Select a log source and click Refresh.":"Selecione uma fonte de log e clique em Atualizar.","Clean panel log":"Limpar log do painel","No log lines yet.":"Ainda não há linhas de log.","Panel log cleaned · {path} · max {max}":"Log do painel limpo · {path} · máx {max}","Cleaning panel log…":"Limpando log do painel…",
    "Network":"Rede","Main Listen (SSH / HTTP)":"Listen principal (SSH / HTTP)","Extra Listen Addresses":"Endereços extras de listen","Proxy Auto Restart":"Reinício automático do proxy","Proxy Auto Restart Interval":"Intervalo de reinício automático do proxy","Proxy Restart Grace Delay":"Atraso para reiniciar proxy","(one per line, e.g. 0.0.0.0:8080)":"(um por linha, ex. 0.0.0.0:8080)","SSH & General":"SSH e geral","Default Upload Limit (Mbps)":"Limite padrão de upload (Mbps)","Default Download Limit (Mbps)":"Limite padrão de download (Mbps)","Quiet Logs":"Logs silenciosos","User Count Display":"Exibir contagem de usuários","SSH Banner":"Banner SSH","Banner Text":"Texto do banner","(shown to connecting SSH clients)":"(mostrado aos clientes SSH ao conectar)","DNSTT Tunnel":"Túnel DNSTT","Domain":"Domínio","UDP Listen":"Listen UDP","Auto Restart Interval":"Intervalo de reinício automático","Restart Grace Delay":"Atraso para reiniciar","0s/off disables":"0s/off desativa","Private Key":"Chave privada","Public Key":"Chave pública","Disable Stats Log":"Desativar log de stats","Disable Console Log":"Desativar log do console","UDP Gateway":"Gateway UDP","Listen":"Listen","Idle Timeout":"Timeout ocioso","Map TTL":"TTL do mapa","Debug Logging":"Log de debug","TLS Forwarders":"Encaminhadores TLS","Listen Address":"Endereço de listen","Certificate":"Certificado","Generate Self-Signed":"Gerar autoassinado","Let's Encrypt (certbot)":"Let's Encrypt (certbot)","Paste PEM text":"Colar texto PEM","Custom file paths":"Caminhos personalizados","Cert File":"Arquivo cert","Key File":"Arquivo key","Certificate PEM":"Certificado PEM","Private Key PEM":"Chave privada PEM","Add Forwarder":"Adicionar forwarder","Save Config":"Salvar config","All service changes apply live.":"Todas as mudanças de serviço aplicam ao vivo.","Saved and applied live.":"Salvo e aplicado ao vivo.","Saved live with warnings: {warnings}":"Salvo ao vivo com avisos: {warnings}","Processing…":"Processando…","Listen address required.":"Endereço de listen obrigatório.","Domain required.":"Domínio obrigatório.","Domain and email required.":"Domínio e email obrigatórios.","Cert and key paths required.":"Caminhos do certificado e da chave obrigatórios.","Added. Save config to apply.":"Adicionado. Salve a config para aplicar.","Generating…":"Gerando…","Generated ✓ paths set.":"Gerado ✓ caminhos definidos.","Generating key…":"Gerando chave…","Key generated. Save config to apply.":"Chave gerada. Salve a config para aplicar.","Loading public key…":"Carregando chave pública…","Self-signed cert generated.":"Certificado autoassinado gerado.","Let's Encrypt cert issued.":"Certificado Let's Encrypt emitido.","PEM saved.":"PEM salvo.","Saved ✓ paths set.":"Salvo ✓ caminhos definidos.","Name, cert PEM, and key PEM required.":"Nome, cert PEM e chave PEM obrigatórios.","Name, cert, and key required.":"Nome, cert e chave obrigatórios.","Save Changes":"Salvar alterações"
  }
};
const I18N_ALIASES = {
  "Painel":"Dashboard","Visão geral":"Overview","Contas":"Accounts","Administração":"Administration","Servidor":"Server","Sistema":"System","Configurações":"Settings","Tráfego":"Traffic","Revendedores":"Resellers","Usuários Xray":"Xray Users","Controle VPN":"VPN Control","Sair":"Logout",
  "Total de contas":"Total accounts","ativas":"active","expiradas":"expired","Limite disponível":"available limit","Carregando cota…":"Loading quota…","Conexões ativas":"Active connections","SSH + Xray online agora":"SSH + Xray online now","Pronto para revendedores":"Ready for resellers","monitoramento em tempo real":"Server monitoring in real time","Carga do processador":"Processor load","Memória usada":"Memory used",
  "Ações rápidas":"Quick actions","Criar SSH":"Create SSH","Criar Xray":"Create Xray","Novo revendedor":"New reseller","Configurar serviços":"Configure services","Usuário, senha, validade e limite.":"User, password, expiry and limit.","UUID, label, validade e conexões.":"UUID, label, expiry and connections.","Plano, validade e limite de contas.":"Plan, expiry and account limit.","Portas, DNSTT, UDPGW e TLS.":"Ports, DNSTT, UDPGW and TLS.","Minha cota":"My quota","Carregando…":"Loading…",
  "Minha conta":"My Account","Usuários":"Users","Usuário":"User","Autenticação":"Auth","Conexões":"Conn","Máximo":"Max","Dono":"Owner","Ações":"Actions","Criar / atualizar usuário":"Create / update user","Mostrar formulário":"Show form","Ocultar formulário":"Hide form","Salvar usuário":"Save user","Cancelar":"Cancel","Gerar":"Gen","Copiar":"Copy","Editar":"Edit","Excluir":"Del","Recarregar":"Reload","Atualizar":"Refresh",
  "Rodando":"Running","Parado":"Stopped","rodando":"running","parado":"stopped","desativado":"disabled","API de contadores":"Counters API","Reparar contadores":"Repair counters","Iniciar":"Start","Parar":"Stop","Reiniciar":"Restart","Inbounds e clientes":"Inbounds & Clients","Configuração Xray":"Xray Config","Editor de configuração":"Config editor","Carregar JSON":"Load JSON","Salvar e reiniciar":"Save & Restart","Logs do sistema":"System Logs","últimas 200 linhas":"last 200 lines","Clientes Xray":"Xray clients","Núcleo Xray":"Xray Core","Ativado":"Enabled","Tempo ativo":"Uptime","Precisa de reparo":"Needs repair",
  "Nome":"Name","Nome de exibição":"Display Name","Data de vencimento":"Expiry Date","Máx. conexões":"Max Connections","Ilimitado":"Unlimited","Ativo":"Active","Suspenso":"Suspended","Expirado":"Expired","Sem vencimento":"No expiration","ocioso":"idle","Nenhum cliente.":"No clients.","Adicionar cliente":"Add Client","Novo usuário.":"New user.","Carregado.":"Loaded.","Salvo.":"Saved.","Salvando…":"Saving…","Erro ao carregar usuários.":"Error loading users.","Erro ao excluir.":"Error deleting.","Credenciais inválidas.":"Invalid credentials.","Conta suspensa ou expirada.":"Account suspended or expired.","Falha no login.":"Login failed.","Erro de rede.":"Network error.","Sessão expirada — faça login novamente.":"Session expired — please sign in again.",
  "Rede":"Network","Listen principal (SSH / HTTP)":"Main Listen (SSH / HTTP)","Endereços extras de listen":"Extra Listen Addresses","Reinício automático do proxy":"Proxy Auto Restart","Intervalo de reinício automático do proxy":"Proxy Auto Restart Interval","Atraso para reiniciar proxy":"Proxy Restart Grace Delay","SSH e geral":"SSH & General","Limite padrão de upload (Mbps)":"Default Upload Limit (Mbps)","Limite padrão de download (Mbps)":"Default Download Limit (Mbps)","Logs silenciosos":"Quiet Logs","Exibir contagem de usuários":"User Count Display","Banner SSH":"SSH Banner","Texto do banner":"Banner Text","Túnel DNSTT":"DNSTT Tunnel","Domínio":"Domain","Chave privada":"Private Key","Intervalo de reinício automático":"Auto Restart Interval","Atraso para reiniciar":"Restart Grace Delay","0s/off desativa":"0s/off disables","Chave pública":"Public Key","Gateway UDP":"UDP Gateway","Endereço de listen":"Listen Address","Certificado":"Certificate","Gerar autoassinado":"Generate Self-Signed","Colar texto PEM":"Paste PEM text","Caminhos personalizados":"Custom file paths","Arquivo cert":"Cert File","Arquivo key":"Key File","Adicionar forwarder":"Add Forwarder","Salvar config":"Save Config","Todas as mudanças de serviço aplicam ao vivo.":"All service changes apply live."
};

Object.assign(I18N_TEXT["en-US"], {
  "Servers":"Servers","Reseller area":"Reseller area","shared quota":"shared quota","available":"available","used":"used","breakdown":"breakdown",
  "Create Xray clients with the same experience as the main panel. Each Xray client uses the same limit shared with SSH accounts.":"Create Xray clients with the same experience as the main panel. Each Xray client uses the same limit shared with SSH accounts.",
  "Loading inbounds…":"Loading inbounds…","SSH -- · Xray --":"SSH -- · Xray --","active ·":"active ·","expired":"expired",
  "Binary: /opt/sshpanel/xray · Config: DB-backed /opt/sshpanel/xray_config.json · Online counters use Xray Stats API on 127.0.0.1:10085":"Binary: /opt/sshpanel/xray · Config: DB-backed /opt/sshpanel/xray_config.json · Online counters use Xray Stats API on 127.0.0.1:10085",
  "Public Key — share with dnstt clients":"Public Key — share with DNSTT clients","auto-saved to /opt/sshpanel/dnstt.key":"auto-saved to /opt/sshpanel/dnstt.key",
  "Max UDP Sessions Per Client":"Max UDP Sessions Per Client","(not total server users)":"(not total server users)","Service Name":"Service Name","Mode":"Mode","Protocol":"Protocol","Port":"Port","Tag":"Tag","Listen IP":"Listen IP","Method":"Method","Host":"Host","Path":"Path","Dest":"Dest","Short ID":"Short ID","Server Name":"Server Name","Cert File Path":"Cert File Path","Key File Path":"Key File Path","Certificate source:":"Certificate source:","Self-Signed":"Self-Signed","Paste PEM":"Paste PEM","File Path":"File Path","Save PEM":"Save PEM","Generate":"Generate","Public Key":"Public Key","Debug Logging":"Debug Logging","Name":"Name","Private Key PEM":"Private Key PEM","Certificate PEM":"Certificate PEM","Domain Name":"Domain Name"
});
Object.assign(I18N_TEXT["pt-BR"], {
  "Servers":"Servidores","Reseller area":"Área do revendedor","shared quota":"cota única","available":"disponíveis","used":"usadas","breakdown":"divisão",
  "Create Xray clients with the same experience as the main panel. Each Xray client uses the same limit shared with SSH accounts.":"Crie clientes Xray com a mesma experiência do painel principal. Cada cliente Xray desconta do mesmo limite usado pelas contas SSH.",
  "Loading inbounds…":"Carregando inbounds…","SSH -- · Xray --":"SSH -- · Xray --","active ·":"ativas ·","expired":"expiradas",
  "Binary: /opt/sshpanel/xray · Config: DB-backed /opt/sshpanel/xray_config.json · Online counters use Xray Stats API on 127.0.0.1:10085":"Binário: /opt/sshpanel/xray · Config: DB-backed /opt/sshpanel/xray_config.json · Contadores online usam a Xray Stats API em 127.0.0.1:10085",
  "Public Key — share with dnstt clients":"Chave pública — compartilhe com clientes DNSTT","auto-saved to /opt/sshpanel/dnstt.key":"salva automaticamente em /opt/sshpanel/dnstt.key",
  "Max UDP Sessions Per Client":"Máx. sessões UDP por cliente","(not total server users)":"(não é o total de usuários do servidor)","Service Name":"Nome do serviço","Mode":"Modo","Protocol":"Protocolo","Port":"Porta","Tag":"Tag","Listen IP":"IP de listen","Method":"Método","Host":"Host","Path":"Caminho","Dest":"Destino","Short ID":"ID curto","Server Name":"Nome do servidor","Cert File Path":"Caminho do arquivo cert","Key File Path":"Caminho do arquivo key","Certificate source:":"Fonte do certificado:","Self-Signed":"Autoassinado","Paste PEM":"Colar PEM","File Path":"Caminho do arquivo","Save PEM":"Salvar PEM","Generate":"Gerar","Public Key":"Chave pública","Debug Logging":"Log de debug","Name":"Nome","Private Key PEM":"Chave privada PEM","Certificate PEM":"Certificado PEM","Domain Name":"Nome do domínio"
});
Object.assign(I18N_ALIASES, {
  "Servidores":"Servers","Área do revendedor":"Reseller area","cota única":"shared quota","disponíveis":"available","usadas":"used","divisão":"breakdown",
  "Crie clientes Xray com a mesma experiência do painel principal. Cada cliente Xray desconta do mesmo limite usado pelas contas SSH.":"Create Xray clients with the same experience as the main panel. Each Xray client uses the same limit shared with SSH accounts.",
  "Carregando inbounds…":"Loading inbounds…","Loading inbounds…":"Loading inbounds…","ativas ·":"active ·","expiradas":"expired",
  "Binário: /opt/sshpanel/xray · Config: DB-backed /opt/sshpanel/xray_config.json · Contadores online usam a Xray Stats API em 127.0.0.1:10085":"Binary: /opt/sshpanel/xray · Config: DB-backed /opt/sshpanel/xray_config.json · Online counters use Xray Stats API on 127.0.0.1:10085",
  "Public Key — share with dnstt clients":"Public Key — share with dnstt clients","Chave pública — compartilhe com clientes DNSTT":"Public Key — share with dnstt clients",
  "Máx. sessões UDP por cliente":"Max UDP Sessions Per Client","(não é o total de usuários do servidor)":"(not total server users)","Nome do serviço":"Service Name","Modo":"Mode","Protocolo":"Protocol","Porta":"Port","IP de listen":"Listen IP","Método":"Method","Caminho":"Path","Destino":"Dest","ID curto":"Short ID","Nome do servidor":"Server Name","Caminho do arquivo cert":"Cert File Path","Caminho do arquivo key":"Key File Path","Fonte do certificado:":"Certificate source:","Autoassinado":"Self-Signed","Colar PEM":"Paste PEM","Caminho do arquivo":"File Path","Salvar PEM":"Save PEM","Intervalo de reinício automático":"Auto Restart Interval","Atraso para reiniciar":"Restart Grace Delay","0s/off desativa":"0s/off disables","Chave pública":"Public Key","Nome do domínio":"Domain Name"
});
Object.assign(I18N_TEXT["en-US"], {
  "Panel Updates":"Panel Updates","Checking…":"Checking…","Open Git":"Open Git","Check now":"Check now","Installed version":"Installed version","Latest Git version":"Latest Git version","Branch":"Branch","Last checked":"Last checked",
  "Comparing the installed version with the Git repository.":"Comparing the installed version with the Git repository.","To update:":"To update:","Copy command":"Copy command","Up to date":"Up to date","Update available":"Update available","Local changes":"Local changes","Unknown":"Unknown",
  "The installed version matches the latest commit on {branch}.":"The installed version matches the latest commit on {branch}.","A newer commit is available on {branch}.":"A newer commit is available on {branch}.","This build contains local changes, so it cannot be compared safely.":"This build contains local changes, so it cannot be compared safely.",
  "Could not check for updates: {error}":"Could not check for updates: {error}","The update status could not be determined.":"The update status could not be determined.","Checking repository…":"Checking repository…","Update check timed out.":"Update check timed out.","Could not reach the Git repository.":"Could not reach the Git repository.","Current build commit is unavailable.":"Current build commit is unavailable.","Unknown update-check error.":"Unknown update-check error.","Copied":"Copied"
});
Object.assign(I18N_TEXT["pt-BR"], {
  "Panel Updates":"Atualizações do painel","Checking…":"Verificando…","Open Git":"Abrir Git","Check now":"Verificar agora","Installed version":"Versão instalada","Latest Git version":"Última versão no Git","Branch":"Branch","Last checked":"Última verificação",
  "Comparing the installed version with the Git repository.":"Comparando a versão instalada com o repositório Git.","To update:":"Para atualizar:","Copy command":"Copiar comando","Up to date":"Atualizado","Update available":"Atualização disponível","Local changes":"Alterações locais","Unknown":"Desconhecido",
  "The installed version matches the latest commit on {branch}.":"A versão instalada corresponde ao commit mais recente da branch {branch}.","A newer commit is available on {branch}.":"Existe um commit mais recente disponível na branch {branch}.","This build contains local changes, so it cannot be compared safely.":"Esta compilação contém alterações locais e não pode ser comparada com segurança.",
  "Could not check for updates: {error}":"Não foi possível verificar atualizações: {error}","The update status could not be determined.":"Não foi possível determinar o status da atualização.","Checking repository…":"Verificando o repositório…","Update check timed out.":"A verificação de atualização excedeu o tempo limite.","Could not reach the Git repository.":"Não foi possível acessar o repositório Git.","Current build commit is unavailable.":"O commit da compilação atual não está disponível.","Unknown update-check error.":"Erro desconhecido ao verificar atualização.","Copied":"Copiado"
});
Object.assign(I18N_ALIASES, {
  "Atualizações do painel":"Panel Updates","Verificando…":"Checking…","Abrir Git":"Open Git","Verificar agora":"Check now","Versão instalada":"Installed version","Última versão no Git":"Latest Git version","Última verificação":"Last checked",
  "Comparando a versão instalada com o repositório Git.":"Comparing the installed version with the Git repository.","Para atualizar:":"To update:","Copiar comando":"Copy command","Atualizado":"Up to date","Atualização disponível":"Update available","Alterações locais":"Local changes","Desconhecido":"Unknown"
});
Object.assign(I18N_TEXT["en-US"], {
  "Command center":"Command center","Overview command copy":"Accounts, connections, and infrastructure at a glance.","Access workspace":"Access workspace","SSH accounts":"SSH accounts","SSH accounts copy":"Create, limit, and monitor SSH and SlowDNS access securely.",
  "Proxy studio":"Proxy studio","Xray visual":"Visual Xray","Xray visual copy":"Manage clients, inbounds, and a shared XHTTP endpoint without editing JSON.","Partner operations":"Partner operations","Partner operations copy":"Control partner quotas, expiration, and access in one place.",
  "Fleet control":"Fleet control","Fleet control copy":"Add nodes, test credentials, and configure remote infrastructure.","Live fleet":"Live fleet","Server status copy":"Health, load, and active sessions for every managed node.","Observability":"Observability","Monitoring copy":"Server resources, interfaces, and capacity in real time.",
  "Traffic intelligence":"Traffic intelligence","Network traffic":"Network traffic","Network traffic copy":"Daily and monthly history for understanding infrastructure usage.","Diagnostics":"Diagnostics","System logs copy":"Investigate the panel, DNSTT, and Xray in a focused view.","System studio":"System studio","Settings copy":"Network, SSH, tunnels, and TLS organized visually and applied live.",
  "One domain and port":"One domain and port","Shared endpoint copy":"The selected protocol uses /; SSH uses /ssh. Available in native Xray mode.","Protocol on /":"Protocol on /","Shared port":"Shared port","Listen IP":"Listen IP","HTTP host":"HTTP host","optional":"optional","XHTTP mode":"XHTTP mode","Security":"Security","No TLS":"No TLS","Certificate file":"Certificate file","Key file":"Key file","Create / update endpoint":"Create / update endpoint",
  "Configured inbounds":"Configured inbounds","Visual inbound help":"Edit any card visually or use JSON for advanced fields.","New inbound":"New inbound","Visual editor":"Visual editor","Add inbound":"Add inbound","Save changes":"Save changes","Duplicate":"Duplicate","Remove":"Remove","Save config and restart":"Save config and restart",
  "Old XHTTP configuration?":"Old XHTTP configuration?","Legacy XHTTP migration copy":"Use “Enable SSH /ssh” on the existing inbound card. The panel preserves the inbound, clients, and every current option; it only adds the SSH route and restarts Xray.","Enable SSH /ssh":"Enable SSH /ssh","SSH /ssh enabled":"SSH /ssh enabled","Legacy XHTTP migration":"Legacy XHTTP migration"
});
Object.assign(I18N_TEXT["pt-BR"], {
  "Command center":"Central de comando","Overview command copy":"Contas, conexões e infraestrutura em uma leitura rápida.","Access workspace":"Área de acessos","SSH accounts":"Contas SSH","SSH accounts copy":"Crie, limite e acompanhe acessos SSH e SlowDNS com segurança.",
  "Proxy studio":"Estúdio de proxy","Xray visual":"Xray visual","Xray visual copy":"Gerencie clientes, inbounds e um endpoint XHTTP compartilhado sem editar JSON.","Partner operations":"Operação de parceiros","Partner operations copy":"Controle cotas, validade e acesso dos parceiros em um só lugar.",
  "Fleet control":"Controle da frota","Fleet control copy":"Adicione nós, teste credenciais e configure a infraestrutura remota.","Live fleet":"Frota ao vivo","Server status copy":"Saúde, carga e sessões ativas de cada nó gerenciado.","Observability":"Observabilidade","Monitoring copy":"Recursos, interfaces e capacidade do servidor em tempo real.",
  "Traffic intelligence":"Inteligência de tráfego","Network traffic":"Tráfego de rede","Network traffic copy":"Histórico diário e mensal para entender o consumo da infraestrutura.","Diagnostics":"Diagnóstico","System logs copy":"Investigue painel, DNSTT e Xray com uma visualização focada.","System studio":"Estúdio do sistema","Settings copy":"Rede, SSH, túneis e TLS organizados em blocos visuais e aplicados ao vivo.",
  "One domain and port":"Um domínio e uma porta","Shared endpoint copy":"O protocolo selecionado usa /; SSH usa /ssh. Disponível no modo Xray nativo.","Protocol on /":"Protocolo em /","Shared port":"Porta compartilhada","Listen IP":"IP de listen","HTTP host":"Host HTTP","optional":"opcional","XHTTP mode":"Modo XHTTP","Security":"Segurança","No TLS":"Sem TLS","Certificate file":"Arquivo do certificado","Key file":"Arquivo da chave","Create / update endpoint":"Criar / atualizar endpoint",
  "Configured inbounds":"Inbounds configurados","Visual inbound help":"Edite qualquer cartão visualmente ou use JSON para campos avançados.","New inbound":"Novo inbound","Visual editor":"Editor visual","Add inbound":"Adicionar inbound","Save changes":"Salvar alterações","Duplicate":"Duplicar","Remove":"Remover","Save config and restart":"Salvar configuração e reiniciar",
  "Old XHTTP configuration?":"Configuração XHTTP antiga?","Legacy XHTTP migration copy":"Use “Ativar SSH /ssh” no cartão do inbound existente. O painel mantém o inbound, os clientes e todas as opções atuais; adiciona somente a rota SSH e reinicia o Xray.","Enable SSH /ssh":"Ativar SSH /ssh","SSH /ssh enabled":"SSH /ssh ativado","Legacy XHTTP migration":"Migração de configuração XHTTP antiga"
});
Object.assign(I18N_TEXT["en-US"], {
  "Infrastructure":"Infrastructure","Infrastructure areas":"Infrastructure areas","Infrastructure area":"Infrastructure area","Waiting for data":"Waiting for data","Operation":"Operation","Accounts":"Accounts","Active accounts":"Active","Online now":"Online now","Counters":"Counters","Save mode":"Save mode",
  "Nodes":"Nodes","Active nodes":"Active","SSH enabled":"SSH enabled","Xray enabled":"Xray enabled","Sessions":"Sessions","Processor":"Processor","Memory":"Memory","Network now":"Network now","Interfaces":"Interfaces","Today":"Today","This month":"This month","Recent period":"Recent period","Update":"Refresh","Clear history":"Clear history",
  "Infrastructure workspace copy":"Manage nodes, monitor system health, and inspect traffic from one workspace.","Confirmation":"Confirmation","Confirm action":"Confirm action","Confirm":"Confirm","Completed":"Completed","Action failed":"Action failed","Attention":"Attention","Information":"Information","Close":"Close",
  "Loading SSH status…":"Loading SSH status…","Loading":"Loading","Could not load SSH status":"Could not load SSH status","Error":"Error","Online":"Online","SSH data updated at {time}":"SSH data updated at {time}","Delete SSH account":"Delete SSH account","The active SSH sessions for this account will be disconnected.":"The active SSH sessions for this account will be disconnected.","Delete account":"Delete account",
  "Loading Xray status…":"Loading Xray status…","Could not load Xray status":"Could not load Xray status","Remove Xray client":"Remove Xray client","The client will lose access immediately after the configuration reload.":"The client will lose access immediately after the configuration reload.","Remove client":"Remove client","Client removed successfully.":"Client removed successfully.","Xray client":"Xray client",
  "Loading infrastructure…":"Loading infrastructure…","Infrastructure loaded with fallback data":"Infrastructure loaded with fallback data","{count} active nodes · updated {time}":"{count} active nodes · updated {time}","Delete managed server":"Delete managed server","Delete server \"{name}\"?":"Delete server \"{name}\"?","The remote node is not erased, but it will be removed from this panel and can no longer receive managed actions.":"The remote node is not erased, but it will be removed from this panel and can no longer receive managed actions.","Delete server":"Delete server",
  "Updating live status…":"Updating live status…","Live · updated {time}":"Live · updated {time}","Error loading server status":"Error loading server status","Clean live interface totals":"Clean live interface totals","Clean the live Interface totals now?":"Clean the live Interface totals now?","VnStat daily and monthly history will be preserved.":"VnStat daily and monthly history will be preserved.","Clean totals":"Clean totals","Live interface totals were cleaned.":"Live interface totals were cleaned.","Traffic counters":"Traffic counters","Clean VnStat history":"Clean VnStat history","Clean all daily and monthly traffic history?":"Clean all daily and monthly traffic history?","Live interface totals are separate and will not be reset.":"Live interface totals are separate and will not be reset.","Clean history":"Clean history","VnStat history was cleaned.":"VnStat history was cleaned.","Traffic history":"Traffic history","Clean panel log":"Clean panel log","Clean the current panel log now?":"Clean the current panel log now?","This only clears the panel log file. Automatic size-based cleanup remains enabled.":"This only clears the panel log file. Automatic size-based cleanup remains enabled.","Clean log":"Clean log",
  "Delete reseller":"Delete reseller","Delete reseller \"{name}\"?":"Delete reseller \"{name}\"?","Their owned access will be removed and active SSH sessions will be disconnected.":"Their owned access will be removed and active SSH sessions will be disconnected.","Remove inbound":"Remove inbound","Remove inbound {name}?":"Remove inbound {name}?","Clients attached only to this inbound will stop connecting after the configuration is saved.":"Clients attached only to this inbound will stop connecting after the configuration is saved.",
  "This endpoint already has an SSH /ssh route.":"This endpoint already has an SSH /ssh route.","Add SSH /ssh without rebuilding this inbound.":"Add SSH /ssh without rebuilding this inbound.","SSH migration attention":"SSH migration attention","Could not enable SSH /ssh":"Could not enable SSH /ssh","Select a VLESS/VMess inbound using XHTTP.":"Select a VLESS/VMess inbound using XHTTP.","Load the selected server configuration before enabling SSH.":"Load the selected server configuration before enabling SSH.","Shared SSH requires native Xray mode. Select Internal native emulator and save the mode first.":"Shared SSH requires native Xray mode. Select Internal native emulator and save the mode first.","Inbound {name} uses {security}, which native SSH XHTTP does not support. Use TLS or no TLS.":"Inbound {name} uses {security}, which native SSH XHTTP does not support. Use TLS or no TLS.","SSH is already enabled on /ssh by inbound {name}.":"SSH is already enabled on /ssh by inbound {name}.","Path /ssh is already used by inbound {name}. Edit that path first.":"Path /ssh is already used by inbound {name}. Edit that path first.","This inbound uses TLS but has no reusable certificate and key file paths.":"This inbound uses TLS but has no reusable certificate and key file paths.","Safe XHTTP migration":"Safe XHTTP migration","Enable SSH on /ssh":"Enable SSH on /ssh","Add SSH to the same endpoint without rebuilding {name}?":"Add SSH to the same endpoint without rebuilding {name}?","Listener":"Listener","Existing path preserved":"Existing path preserved","New SSH path":"New SSH path","Clients preserved":"Clients preserved","Enabling SSH…":"Enabling SSH…","Could not enable SSH: {error}":"Could not enable SSH: {error}","Migration was cancelled because it would alter the old inbound.":"Migration was cancelled because it would alter the old inbound.","SSH /ssh added to the draft without changing {name}.":"SSH /ssh added to the draft without changing {name}.","Enabling SSH /ssh without changing {name}…":"Enabling SSH /ssh without changing {name}…","The SSH route could not be saved. The old inbound was not changed.":"The SSH route could not be saved. The old inbound was not changed.","SSH /ssh was saved, but Xray could not restart. Use the Restart button after checking the Xray log.":"SSH /ssh was saved, but Xray could not restart. Use the Restart button after checking the Xray log.","SSH /ssh is active. The old inbound and all clients were preserved.":"SSH /ssh is active. The old inbound and all clients were preserved.","Configuration for this server was not loaded.":"Configuration for this server was not loaded.","Invalid visual config: {error}":"Invalid visual config: {error}","Xray could not restart.":"Xray could not restart.","Could not save configuration: {error}":"Could not save configuration: {error}","selected":"selected","this inbound":"this inbound","the old inbound":"the old inbound","untagged":"untagged"
});
Object.assign(I18N_TEXT["pt-BR"], {
  "Infrastructure":"Infraestrutura","Infrastructure areas":"Áreas da infraestrutura","Infrastructure area":"Área da infraestrutura","Waiting for data":"Aguardando dados","Operation":"Operação","Accounts":"Contas","Active accounts":"Ativas","Online now":"Online agora","Counters":"Contadores","Save mode":"Salvar modo",
  "Nodes":"Nós","Active nodes":"Ativos","SSH enabled":"SSH habilitado","Xray enabled":"Xray habilitado","Sessions":"Sessões","Processor":"Processador","Memory":"Memória","Network now":"Rede agora","Interfaces":"Interfaces","Today":"Hoje","This month":"Este mês","Recent period":"Período recente","Update":"Atualizar","Clear history":"Limpar histórico",
  "Infrastructure workspace copy":"Gerencie nós, acompanhe a saúde do sistema e consulte tráfego em um único espaço.","Confirmation":"Confirmação","Confirm action":"Confirmar ação","Confirm":"Confirmar","Completed":"Concluído","Action failed":"Ação não concluída","Attention":"Atenção","Information":"Informação","Close":"Fechar",
  "Loading SSH status…":"Carregando status SSH…","Loading":"Carregando","Could not load SSH status":"Não foi possível carregar o status SSH","Error":"Erro","Online":"Online","SSH data updated at {time}":"Dados SSH atualizados às {time}","Delete SSH account":"Excluir conta SSH","The active SSH sessions for this account will be disconnected.":"As sessões SSH ativas desta conta serão desconectadas.","Delete account":"Excluir conta",
  "Loading Xray status…":"Carregando status do Xray…","Could not load Xray status":"Não foi possível carregar o status do Xray","Remove Xray client":"Remover cliente Xray","The client will lose access immediately after the configuration reload.":"O cliente perderá o acesso imediatamente após recarregar a configuração.","Remove client":"Remover cliente","Client removed successfully.":"Cliente removido com sucesso.","Xray client":"Cliente Xray",
  "Loading infrastructure…":"Carregando infraestrutura…","Infrastructure loaded with fallback data":"Infraestrutura carregada com dados locais de segurança","{count} active nodes · updated {time}":"{count} nós ativos · atualizado às {time}","Delete managed server":"Excluir servidor gerenciado","Delete server \"{name}\"?":"Excluir o servidor \"{name}\"?","The remote node is not erased, but it will be removed from this panel and can no longer receive managed actions.":"O nó remoto não será apagado, mas será removido deste painel e deixará de receber ações gerenciadas.","Delete server":"Excluir servidor",
  "Updating live status…":"Atualizando status ao vivo…","Live · updated {time}":"Ao vivo · atualizado às {time}","Error loading server status":"Erro ao carregar status do servidor","Clean live interface totals":"Limpar totais ao vivo das interfaces","Clean the live Interface totals now?":"Limpar agora os totais ao vivo das interfaces?","VnStat daily and monthly history will be preserved.":"O histórico diário e mensal do VnStat será preservado.","Clean totals":"Limpar totais","Live interface totals were cleaned.":"Os totais ao vivo das interfaces foram limpos.","Traffic counters":"Contadores de tráfego","Clean VnStat history":"Limpar histórico VnStat","Clean all daily and monthly traffic history?":"Limpar todo o histórico diário e mensal de tráfego?","Live interface totals are separate and will not be reset.":"Os totais ao vivo das interfaces são separados e não serão zerados.","Clean history":"Limpar histórico","VnStat history was cleaned.":"O histórico VnStat foi limpo.","Traffic history":"Histórico de tráfego","Clean panel log":"Limpar log do painel","Clean the current panel log now?":"Limpar agora o log atual do painel?","This only clears the panel log file. Automatic size-based cleanup remains enabled.":"Isso limpa somente o arquivo de log do painel. A limpeza automática por tamanho continuará ativa.","Clean log":"Limpar log",
  "Delete reseller":"Excluir revendedor","Delete reseller \"{name}\"?":"Excluir o revendedor \"{name}\"?","Their owned access will be removed and active SSH sessions will be disconnected.":"Os acessos pertencentes a ele serão removidos e as sessões SSH ativas serão desconectadas.","Remove inbound":"Remover inbound","Remove inbound {name}?":"Remover o inbound {name}?","Clients attached only to this inbound will stop connecting after the configuration is saved.":"Clientes vinculados somente a este inbound deixarão de conectar após salvar a configuração.",
  "This endpoint already has an SSH /ssh route.":"Este endpoint já possui uma rota SSH /ssh.","Add SSH /ssh without rebuilding this inbound.":"Adicione SSH /ssh sem recriar este inbound.","SSH migration attention":"Atenção na migração SSH","Could not enable SSH /ssh":"Não foi possível ativar SSH /ssh","Select a VLESS/VMess inbound using XHTTP.":"Selecione um inbound VLESS/VMess usando XHTTP.","Load the selected server configuration before enabling SSH.":"Carregue a configuração do servidor selecionado antes de ativar SSH.","Shared SSH requires native Xray mode. Select Internal native emulator and save the mode first.":"O SSH compartilhado exige o modo Xray nativo. Selecione Internal native emulator e salve o modo primeiro.","Inbound {name} uses {security}, which native SSH XHTTP does not support. Use TLS or no TLS.":"O inbound {name} usa {security}, que o SSH XHTTP nativo não suporta. Use TLS ou sem TLS.","SSH is already enabled on /ssh by inbound {name}.":"SSH já está ativado em /ssh pelo inbound {name}.","Path /ssh is already used by inbound {name}. Edit that path first.":"O caminho /ssh já é usado pelo inbound {name}. Edite esse caminho primeiro.","This inbound uses TLS but has no reusable certificate and key file paths.":"Este inbound usa TLS, mas não possui caminhos reutilizáveis para certificado e chave.","Safe XHTTP migration":"Migração XHTTP segura","Enable SSH on /ssh":"Ativar SSH em /ssh","Add SSH to the same endpoint without rebuilding {name}?":"Adicionar SSH ao mesmo endpoint sem recriar {name}?","Listener":"Listener","Existing path preserved":"Path existente preservado","New SSH path":"Novo path SSH","Clients preserved":"Clientes preservados","Enabling SSH…":"Ativando SSH…","Could not enable SSH: {error}":"Não foi possível ativar SSH: {error}","Migration was cancelled because it would alter the old inbound.":"A migração foi cancelada porque alteraria o inbound antigo.","SSH /ssh added to the draft without changing {name}.":"SSH /ssh foi adicionado ao rascunho sem alterar {name}.","Enabling SSH /ssh without changing {name}…":"Ativando SSH /ssh sem alterar {name}…","The SSH route could not be saved. The old inbound was not changed.":"A rota SSH não pôde ser salva. O inbound antigo não foi alterado.","SSH /ssh was saved, but Xray could not restart. Use the Restart button after checking the Xray log.":"SSH /ssh foi salvo, mas o Xray não conseguiu reiniciar. Verifique o log e use o botão Reiniciar.","SSH /ssh is active. The old inbound and all clients were preserved.":"SSH /ssh está ativo. O inbound antigo e todos os clientes foram preservados.","Configuration for this server was not loaded.":"A configuração deste servidor não foi carregada.","Invalid visual config: {error}":"Configuração visual inválida: {error}","Xray could not restart.":"O Xray não conseguiu reiniciar.","Could not save configuration: {error}":"Não foi possível salvar a configuração: {error}","selected":"selecionado","this inbound":"este inbound","the old inbound":"o inbound antigo","untagged":"sem tag"
});
const I18N_REVERSE = Object.fromEntries(SUPPORTED_LANGS.map(lang => [lang, Object.fromEntries(Object.entries(I18N_TEXT[lang] || {}).map(([k, v]) => [v, k]))]));
let currentLang = detectInitialLanguage();
let i18nTranslating = false;
let i18nQueued = false;

function detectInitialLanguage() {
  const saved = localStorage.getItem(LANG_STORAGE_KEY);
  if (SUPPORTED_LANGS.includes(saved)) return saved;
  const langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""]).join(" ").toLowerCase();
  return langs.includes("pt") ? "pt-BR" : "en-US";
}
function normalizeI18nText(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function i18nCanonicalKey(value) {
  const text = normalizeI18nText(value);
  if (!text) return "";
  if (Object.prototype.hasOwnProperty.call(I18N_TEXT["en-US"], text)) return text;
  if (I18N_ALIASES[text]) return I18N_ALIASES[text];
  for (const lang of SUPPORTED_LANGS) {
    if (I18N_REVERSE[lang][text]) return I18N_REVERSE[lang][text];
  }
  return "";
}
function t(key, vars = {}) {
  const dict = I18N_TEXT[currentLang] || I18N_TEXT["en-US"];
  let out = dict[key] || I18N_TEXT["en-US"][key] || key;
  return out.replace(/\{(\w+)\}/g, (_, name) => Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : "");
}
function shouldSkipI18n(el) {
  return !el || !el.closest || !!el.closest("script,style,textarea,pre,code,[data-no-i18n]");
}
function translateTextNode(node) {
  const raw = node.nodeValue || "";
  const key = i18nCanonicalKey(raw);
  if (!key) return;
  const translated = t(key);
  const lead = raw.match(/^\s*/)?.[0] || "";
  const tail = raw.match(/\s*$/)?.[0] || "";
  const next = lead + translated + tail;
  if (node.nodeValue !== next) node.nodeValue = next;
}
function translateStatic(root = document.body) {
  if (!root) return;
  i18nTranslating = true;
  try {
    if (root.nodeType === Node.TEXT_NODE) translateTextNode(root);
    const base = root.nodeType === Node.ELEMENT_NODE ? root : document.body;
    if (!base) return;
    const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return shouldSkipI18n(node.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(translateTextNode);
    base.querySelectorAll?.("[placeholder],[title],[aria-label]").forEach(el => {
      if (shouldSkipI18n(el)) return;
      ["placeholder", "title", "aria-label"].forEach(attr => {
        const value = el.getAttribute(attr);
        const key = i18nCanonicalKey(value);
        if (key) el.setAttribute(attr, t(key));
      });
    });
  } finally {
    i18nTranslating = false;
  }
}
function queueI18nRefresh() {
  if (i18nTranslating || i18nQueued) return;
  i18nQueued = true;
  requestAnimationFrame(() => {
    i18nQueued = false;
    translateStatic(document.body);
  });
}
function startI18nObserver() {
  if (!document.body || window.__dragonI18nObserver) return;
  window.__dragonI18nObserver = new MutationObserver(() => queueI18nRefresh());
  window.__dragonI18nObserver.observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["placeholder", "title", "aria-label"] });
}
function applyLanguage(lang, options = {}) {
  currentLang = SUPPORTED_LANGS.includes(lang) ? lang : "en-US";
  if (options.persist !== false) localStorage.setItem(LANG_STORAGE_KEY, currentLang);
  document.documentElement.lang = currentLang.toLowerCase();
  if (languageSelect) languageSelect.value = currentLang;
  updatePageHeading();
  translateStatic(document.body);
  document.documentElement.classList.remove("i18n-pending");
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const loginOverlay  = document.getElementById("loginOverlay");
const loginUser     = document.getElementById("loginUser");
const loginPass     = document.getElementById("loginPass");
const loginBtn      = document.getElementById("loginBtn");
const loginErr      = document.getElementById("loginErr");
const mainApp       = document.getElementById("mainApp");
const meUsername    = document.getElementById("meUsername");
const roleChip      = document.getElementById("roleChip");
const logoutBtn     = document.getElementById("logoutBtn");
const menuToggle    = document.getElementById("menuToggle");
const drawerBackdrop = document.getElementById("drawerBackdrop");
const languageSelect = document.getElementById("languageSelect");
const pageTitle     = document.getElementById("pageTitle");
const pageEyebrow   = document.getElementById("pageEyebrow");
const dashTotalUsers = document.getElementById("dashTotalUsers");
const dashActiveUsers = document.getElementById("dashActiveUsers");
const dashExpiredUsers = document.getElementById("dashExpiredUsers");
const dashAccountBreakdown = document.getElementById("dashAccountBreakdown");
const dashConnections = document.getElementById("dashConnections");
const dashConnectionsText = document.getElementById("dashConnectionsText");
const dashServers = document.getElementById("dashServers");
const dashServerStatus = document.getElementById("dashServerStatus");
const dashXrayClients = document.getElementById("dashXrayClients");
const dashXrayStatus = document.getElementById("dashXrayStatus");
const dashCpuVal = document.getElementById("dashCpuVal");
const dashCpuText = document.getElementById("dashCpuText");
const dashCpuBar = document.getElementById("dashCpuBar");
const dashRamVal = document.getElementById("dashRamVal");
const dashRamText = document.getElementById("dashRamText");
const dashRamBar = document.getElementById("dashRamBar");
const dashNetVal = document.getElementById("dashNetVal");
const dashNetText = document.getElementById("dashNetText");
const dashNetTotal = document.getElementById("dashNetTotal");
const dashQuotaChip = document.getElementById("dashQuotaChip");
const dashQuotaBar = document.getElementById("dashQuotaBar");
const dashQuotaText = document.getElementById("dashQuotaText");
const dashQuotaBreakdown = document.getElementById("dashQuotaBreakdown");
const dashQuotaRemaining = document.getElementById("dashQuotaRemaining");
const dashQuotaSummaryText = document.getElementById("dashQuotaSummaryText");
const dashQuotaMiniBar = document.getElementById("dashQuotaMiniBar");
const xrayResellerQuotaUsed = document.getElementById("xrayResellerQuotaUsed");
const xrayResellerQuotaRemaining = document.getElementById("xrayResellerQuotaRemaining");
const xrayResellerQuotaMix = document.getElementById("xrayResellerQuotaMix");
const dashboardQuotaCard = document.getElementById("dashboardQuotaCard");

// Users
const usersBody      = document.getElementById("usersBody");
const userCountChip  = document.getElementById("userCountChip");
const userStatus     = document.getElementById("userStatus");
const lastReload     = document.getElementById("lastReload");
const ownerColHead   = document.getElementById("ownerColHead");
const resellerInfoCard = document.getElementById("resellerInfoCard");
const rUsedMax       = document.getElementById("rUsedMax");
const rExpiry        = document.getElementById("rExpiry");
const rStatus        = document.getElementById("rStatus");

// User form
const userForm       = document.getElementById("userForm");
const userFormWrap   = document.getElementById("userFormWrap");
const toggleFormBtn  = document.getElementById("toggleFormBtn");
const cancelUserBtn  = document.getElementById("cancelUserBtn");
const newUserBtn     = document.getElementById("newUserBtn");
const saveUserBtn    = document.getElementById("saveUserBtn");
const fUsername      = document.getElementById("fUsername");
const fPassword      = document.getElementById("fPassword");
const fTotpSecret    = document.getElementById("fTotpSecret");
const fTotpPeriod    = document.getElementById("fTotpPeriod");
const fTotpWindow    = document.getElementById("fTotpWindow");
const fTotpDigits    = document.getElementById("fTotpDigits");
const fAllowStatic   = document.getElementById("fAllowStatic");
const fMaxConn       = document.getElementById("fMaxConn");
const fExpires       = document.getElementById("fExpires");
const fUp            = document.getElementById("fUp");
const fDown          = document.getElementById("fDown");
const sshLiveStatus  = document.getElementById("sshLiveStatus");
const sshMetricState = document.getElementById("sshMetricState");
const sshMetricTotal = document.getElementById("sshMetricTotal");
const sshMetricActive = document.getElementById("sshMetricActive");
const sshMetricOnline = document.getElementById("sshMetricOnline");

// Xray
const xrayChip       = document.getElementById("xrayChip");
const xRunning       = document.getElementById("xRunning");
const xPID           = document.getElementById("xPID");
const xUptime        = document.getElementById("xUptime");
const xStatus        = document.getElementById("xStatus");
const xOnlineUsers   = document.getElementById("xOnlineUsers");
const xCoreMode      = document.getElementById("xCoreMode");
const xSaveModeBtn   = document.getElementById("xSaveModeBtn");
const xCfgEditor     = document.getElementById("xCfgEditor");
const xCfgStatus     = document.getElementById("xCfgStatus");
const xLogsBox       = document.getElementById("xLogsBox");
const inboundsContainer = document.getElementById("inboundsContainer");
const sshServerPickerCard = document.getElementById("sshServerPickerCard");
const xrayServerPickerCard = document.getElementById("xrayServerPickerCard");
const sshServerSelect = document.getElementById("sshServerSelect");
const xrayServerSelect = document.getElementById("xrayServerSelect");
const sshServerHint = document.getElementById("sshServerHint");
const xrayServerHint = document.getElementById("xrayServerHint");

// Resellers
const resellersBody     = document.getElementById("resellersBody");
const resellerCountChip = document.getElementById("resellerCountChip");
const resellerStatus    = document.getElementById("resellerStatus");
const resellerFormTitle = document.getElementById("resellerFormTitle");
const resellerForm      = document.getElementById("resellerForm");
const rUsername         = document.getElementById("rUsername");
const rPassword         = document.getElementById("rPassword");
const rMaxUsers         = document.getElementById("rMaxUsers");
const rExpires          = document.getElementById("rExpires");
const rActive           = document.getElementById("rActive");

// Managed servers
const serversBody = document.getElementById("serversBody");
const serversCountChip = document.getElementById("serversCountChip");
const serversStatus = document.getElementById("serversStatus");
const serverForm = document.getElementById("serverForm");
const serverFormTitle = document.getElementById("serverFormTitle");
const srvID = document.getElementById("srvID");
const srvName = document.getElementById("srvName");
const srvBaseURL = document.getElementById("srvBaseURL");
const srvAdminUser = document.getElementById("srvAdminUser");
const srvAdminKey = document.getElementById("srvAdminKey");
const srvEnableSSH = document.getElementById("srvEnableSSH");
const srvEnableXray = document.getElementById("srvEnableXray");
const srvIsActive = document.getElementById("srvIsActive");
const serverFormStatus = document.getElementById("serverFormStatus");
const serversListView = document.getElementById("serversListView");
const serverConfigSubpage = document.getElementById("serverConfigSubpage");
const cfgServerName = document.getElementById("cfgServerName");
const managedConfigEditor = document.getElementById("managedConfigEditor");
const managedConfigStatus = document.getElementById("managedConfigStatus");
const serversStatusGrid = document.getElementById("serversStatusGrid");
const serversStatusPageStatus = document.getElementById("serversStatusPageStatus");
const serversStatusCountChip = document.getElementById("serversStatusCountChip");
const fleetLiveStatus = document.getElementById("fleetLiveStatus");
const fleetMetricNodes = document.getElementById("fleetMetricNodes");
const fleetMetricActive = document.getElementById("fleetMetricActive");
const fleetMetricSSH = document.getElementById("fleetMetricSSH");
const fleetMetricXray = document.getElementById("fleetMetricXray");
const fleetStatusOnline = document.getElementById("fleetStatusOnline");
const fleetStatusOffline = document.getElementById("fleetStatusOffline");
const fleetStatusSessions = document.getElementById("fleetStatusSessions");

// Stats
const cpuVal     = document.getElementById("cpuVal");
const cpuBar     = document.getElementById("cpuBar");
const memVal     = document.getElementById("memVal");
const memBar     = document.getElementById("memBar");
const memDetail  = document.getElementById("memDetail");
const ifaceBody  = document.getElementById("ifaceBody");
const ifaceSummary = document.getElementById("ifaceSummary");
const statsUpdated = document.getElementById("statsUpdated");
const statsNetVal = document.getElementById("statsNetVal");
const statsIfaceVal = document.getElementById("statsIfaceVal");
const resetIfaceStatsBtn = document.getElementById("resetIfaceStatsBtn");
const dnsttDashboardCard = document.getElementById("dnsttDashboardCard");
const dnsttHealthUpdated = document.getElementById("dnsttHealthUpdated");
const dnsttActiveSessions = document.getElementById("dnsttActiveSessions");
const dnsttActiveStreams = document.getElementById("dnsttActiveStreams");
const dnsttDNSRx = document.getElementById("dnsttDNSRx");
const dnsttQueueLen = document.getElementById("dnsttQueueLen");
const dnsttHealthBody = document.getElementById("dnsttHealthBody");
const dnsttHealthSummary = document.getElementById("dnsttHealthSummary");

// VnStat
const vnstatDailyBody = document.getElementById("vnstatDailyBody");
const vnstatMonthlyBody = document.getElementById("vnstatMonthlyBody");
const vnstatStatus = document.getElementById("vnstatStatus");
const vnTodayTotal = document.getElementById("vnTodayTotal");
const vnMonthTotal = document.getElementById("vnMonthTotal");
const vnIfaceCount = document.getElementById("vnIfaceCount");
const vnLatestPeriod = document.getElementById("vnLatestPeriod");
const reloadVnstatBtn = document.getElementById("reloadVnstatBtn");
const resetVnstatBtn = document.getElementById("resetVnstatBtn");

// Shared panel-native dialog and toast surfaces. Destructive and migration
// actions use these instead of browser confirm/alert prompts.
const panelConfirmDialog = document.getElementById("panelConfirmDialog");
const panelDialogCard = panelConfirmDialog?.querySelector(".panel-dialog-card");
const panelDialogIcon = document.getElementById("panelDialogIcon");
const panelDialogEyebrow = document.getElementById("panelDialogEyebrow");
const panelDialogTitle = document.getElementById("panelDialogTitle");
const panelDialogMessage = document.getElementById("panelDialogMessage");
const panelDialogDetail = document.getElementById("panelDialogDetail");
const panelDialogCancelBtn = document.getElementById("panelDialogCancelBtn");
const panelDialogConfirmBtn = document.getElementById("panelDialogConfirmBtn");
const panelToastStack = document.getElementById("panelToastStack");
let panelDialogResolver = null;
let panelDialogLastFocus = null;

function closePanelConfirm(accepted = false) {
  if (!panelConfirmDialog || panelConfirmDialog.classList.contains("hidden")) return;
  panelConfirmDialog.classList.add("hidden");
  panelConfirmDialog.setAttribute("aria-hidden", "true");
  document.body.classList.remove("panel-dialog-open");
  const resolver = panelDialogResolver;
  panelDialogResolver = null;
  resolver?.(!!accepted);
  panelDialogLastFocus?.focus?.();
  panelDialogLastFocus = null;
}

function panelConfirm(options = {}) {
  const opts = typeof options === "string" ? { message: options } : options;
  if (!panelConfirmDialog || !panelDialogConfirmBtn) return Promise.resolve(false);
  if (panelDialogResolver) closePanelConfirm(false);
  panelDialogLastFocus = document.activeElement;
  const tone = opts.tone || (opts.danger ? "danger" : "default");
  panelDialogCard?.classList.toggle("is-danger", tone === "danger");
  panelDialogCard?.classList.toggle("is-success", tone === "success");
  if (panelDialogIcon) panelDialogIcon.textContent = opts.icon || (tone === "danger" ? "!" : tone === "success" ? "✓" : "?");
  if (panelDialogEyebrow) panelDialogEyebrow.textContent = opts.eyebrow || t("Confirmation");
  if (panelDialogTitle) panelDialogTitle.textContent = opts.title || t("Confirm action");
  if (panelDialogMessage) panelDialogMessage.textContent = opts.message || "";
  if (panelDialogDetail) {
    panelDialogDetail.textContent = opts.detail || "";
    panelDialogDetail.classList.toggle("hidden", !opts.detail);
  }
  if (panelDialogCancelBtn) panelDialogCancelBtn.textContent = opts.cancelLabel || t("Cancel");
  panelDialogConfirmBtn.textContent = opts.confirmLabel || t("Confirm");
  panelDialogConfirmBtn.className = tone === "danger" ? "btn btn-danger" : "btn";
  panelConfirmDialog.classList.remove("hidden");
  panelConfirmDialog.setAttribute("aria-hidden", "false");
  document.body.classList.add("panel-dialog-open");
  setTimeout(() => panelDialogConfirmBtn.focus(), 0);
  return new Promise(resolve => { panelDialogResolver = resolve; });
}

function showPanelToast(message, tone = "info", title = "", duration = 4800) {
  if (!panelToastStack || !message) return null;
  const toast = document.createElement("article");
  toast.className = `panel-toast ${tone}`;
  const icon = document.createElement("span");
  icon.className = "panel-toast-icon";
  icon.textContent = tone === "success" ? "✓" : tone === "error" ? "!" : tone === "warning" ? "i" : "•";
  const copy = document.createElement("div");
  copy.className = "panel-toast-copy";
  const heading = document.createElement("strong");
  heading.textContent = title || (tone === "success" ? t("Completed") : tone === "error" ? t("Action failed") : tone === "warning" ? t("Attention") : t("Information"));
  const body = document.createElement("p");
  body.textContent = message;
  copy.append(heading, body);
  const close = document.createElement("button");
  close.className = "panel-toast-close";
  close.type = "button";
  close.setAttribute("aria-label", t("Close"));
  close.textContent = "×";
  const remove = () => toast.remove();
  close.addEventListener("click", remove);
  toast.append(icon, copy, close);
  panelToastStack.appendChild(toast);
  if (duration > 0) setTimeout(remove, duration);
  return toast;
}

panelDialogCancelBtn?.addEventListener("click", () => closePanelConfirm(false));
panelDialogConfirmBtn?.addEventListener("click", () => closePanelConfirm(true));
panelConfirmDialog?.querySelector("[data-panel-dialog-close]")?.addEventListener("click", () => closePanelConfirm(false));
document.addEventListener("keydown", event => {
  if (!panelConfirmDialog || panelConfirmDialog.classList.contains("hidden")) return;
  if (event.key === "Escape") closePanelConfirm(false);
  if (event.key === "Enter" && document.activeElement !== panelDialogCancelBtn) closePanelConfirm(true);
});

// ─── API helper ───────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const o = Object.assign({ headers: {} }, opts);
  o.headers = Object.assign({}, o.headers, {
    "Content-Type": "application/json",
    "X-Session-Token": sessionToken,
  });
  const res = await fetch(path, o);
  if (res.status === 401 || res.status === 403) throw new Error("auth");
  return res;
}
function withServerParam(path, serverID) {
  serverID = serverID || "local";
  if (!serverID || serverID === "local") return path;
  return path + (path.includes("?") ? "&" : "?") + "server_id=" + encodeURIComponent(serverID);
}
function selectedSSHServer() { return sshServerSelect?.value || selectedSSHServerID || "local"; }
function selectedXrayServer() { return xrayServerSelect?.value || selectedXrayServerID || "local"; }
function serverByID(id) { return serversCache.find(s => String(s.id) === String(id)); }
function selectedXrayServerLabel() {
  const id = selectedXrayServer();
  const srv = serverByID(id);
  if (srv) return srv.name || srv.base_url || id;
  return id === "local" ? "Master node" : id;
}
function xrayModeFromConfig(x) {
  const mode = String(x?.mode || "").toLowerCase();
  return mode === "external" ? "external" : "native";
}

function applyXrayModeToConfig(cfg, mode) {
  mode = mode === "external" ? "external" : "native";
  cfg.xray = cfg.xray && typeof cfg.xray === "object" ? cfg.xray : {};
  cfg.xray.mode = mode;
  cfg.xray.native = mode === "native";
  cfg.xray.bin_path = cfg.xray.bin_path || "/opt/sshpanel/xray";
  cfg.xray.config_file = cfg.xray.config_file || "/opt/sshpanel/xray_config.json";
  cfg.xray.native_config_file = cfg.xray.native_config_file || "/opt/sshpanel/xray_native_config.json";
  cfg.xray.api_server = cfg.xray.api_server || "127.0.0.1:10085";
  cfg.xray.online_window_seconds = cfg.xray.online_window_seconds || 90;
  cfg.xray.stats_poll_seconds = cfg.xray.stats_poll_seconds || 15;
  return cfg;
}

function reloadXrayConfigForSelectedServer() {
  const wizPane = document.getElementById("xrayWizardPane");
  const jsonPane = document.getElementById("xrayCfgPaneJson");
  if (jsonPane && !jsonPane.classList.contains("hidden")) return loadXrayCfg();
  if (wizPane && !wizPane.classList.contains("hidden")) return loadWizardFromConfig();
}

// ─── Formatters ──────────────────────────────────────────────────────────────
const fmtPct   = n => (n == null || isNaN(n)) ? "--%"  : n.toFixed(1)+"%";
const fmtMbps  = n => (n == null || isNaN(n)) ? "--"   : n.toFixed(2);
function fmtBytes(n) {
  if (!Number.isFinite(n)) return "--";
  if (n<1024) return n+" B";
  const k=n/1024; if(k<1024) return k.toFixed(1)+" KiB";
  const m=k/1024; if(m<1024) return m.toFixed(1)+" MiB";
  return (m/1024).toFixed(1)+" GiB";
}
function fmtInt(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString() : "--";
}
function fmtDnsttTimestamp(ts) {
  if (!ts) return "Waiting for DNSTT stats…";
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime()) || d.getFullYear() < 2020) return "Waiting for DNSTT stats…";
  return "Updated: " + d.toLocaleTimeString();
}
function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString()+" "+d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
}
function isoFromLocal(v) {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}
function localFromISO(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function genBase32(len=20) {
  const alpha="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes=new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let bits=0,val=0,out="";
  for(const b of bytes){val=(val<<8)|b;bits+=8;while(bits>=5){out+=alpha[(val>>>(bits-5))&31];bits-=5;}}
  if(bits>0) out+=alpha[(val<<(5-bits))&31];
  return out;
}
function genUUID() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
}


function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>'"]/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[ch]));
}

function isVisible(el) {
  return !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
}

function isXrayClientEditorActive() {
  const active = document.activeElement;
  if (active && active.closest && (active.closest("#inboundsContainer") || active.closest("#editXrayClientPanel"))) return true;
  if (isVisible(document.getElementById("editXrayClientPanel"))) return true;
  return Array.from(document.querySelectorAll('#inboundsContainer [id^="add-form-"]')).some(isVisible);
}

function inboundStructure(inbounds = []) {
  return JSON.stringify((inbounds || []).map(ib => ({
    tag: ib.tag || "",
    protocol: ib.protocol || "",
    port: ib.port ?? "",
    clients: (ib.clients || []).map(c => c.id || ""),
  })));
}

function clientStatusHTML(c) {
  const exp = c.expires_at ? new Date(c.expires_at) : null;
  const daysLeft = c.expiration_days;
  if (c.expired) return `<span style="color:var(--danger);font-size:.68rem;">${t("Expired")}</span>`;
  if (daysLeft === -1 || !exp) return `<span style="color:var(--success);font-size:.68rem;">${t("Active")}</span>`;
  return `<span style="color:var(--success);font-size:.68rem;">${t("Active ({days}d)", {days: escapeHTML(daysLeft)})}</span>`;
}

function clientExpiryLabel(c) {
  const exp = c.expires_at ? new Date(c.expires_at) : null;
  return exp ? exp.toLocaleDateString() : t("Unlimited");
}

function clientOnlineHTML(c) {
  return `${c.online ? `<span class="badge-on">${t("online")}</span>` : `<span class="badge-off">${t("offline")}</span>`}<div class="hint">${escapeHTML(formatLastActive(c.last_active))}</div>`;
}

function clientTrafficHTML(c) {
  const up = Number(c.uplink_bytes || 0);
  const down = Number(c.downlink_bytes || 0);
  const total = Number(c.total_bytes || (up + down) || 0);
  return `${escapeHTML(formatBytes(total))}<div class="hint">↑ ${escapeHTML(formatBytes(up))} · ↓ ${escapeHTML(formatBytes(down))}</div>`;
}

function updateCell(row, name, html) {
  const cell = row?.querySelector?.(`[data-cell="${name}"]`);
  if (cell && cell.innerHTML !== html) cell.innerHTML = html;
}

function patchRenderedInbounds(inbounds) {
  const sections = Array.from(inboundsContainer.querySelectorAll("[data-inbound-tag]"));
  if (sections.length !== inbounds.length) return false;

  for (const ib of inbounds) {
    const tag = String(ib.tag || "");
    const section = sections.find(el => el.dataset.inboundTag === tag);
    if (!section) return false;
    if (section.dataset.inboundProtocol !== String(ib.protocol || "") || section.dataset.inboundPort !== String(ib.port ?? "")) return false;

    const clients = ib.clients || [];
    const rows = Array.from(section.querySelectorAll("tr[data-client-id]"));
    if (rows.length !== clients.length) return false;

    const onlineCount = clients.filter(c => !!c.online).length;
    const chip = section.querySelector('[data-role="inbound-online-chip"]');
    if (chip) {
      chip.textContent = t("{count} online", {count: onlineCount});
      chip.classList.toggle("green", onlineCount > 0);
    }

    for (const c of clients) {
      const row = rows.find(el => el.dataset.clientId === String(c.id || ""));
      if (!row) return false;
      updateCell(row, "name", escapeHTML(c.name || "—"));
      updateCell(row, "uuid", escapeHTML(c.id || "—"));
      updateCell(row, "email", escapeHTML(c.email || "—"));
      updateCell(row, "expiry", escapeHTML(clientExpiryLabel(c)));
      updateCell(row, "status", clientStatusHTML(c));
      updateCell(row, "online", clientOnlineHTML(c));
      updateCell(row, "traffic", clientTrafficHTML(c));
      updateCell(row, "max", escapeHTML(c.max_conns || "∞"));
    }
  }
  return true;
}
