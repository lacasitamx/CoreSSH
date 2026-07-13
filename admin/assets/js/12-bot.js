// Bot / Vendas — safe DOM rendering and sectioned management workspace.

const botState = {
  config: null,
  plans: [],
  packages: [],
  users: [],
  transactions: [],
  section: sessionStorage.getItem("BOT_SECTION") || "config",
};

function botStatus(id, message, ok) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = message;
  if (id === "botConfigStatus") {
    element.classList.toggle("is-ok", ok === true);
    element.classList.toggle("is-error", ok === false);
  } else {
    element.style.color = ok === false ? "var(--danger)" : "";
  }
}

function botBRL(cents) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents || 0) / 100);
}

function botNode(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text != null) element.textContent = String(options.text);
  if (options.title) element.title = options.title;
  if (options.type) element.type = options.type;
  for (const child of children) if (child) element.appendChild(child);
  return element;
}

function botCell(content, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  if (content instanceof Node) cell.appendChild(content);
  else cell.textContent = String(content == null || content === "" ? "—" : content);
  return cell;
}

function botPrimaryCell(title, detail) {
  const wrapper = botNode("div", { className: "bot-primary-cell" });
  wrapper.appendChild(botNode("strong", { text: title || "—" }));
  if (detail) wrapper.appendChild(botNode("small", { text: detail }));
  return wrapper;
}

function botBadge(label, tone) {
  return botNode("span", { className: "bot-status " + tone, text: label });
}

function botButton(label, handler, className = "btn btn-ghost btn-sm") {
  const button = botNode("button", { className, text: label, type: "button" });
  button.addEventListener("click", handler);
  return button;
}

function botActions(buttons) {
  return botNode("div", { className: "bot-row-actions" }, buttons);
}

function botEmptyRow(body, columns, message) {
  const row = botNode("tr", { className: "bot-empty-row" });
  const cell = botCell(message);
  cell.colSpan = columns;
  row.appendChild(cell);
  body.replaceChildren(row);
}

async function botRequest(path, options = {}) {
  const response = await api(path, options);
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || `HTTP ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function botHandleError(error, statusID, fallback) {
  if (error.message === "auth") {
    doAuthError();
    return;
  }
  botStatus(statusID, error.message || fallback, false);
}

function botSetSection(section) {
	const allowedSections = new Set(["config", "plans", "packages", "messages", "users", "transactions"]);
	if (!allowedSections.has(section)) section = "config";
  botState.section = section;
  sessionStorage.setItem("BOT_SECTION", section);
  document.querySelectorAll("[data-bot-panel]").forEach(panel => panel.classList.toggle("active", panel.dataset.botPanel === section));
  document.querySelectorAll("[data-bot-section]").forEach(button => button.classList.toggle("active", button.dataset.botSection === section));
  const select = document.getElementById("botSection");
  if (select) select.value = section;
}

function botUpdateMetrics() {
  const config = botState.config;
  const stateMetric = document.getElementById("botMetricState");
  if (stateMetric) stateMetric.textContent = config ? (config.enabled ? "Ativo" : "Pausado") : "Indisponível";
  const plansMetric = document.getElementById("botMetricPlans");
  if (plansMetric) plansMetric.textContent = String(botState.plans.filter(plan => plan.IsActive).length);
  const usersMetric = document.getElementById("botMetricUsers");
  if (usersMetric) usersMetric.textContent = String(botState.users.length);
  const pendingMetric = document.getElementById("botMetricPending");
  if (pendingMetric) pendingMetric.textContent = String(botState.transactions.filter(transaction => transaction.Status === "pending").length);
}

async function loadBotTab() {
  botSetSection(botState.section);
  botStatus("botConfigStatus", "Atualizando dados…");
  await Promise.allSettled([
    loadBotConfig(), loadBotInbounds(), loadBotPlans(), loadBotPkgs(),
    loadBotUsers(), loadBotTxns(), loadBotSettings(),
  ]);
  botUpdateMetrics();
}

// Configuration
async function loadBotConfig() {
  try {
    const config = await botRequest("/api/bot/config");
    botState.config = config;
    const setValue = (id, value) => { const field = document.getElementById(id); if (field) field.value = value ?? ""; };
    const setChecked = (id, value) => { const field = document.getElementById(id); if (field) field.checked = !!value; };
    setChecked("botEnabled", config.enabled);
    setValue("botMPConfirmMode", config.mp_confirm_mode);
    setValue("botMPPollInterval", config.mp_poll_interval);
    setValue("botPixExp", config.pix_expiration_minutes);
    setChecked("botTrialEnabled", config.trial_enabled);
    setValue("botTrialHours", config.trial_hours);
    setValue("botTrialMaxConns", config.trial_max_connections);
    setValue("botTrialKind", config.trial_kind);
    setValue("botTrialInbound", config.trial_inbound_tag);
    setValue("botAdminIDs", (config.admin_telegram_ids || []).join(", "));
    setValue("botPublicHost", config.public_host);
    setValue("botXrayPublicHost", config.xray_public_host);
    botSetSecretState("botHasTgToken", config.has_telegram_token);
    botSetSecretState("botHasMpToken", config.has_mp_access_token);
    botSetSecretState("botHasMpSecret", config.has_mp_webhook_secret);
    botToggleMPWebhookBox();
    botStatus("botConfigStatus", config.enabled ? "Bot ativo" : "Bot pausado", true);
    botUpdateMetrics();
    return config;
	  } catch (error) {
    botState.config = null;
    botHandleError(error, "botConfigStatus", "Erro ao carregar configuração.");
    botUpdateMetrics();
	  }
}

function botSetSecretState(id, configured) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = configured ? "● protegido" : "○ não configurado";
  element.classList.toggle("is-set", !!configured);
  element.classList.toggle("is-missing", !configured);
}

function botToggleMPWebhookBox() {
  const mode = document.getElementById("botMPConfirmMode")?.value;
  document.getElementById("botMPWebhookBox")?.classList.toggle("hidden", mode !== "webhook");
  const url = document.getElementById("botMPWebhookURL");
  if (url) url.textContent = location.origin + "/api/mp/webhook";
}

async function saveBotConfig() {
  const value = id => (document.getElementById(id)?.value || "").trim();
  const number = id => Number.parseInt(document.getElementById(id)?.value || "0", 10) || 0;
  const checked = id => !!document.getElementById(id)?.checked;
  const adminIDs = value("botAdminIDs").split(",").map(item => Number.parseInt(item.trim(), 10)).filter(Number.isSafeInteger);
  const payload = {
    enabled: checked("botEnabled"), telegram_token: value("botTelegramToken"),
    mp_access_token: value("botMPToken"), mp_confirm_mode: value("botMPConfirmMode"),
    mp_webhook_secret: value("botMPWebhookSecret"), mp_poll_interval: value("botMPPollInterval"),
    pix_expiration_minutes: number("botPixExp"), trial_enabled: checked("botTrialEnabled"),
    trial_hours: number("botTrialHours"), trial_max_connections: number("botTrialMaxConns"),
    trial_kind: value("botTrialKind"), trial_inbound_tag: value("botTrialInbound"),
    admin_telegram_ids: adminIDs, public_host: value("botPublicHost"), xray_public_host: value("botXrayPublicHost"),
  };
  botStatus("botConfigStatus", "Salvando e reiniciando…");
  try {
    await botRequest("/api/bot/config", { method: "POST", body: JSON.stringify(payload) });
    ["botTelegramToken", "botMPToken", "botMPWebhookSecret"].forEach(id => { const field = document.getElementById(id); if (field) field.value = ""; });
    await loadBotConfig();
    botStatus("botConfigStatus", "Configuração salva", true);
  } catch (error) {
    botHandleError(error, "botConfigStatus", "Erro ao salvar configuração.");
  }
}

async function testBot() {
  botStatus("botConfigStatus", "Testando Telegram e Mercado Pago…");
  const payload = {
    telegram_token: (document.getElementById("botTelegramToken")?.value || "").trim(),
    mp_access_token: (document.getElementById("botMPToken")?.value || "").trim(),
  };
  try {
    const result = await botRequest("/api/bot/test", { method: "POST", body: JSON.stringify(payload) });
    const telegram = result.telegram_ok ? `Telegram ${result.telegram_bot || "OK"}` : `Telegram: ${result.telegram_error || "falha"}`;
    const mercadoPago = result.mp_ok ? "Mercado Pago OK" : `Mercado Pago: ${result.mp_error || "falha"}`;
    botStatus("botConfigStatus", `${telegram} · ${mercadoPago}`, !!result.telegram_ok && !!result.mp_ok);
  } catch (error) {
    botHandleError(error, "botConfigStatus", "Erro ao testar integrações.");
  }
}

async function botCopyWebhook() {
  const value = document.getElementById("botMPWebhookURL")?.textContent || "";
  try {
    await navigator.clipboard.writeText(value);
    const button = document.getElementById("botCopyWebhookBtn");
    if (button) {
      button.textContent = "Copiado";
      setTimeout(() => { button.textContent = "Copiar"; }, 1400);
    }
  } catch {
    botStatus("botConfigStatus", "Não foi possível copiar a URL.", false);
  }
}

async function loadBotInbounds() {
  try {
    const inbounds = await botRequest("/api/xray/inbounds");
    const datalist = document.getElementById("botInboundList");
    if (!datalist) return;
    datalist.replaceChildren(...(inbounds || []).map(inbound => {
      const option = document.createElement("option");
      option.value = String(inbound.tag || "");
      option.textContent = String(inbound.protocol || "");
      return option;
    }));
  } catch (error) {
    if (error.message === "auth") doAuthError();
  }
}

// Plans
async function loadBotPlans() {
  try {
    const plans = await botRequest("/api/bot/plans");
    botState.plans = plans || [];
    renderBotPlans(botState.plans);
    botStatus("botPlansStatus", `${botState.plans.length} plano(s) carregado(s).`, true);
    botUpdateMetrics();
    return plans;
	  } catch (error) {
		botHandleError(error, "botPlansStatus", "Erro ao carregar planos.");
	  }
}

function renderBotPlans(plans) {
  const body = document.getElementById("botPlansBody");
  if (!body) return;
  document.getElementById("botPlanCount").textContent = String(plans.length);
  if (!plans.length) return botEmptyRow(body, 6, "Nenhum plano cadastrado. Crie o primeiro ao lado.");
  const rows = plans.map(plan => {
    const row = document.createElement("tr");
    const delivery = plan.Kind === "xray" ? `Xray${plan.XrayProtocol ? " · " + plan.XrayProtocol.toUpperCase() : ""}` : "SSH";
    const price = botPrimaryCell(botBRL(plan.PriceCents), `${plan.CreditCost || 0} crédito(s)`);
    row.append(
      botCell(botPrimaryCell(plan.Name, `#${plan.ID}`)), botCell(delivery),
      botCell(`${plan.Days} dias`), botCell(price),
      botCell(botBadge(plan.IsActive ? "Ativo" : "Oculto", plan.IsActive ? "active" : "inactive")),
      botCell(botActions([
        botButton("Editar", () => botEditPlan(plan)),
        botButton("Excluir", () => botDeletePlan(plan.ID), "btn btn-danger btn-sm"),
      ])),
    );
    return row;
  });
  body.replaceChildren(...rows);
}

function botEditPlan(plan) {
  const set = (id, value) => { const field = document.getElementById(id); if (field) field.value = value ?? ""; };
  set("planId", plan.ID); set("planName", plan.Name); set("planKind", plan.Kind); set("planDays", plan.Days);
  set("planMaxConns", plan.MaxConnections); set("planUpMbps", plan.LimitMbpsUp); set("planDownMbps", plan.LimitMbpsDown);
  set("planInbound", plan.XrayInboundTag); set("planProtocol", plan.XrayProtocol); set("planPrice", (Number(plan.PriceCents) / 100).toFixed(2));
  set("planCreditCost", plan.CreditCost); set("planServerId", plan.ServerID); set("planSort", plan.SortOrder);
  document.getElementById("planActive").checked = !!plan.IsActive;
  document.getElementById("botPlanFormTitle").textContent = `Editar ${plan.Name}`;
  document.getElementById("planName")?.focus();
}

function botClearPlanForm() {
  document.getElementById("botPlanForm")?.reset();
  document.getElementById("planId").value = "";
  document.getElementById("planActive").checked = true;
  document.getElementById("botPlanFormTitle").textContent = "Novo plano";
}

async function botSavePlan(event) {
  event.preventDefault();
  const value = id => document.getElementById(id).value.trim();
  const number = id => Number.parseInt(document.getElementById(id).value || "0", 10) || 0;
  const payload = {
    ID: number("planId"), Name: value("planName"), Kind: value("planKind"), Days: number("planDays"),
    MaxConnections: number("planMaxConns"), LimitMbpsUp: number("planUpMbps"), LimitMbpsDown: number("planDownMbps"),
    XrayInboundTag: value("planInbound"), XrayProtocol: value("planProtocol"),
    PriceCents: Math.round((Number.parseFloat(value("planPrice")) || 0) * 100), CreditCost: number("planCreditCost"),
    ServerID: value("planServerId"), IsActive: document.getElementById("planActive").checked, SortOrder: number("planSort"),
  };
  botStatus("botPlansStatus", "Salvando plano…");
  try {
    await botRequest("/api/bot/plans", { method: "POST", body: JSON.stringify(payload) });
    botClearPlanForm();
    await loadBotPlans();
    botStatus("botPlansStatus", "Plano salvo.", true);
  } catch (error) {
    botHandleError(error, "botPlansStatus", "Erro ao salvar plano.");
  }
}

async function botDeletePlan(id) {
  const accepted = await panelConfirm({ tone:"danger", icon:"×", title:"Excluir plano", message:"Excluir este plano?", detail:"Esta ação não pode ser desfeita.", confirmLabel:"Excluir plano" });
  if (!accepted) return;
  try {
    await botRequest(`/api/bot/plans?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadBotPlans();
  } catch (error) {
    botHandleError(error, "botPlansStatus", "Erro ao excluir plano.");
  }
}

// Credit packages
async function loadBotPkgs() {
  try {
    const packages = await botRequest("/api/bot/credit-packages");
    botState.packages = packages || [];
    renderBotPackages(botState.packages);
    botStatus("botPkgStatus", `${botState.packages.length} pacote(s) carregado(s).`, true);
    return packages;
	  } catch (error) {
		botHandleError(error, "botPkgStatus", "Erro ao carregar pacotes.");
	  }
}

function renderBotPackages(packages) {
  const body = document.getElementById("botPkgsBody");
  if (!body) return;
  document.getElementById("botPkgCount").textContent = String(packages.length);
  if (!packages.length) return botEmptyRow(body, 5, "Nenhum pacote de créditos cadastrado.");
  body.replaceChildren(...packages.map(item => {
    const row = document.createElement("tr");
    row.append(
      botCell(botPrimaryCell(item.Name, `#${item.ID}`)), botCell(`${item.Credits} créditos`), botCell(botBRL(item.PriceCents)),
      botCell(botBadge(item.IsActive ? "Ativo" : "Oculto", item.IsActive ? "active" : "inactive")),
      botCell(botActions([
        botButton("Editar", () => botEditPkg(item)),
        botButton("Excluir", () => botDeletePkg(item.ID), "btn btn-danger btn-sm"),
      ])),
    );
    return row;
  }));
}

function botEditPkg(item) {
  const set = (id, value) => { document.getElementById(id).value = value ?? ""; };
  set("pkgId", item.ID); set("pkgName", item.Name); set("pkgCredits", item.Credits);
  set("pkgPrice", (Number(item.PriceCents) / 100).toFixed(2)); set("pkgSort", item.SortOrder);
  document.getElementById("pkgActive").checked = !!item.IsActive;
  document.getElementById("pkgName")?.focus();
}

function botClearPkgForm() {
  document.getElementById("botPkgForm")?.reset();
  document.getElementById("pkgId").value = "";
  document.getElementById("pkgActive").checked = true;
}

async function botSavePkg(event) {
  event.preventDefault();
  const value = id => document.getElementById(id).value.trim();
  const number = id => Number.parseInt(document.getElementById(id).value || "0", 10) || 0;
  const payload = {
    ID: number("pkgId"), Name: value("pkgName"), Credits: number("pkgCredits"),
    PriceCents: Math.round((Number.parseFloat(value("pkgPrice")) || 0) * 100),
    SortOrder: number("pkgSort"), IsActive: document.getElementById("pkgActive").checked,
  };
  botStatus("botPkgStatus", "Salvando pacote…");
  try {
    await botRequest("/api/bot/credit-packages", { method: "POST", body: JSON.stringify(payload) });
    botClearPkgForm();
    await loadBotPkgs();
    botStatus("botPkgStatus", "Pacote salvo.", true);
  } catch (error) {
    botHandleError(error, "botPkgStatus", "Erro ao salvar pacote.");
  }
}

async function botDeletePkg(id) {
  const accepted = await panelConfirm({ tone:"danger", icon:"×", title:"Excluir pacote", message:"Excluir este pacote de créditos?", confirmLabel:"Excluir pacote" });
  if (!accepted) return;
  try {
    await botRequest(`/api/bot/credit-packages?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadBotPkgs();
  } catch (error) {
    botHandleError(error, "botPkgStatus", "Erro ao excluir pacote.");
  }
}

// Users
async function loadBotUsers() {
  try {
    const users = await botRequest("/api/bot/users");
    botState.users = users || [];
    renderBotUsers(botState.users);
    botStatus("botUsersStatus", `${botState.users.length} cliente(s) carregado(s).`, true);
    botUpdateMetrics();
    return users;
	  } catch (error) {
		botHandleError(error, "botUsersStatus", "Erro ao carregar clientes.");
	  }
}

function renderBotUsers(users) {
  const body = document.getElementById("botUsersBody");
  if (!body) return;
  document.getElementById("botUserCount").textContent = String(users.length);
  if (!users.length) return botEmptyRow(body, 6, "Nenhum cliente conversou com o bot ainda.");
  body.replaceChildren(...users.map(user => {
    const row = document.createElement("tr");
    const displayName = user.FirstName || user.Username || "Sem nome";
    const username = user.Username ? `@${user.Username}` : "Sem username";
    const isBlocked = user.Role === "blocked";
    row.append(
      botCell(botPrimaryCell(displayName, username)), botCell(user.TelegramID),
      botCell(botBadge(user.Role || "customer", user.Role || "customer")),
      botCell(user.LinkedAdminUsername || "—"), botCell(`${user.CreditBalance || 0} créditos`),
      botCell(botActions([
        botButton("Função", () => botOpenUserAction(user, "role")),
        botButton("Saldo", () => botOpenUserAction(user, "credits")),
        botButton(isBlocked ? "Desbloquear" : "Bloquear", () => botToggleBlock(user), isBlocked ? "btn btn-ghost btn-sm" : "btn btn-danger btn-sm"),
      ])),
    );
    return row;
  }));
}

function botOpenUserAction(user, mode) {
  document.getElementById("botActionTelegramID").value = String(user.TelegramID);
  document.getElementById("botActionMode").value = mode;
  document.getElementById("botUserActionTitle").textContent = mode === "role" ? "Alterar função" : "Ajustar créditos";
  document.getElementById("botUserActionSubtitle").textContent = `${user.FirstName || user.Username || "Cliente"} · ID ${user.TelegramID}`;
  document.getElementById("botRoleFields").classList.toggle("hidden", mode !== "role");
  document.getElementById("botCreditFields").classList.toggle("hidden", mode !== "credits");
  document.getElementById("botActionRole").value = user.Role || "customer";
  document.getElementById("botActionLinked").value = user.LinkedAdminUsername || "";
  document.getElementById("botActionCredits").value = "";
  botToggleLinkedAdminField();
  document.getElementById("botUserActionModal").classList.remove("hidden");
  document.body.classList.add("bot-modal-open");
  setTimeout(() => (mode === "role" ? document.getElementById("botActionRole") : document.getElementById("botActionCredits"))?.focus(), 0);
}

function botCloseUserAction() {
  document.getElementById("botUserActionModal")?.classList.add("hidden");
  document.body.classList.remove("bot-modal-open");
}

function botToggleLinkedAdminField() {
  const show = document.getElementById("botActionRole")?.value === "reseller";
  document.getElementById("botActionLinkedField")?.classList.toggle("hidden", !show);
}

async function botSaveUserAction(event) {
  event.preventDefault();
  const telegramID = Number.parseInt(document.getElementById("botActionTelegramID").value, 10);
  const mode = document.getElementById("botActionMode").value;
  const payload = mode === "role" ? {
    telegram_id: telegramID, action: "set_role", role: document.getElementById("botActionRole").value,
    linked_admin_username: document.getElementById("botActionLinked").value.trim(),
  } : {
    telegram_id: telegramID, action: "adjust_credits", credits: Number.parseInt(document.getElementById("botActionCredits").value, 10) || 0,
  };
  try {
    await botRequest("/api/bot/users", { method: "POST", body: JSON.stringify(payload) });
    botCloseUserAction();
    await loadBotUsers();
    botStatus("botUsersStatus", "Cliente atualizado.", true);
  } catch (error) {
    botHandleError(error, "botUsersStatus", "Erro ao atualizar cliente.");
  }
}

async function botToggleBlock(user) {
  const isBlocked = user.Role === "blocked";
  const accepted = await panelConfirm({
    tone:isBlocked ? "default" : "danger", icon:isBlocked ? "✓" : "!",
    title:isBlocked ? "Desbloquear cliente" : "Bloquear cliente",
    message:isBlocked ? "Desbloquear este cliente?" : "Bloquear este cliente no bot?",
    confirmLabel:isBlocked ? "Desbloquear" : "Bloquear",
  });
  if (!accepted) return;
  try {
    await botRequest("/api/bot/users", { method: "POST", body: JSON.stringify({ telegram_id: user.TelegramID, action: isBlocked ? "unblock" : "block" }) });
    await loadBotUsers();
  } catch (error) {
    botHandleError(error, "botUsersStatus", "Erro ao alterar bloqueio.");
  }
}

// Transactions
async function loadBotTxns() {
  const filter = document.getElementById("botTxnFilter")?.value || "";
  try {
    const transactions = await botRequest(`/api/bot/transactions?limit=200&status=${encodeURIComponent(filter)}`);
    botState.transactions = transactions || [];
    renderBotTransactions(botState.transactions);
    botStatus("botTxnStatus", `${botState.transactions.length} pagamento(s) carregado(s).`, true);
    botUpdateMetrics();
    return transactions;
	  } catch (error) {
		botHandleError(error, "botTxnStatus", "Erro ao carregar pagamentos.");
	  }
}

function botTransactionType(type) {
  return ({ plan_purchase: "Compra de plano", plan_renewal: "Renovação", credit_topup: "Recarga" })[type] || type || "—";
}

function renderBotTransactions(transactions) {
  const body = document.getElementById("botTxnsBody");
  if (!body) return;
  document.getElementById("botTxnCount").textContent = String(transactions.length);
  if (!transactions.length) return botEmptyRow(body, 8, "Nenhum pagamento encontrado para este filtro.");
  body.replaceChildren(...transactions.map(transaction => {
    const row = document.createElement("tr");
    const createdAt = transaction.CreatedAt ? new Date(transaction.CreatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
    const buttons = [];
    if (transaction.Status === "pending" || transaction.Status === "approved") buttons.push(botButton("Reprocessar", () => botReprocess(transaction.ID)));
    if (transaction.Status !== "refunded") buttons.push(botButton("Marcar estornado", () => botRefund(transaction.ID), "btn btn-danger btn-sm"));
    row.append(
      botCell(botPrimaryCell(`#${transaction.ID}`, transaction.MPPaymentID ? `MP ${transaction.MPPaymentID}` : "Sem ID Mercado Pago")),
      botCell(transaction.TelegramID), botCell(botTransactionType(transaction.Type)), botCell(botBRL(transaction.AmountCents)),
      botCell(botBadge(transaction.Status || "unknown", transaction.Status || "inactive")), botCell(transaction.TargetUsername || "Aguardando"),
      botCell(createdAt), botCell(botActions(buttons)),
    );
    return row;
  }));
}

async function botReprocess(id) {
  try {
    await botRequest("/api/bot/transactions", { method: "POST", body: JSON.stringify({ id, action: "reprocess" }) });
    botStatus("botTxnStatus", `Pagamento #${id} enviado para reprocessamento.`, true);
    setTimeout(loadBotTxns, 1400);
  } catch (error) {
    botHandleError(error, "botTxnStatus", "Erro ao reprocessar pagamento.");
  }
}

async function botRefund(id) {
  const accepted = await panelConfirm({
    tone:"danger", icon:"!", title:"Marcar como estornado",
    message:`Marcar o pagamento #${id} como estornado no painel?`,
    detail:"Esta ação não envia um estorno financeiro ao Mercado Pago; ela altera somente o status interno.",
    confirmLabel:"Marcar estornado",
  });
  if (!accepted) return;
  try {
    await botRequest("/api/bot/transactions", { method: "POST", body: JSON.stringify({ id, action: "refund" }) });
    await loadBotTxns();
  } catch (error) {
    botHandleError(error, "botTxnStatus", "Erro ao atualizar pagamento.");
  }
}

// Messages
async function loadBotSettings() {
  try {
    const settings = await botRequest("/api/bot/settings");
    const set = (id, value) => { const field = document.getElementById(id); if (field) field.value = value || ""; };
    set("setWelcome", settings.welcome_text); set("setContact", settings.contact_text);
    set("setAppText", settings.app_text); set("setAppUrl", settings.app_url);
    botStatus("botSettingsStatus", "Mensagens carregadas.", true);
    return settings;
	  } catch (error) {
		botHandleError(error, "botSettingsStatus", "Erro ao carregar mensagens.");
	  }
}

async function saveBotSettings() {
  const value = id => document.getElementById(id)?.value || "";
  const payload = { welcome_text: value("setWelcome"), contact_text: value("setContact"), app_text: value("setAppText"), app_url: value("setAppUrl").trim() };
  botStatus("botSettingsStatus", "Salvando mensagens…");
  try {
    await botRequest("/api/bot/settings", { method: "POST", body: JSON.stringify(payload) });
    botStatus("botSettingsStatus", "Mensagens salvas.", true);
  } catch (error) {
    botHandleError(error, "botSettingsStatus", "Erro ao salvar mensagens.");
  }
}

// Wiring
document.querySelectorAll("[data-bot-section]").forEach(button => button.addEventListener("click", () => botSetSection(button.dataset.botSection)));
document.getElementById("botSection")?.addEventListener("change", event => botSetSection(event.target.value));
document.getElementById("botConfigSaveBtn")?.addEventListener("click", saveBotConfig);
document.getElementById("botConfigReloadBtn")?.addEventListener("click", loadBotTab);
document.getElementById("botTestBtn")?.addEventListener("click", testBot);
document.getElementById("botMPConfirmMode")?.addEventListener("change", botToggleMPWebhookBox);
document.getElementById("botCopyWebhookBtn")?.addEventListener("click", botCopyWebhook);
document.getElementById("botReloadPlansBtn")?.addEventListener("click", loadBotPlans);
document.getElementById("botNewPlanBtn")?.addEventListener("click", botClearPlanForm);
document.getElementById("botCancelPlanBtn")?.addEventListener("click", botClearPlanForm);
document.getElementById("botPlanForm")?.addEventListener("submit", botSavePlan);
document.getElementById("botReloadPkgsBtn")?.addEventListener("click", loadBotPkgs);
document.getElementById("botNewPkgBtn")?.addEventListener("click", botClearPkgForm);
document.getElementById("botClearPkgBtn")?.addEventListener("click", botClearPkgForm);
document.getElementById("botPkgForm")?.addEventListener("submit", botSavePkg);
document.getElementById("botReloadUsersBtn")?.addEventListener("click", loadBotUsers);
document.getElementById("botReloadTxnsBtn")?.addEventListener("click", loadBotTxns);
document.getElementById("botTxnFilter")?.addEventListener("change", loadBotTxns);
document.getElementById("botSaveSettingsBtn")?.addEventListener("click", saveBotSettings);
document.getElementById("botReloadSettingsBtn")?.addEventListener("click", loadBotSettings);
document.getElementById("botUserActionForm")?.addEventListener("submit", botSaveUserAction);
document.getElementById("botActionRole")?.addEventListener("change", botToggleLinkedAdminField);
document.querySelectorAll("[data-bot-modal-close]").forEach(element => element.addEventListener("click", botCloseUserAction));
document.addEventListener("keydown", event => { if (event.key === "Escape") botCloseUserAction(); });

botSetSection(botState.section);
