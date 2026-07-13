// ─── Bot / Vendas (Telegram + Mercado Pago) ─────────────────────────────────
// Superadmin-only tab. Uses the shared api() helper from 01-core.js.

function botEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function botStatus(id, msg, ok) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.color = ok === false ? "var(--danger,#e5484d)" : ""; }
}
function brl(cents) {
  return "R$ " + (Number(cents || 0) / 100).toFixed(2).replace(".", ",");
}

async function loadBotTab() {
  loadBotConfig();
  loadBotInbounds();
  loadBotPlans();
  loadBotPkgs();
  loadBotUsers();
  loadBotTxns();
  loadBotSettings();
}

// ─── Config ───
async function loadBotConfig() {
  try {
    const res = await api("/api/bot/config");
    const c = await res.json();
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v ?? ""; };
    const chk = (id, v) => { const e = document.getElementById(id); if (e) e.checked = !!v; };
    chk("botEnabled", c.enabled);
    set("botTelegramMode", c.telegram_mode);
    set("botTelegramWebhookURL", c.telegram_webhook_url);
    set("botMPConfirmMode", c.mp_confirm_mode);
    set("botMPPollInterval", c.mp_poll_interval);
    set("botPixExp", c.pix_expiration_minutes);
    chk("botTrialEnabled", c.trial_enabled);
    set("botTrialHours", c.trial_hours);
    set("botTrialMaxConns", c.trial_max_connections);
    set("botTrialKind", c.trial_kind);
    set("botTrialInbound", c.trial_inbound_tag);
    set("botAdminIDs", (c.admin_telegram_ids || []).join(","));
    set("botPublicHost", c.public_host);
    set("botXrayPublicHost", c.xray_public_host);
    document.getElementById("botHasTgToken").textContent = c.has_telegram_token ? "✓ configurado" : "não definido";
    document.getElementById("botHasTgSecret").textContent = c.has_telegram_webhook_secret ? "✓ configurado" : "não definido";
    document.getElementById("botHasMpToken").textContent = c.has_mp_access_token ? "✓ configurado" : "não definido";
    document.getElementById("botHasMpSecret").textContent = c.has_mp_webhook_secret ? "✓ configurado" : "não definido";
    botStatus("botConfigStatus", "Carregado.");
  } catch (e) { if (e.message !== "auth") botStatus("botConfigStatus", "Erro ao carregar.", false); }
}

async function saveBotConfig() {
  const val = id => (document.getElementById(id)?.value || "").trim();
  const num = id => parseInt(document.getElementById(id)?.value || "0", 10) || 0;
  const chk = id => !!document.getElementById(id)?.checked;
  const ids = val("botAdminIDs").split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  const body = {
    enabled: chk("botEnabled"),
    telegram_token: val("botTelegramToken"),
    telegram_mode: val("botTelegramMode"),
    telegram_webhook_url: val("botTelegramWebhookURL"),
    telegram_webhook_secret: val("botTelegramWebhookSecret"),
    mp_access_token: val("botMPToken"),
    mp_confirm_mode: val("botMPConfirmMode"),
    mp_webhook_secret: val("botMPWebhookSecret"),
    mp_poll_interval: val("botMPPollInterval"),
    pix_expiration_minutes: num("botPixExp"),
    trial_enabled: chk("botTrialEnabled"),
    trial_hours: num("botTrialHours"),
    trial_max_connections: num("botTrialMaxConns"),
    trial_kind: val("botTrialKind"),
    trial_inbound_tag: val("botTrialInbound"),
    admin_telegram_ids: ids,
    public_host: val("botPublicHost"),
    xray_public_host: val("botXrayPublicHost"),
  };
  try {
    await api("/api/bot/config", { method: "POST", body: JSON.stringify(body) });
    ["botTelegramToken", "botTelegramWebhookSecret", "botMPToken", "botMPWebhookSecret"].forEach(id => { const e = document.getElementById(id); if (e) e.value = ""; });
    botStatus("botConfigStatus", "Configuração salva e bot reiniciado.");
    loadBotConfig();
  } catch (e) { if (e.message !== "auth") botStatus("botConfigStatus", "Erro ao salvar.", false); }
}

async function testBot() {
  botStatus("botConfigStatus", "Testando...");
  const body = {
    telegram_token: (document.getElementById("botTelegramToken")?.value || "").trim(),
    mp_access_token: (document.getElementById("botMPToken")?.value || "").trim(),
  };
  try {
    const res = await api("/api/bot/test", { method: "POST", body: JSON.stringify(body) });
    const r = await res.json();
    const tg = r.telegram_ok ? `Telegram OK (${r.telegram_bot || ""})` : `Telegram: ${r.telegram_error || "falha"}`;
    const mp = r.mp_ok ? "Mercado Pago OK" : `Mercado Pago: ${r.mp_error || "falha"}`;
    botStatus("botConfigStatus", tg + " · " + mp, r.telegram_ok && r.mp_ok);
  } catch (e) { if (e.message !== "auth") botStatus("botConfigStatus", "Erro no teste.", false); }
}

// ─── Inbounds datalist ───
async function loadBotInbounds() {
  try {
    const res = await api("/api/xray/inbounds");
    const list = await res.json();
    const dl = document.getElementById("botInboundList");
    if (dl) dl.innerHTML = (list || []).map(ib => `<option value="${botEsc(ib.tag)}">${botEsc(ib.protocol)}</option>`).join("");
  } catch (e) { /* xray may be off; ignore */ }
}

// ─── Plans ───
async function loadBotPlans() {
  try {
    const res = await api("/api/bot/plans");
    const plans = await res.json() || [];
    document.getElementById("botPlanCount").textContent = plans.length;
    document.getElementById("botPlansBody").innerHTML = plans.map(p => `
      <tr>
        <td>${botEsc(p.Name)}</td><td>${botEsc(p.Kind)}</td><td>${p.Days}</td>
        <td>${brl(p.PriceCents)}</td><td>${p.CreditCost}</td>
        <td>${p.IsActive ? "✅" : "—"}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick='botEditPlan(${JSON.stringify(p)})'>Editar</button>
          <button class="btn btn-ghost btn-sm" onclick='botDeletePlan(${p.ID})'>Excluir</button>
        </td>
      </tr>`).join("");
    botStatus("botPlansStatus", "Ready.");
  } catch (e) { if (e.message !== "auth") botStatus("botPlansStatus", "Erro ao carregar.", false); }
}
function botEditPlan(p) {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v ?? ""; };
  set("planId", p.ID); set("planName", p.Name); set("planKind", p.Kind); set("planDays", p.Days);
  set("planMaxConns", p.MaxConnections); set("planUpMbps", p.LimitMbpsUp); set("planDownMbps", p.LimitMbpsDown);
  set("planInbound", p.XrayInboundTag); set("planProtocol", p.XrayProtocol);
  set("planPrice", (p.PriceCents / 100).toFixed(2)); set("planCreditCost", p.CreditCost);
  set("planServerId", p.ServerID); set("planSort", p.SortOrder);
  document.getElementById("planActive").checked = !!p.IsActive;
  document.getElementById("botPlanFormTitle").textContent = "Editar Plano #" + p.ID;
}
function botClearPlanForm() {
  document.getElementById("botPlanForm").reset();
  document.getElementById("planId").value = "";
  document.getElementById("botPlanFormTitle").textContent = "Novo Plano";
}
async function botSavePlan(ev) {
  ev.preventDefault();
  const val = id => document.getElementById(id).value;
  const num = id => parseInt(document.getElementById(id).value || "0", 10) || 0;
  const body = {
    id: num("planId"), name: val("planName"), kind: val("planKind"), days: num("planDays"),
    max_connections: num("planMaxConns"), limit_mbps_up: num("planUpMbps"), limit_mbps_down: num("planDownMbps"),
    xray_inbound_tag: val("planInbound"), xray_protocol: val("planProtocol"),
    price_cents: Math.round(parseFloat(val("planPrice") || "0") * 100),
    credit_cost: num("planCreditCost"), server_id: val("planServerId"), sort_order: num("planSort"),
    is_active: document.getElementById("planActive").checked,
  };
  // map to Go struct JSON tags (exported field names)
  const payload = {
    ID: body.id, Name: body.name, Kind: body.kind, Days: body.days, MaxConnections: body.max_connections,
    LimitMbpsUp: body.limit_mbps_up, LimitMbpsDown: body.limit_mbps_down, XrayInboundTag: body.xray_inbound_tag,
    XrayProtocol: body.xray_protocol, PriceCents: body.price_cents, CreditCost: body.credit_cost,
    ServerID: body.server_id, IsActive: body.is_active, SortOrder: body.sort_order,
  };
  try {
    await api("/api/bot/plans", { method: "POST", body: JSON.stringify(payload) });
    botClearPlanForm(); loadBotPlans(); botStatus("botPlansStatus", "Plano salvo.");
  } catch (e) { if (e.message !== "auth") botStatus("botPlansStatus", "Erro ao salvar.", false); }
}
async function botDeletePlan(id) {
  if (!confirm("Excluir este plano?")) return;
  try { await api("/api/bot/plans?id=" + id, { method: "DELETE" }); loadBotPlans(); }
  catch (e) { if (e.message !== "auth") botStatus("botPlansStatus", "Erro ao excluir.", false); }
}

// ─── Credit packages ───
async function loadBotPkgs() {
  try {
    const res = await api("/api/bot/credit-packages");
    const pkgs = await res.json() || [];
    document.getElementById("botPkgCount").textContent = pkgs.length;
    document.getElementById("botPkgsBody").innerHTML = pkgs.map(p => `
      <tr>
        <td>${botEsc(p.Name)}</td><td>${p.Credits}</td><td>${brl(p.PriceCents)}</td>
        <td>${p.IsActive ? "✅" : "—"}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick='botEditPkg(${JSON.stringify(p)})'>Editar</button>
          <button class="btn btn-ghost btn-sm" onclick='botDeletePkg(${p.ID})'>Excluir</button>
        </td>
      </tr>`).join("");
    botStatus("botPkgStatus", "Ready.");
  } catch (e) { if (e.message !== "auth") botStatus("botPkgStatus", "Erro ao carregar.", false); }
}
function botEditPkg(p) {
  const set = (id, v) => { document.getElementById(id).value = v ?? ""; };
  set("pkgId", p.ID); set("pkgName", p.Name); set("pkgCredits", p.Credits);
  set("pkgPrice", (p.PriceCents / 100).toFixed(2)); set("pkgSort", p.SortOrder);
  document.getElementById("pkgActive").checked = !!p.IsActive;
}
function botClearPkgForm() { document.getElementById("botPkgForm").reset(); document.getElementById("pkgId").value = ""; }
async function botSavePkg(ev) {
  ev.preventDefault();
  const val = id => document.getElementById(id).value;
  const num = id => parseInt(document.getElementById(id).value || "0", 10) || 0;
  const payload = {
    ID: num("pkgId"), Name: val("pkgName"), Credits: num("pkgCredits"),
    PriceCents: Math.round(parseFloat(val("pkgPrice") || "0") * 100),
    SortOrder: num("pkgSort"), IsActive: document.getElementById("pkgActive").checked,
  };
  try { await api("/api/bot/credit-packages", { method: "POST", body: JSON.stringify(payload) }); botClearPkgForm(); loadBotPkgs(); botStatus("botPkgStatus", "Pacote salvo."); }
  catch (e) { if (e.message !== "auth") botStatus("botPkgStatus", "Erro ao salvar.", false); }
}
async function botDeletePkg(id) {
  if (!confirm("Excluir este pacote?")) return;
  try { await api("/api/bot/credit-packages?id=" + id, { method: "DELETE" }); loadBotPkgs(); }
  catch (e) { if (e.message !== "auth") botStatus("botPkgStatus", "Erro ao excluir.", false); }
}

// ─── Bot users ───
async function loadBotUsers() {
  try {
    const res = await api("/api/bot/users");
    const users = await res.json() || [];
    document.getElementById("botUserCount").textContent = users.length;
    document.getElementById("botUsersBody").innerHTML = users.map(u => `
      <tr>
        <td>${u.TelegramID}</td><td>${botEsc(u.FirstName)}</td><td>${botEsc(u.Username)}</td>
        <td>${botEsc(u.Role)}</td><td>${botEsc(u.LinkedAdminUsername)}</td><td>${u.CreditBalance}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick='botPromote(${u.TelegramID})'>Papel</button>
          <button class="btn btn-ghost btn-sm" onclick='botCredit(${u.TelegramID})'>Créditos</button>
          <button class="btn btn-ghost btn-sm" onclick='botBlock(${u.TelegramID}, ${u.Role === "blocked"})'>${u.Role === "blocked" ? "Desbloq." : "Bloquear"}</button>
        </td>
      </tr>`).join("");
    botStatus("botUsersStatus", "Ready.");
  } catch (e) { if (e.message !== "auth") botStatus("botUsersStatus", "Erro ao carregar.", false); }
}
async function botPromote(tid) {
  const role = prompt("Papel (customer / reseller / blocked):", "reseller");
  if (!role) return;
  let linked = "";
  if (role === "reseller") { linked = prompt("Username do revendedor (admin_users) vinculado:", "") || ""; }
  try { await api("/api/bot/users", { method: "POST", body: JSON.stringify({ telegram_id: tid, action: "set_role", role, linked_admin_username: linked }) }); loadBotUsers(); }
  catch (e) { if (e.message !== "auth") botStatus("botUsersStatus", "Erro.", false); }
}
async function botCredit(tid) {
  const v = prompt("Ajuste de créditos (use negativo para remover):", "10");
  if (v === null) return;
  const n = parseInt(v, 10); if (isNaN(n)) return;
  try { await api("/api/bot/users", { method: "POST", body: JSON.stringify({ telegram_id: tid, action: "adjust_credits", credits: n }) }); loadBotUsers(); }
  catch (e) { if (e.message !== "auth") botStatus("botUsersStatus", "Erro (saldo insuficiente?).", false); }
}
async function botBlock(tid, isBlocked) {
  try { await api("/api/bot/users", { method: "POST", body: JSON.stringify({ telegram_id: tid, action: isBlocked ? "unblock" : "block" }) }); loadBotUsers(); }
  catch (e) { if (e.message !== "auth") botStatus("botUsersStatus", "Erro.", false); }
}

// ─── Transactions ───
async function loadBotTxns() {
  const filter = document.getElementById("botTxnFilter")?.value || "";
  try {
    const res = await api("/api/bot/transactions?limit=200&status=" + encodeURIComponent(filter));
    const txns = await res.json() || [];
    document.getElementById("botTxnCount").textContent = txns.length;
    document.getElementById("botTxnsBody").innerHTML = txns.map(t => `
      <tr>
        <td>${t.ID}</td><td>${t.TelegramID}</td><td>${botEsc(t.Type)}</td><td>${brl(t.AmountCents)}</td>
        <td>${botEsc(t.Status)}</td><td>${botEsc(t.TargetUsername)}</td>
        <td>${botEsc((t.CreatedAt || "").slice(0, 16).replace("T", " "))}</td>
        <td>
          ${t.Status === "pending" || t.Status === "approved" ? `<button class="btn btn-ghost btn-sm" onclick='botReprocess(${t.ID})'>Reprocessar</button>` : ""}
          ${t.Status !== "refunded" ? `<button class="btn btn-ghost btn-sm" onclick='botRefund(${t.ID})'>Estornar</button>` : ""}
        </td>
      </tr>`).join("");
    botStatus("botTxnStatus", "Ready.");
  } catch (e) { if (e.message !== "auth") botStatus("botTxnStatus", "Erro ao carregar.", false); }
}
async function botReprocess(id) {
  try { await api("/api/bot/transactions", { method: "POST", body: JSON.stringify({ id, action: "reprocess" }) }); botStatus("botTxnStatus", "Reprocessando #" + id + "..."); setTimeout(loadBotTxns, 1500); }
  catch (e) { if (e.message !== "auth") botStatus("botTxnStatus", "Erro (bot ativo?).", false); }
}
async function botRefund(id) {
  if (!confirm("Marcar pagamento #" + id + " como estornado?")) return;
  try { await api("/api/bot/transactions", { method: "POST", body: JSON.stringify({ id, action: "refund" }) }); loadBotTxns(); }
  catch (e) { if (e.message !== "auth") botStatus("botTxnStatus", "Erro.", false); }
}

// ─── Settings (messages) ───
async function loadBotSettings() {
  try {
    const res = await api("/api/bot/settings");
    const s = await res.json() || {};
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v || ""; };
    set("setWelcome", s.welcome_text); set("setContact", s.contact_text);
    set("setAppText", s.app_text); set("setAppUrl", s.app_url);
    botStatus("botSettingsStatus", "Ready.");
  } catch (e) { if (e.message !== "auth") botStatus("botSettingsStatus", "Erro ao carregar.", false); }
}
async function saveBotSettings() {
  const val = id => document.getElementById(id)?.value || "";
  const payload = { welcome_text: val("setWelcome"), contact_text: val("setContact"), app_text: val("setAppText"), app_url: val("setAppUrl") };
  try { await api("/api/bot/settings", { method: "POST", body: JSON.stringify(payload) }); botStatus("botSettingsStatus", "Mensagens salvas."); }
  catch (e) { if (e.message !== "auth") botStatus("botSettingsStatus", "Erro ao salvar.", false); }
}

// ─── Wiring ───
document.getElementById("botConfigSaveBtn")?.addEventListener("click", saveBotConfig);
document.getElementById("botConfigReloadBtn")?.addEventListener("click", loadBotConfig);
document.getElementById("botTestBtn")?.addEventListener("click", testBot);
document.getElementById("botReloadPlansBtn")?.addEventListener("click", loadBotPlans);
document.getElementById("botNewPlanBtn")?.addEventListener("click", botClearPlanForm);
document.getElementById("botCancelPlanBtn")?.addEventListener("click", botClearPlanForm);
document.getElementById("botPlanForm")?.addEventListener("submit", botSavePlan);
document.getElementById("botReloadPkgsBtn")?.addEventListener("click", loadBotPkgs);
document.getElementById("botNewPkgBtn")?.addEventListener("click", botClearPkgForm);
document.getElementById("botPkgForm")?.addEventListener("submit", botSavePkg);
document.getElementById("botReloadUsersBtn")?.addEventListener("click", loadBotUsers);
document.getElementById("botReloadTxnsBtn")?.addEventListener("click", loadBotTxns);
document.getElementById("botTxnFilter")?.addEventListener("change", loadBotTxns);
document.getElementById("botSaveSettingsBtn")?.addEventListener("click", saveBotSettings);
document.getElementById("botReloadSettingsBtn")?.addEventListener("click", loadBotSettings);
