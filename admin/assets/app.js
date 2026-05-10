
// ─── State ───────────────────────────────────────────────────────────────────
let sessionToken = localStorage.getItem("SESSION_TOKEN") || "";
let currentRole  = "";
let currentUser  = "";
let statsTimer   = null, usersTimer = null, xrayTimer = null;
let formCollapsed = true;
let tlsForwardersState = [];
let editingXrayClientId = null;
let wzInbounds = [];
let dashboardCache = { sshUsers: [], xrayInbounds: [], me: null };
let currentTab = "dashboard";
let inboundsRefreshInFlight = false;
let lastInboundsStructure = "";

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
const themeToggle   = document.getElementById("themeToggle");
const pageTitle     = document.getElementById("pageTitle");
const pageEyebrow   = document.getElementById("pageEyebrow");
const sidebarUsername = document.getElementById("sidebarUsername");
const sidebarRole   = document.getElementById("sidebarRole");
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

// Xray
const xrayChip       = document.getElementById("xrayChip");
const xRunning       = document.getElementById("xRunning");
const xPID           = document.getElementById("xPID");
const xUptime        = document.getElementById("xUptime");
const xStatus        = document.getElementById("xStatus");
const xOnlineUsers   = document.getElementById("xOnlineUsers");
const xCfgEditor     = document.getElementById("xCfgEditor");
const xCfgStatus     = document.getElementById("xCfgStatus");
const xLogsBox       = document.getElementById("xLogsBox");
const inboundsContainer = document.getElementById("inboundsContainer");

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

// Stats
const cpuVal     = document.getElementById("cpuVal");
const cpuBar     = document.getElementById("cpuBar");
const memVal     = document.getElementById("memVal");
const memBar     = document.getElementById("memBar");
const memDetail  = document.getElementById("memDetail");
const ifaceBody  = document.getElementById("ifaceBody");
const ifaceSummary = document.getElementById("ifaceSummary");
const statsUpdated = document.getElementById("statsUpdated");
const resetIfaceStatsBtn = document.getElementById("resetIfaceStatsBtn");

// VnStat
const vnstatDailyBody = document.getElementById("vnstatDailyBody");
const vnstatMonthlyBody = document.getElementById("vnstatMonthlyBody");
const vnstatStatus = document.getElementById("vnstatStatus");
const vnTodayTotal = document.getElementById("vnTodayTotal");
const vnMonthTotal = document.getElementById("vnMonthTotal");
const vnIfaceCount = document.getElementById("vnIfaceCount");
const reloadVnstatBtn = document.getElementById("reloadVnstatBtn");
const resetVnstatBtn = document.getElementById("resetVnstatBtn");

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
  if (c.expired) return `<span style="color:var(--danger);font-size:.68rem;">Expired</span>`;
  if (daysLeft === -1 || !exp) return `<span style="color:var(--success);font-size:.68rem;">Active</span>`;
  return `<span style="color:var(--success);font-size:.68rem;">Active (${escapeHTML(daysLeft)}d)</span>`;
}

function clientExpiryLabel(c) {
  const exp = c.expires_at ? new Date(c.expires_at) : null;
  return exp ? exp.toLocaleDateString() : "Unlimited";
}

function clientOnlineHTML(c) {
  return `${c.online ? '<span class="badge-on">online</span>' : '<span class="badge-off">offline</span>'}<div class="hint">${escapeHTML(formatLastActive(c.last_active))}</div>`;
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
      chip.textContent = `${onlineCount} online`;
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
      updateCell(row, "traffic", escapeHTML(formatBytes(c.total_bytes)));
      updateCell(row, "max", escapeHTML(c.max_conns || "∞"));
    }
  }
  return true;
}

// ─── Navigation / shell ──────────────────────────────────────────────────────
const tabTitles = {
  dashboard: ["Painel", "Visão geral"],
  ssh: ["Contas", "SSH / SlowDNS"],
  xray: ["Contas", "Xray Users"],
  resellers: ["Administração", "Revendedores"],
  stats: ["Servidor", "Monitoramento"],
  vnstat: ["Tráfego", "VnStat"],
  logs: ["Sistema", "Logs"],
  server: ["Sistema", "Configurações"],
};

function selectTab(tab) {
  currentTab = tab;
  const pane = document.getElementById("tab-" + tab);
  const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (!pane || !btn) return;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
  btn.classList.add("active");
  pane.classList.add("active");
  const [eyebrow, title] = tabTitles[tab] || ["Painel", tab];
  if (pageEyebrow) pageEyebrow.textContent = eyebrow;
  if (pageTitle) pageTitle.textContent = title;
  document.body.classList.remove("sidebar-open");

  if (tab === "dashboard") refreshDashboard();
  if (tab === "xray") {
    loadXrayStatus();
    loadInbounds({ force: true });
    if (currentRole === "superadmin") loadWizardFromConfig();
  }
  if (tab === "stats" && currentRole === "superadmin") loadStats();
  if (tab === "resellers" && currentRole === "superadmin") loadResellers();
}

document.querySelectorAll(".tab-btn").forEach(btn => btn.addEventListener("click", () => selectTab(btn.dataset.tab)));
menuToggle?.addEventListener("click", () => document.body.classList.add("sidebar-open"));
drawerBackdrop?.addEventListener("click", () => document.body.classList.remove("sidebar-open"));
themeToggle?.addEventListener("click", () => document.body.classList.toggle("light-mode"));
document.querySelectorAll(".quick-action[data-jump]").forEach(btn => btn.addEventListener("click", () => selectTab(btn.dataset.jump)));
document.getElementById("quickCreateUserBtn")?.addEventListener("click", () => { selectTab("ssh"); setFormCollapsed(false); fUsername?.focus(); });
document.getElementById("quickOpenXrayBtn")?.addEventListener("click", () => selectTab("xray"));

// ─── Login / Logout ───────────────────────────────────────────────────────────
loginBtn.addEventListener("click", doLogin);
loginPass.addEventListener("keydown", e => { if (e.key==="Enter") doLogin(); });
logoutBtn.addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  sessionToken = "";
  localStorage.removeItem("SESSION_TOKEN");
  clearTimers();
  mainApp.classList.add("hidden");
  loginOverlay.classList.remove("hidden");
  loginErr.textContent = "";
  loginUser.value = loginPass.value = "";
});

async function doLogin() {
  loginErr.textContent = "";
  loginBtn.disabled = true;
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ username: loginUser.value.trim(), password: loginPass.value }),
    });
    if (!res.ok) {
      loginErr.textContent = res.status === 401 ? "Invalid credentials." :
                             res.status === 403 ? "Account suspended or expired." :
                             "Login failed.";
      return;
    }
    const data = await res.json();
    sessionToken = data.token;
    currentRole  = data.role;
    currentUser  = data.username;
    localStorage.setItem("SESSION_TOKEN", sessionToken);
    loginOverlay.classList.add("hidden");
    mainApp.classList.remove("hidden");
    initAfterLogin();
  } catch (e) {
    loginErr.textContent = "Network error.";
  } finally {
    loginBtn.disabled = false;
  }
}

// ─── Init after login ─────────────────────────────────────────────────────────
function clearTimers() {
  [statsTimer, usersTimer, xrayTimer].forEach(t => t && clearInterval(t));
  statsTimer = usersTimer = xrayTimer = null;
}

function initAfterLogin() {
  meUsername.textContent = currentUser;
  if (sidebarUsername) sidebarUsername.textContent = currentUser;
  if (sidebarRole) sidebarRole.textContent = currentRole === "superadmin" ? "Super Admin" : "Revendedor";
  roleChip.innerHTML = currentRole === "superadmin"
    ? `<span class="chip green">superadmin</span>`
    : `<span class="chip warn">reseller</span>`;

  document.querySelectorAll(".superadmin-only").forEach(el => {
    el.classList.toggle("hidden", currentRole !== "superadmin");
  });
  document.querySelectorAll(".reseller-only").forEach(el => {
    el.classList.toggle("hidden", currentRole !== "reseller");
  });
  document.querySelectorAll(".xray-admin-only").forEach(el => {
    el.classList.toggle("hidden", currentRole !== "superadmin");
  });

  resellerInfoCard.classList.toggle("hidden", currentRole !== "reseller");
  dashboardQuotaCard?.classList.toggle("hidden", currentRole !== "reseller");
  updateRoleWelcome();

  selectTab("dashboard");

  if (currentRole === "superadmin") {
    loadDashboardStats();
    statsTimer = setInterval(() => {
      loadDashboardStats();
      if (currentTab === "stats") loadStats();
    }, 2000);
  } else {
    loadMe();
  }
  xrayTimer = setInterval(() => {
    loadXrayStatus();
    if (currentTab === "xray") loadInbounds({ silent: true });
  }, 7000);

  loadUsers();
  loadXrayStatus();
  loadInbounds({ silent: true });
  usersTimer = setInterval(() => loadUsersSilent(), 3000);
}

function updateRoleWelcome() {
  const title = document.getElementById("welcomeTitle");
  const sub = document.getElementById("welcomeSub");
  const kicker = document.getElementById("welcomeKicker");
  if (!title || !sub || !kicker) return;
  const name = currentUser || "admin";
  title.textContent = `Bem-vindo de volta, ${name} 👋`;
  if (currentRole === "reseller") {
    kicker.textContent = "Painel do revendedor";
    sub.textContent = "Crie contas SSH e Xray com cota única, sem precisar tocar em configurações técnicas.";
  } else {
    kicker.textContent = "Painel operacional";
    sub.textContent = "Gerencie SSH, Xray, revendedores e servidor em poucos cliques.";
  }
}

// ─── Me (reseller info) ───────────────────────────────────────────────────────
async function loadMe() {
  try {
    const res = await api("/api/auth/me");
    const d   = await res.json();
    dashboardCache.me = d;
    const used = d.used_users ?? 0;
    const max = d.max_users || 0;
    rUsedMax.textContent = used + " / " + (max || "∞");
    rExpiry.textContent  = d.expires_at ? fmtDate(d.expires_at) : "Sem vencimento";
    rStatus.textContent  = d.is_active  ? "Ativo" : "Suspenso";
    rStatus.style.color  = d.is_active  ? "var(--success)" : "var(--danger)";
    updateQuotaCard(used, max, d.used_ssh_users || 0, d.used_xray_users || 0);
    renderDashboardCounters();
  } catch {}
}

function quotaToneClass(pct, remaining) {
  if (remaining === 0 || pct >= 90) return "quota-danger";
  if (pct >= 75) return "quota-warn";
  return "quota-good";
}

function setQuotaTone(el, tone) {
  if (!el) return;
  el.classList.remove("quota-good", "quota-warn", "quota-danger");
  el.classList.add(tone);
}

function updateQuotaCard(used, max, sshUsed = 0, xrayUsed = 0) {
  if (!dashQuotaText) return;
  const unlimited = !max;
  const remaining = unlimited ? "∞" : Math.max(0, max - used);
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / max) * 100));
  const tone = quotaToneClass(pct, remaining === "∞" ? 999999 : remaining);
  const labelMax = unlimited ? "∞" : max;

  dashQuotaChip.textContent = `${used} / ${labelMax}`;
  dashQuotaChip.className = `chip ${pct >= 90 ? "red" : pct >= 75 ? "warn" : "green"}`;
  dashQuotaText.textContent = unlimited
    ? "Sem limite definido pelo admin"
    : `${remaining} contas disponíveis · ${pct}% usado`;
  dashQuotaBreakdown.textContent = `SSH ${sshUsed} · Xray ${xrayUsed}`;
  dashQuotaBar.style.width = `${pct}%`;

  if (dashQuotaRemaining) {
    dashQuotaRemaining.textContent = String(remaining);
    setQuotaTone(dashQuotaRemaining, tone);
  }
  if (dashQuotaSummaryText) {
    dashQuotaSummaryText.textContent = unlimited
      ? `${used} usadas · sem limite`
      : `${used}/${max} usadas · ${pct}% do plano`;
  }
  if (dashQuotaMiniBar) dashQuotaMiniBar.style.width = `${pct}%`;
  if (xrayResellerQuotaUsed) xrayResellerQuotaUsed.textContent = `${used}/${labelMax}`;
  if (xrayResellerQuotaRemaining) {
    xrayResellerQuotaRemaining.textContent = String(remaining);
    setQuotaTone(xrayResellerQuotaRemaining, tone);
  }
  if (xrayResellerQuotaMix) xrayResellerQuotaMix.textContent = `SSH ${sshUsed} · Xray ${xrayUsed}`;
}

function flattenXrayClients(inbounds = []) {
  return inbounds.flatMap(ib => (ib.clients || []).map(c => Object.assign({ inbound_tag: ib.tag }, c)));
}

function isExpiredDate(value) {
  return !!value && new Date(value) < new Date();
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

function formatLastActive(value) {
  if (!value) return "--";
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s atrás`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m atrás`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  return new Date(value).toLocaleString();
}

function renderDashboardCounters() {
  if (!dashTotalUsers) return;
  const sshUsers = dashboardCache.sshUsers || [];
  const xrayClients = flattenXrayClients(dashboardCache.xrayInbounds || []);
  const sshExpired = sshUsers.filter(u => isExpiredDate(u.expires_at)).length;
  const xrayExpired = xrayClients.filter(c => c.expired || isExpiredDate(c.expires_at)).length;
  const sshActive = Math.max(0, sshUsers.length - sshExpired);
  const xrayActive = Math.max(0, xrayClients.length - xrayExpired);
  const total = sshUsers.length + xrayClients.length;
  const active = sshActive + xrayActive;
  const expired = sshExpired + xrayExpired;
  const sshConns = sshUsers.reduce((sum, u) => sum + Number(u.active_conns || 0), 0);
  const xrayOnline = xrayClients.filter(c => !!c.online).length;
  const liveTotal = sshConns + xrayOnline;

  dashTotalUsers.textContent = total;
  dashActiveUsers.textContent = active;
  dashExpiredUsers.textContent = expired;
  if (dashAccountBreakdown) dashAccountBreakdown.textContent = `SSH ${sshUsers.length} · Xray ${xrayClients.length}`;
  dashConnections.textContent = liveTotal;
  if (dashConnectionsText) dashConnectionsText.textContent = `${sshConns} SSH · ${xrayOnline} Xray online`;
  if (dashXrayClients) dashXrayClients.textContent = xrayClients.length;
  if (dashXrayStatus) {
    const running = xrayChip?.textContent || "--";
    dashXrayStatus.textContent = `${xrayOnline} online · ${xrayActive} ativos · ${xrayExpired} expirados · Core: ${running}`;
  }

  const me = dashboardCache.me;
  if (currentRole === "reseller" && me) {
    updateQuotaCard(me.used_users ?? total, me.max_users || 0, me.used_ssh_users ?? sshUsers.length, me.used_xray_users ?? xrayClients.length);
  }
}

function updateDashboardFromUsers(users = []) {
  dashboardCache.sshUsers = users || [];
  renderDashboardCounters();
}

function updateDashboardXray(inbounds = []) {
  dashboardCache.xrayInbounds = inbounds || [];
  renderDashboardCounters();
}

function refreshDashboard() {
  loadUsersSilent();
  loadInbounds({ silent: true });
  loadXrayStatus();
  if (currentRole === "superadmin") loadStats();
  if (currentRole === "reseller") loadMe();
}

// ─── SSH Users ────────────────────────────────────────────────────────────────
document.getElementById("reloadUsersBtn").addEventListener("click", loadUsers);
newUserBtn.addEventListener("click", () => {
  setFormCollapsed(false);
  userForm.reset();
  fTotpPeriod.value = 60; fTotpWindow.value = 1; fTotpDigits.value = 6;
  userStatus.textContent = "New user.";
  fUsername.focus();
});
cancelUserBtn.addEventListener("click", () => setFormCollapsed(true));
toggleFormBtn.addEventListener("click", () => setFormCollapsed(!formCollapsed));
document.getElementById("genTotpBtn").addEventListener("click", () => {
  fTotpSecret.value = genBase32();
  if (!fTotpPeriod.value) fTotpPeriod.value = 60;
  if (!fTotpWindow.value) fTotpWindow.value = 1;
  if (!fTotpDigits.value) fTotpDigits.value = 6;
  userStatus.textContent = "TOTP secret generated.";
});
document.getElementById("clearTotpBtn").addEventListener("click", () => { fTotpSecret.value = ""; });

function setFormCollapsed(v) {
  formCollapsed = v;
  userFormWrap.classList.toggle("collapsed", v);
  toggleFormBtn.textContent = v ? "Show form" : "Hide form";
}

async function loadUsers() {
  userStatus.textContent = "Loading…";
  try {
    const res  = await api("/api/users");
    const data = await res.json();
    renderUsers(data || []);
    userStatus.textContent = "Loaded.";
    lastReload.textContent = "Last reload: " + new Date().toLocaleTimeString();
  } catch (e) {
    if (e.message==="auth") { doAuthError(); } else { userStatus.textContent = "Error loading users."; }
  }
}
async function loadUsersSilent() {
  try {
    const res  = await api("/api/users");
    const data = await res.json();
    renderUsers(data || []);
  } catch (e) {
    if (e.message==="auth") doAuthError();
  }
}

function renderUsers(users) {
  updateDashboardFromUsers(users);
  const isSA = currentRole === "superadmin";
  userCountChip.textContent = users.length;
  if (isSA) ownerColHead.classList.remove("hidden");
  usersBody.innerHTML = "";
  let online = 0;
  let expiredCount = 0;
  users.forEach(u => {
    const on = (u.active_conns || 0) > 0;
    if (on) online++;
    if (isExpiredDate(u.expires_at)) expiredCount++;
    const tr = document.createElement("tr");
    const cells = [
      u.username,
      on ? '<span class="badge-on">online</span>' : '<span class="badge-off">idle</span>',
      u.totp_enabled ? (u.allow_static_password ? "TOTP+pw" : "TOTP") : "Password",
      u.active_conns ?? 0,
      u.max_connections || 0,
      u.limit_mbps_up || 0,
      u.limit_mbps_down || 0,
      u.expires_at ? fmtDate(u.expires_at) : "—",
    ];
    if (isSA) cells.push(u.owner_username || "—");
    cells.forEach((c, i) => {
      const td = document.createElement("td");
      if (i === 1) td.innerHTML = c; else td.textContent = c;
      tr.appendChild(td);
    });
    const tdA = document.createElement("td");
    const editBtn = Object.assign(document.createElement("button"), {
      className:"btn btn-ghost btn-sm", textContent:"Edit",
      onclick: () => fillUserForm(u),
    });
    const delBtn = Object.assign(document.createElement("button"), {
      className:"btn btn-danger btn-sm", textContent:"Del",
      style: "margin-left:4px;",
      onclick: () => deleteUser(u.username),
    });
    tdA.append(editBtn, delBtn);
    tr.appendChild(tdA);
    usersBody.appendChild(tr);
  });
  const activeCount = Math.max(0, users.length - expiredCount);
  userCountChip.textContent = `${users.length} total · ${activeCount} ativas · ${online} online`;
}

function fillUserForm(u) {
  setFormCollapsed(false);
  fUsername.value       = u.username || "";
  fPassword.value       = "";
  fTotpSecret.value     = u.totp_secret || "";
  fTotpPeriod.value     = u.totp_period || 60;
  fTotpWindow.value     = u.totp_window ?? 1;
  fTotpDigits.value     = u.totp_digits || 6;
  fAllowStatic.checked  = !!u.allow_static_password;
  fMaxConn.value        = u.max_connections || "";
  fUp.value             = u.limit_mbps_up || "";
  fDown.value           = u.limit_mbps_down || "";
  fExpires.value        = u.expires_at ? localFromISO(u.expires_at) : "";
  userStatus.textContent = `Editing ${u.username}`;
}

userForm.addEventListener("submit", async e => {
  e.preventDefault();
  saveUserBtn.disabled = true;
  userStatus.textContent = "Saving…";
  const payload = {
    username: fUsername.value.trim(),
    password: fPassword.value || undefined,
    totp_secret: fTotpSecret.value.trim(),
    totp_period: parseInt(fTotpPeriod.value||"60",10),
    totp_window: parseInt(fTotpWindow.value||"1",10),
    totp_digits: parseInt(fTotpDigits.value||"6",10),
    allow_static_password: !!fAllowStatic.checked,
    max_connections: parseInt(fMaxConn.value||"0",10),
    expires_at: isoFromLocal(fExpires.value),
    limit_mbps_up:   parseInt(fUp.value||"0",10),
    limit_mbps_down: parseInt(fDown.value||"0",10),
  };
  try {
    const res = await api("/api/users/create", { method:"POST", body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(await res.text());
    userStatus.textContent = "Saved.";
    fPassword.value = "";
    loadUsers();
    if (currentRole === "reseller") loadMe();
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else userStatus.textContent = "Error: " + e.message;
  } finally {
    saveUserBtn.disabled = false;
  }
});

async function deleteUser(username) {
  if (!confirm(`Delete user "${username}"?`)) return;
  userStatus.textContent = `Deleting ${username}…`;
  try {
    const res = await api(`/api/users/delete?username=${encodeURIComponent(username)}`, { method:"DELETE" });
    if (!res.ok && res.status !== 204) throw new Error("delete failed");
    userStatus.textContent = "Deleted.";
    loadUsers();
    if (currentRole === "reseller") loadMe();
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else userStatus.textContent = "Error deleting.";
  }
}

// ─── Xray ─────────────────────────────────────────────────────────────────────
document.getElementById("xStartBtn").addEventListener("click", () => xrayCtrl("start"));
document.getElementById("xStopBtn").addEventListener("click", () => xrayCtrl("stop"));
document.getElementById("xRestartBtn").addEventListener("click", () => xrayCtrl("restart"));
document.getElementById("xRepairStatsBtn")?.addEventListener("click", repairXrayStats);
document.getElementById("xRefreshBtn").addEventListener("click", () => { loadXrayStatus(); loadInbounds({ force: true }); });
document.getElementById("xLoadInboundsBtn").addEventListener("click", () => loadInbounds({ force: true }));
document.getElementById("xLoadCfgBtn").addEventListener("click", loadXrayCfg);
document.getElementById("xSaveCfgBtn").addEventListener("click", saveXrayCfg);
document.getElementById("xLoadLogsBtn").addEventListener("click", loadXrayLogs);


async function loadXrayStatus() {
  try {
    const res = await api("/api/xray/status");
    const s   = await res.json();
    const run = !!s.running;
    xrayChip.textContent  = run ? "running" : (s.enabled ? "stopped" : "disabled");
    xrayChip.className    = "chip " + (run ? "green" : "red");
    xRunning.textContent  = run ? "Running" : "Stopped";
    xRunning.style.color  = run ? "var(--success)" : "var(--danger)";
    xPID.textContent      = s.pid    || "--";
    xUptime.textContent   = s.uptime || "--";
    const statsCfgEl = document.getElementById("xStatsConfig");
    const repairBtn = document.getElementById("xRepairStatsBtn");
    if (statsCfgEl) {
      statsCfgEl.textContent = s.stats_configured ? "OK" : "Needs repair";
      statsCfgEl.style.color = s.stats_configured ? "var(--success)" : "var(--warning)";
    }
    if (repairBtn) repairBtn.style.display = s.stats_configured ? "none" : "";
    if (xOnlineUsers) xOnlineUsers.textContent = String(s.online_users ?? 0);
    if (!s.stats_configured && xStatus) {
      const missing = Array.isArray(s.stats_missing) && s.stats_missing.length ? ` Missing: ${s.stats_missing.join(", ")}.` : "";
      xStatus.textContent = "Online counters need Stats API repair." + missing;
    } else if (s.stats_error && xStatus) {
      xStatus.textContent = "Online counters: " + s.stats_error;
    } else if (xStatus) {
      xStatus.textContent = s.api_server ? `Counters API ready at ${s.api_server}.` : "Counters API ready.";
    }
    if (dashServers) dashServers.textContent = s.enabled ? "1" : "0";
    if (dashServerStatus) dashServerStatus.textContent = run ? "1 online" : (s.enabled ? "parado" : "desativado");
    renderDashboardCounters();
    if (s.error) xStatus.textContent = "Error: " + s.error;
  } catch (e) { if (e.message==="auth") doAuthError(); }
}

async function repairXrayStats() {
  const btn = document.getElementById("xRepairStatsBtn");
  if (btn) btn.disabled = true;
  xStatus.textContent = "Checking and repairing Xray counters API…";
  try {
    const res = await api("/api/xray/stats/repair", { method:"POST" });
    if (!res.ok) throw new Error(await res.text());
    const d = await res.json().catch(() => ({}));
    xStatus.textContent = d.changed
      ? (d.restarted ? "Counters API repaired and Xray restarted." : "Counters API repaired. Restart Xray to apply it.")
      : "Counters API already looks correct.";
    setTimeout(loadXrayStatus, 700);
    setTimeout(() => loadInbounds({ force: true }), 1200);
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else xStatus.textContent = "Error repairing counters: "+e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function xrayCtrl(action) {
  xStatus.textContent = action.charAt(0).toUpperCase()+action.slice(1)+"ing Xray…";
  try {
    const res = await api(`/api/xray/${action}`, { method:"POST" });
    if (!res.ok) throw new Error(await res.text());
    xStatus.textContent = "Xray "+action+" OK.";
    setTimeout(loadXrayStatus, 700);
    setTimeout(() => loadInbounds({ force: true }), 1200);
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else xStatus.textContent = "Error: "+e.message;
  }
}

async function loadInbounds(options = {}) {
  const { silent = false, force = false } = options || {};
  if (inboundsRefreshInFlight) return;
  inboundsRefreshInFlight = true;
  if (!silent) inboundsContainer.innerHTML = '<div class="hint" style="padding:8px 0;">Loading…</div>';
  else inboundsContainer.classList.add("xray-refreshing");
  try {
    const res      = await api("/api/xray/inbounds");
    if (!res.ok) throw new Error(await res.text());
    const inbounds = await res.json();
    renderInbounds(inbounds || [], { silent, force });
  } catch (e) {
    if (!silent) inboundsContainer.textContent = "Error loading inbounds.";
    if (e.message==="auth") doAuthError();
  } finally {
    inboundsRefreshInFlight = false;
    inboundsContainer.classList.remove("xray-refreshing");
  }
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { return document.execCommand("copy"); }
  finally { document.body.removeChild(ta); }
}

function renderInbounds(inbounds, options = {}) {
  const { silent = false, force = false } = options || {};
  updateDashboardXray(inbounds);
  const nextStructure = inboundStructure(inbounds);

  if (silent && !force && nextStructure === lastInboundsStructure && patchRenderedInbounds(inbounds)) return;
  if (silent && !force && isXrayClientEditorActive()) {
    patchRenderedInbounds(inbounds);
    if (xStatus) xStatus.textContent = "New client data is available; editing was preserved.";
    return;
  }

  if (!inbounds.length) {
    inboundsContainer.innerHTML = '<div class="hint" style="padding:8px 0;">No VLESS/VMess/Trojan inbounds found.</div>';
    lastInboundsStructure = nextStructure;
    return;
  }
  inboundsContainer.innerHTML = "";
  lastInboundsStructure = nextStructure;
  inbounds.forEach(ib => {
    const section = document.createElement("div");
    section.dataset.inboundTag = String(ib.tag || "");
    section.dataset.inboundProtocol = String(ib.protocol || "");
    section.dataset.inboundPort = String(ib.port ?? "");
    section.style = "margin-bottom:14px;";

    const hdr = document.createElement("div");
    hdr.className = "card-hdr";
    hdr.style = "margin-bottom:6px;";
    const clients = ib.clients || [];
    const onlineCount = clients.filter(c => !!c.online).length;
    hdr.innerHTML = `
      <div class="card-title" style="font-size:.8rem;">
        <span class="chip">${escapeHTML(ib.protocol)}</span>
        ${escapeHTML(ib.tag || "untagged")}
        <span class="hint">:${escapeHTML(ib.port ?? "?")}</span>
        <span class="chip ${onlineCount ? "green" : ""}" data-role="inbound-online-chip">${onlineCount} online</span>
      </div>
      <button class="btn btn-sm" onclick="openAddClient('${ib.tag}')">+ Add Client</button>`;
    section.appendChild(hdr);

    // Add client mini-form (hidden by default)
    const addForm = document.createElement("div");
    addForm.id = `add-form-${ib.tag}`;
    addForm.className = "hidden";
    addForm.style = "background:rgba(15,23,42,.9);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px;";
    addForm.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr 1fr;">
        <div class="field">
          <label>UUID</label>
          <div class="field-row">
            <input id="newUUID-${ib.tag}" placeholder="auto-generate" style="border-radius:6px;"/>
            <button class="btn btn-ghost btn-sm" type="button" onclick="document.getElementById('newUUID-${ib.tag}').value=genUUID()">Gen</button>
          </div>
        </div>
        <div class="field"><label>Email / label</label><input id="newEmail-${ib.tag}" placeholder="user@example" style="border-radius:6px;"/></div>
        <div class="field"><label>Display Name</label><input id="newName-${ib.tag}" placeholder="e.g. Maykinho01" style="border-radius:6px;"/></div>
        <div class="field"><label>Expiry Date</label><input type="datetime-local" id="newExpiry-${ib.tag}" style="border-radius:6px;color-scheme:dark;"/></div>
        <div class="field"><label>Max Connections <span class="hint">(0 = unlimited)</span></label><input type="number" min="0" id="newMaxConns-${ib.tag}" placeholder="0" style="border-radius:6px;"/></div>
      </div>
      <div class="form-actions" style="margin-top:6px;">
        <button class="btn btn-sm" onclick="addClient('${ib.tag}')">Add</button>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('add-form-${ib.tag}').classList.add('hidden')">Cancel</button>
      </div>`;
    section.appendChild(addForm);

    // Clients table
    const tblWrap = document.createElement("div");
    tblWrap.className = "tbl-wrap";
    if (!clients.length) {
      tblWrap.innerHTML = '<div class="hint" style="padding:4px 0;">No clients.</div>';
    } else {
      const tbl = document.createElement("table");
      tbl.innerHTML = `<thead><tr><th>Name</th><th>UUID</th><th>Email</th><th>Expiry</th><th>Status</th><th>Online</th><th>Traffic</th><th>Max</th><th>Actions</th></tr></thead>`;
      const tbody = document.createElement("tbody");
      clients.forEach(c => {
        const tr = document.createElement("tr");
        tr.dataset.clientId = String(c.id || "");
        tr.innerHTML = `
          <td data-cell="name">${escapeHTML(c.name || "—")}</td>
          <td data-cell="uuid" style="font-family:monospace;font-size:.65rem;">${escapeHTML(c.id || "—")}</td>
          <td data-cell="email">${escapeHTML(c.email || "—")}</td>
          <td data-cell="expiry" style="font-size:.7rem;">${escapeHTML(clientExpiryLabel(c))}</td>
          <td data-cell="status">${clientStatusHTML(c)}</td>
          <td data-cell="online">${clientOnlineHTML(c)}</td>
          <td data-cell="traffic" style="font-size:.7rem;">${escapeHTML(formatBytes(c.total_bytes))}</td>
          <td data-cell="max" style="font-size:.7rem;">${escapeHTML(c.max_conns || "∞")}</td>`;
        const actTd = document.createElement("td");
        actTd.style.whiteSpace = "nowrap";
        const copyBtn = document.createElement("button");
        copyBtn.className = "btn btn-ghost btn-sm";
        copyBtn.textContent = "Copy";
        copyBtn.onclick = async () => { await copyText(c.id); xStatus.textContent = "Copied client ID."; };
        const editBtn = document.createElement("button");
        editBtn.className = "btn btn-warn btn-sm";
        editBtn.style.marginLeft = "4px";
        editBtn.textContent = "Edit";
        editBtn.onclick = () => openEditXrayClient(ib.tag, c);
        const delBtn = document.createElement("button");
        delBtn.className = "btn btn-danger btn-sm";
        delBtn.style.marginLeft = "4px";
        delBtn.textContent = "Del";
        delBtn.onclick = () => removeClient(ib.tag, c.id);
        actTd.append(copyBtn, editBtn, delBtn);
        tr.appendChild(actTd);
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);
      tblWrap.appendChild(tbl);
    }
    section.appendChild(tblWrap);

    const divider = document.createElement("hr");
    divider.style = "border:none;border-top:1px solid var(--border);margin-top:10px;";
    section.appendChild(divider);

    inboundsContainer.appendChild(section);
  });
}

function openAddClient(tag) {
  const form = document.getElementById(`add-form-${tag}`);
  if (form) { form.classList.remove("hidden"); }
  const uuidField = document.getElementById(`newUUID-${tag}`);
  if (uuidField && !uuidField.value) uuidField.value = genUUID();
}

async function addClient(tag) {
  const uuidEl     = document.getElementById(`newUUID-${tag}`);
  const emailEl    = document.getElementById(`newEmail-${tag}`);
  const nameEl     = document.getElementById(`newName-${tag}`);
  const expiryEl   = document.getElementById(`newExpiry-${tag}`);
  const maxConnsEl = document.getElementById(`newMaxConns-${tag}`);
  const uuid       = (uuidEl?.value || "").trim();
  const email      = (emailEl?.value || "").trim();
  const name       = (nameEl?.value || "").trim();
  const expiresAt  = isoFromLocal(expiryEl?.value || "");
  const maxConns   = parseInt(maxConnsEl?.value || "0", 10) || 0;
  if (!uuid) { xStatus.textContent = "UUID required."; return; }
  try {
    const res = await api("/api/xray/clients/add", {
      method: "POST",
      body: JSON.stringify({ inbound_tag: tag, uuid, email, name, expires_at: expiresAt, max_connections: maxConns }),
    });
    if (!res.ok) throw new Error(await res.text());
    xStatus.textContent = `Client ${uuid.slice(0,8)}… added. Restarting Xray…`;
    setTimeout(() => { loadInbounds({ force: true }); if (currentRole === "reseller") loadMe(); }, 1500);
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else xStatus.textContent = "Error: "+e.message;
  }
}

async function removeClient(tag, uuid) {
  if (!confirm(`Remove client ${uuid.slice(0,8)}… from ${tag}?`)) return;
  try {
    const res = await api(`/api/xray/clients/remove?inbound_tag=${encodeURIComponent(tag)}&uuid=${encodeURIComponent(uuid)}`, { method:"DELETE" });
    if (!res.ok && res.status !== 204) throw new Error(await res.text());
    xStatus.textContent = "Client removed. Restarting Xray…";
    setTimeout(() => { loadInbounds({ force: true }); if (currentRole === "reseller") loadMe(); }, 1500);
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else xStatus.textContent = "Error: "+e.message;
  }
}

async function loadXrayCfg() {
  try {
    const res  = await api("/api/xray/config");
    if (!res.ok) throw new Error(await res.text());
    const text = await res.text();
    try { xCfgEditor.value = JSON.stringify(JSON.parse(text), null, 2); }
    catch { xCfgEditor.value = text; }
    xCfgStatus.textContent = "Config loaded.";
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else xCfgStatus.textContent = "Error: "+e.message;
  }
}

async function saveXrayCfg() {
  const text = xCfgEditor.value.trim();
  try { JSON.parse(text); } catch(e) { xCfgStatus.textContent = "Invalid JSON: "+e.message; return; }
  xCfgStatus.textContent = "Saving…";
  try {
    const res = await api("/api/xray/config", { method:"POST", body: text });
    if (!res.ok) throw new Error(await res.text());
    xCfgStatus.textContent = "Saved. Restarting Xray…";
    await xrayCtrl("restart");
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else xCfgStatus.textContent = "Error: "+e.message;
  }
}

async function loadXrayLogs() {
  try {
    const res  = await api("/api/xray/logs");
    const data = await res.json();
    xLogsBox.textContent = (data.lines||[]).join("\n");
    xLogsBox.scrollTop   = xLogsBox.scrollHeight;
  } catch (e) { if (e.message==="auth") doAuthError(); }
}

// ─── Resellers ────────────────────────────────────────────────────────────────
document.getElementById("reloadResellersBtn").addEventListener("click", loadResellers);
document.getElementById("newResellerBtn").addEventListener("click", () => {
  resellerFormTitle.textContent = "Create Reseller";
  resellerForm.reset();
  rActive.checked = true;
  resellerStatus.textContent = "New reseller.";
});
document.getElementById("cancelResellerBtn").addEventListener("click", () => {
  resellerForm.reset();
  rActive.checked = true;
  resellerFormTitle.textContent = "Create Reseller";
});

document.querySelector("[data-tab='resellers']")?.addEventListener("click", loadResellers);

async function loadResellers() {
  resellerStatus.textContent = "Loading…";
  try {
    const res  = await api("/api/resellers");
    const data = await res.json();
    renderResellers(data || []);
    resellerStatus.textContent = "Loaded.";
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else resellerStatus.textContent = "Error loading.";
  }
}

function renderResellers(list) {
  resellerCountChip.textContent = list.length;
  resellersBody.innerHTML = "";
  list.forEach(r => {
    const expired = r.expires_at && new Date(r.expires_at) < new Date();
    const max = r.max_users || 0;
    const used = r.used_users || 0;
    const remaining = max ? Math.max(0, max - used) : "∞";
    const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.username}</td>
      <td>
        <strong>${used} / ${max || "∞"}</strong>
        <div class="hint">Disponível ${remaining} · SSH ${r.used_ssh_users || 0} · Xray ${r.used_xray_users || 0}</div>
        <div class="table-meter"><span style="width:${pct}%"></span></div>
      </td>
      <td>${r.expires_at ? fmtDate(r.expires_at) : "—"}</td>
      <td><span class="${r.is_active && !expired ? 'badge-on' : 'badge-off'}">${r.is_active && !expired ? "Active" : expired ? "Expired" : "Suspended"}</span></td>
      <td></td>`;
    const tdA = tr.lastElementChild;
    const editBtn = Object.assign(document.createElement("button"),{
      className:"btn btn-ghost btn-sm", textContent:"Edit",
      onclick: () => fillResellerForm(r),
    });
    const delBtn = Object.assign(document.createElement("button"),{
      className:"btn btn-danger btn-sm", textContent:"Del",
      style: "margin-left:4px;",
      onclick: () => deleteReseller(r.username),
    });
    tdA.append(editBtn, delBtn);
    resellersBody.appendChild(tr);
  });
}

function fillResellerForm(r) {
  resellerFormTitle.textContent = `Edit: ${r.username}`;
  rUsername.value  = r.username;
  rPassword.value  = "";
  rMaxUsers.value  = r.max_users || 0;
  rExpires.value   = r.expires_at ? localFromISO(r.expires_at) : "";
  rActive.checked  = r.is_active;
  resellerStatus.textContent = `Editing ${r.username}.`;
}

resellerForm.addEventListener("submit", async e => {
  e.preventDefault();
  const btn = document.getElementById("saveResellerBtn");
  btn.disabled = true;
  resellerStatus.textContent = "Saving…";
  const payload = {
    username:   rUsername.value.trim(),
    password:   rPassword.value || undefined,
    max_users:  parseInt(rMaxUsers.value||"0",10),
    expires_at: isoFromLocal(rExpires.value),
    is_active:  rActive.checked,
  };
  try {
    const res = await api("/api/resellers/create", { method:"POST", body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(await res.text());
    resellerStatus.textContent = "Saved.";
    resellerForm.reset(); rActive.checked = true;
    resellerFormTitle.textContent = "Create Reseller";
    loadResellers();
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else resellerStatus.textContent = "Error: "+e.message;
  } finally { btn.disabled = false; }
});

async function deleteReseller(username) {
  if (!confirm(`Delete reseller "${username}"? All their SSH sessions will be disconnected.`)) return;
  resellerStatus.textContent = `Deleting ${username}…`;
  try {
    const res = await api(`/api/resellers/delete?username=${encodeURIComponent(username)}`, { method:"DELETE" });
    if (!res.ok && res.status !== 204) throw new Error("failed");
    resellerStatus.textContent = "Deleted.";
    loadResellers();
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else resellerStatus.textContent = "Error deleting.";
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
document.querySelector("[data-tab='stats']")?.addEventListener("click", loadStats);

async function loadDashboardStats() {
  try {
    const res = await api("/api/stats");
    if (!res.ok) throw new Error(await res.text());
    const s = await res.json();
    updateDashboardStats(s);
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else {
      if (dashCpuVal) dashCpuVal.textContent = "erro";
      if (dashRamVal) dashRamVal.textContent = "erro";
      if (dashNetVal) dashNetVal.textContent = "erro";
    }
  }
}

function updateDashboardStats(s) {
  if (!s) return;
  const cpu = Number(s.cpu_percent ?? 0);
  const mem = s.mem_percent == null ? null : Number(s.mem_percent);
  if (dashCpuVal) dashCpuVal.textContent = fmtPct(cpu);
  if (dashCpuBar) dashCpuBar.style.width = Math.min(100, Math.max(0, cpu)) + "%";
  if (dashCpuText) dashCpuText.textContent = cpu >= 85 ? "Carga alta" : cpu >= 60 ? "Carga moderada" : "Carga normal";
  if (dashRamVal) dashRamVal.textContent = mem == null ? "--%" : fmtPct(mem);
  if (dashRamBar) dashRamBar.style.width = mem == null ? "0%" : Math.min(100, Math.max(0, mem)) + "%";
  if (dashRamText) {
    const used = s.mem_used_bytes, total = s.mem_total_bytes;
    dashRamText.textContent = used != null && total != null ? `${fmtBytes(used)} / ${fmtBytes(total)}` : "Memória usada";
  }
  const ifaces = Array.isArray(s.interfaces) ? s.interfaces : [];
  let rx = 0, tx = 0, rxTotal = 0, txTotal = 0;
  ifaces.forEach(it => {
    rx += Number(it.rx_mbps || 0);
    tx += Number(it.tx_mbps || 0);
    rxTotal += Number(it.rx_bytes || 0);
    txTotal += Number(it.tx_bytes || 0);
  });
  if (dashNetVal) dashNetVal.textContent = `${fmtMbps(rx + tx)} Mb/s`;
  if (dashNetText) dashNetText.textContent = `RX ${fmtMbps(rx)} · TX ${fmtMbps(tx)} Mb/s`;
  if (dashNetTotal) dashNetTotal.textContent = `Total ${fmtBytes(rxTotal + txTotal)}`;
}

async function loadStats() {
  try {
    const res = await api("/api/stats");
    if (!res.ok) throw new Error(await res.text());
    const s   = await res.json();
    updateDashboardStats(s);
    const cpu = Number(s?.cpu_percent ?? 0);
    if (cpuVal) cpuVal.textContent = fmtPct(cpu);
    if (cpuBar) cpuBar.style.width = Math.min(100, Math.max(0, cpu)) + "%";
    const mp  = s?.mem_percent == null ? null : Number(s.mem_percent);
    if (memVal) memVal.textContent = mp == null ? "--%"  : fmtPct(mp);
    if (memBar) memBar.style.width = mp == null ? "0%"   : Math.min(100, Math.max(0, mp)) + "%";
    const mu = s?.mem_used_bytes, mt = s?.mem_total_bytes;
    if (memDetail) memDetail.textContent = (mu != null && mt != null) ? `${fmtBytes(mu)} / ${fmtBytes(mt)}` : "";
    const ifaces = Array.isArray(s.interfaces) ? s.interfaces : [];
    if (ifaceBody) ifaceBody.innerHTML = "";
    let totRx = 0, totTx = 0;
    ifaces.forEach(it => {
      totRx += Number(it.rx_bytes||0); totTx += Number(it.tx_bytes||0);
      if (!ifaceBody) return;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${it.name}</td><td>${fmtMbps(it.rx_mbps)}</td><td>${fmtMbps(it.tx_mbps)}</td><td>${fmtBytes(it.rx_bytes)}</td><td>${fmtBytes(it.tx_bytes)}</td>`;
      ifaceBody.appendChild(tr);
    });
    if (ifaceSummary) ifaceSummary.textContent = `Total: ${fmtBytes(totRx)} rx / ${fmtBytes(totTx)} tx`;
    if (statsUpdated) statsUpdated.textContent = "Updated: " + new Date().toLocaleTimeString();
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else if (statsUpdated) statsUpdated.textContent = "Erro ao carregar stats.";
  }
}

resetIfaceStatsBtn?.addEventListener("click", resetInterfaceStats);

async function resetInterfaceStats() {
  if (!confirm("Clean the live Interface totals now? This does not delete VnStat daily/monthly history.")) return;
  resetIfaceStatsBtn.disabled = true;
  ifaceSummary.textContent = "Cleaning interface totals…";
  try {
    const res = await api("/api/stats/interfaces/reset", { method:"POST" });
    if (!res.ok) throw new Error(await res.text());
    ifaceSummary.textContent = "Interface totals cleaned. Auto-clean remains every 30 days.";
    loadStats();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else ifaceSummary.textContent = "Error cleaning totals: " + e.message;
  } finally {
    resetIfaceStatsBtn.disabled = false;
  }
}

// ─── VnStat ───────────────────────────────────────────────────────────────────
document.querySelector("[data-tab='vnstat']")?.addEventListener("click", loadVnstat);
reloadVnstatBtn?.addEventListener("click", loadVnstat);
resetVnstatBtn?.addEventListener("click", resetVnstatHistory);

function renderVnstatRows(body, rows, emptyLabel) {
  body.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" class="hint">${emptyLabel}</td>`;
    body.appendChild(tr);
    return;
  }
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.period || "--"}</td><td>${r.iface || "--"}</td><td>${fmtBytes(r.rx_bytes||0)}</td><td>${fmtBytes(r.tx_bytes||0)}</td><td>${fmtBytes(r.total_bytes||((r.rx_bytes||0)+(r.tx_bytes||0)))}</td>`;
    body.appendChild(tr);
  });
}

async function loadVnstat() {
  vnstatStatus.textContent = "Loading VnStat usage…";
  try {
    const res = await api("/api/vnstat?days=31&months=12");
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const daily = Array.isArray(data.daily) ? data.daily : [];
    const monthly = Array.isArray(data.monthly) ? data.monthly : [];
    renderVnstatRows(vnstatDailyBody, daily, "No daily usage recorded yet.");
    renderVnstatRows(vnstatMonthlyBody, monthly, "No monthly usage recorded yet.");

    // Use the server/database periods when available. Falling back to the
    // newest row avoids browser UTC/local-time mismatches that can make
    // "Today total" show 0 while the daily table has data.
    const today = data.today_period || daily[0]?.period || localDateKey();
    const month = data.month_period || today.slice(0,7);
    const todayTotal = data.today_total_bytes ?? daily.filter(r => r.period === today).reduce((sum, r) => sum + (r.total_bytes||0), 0);
    const monthTotal = data.month_total_bytes ?? monthly.filter(r => r.period === month).reduce((sum, r) => sum + (r.total_bytes||0), 0);
    const ifaces = new Set([...daily, ...monthly].map(r => r.iface).filter(Boolean));
    vnTodayTotal.textContent = fmtBytes(todayTotal);
    vnMonthTotal.textContent = fmtBytes(monthTotal);
    vnIfaceCount.textContent = String(data.interface_count ?? ifaces.size ?? 0);
    vnstatStatus.textContent = "Updated: " + new Date().toLocaleTimeString() + " · history is kept until manually cleaned.";
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else vnstatStatus.textContent = "Error loading VnStat usage: " + e.message;
  }
}

async function resetVnstatHistory() {
  if (!confirm("Clean all VnStat daily/monthly usage history? This does not reset the live Interface totals.")) return;
  resetVnstatBtn.disabled = true;
  vnstatStatus.textContent = "Cleaning VnStat history…";
  try {
    const res = await api("/api/vnstat/reset", { method:"POST" });
    if (!res.ok) throw new Error(await res.text());
    vnstatStatus.textContent = "VnStat history cleaned.";
    loadVnstat();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else vnstatStatus.textContent = "Error cleaning VnStat history: " + e.message;
  } finally {
    resetVnstatBtn.disabled = false;
  }
}

// ─── Logs ─────────────────────────────────────────────────────────────────────
document.querySelector("[data-tab='logs']")?.addEventListener("click", loadSystemLogs);
document.getElementById("logSource")?.addEventListener("change", loadSystemLogs);
document.getElementById("clearPanelLogBtn")?.addEventListener("click", clearPanelLog);

async function loadSystemLogs() {
  const box = document.getElementById("systemLogBox");
  const st = document.getElementById("systemLogStatus");
  const source = document.getElementById("logSource")?.value || "panel";
  const clearBtn = document.getElementById("clearPanelLogBtn");
  if (clearBtn) clearBtn.disabled = source !== "panel";
  st.textContent = "Loading…";
  try {
    const res = await api(`/api/system/logs?source=${encodeURIComponent(source)}&lines=500`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const lines = Array.isArray(data.lines) ? data.lines : [];
    box.textContent = lines.length ? lines.join("\n") : "No log lines yet.";
    box.scrollTop = box.scrollHeight;
    st.textContent = `${data.source || source} logs${data.path ? " · " + data.path : ""} · ${lines.length} lines · ` + new Date().toLocaleTimeString();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else st.textContent = "Error: " + e.message;
  }
}

async function clearPanelLog() {
  const st = document.getElementById("systemLogStatus");
  if (!confirm("Clean the panel log now? Logs are already auto-cleaned after 1 MiB.")) return;
  st.textContent = "Cleaning panel log…";
  try {
    const res = await api("/api/system/logs/reset", { method:"POST" });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    st.textContent = `Panel log cleaned · ${data.path || "panel.log"} · max ${fmtBytes(data.max_bytes || 1048576)}`;
    await loadSystemLogs();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else st.textContent = "Error cleaning panel log: " + e.message;
  }
}

// ─── Server Config ────────────────────────────────────────────────────────────
document.querySelector("[data-tab='server']")?.addEventListener("click", loadServerConfig);

function toggleDnsttFields(on) {
  const el = document.getElementById("dnsttFields");
  el.style.opacity = on ? "1" : ".4";
  el.style.pointerEvents = on ? "" : "none";
}
function toggleUdpgwFields(on) {
  const el = document.getElementById("udpgwFields");
  el.style.opacity = on ? "1" : ".4";
  el.style.pointerEvents = on ? "" : "none";
}

async function loadServerConfig() {
  const st = document.getElementById("srvCfgStatus");
  st.textContent = "Loading…";
  try {
    const res = await api("/api/server/config");
    if (!res.ok) throw new Error(await res.text());
    const c = await res.json();

    // Network
    document.getElementById("cfgListen").value       = c.listen || "";
    document.getElementById("cfgExtraListen").value  = (c.extra_listen || []).join("\n");

    // SSH / general
    document.getElementById("cfgLimitUp").value      = c.default_limit_mbps_up || 0;
    document.getElementById("cfgLimitDown").value    = c.default_limit_mbps_down || 0;
    document.getElementById("cfgQuiet").checked      = !!c.quiet;
    document.getElementById("cfgUserCount").checked  = !!c.user_count;

    // Banner
    document.getElementById("cfgBanner").value       = c.banner || "";

    // DNSTT
    const hasDnstt = !!c.dnstt;
    document.getElementById("cfgDnsttEnabled").checked = hasDnstt;
    toggleDnsttFields(hasDnstt);
    const d = c.dnstt || {};
    document.getElementById("cfgDnsttDomain").value    = d.domain || "";
    document.getElementById("cfgDnsttUDP").value       = d.udp_listen || "";
    document.getElementById("cfgDnsttKey").value       = d.privkey_file || "/opt/sshpanel/dnstt.key";
    document.getElementById("cfgDnsttNoStats").checked = !!d.disable_stats_log;
    document.getElementById("cfgDnsttNoConsole").checked = !!d.disable_console_log;

    // UDPGW
    const hasUdpgw = !!c.udpgw;
    document.getElementById("cfgUdpgwEnabled").checked = hasUdpgw;
    toggleUdpgwFields(hasUdpgw);
    const u = c.udpgw || {};
    document.getElementById("cfgUdpgwListen").value    = u.listen || "";
    document.getElementById("cfgUdpgwMaxConns").value  = u.max_client_conns || 0;
    document.getElementById("cfgUdpgwIdle").value      = u.idle_timeout || "";
    document.getElementById("cfgUdpgwMapTTL").value    = u.map_ttl || "";
    document.getElementById("cfgUdpgwDebug").checked   = !!u.debug;

    // TLS forwarders
    tlsForwardersState = c.tls_forwarders || [];
    renderTLSForwarders();

    // Xray
    const x = c.xray || {};
    document.getElementById("cfgXrayEnabled").checked = !!x.enabled;

    st.textContent = "Config loaded.";
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else st.textContent = "Error: " + e.message;
  }
}

async function saveServerConfig() {
  const st = document.getElementById("srvCfgStatus");
  st.textContent = "Saving…";

  const tlsArr = tlsForwardersState;

  const extraLines = document.getElementById("cfgExtraListen").value
    .split("\n").map(s => s.trim()).filter(Boolean);

  const cfg = {
    listen:               document.getElementById("cfgListen").value.trim(),
    extra_listen:         extraLines,
    host_key_file:        "/opt/sshpanel/ssh_host_rsa_key",
    admin_dir:            "/opt/sshpanel/admin",
    default_limit_mbps_up:   parseInt(document.getElementById("cfgLimitUp").value  || "0", 10),
    default_limit_mbps_down: parseInt(document.getElementById("cfgLimitDown").value || "0", 10),
    quiet:      document.getElementById("cfgQuiet").checked,
    user_count: document.getElementById("cfgUserCount").checked,
    banner:      document.getElementById("cfgBanner").value,
    banner_file: "/opt/sshpanel/banner.txt",
    dnstt: document.getElementById("cfgDnsttEnabled").checked ? {
      domain:              document.getElementById("cfgDnsttDomain").value.trim(),
      udp_listen:          document.getElementById("cfgDnsttUDP").value.trim(),
      privkey_file:        document.getElementById("cfgDnsttKey").value.trim(),
      disable_stats_log:   document.getElementById("cfgDnsttNoStats").checked,
      disable_console_log: document.getElementById("cfgDnsttNoConsole").checked,
    } : null,
    udpgw: document.getElementById("cfgUdpgwEnabled").checked ? {
      listen:          document.getElementById("cfgUdpgwListen").value.trim(),
      max_client_conns: parseInt(document.getElementById("cfgUdpgwMaxConns").value || "0", 10),
      idle_timeout:    document.getElementById("cfgUdpgwIdle").value.trim(),
      map_ttl:         document.getElementById("cfgUdpgwMapTTL").value.trim(),
      debug:           document.getElementById("cfgUdpgwDebug").checked,
    } : null,
    tls_forwarders: tlsArr,
    xray: {
      enabled:     document.getElementById("cfgXrayEnabled").checked,
      bin_path:    "/opt/sshpanel/xray",
      config_file: "/opt/sshpanel/xray_config.json",
      api_server:  "127.0.0.1:10085",
      online_window_seconds: 90,
      stats_poll_seconds: 15,
    },
  };

  try {
    const res = await api("/api/server/config", { method: "POST", body: JSON.stringify(cfg) });
    if (!res.ok) throw new Error(await res.text());
    const report = await res.json().catch(() => null);
    const warnings = report?.warnings || [];
    const bad = Object.entries(report?.services || {}).filter(([_, v]) => v?.enabled && !v?.running);
    if (warnings.length || bad.length) {
      const badText = bad.map(([name, v]) => `${name}: ${v.error || "not running"}`).join(" | ");
      st.textContent = "Saved live with warnings: " + [...warnings, badText].filter(Boolean).join(" | ");
    } else {
      st.textContent = "Saved and applied live.";
    }
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else st.textContent = "Error: " + e.message;
  }
}

// ─── TLS Forwarders ────────────────────────────────────────────────────────────
function renderTLSForwarders() {
  const list = document.getElementById("tlsForwardersList");
  const chip = document.getElementById("tlsCountChip");
  if (!list) return;
  chip.textContent = tlsForwardersState.length;
  if (!tlsForwardersState.length) {
    list.innerHTML = '<div class="hint" style="padding:4px 0;">No TLS forwarders configured.</div>';
    return;
  }
  list.innerHTML = "";
  tlsForwardersState.forEach((fw, i) => {
    const row = document.createElement("div");
    row.style = "display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:.73rem;";
    row.innerHTML = `<span style="flex:1;font-family:monospace;">${fw.listen}</span>
      <span class="hint">${fw.cert_file ? fw.cert_file.split("/").pop() : "no cert"}</span>`;
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.textContent = "Remove";
    delBtn.onclick = () => { tlsForwardersState.splice(i,1); renderTLSForwarders(); };
    row.appendChild(delBtn);
    list.appendChild(row);
  });
}

function toggleAddTLSForm() {
  const panel = document.getElementById("addTLSPanel");
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) {
    document.getElementById("tlsAddStatus").textContent = "";
    document.getElementById("tlsListenAddr").value = "";
    document.getElementById("tlsSSLDomain").value = "";
    document.getElementById("tlsCertType").value = "selfsigned";
    onTLSTypeChange("selfsigned");
  }
}

function onTLSTypeChange(val) {
  document.getElementById("tlsSSFields").style.display     = val === "selfsigned"  ? "" : "none";
  document.getElementById("tlsLEFields").style.display     = val === "letsencrypt" ? "grid" : "none";
  document.getElementById("tlsPasteFields").style.display  = val === "paste"       ? "" : "none";
  document.getElementById("tlsCustomFields").style.display = val === "custom"      ? "grid" : "none";
}

async function addTLSForwarder() {
  const st = document.getElementById("tlsAddStatus");
  const listen   = document.getElementById("tlsListenAddr").value.trim();
  const certType = document.getElementById("tlsCertType").value;
  if (!listen) { st.textContent = "Listen address required."; return; }
  let certFile = "", keyFile = "";
  st.textContent = "Processing…";
  if (certType === "selfsigned") {
    const domain = document.getElementById("tlsSSLDomain").value.trim();
    if (!domain) { st.textContent = "Domain required."; return; }
    try {
      const res = await api("/api/tls/generate-selfsigned", { method:"POST", body: JSON.stringify({ domain }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      certFile = data.cert_file; keyFile = data.key_file;
      st.textContent = "Self-signed cert generated.";
    } catch (e) {
      if (e.message==="auth") doAuthError();
      else st.textContent = "Cert error: " + e.message;
      return;
    }
  } else if (certType === "letsencrypt") {
    const domain = document.getElementById("tlsLEDomain").value.trim();
    const email  = document.getElementById("tlsLEEmail").value.trim();
    if (!domain || !email) { st.textContent = "Domain and email required."; return; }
    st.textContent = "Running certbot… (may take ~30s)";
    try {
      const res = await api("/api/tls/letsencrypt", { method:"POST", body: JSON.stringify({ domain, email }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      certFile = data.cert_file; keyFile = data.key_file;
      st.textContent = "Let's Encrypt cert issued.";
    } catch (e) {
      if (e.message==="auth") doAuthError();
      else st.textContent = "certbot error: " + e.message;
      return;
    }
  } else if (certType === "paste") {
    const name = document.getElementById("tlsPasteName").value.trim();
    const cert = document.getElementById("tlsPasteCert").value.trim();
    const key  = document.getElementById("tlsPasteKey").value.trim();
    if (!name || !cert || !key) { st.textContent = "Name, cert PEM, and key PEM required."; return; }
    try {
      const res = await api("/api/tls/upload-pem", { method:"POST", body: JSON.stringify({ name, cert, key }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      certFile = data.cert_file; keyFile = data.key_file;
      st.textContent = "PEM saved.";
    } catch (e) {
      if (e.message==="auth") doAuthError();
      else st.textContent = "Upload error: " + e.message;
      return;
    }
  } else {
    certFile = document.getElementById("tlsCustomCert").value.trim();
    keyFile  = document.getElementById("tlsCustomKey").value.trim();
    if (!certFile || !keyFile) { st.textContent = "Cert and key paths required."; return; }
  }
  tlsForwardersState.push({ listen, cert_file: certFile, key_file: keyFile });
  renderTLSForwarders();
  document.getElementById("addTLSPanel").classList.add("hidden");
  st.textContent = "Added. Save config to apply.";
}

// ─── Xray wizard cert source picker ──────────────────────────────────────────
function setWzCertSrc(mode) {
  ["file","paste","gen"].forEach(m => {
    const cap = m.charAt(0).toUpperCase() + m.slice(1);
    document.getElementById("wzCertSrc"+cap).style.display = m === mode ? "" : "none";
    const btn = document.getElementById("wzCertSrc"+cap+"Btn");
    if (btn) btn.className = (m === mode ? "btn btn-sm" : "btn btn-ghost btn-sm");
  });
  document.getElementById("wzPasteCertStatus").textContent = "";
  document.getElementById("wzGenCertStatus").textContent   = "";
}

async function wzSavePastedCert() {
  const st   = document.getElementById("wzPasteCertStatus");
  const name = document.getElementById("wzPastedName").value.trim();
  const cert = document.getElementById("wzPastedCert").value.trim();
  const key  = document.getElementById("wzPastedKey").value.trim();
  if (!name || !cert || !key) { st.textContent = "Name, cert, and key required."; return; }
  st.textContent = "Saving…";
  try {
    const res = await api("/api/tls/upload-pem", { method:"POST", body: JSON.stringify({ name, cert, key }) });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    document.getElementById("wzTLSCert").value = data.cert_file;
    document.getElementById("wzTLSKey").value  = data.key_file;
    st.textContent = "Saved ✓ paths set.";
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else st.textContent = "Error: " + e.message;
  }
}

async function wzGenerateCert() {
  const st     = document.getElementById("wzGenCertStatus");
  const domain = document.getElementById("wzGenDomain").value.trim();
  if (!domain) { st.textContent = "Domain required."; return; }
  st.textContent = "Generating…";
  try {
    const res = await api("/api/tls/generate-selfsigned", { method:"POST", body: JSON.stringify({ domain }) });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    document.getElementById("wzTLSCert").value = data.cert_file;
    document.getElementById("wzTLSKey").value  = data.key_file;
    st.textContent = "Generated ✓ paths set.";
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else st.textContent = "Error: " + e.message;
  }
}

// ─── DNSTT Key Management ─────────────────────────────────────────────────────
async function generateDnsttKey() {
  const st = document.getElementById("dnsttKeyStatus");
  st.textContent = "Generating key…";
  try {
    const res = await api("/api/dnstt/genkey", { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    document.getElementById("cfgDnsttKey").value = data.privkey_file;
    document.getElementById("dnsttPubkeyVal").value = data.pubkey;
    document.getElementById("dnsttPubkeyWrap").classList.remove("hidden");
    st.textContent = "Key generated. Save config to apply.";
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else st.textContent = "Error: " + e.message;
  }
}

async function loadDnsttPubkey() {
  const st = document.getElementById("dnsttKeyStatus");
  st.textContent = "Loading public key…";
  try {
    const res = await api("/api/dnstt/pubkey");
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    document.getElementById("dnsttPubkeyVal").value = data.pubkey;
    document.getElementById("dnsttPubkeyWrap").classList.remove("hidden");
    st.textContent = "";
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else st.textContent = "Error: " + e.message;
  }
}

// ─── Xray Client Edit ─────────────────────────────────────────────────────────
function openEditXrayClient(tag, client) {
  editingXrayClientId = client.id;
  document.getElementById("editClientUUID").textContent = client.id;
  document.getElementById("editXrayName").value    = client.name  || "";
  document.getElementById("editXrayEmail").value   = client.email || "";
  document.getElementById("editXrayExpiry").value  = client.expires_at ? localFromISO(client.expires_at) : "";
  document.getElementById("editXrayMaxConns").value = client.max_conns || 0;
  document.getElementById("editXrayClientStatus").textContent = "";
  document.getElementById("editXrayClientPanel").classList.remove("hidden");
  document.getElementById("editXrayClientPanel").scrollIntoView({ behavior:"smooth", block:"nearest" });
}

function closeEditXrayClient() {
  editingXrayClientId = null;
  document.getElementById("editXrayClientPanel").classList.add("hidden");
}

async function saveEditXrayClient() {
  if (!editingXrayClientId) return;
  const st = document.getElementById("editXrayClientStatus");
  st.textContent = "Saving…";
  const payload = {
    uuid:            editingXrayClientId,
    name:            document.getElementById("editXrayName").value.trim(),
    email:           document.getElementById("editXrayEmail").value.trim(),
    expires_at:      isoFromLocal(document.getElementById("editXrayExpiry").value),
    max_connections: parseInt(document.getElementById("editXrayMaxConns").value || "0", 10),
  };
  try {
    const res = await api("/api/xray/clients/update", { method:"POST", body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(await res.text());
    st.textContent = "Saved.";
    setTimeout(() => { closeEditXrayClient(); loadInbounds({ force: true }); }, 700);
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else st.textContent = "Error: " + e.message;
  }
}

// ─── Xray Config Wizard ────────────────────────────────────────────────────────
function setXrayCfgMode(mode) {
  const wizPane  = document.getElementById("xrayWizardPane");
  const jsonPane = document.getElementById("xrayCfgPaneJson");
  const wizBtn   = document.getElementById("xrayWizardTabBtn");
  const jsonBtn  = document.getElementById("xrayJsonTabBtn");
  if (mode === "wizard") {
    wizPane.classList.remove("hidden");
    jsonPane.classList.add("hidden");
    wizBtn.classList.remove("btn-ghost");
    jsonBtn.classList.add("btn-ghost");
    loadWizardFromConfig();
  } else {
    wizPane.classList.add("hidden");
    jsonPane.classList.remove("hidden");
    jsonBtn.classList.remove("btn-ghost");
    wizBtn.classList.add("btn-ghost");
    loadXrayCfg();
  }
}

function loadWizardFromConfig() {
  api("/api/xray/config").then(async res => {
    if (!res.ok) return;
    try {
      const cfg = JSON.parse(await res.text());
      document.getElementById("wzLogLevel").value = cfg.log?.loglevel || "warning";
      wzInbounds = (cfg.inbounds || []).filter(ib => ib.tag !== "api");
      renderWzInbounds();
    } catch {}
  }).catch(() => {});
}

function renderWzInbounds() {
  const list = document.getElementById("wzInboundsList");
  if (!list) return;
  if (!wzInbounds.length) {
    list.innerHTML = '<div class="hint" style="padding:4px 0;">No inbounds. Click + Add to create one.</div>';
    return;
  }
  list.innerHTML = "";
  wzInbounds.forEach((ib, i) => {
    const row = document.createElement("div");
    row.style = "display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:.73rem;";
    const portStr = ib.port !== undefined ? `:${ib.port}` : "";
    const ss  = ib.streamSettings || {};
    const net = ss.network || "";
    const sec = ss.security || "";
    const secLabel = sec === "tls" ? " TLS" : sec === "reality" ? " Reality" : "";
    const modeLabel = net === "xhttp" && ss.xhttpSettings?.mode ? " ("+ss.xhttpSettings.mode+")" : "";
    row.innerHTML = `<span class="chip">${ib.protocol}</span>
      <span style="font-family:monospace;">${ib.tag||"untagged"}${portStr}</span>
      <span class="hint" style="flex:1;">${ib.listen||"0.0.0.0"}${net?" · "+net:""}${modeLabel}${secLabel}</span>`;
    const clients = ib.settings?.clients;
    if (Array.isArray(clients) && clients.length) {
      const badge = document.createElement("span");
      badge.className = "chip green";
      badge.textContent = clients.length + " client" + (clients.length!==1?"s":"");
      row.appendChild(badge);
    }
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.textContent = "Remove";
    delBtn.onclick = () => { wzInbounds.splice(i,1); renderWzInbounds(); };
    row.appendChild(delBtn);
    list.appendChild(row);
  });
}

function wzToggleAddInbound() {
  const form = document.getElementById("wzAddInboundForm");
  form.classList.toggle("hidden");
  if (!form.classList.contains("hidden")) {
    onWzProtoChange(document.getElementById("wzProtocol").value);
    onWzNetworkChange(document.getElementById("wzNetwork").value);
    onWzTLSChange(document.getElementById("wzTLS").value);
  }
}

function onWzProtoChange(val) {
  const usesClientTransport = val === "vless" || val === "vmess";
  document.getElementById("wzVlessFields").style.display   = usesClientTransport    ? "grid" : "none";
  document.getElementById("wzTrojanFields").style.display  = val === "trojan"       ? "" : "none";
  document.getElementById("wzSSFields").style.display      = val === "shadowsocks"  ? "grid" : "none";

  const tlsSel = document.getElementById("wzTLS");
  const realityOpt = document.querySelector("#wzTLS option[value='reality']");
  if (realityOpt) {
    realityOpt.disabled = val === "vmess";
    if (val === "vmess" && tlsSel.value === "reality") {
      tlsSel.value = "none";
      onWzTLSChange("none");
    }
  }

  const portMap = { vless:10086, vmess:10087, trojan:8443, shadowsocks:8388, socks:10808 };
  const tagMap  = { vless:"vless-in", vmess:"vmess-in", trojan:"trojan-in", shadowsocks:"ss-in", socks:"socks-local" };
  const portEl = document.getElementById("wzPort");
  const tagEl  = document.getElementById("wzTag");
  const lisEl  = document.getElementById("wzListenIP");
  const knownPorts = Object.values(portMap).map(String);
  const knownTags  = Object.values(tagMap);
  if (!portEl.value || knownPorts.includes(portEl.value)) portEl.value = portMap[val] || "";
  if (!tagEl.value || knownTags.includes(tagEl.value))     tagEl.value  = tagMap[val]  || val+"-in";
  if (!lisEl.value || lisEl.value === "0.0.0.0" || lisEl.value === "127.0.0.1") {
    lisEl.value = val === "socks" ? "127.0.0.1" : "0.0.0.0";
  }
}

function onWzNetworkChange(val) {
  const show = (id, v) => document.getElementById(id).style.display = v ? "" : "none";
  // WebSocket
  show("wzWSPathField",      val === "ws");
  // XHTTP
  show("wzXHTTPPathField",   val === "xhttp");
  show("wzXHTTPHostField",   val === "xhttp");
  show("wzXHTTPModeField",   val === "xhttp");
  // HTTPUpgrade
  show("wzHUPathField",      val === "httpupgrade");
  show("wzHUHostField",      val === "httpupgrade");
  // H2
  show("wzH2PathField",      val === "h2");
  show("wzH2HostField",      val === "h2");
  // gRPC
  show("wzGRPCServiceField", val === "grpc");
  show("wzGRPCMultiField",   val === "grpc");
  // Auto-select TLS defaults
  const tlsSel = document.getElementById("wzTLS");
  if ((val === "h2" || val === "grpc") && tlsSel.value === "none") {
    tlsSel.value = "tls"; onWzTLSChange("tls");
  }
}

function onWzTLSChange(val) {
  const show = (id, v) => document.getElementById(id).style.display = v ? "" : "none";
  show("wzTLSCertBlock",       val === "tls");
  show("wzRealityDestField",   val === "reality");
  show("wzRealitySNIField",    val === "reality");
  show("wzRealityPrivField",   val === "reality");
  show("wzRealityShortIDField",val === "reality");
}

function wzSaveInbound() {
  const proto  = document.getElementById("wzProtocol").value;
  const port   = parseInt(document.getElementById("wzPort").value || "0", 10);
  const listen = document.getElementById("wzListenIP").value.trim() || "0.0.0.0";
  const tag    = document.getElementById("wzTag").value.trim() || proto+"-in";
  if (!port) { alert("Port required."); return; }
  const ib = { tag, port, listen, protocol: proto, settings: {} };
  if (proto === "vless" || proto === "vmess") {
    ib.settings = proto === "vless" ? { clients: [], decryption: "none" } : { clients: [] };
    const net    = document.getElementById("wzNetwork").value;
    const tlsVal = document.getElementById("wzTLS").value;
    ib.streamSettings = { network: net };
    // Transport-specific settings
    switch (net) {
      case "ws":
        ib.streamSettings.wsSettings = { path: document.getElementById("wzWSPath").value.trim() || "/" };
        break;
      case "xhttp":
        ib.streamSettings.xhttpSettings = {
          path: document.getElementById("wzXHTTPPath").value.trim() || "/",
          host: document.getElementById("wzXHTTPHost").value.trim() || undefined,
          mode: document.getElementById("wzXHTTPMode").value,
        };
        if (!ib.streamSettings.xhttpSettings.host) delete ib.streamSettings.xhttpSettings.host;
        break;
      case "httpupgrade":
        ib.streamSettings.httpupgradeSettings = {
          path: document.getElementById("wzHUPath").value.trim() || "/",
          host: document.getElementById("wzHUHost").value.trim() || undefined,
        };
        if (!ib.streamSettings.httpupgradeSettings.host) delete ib.streamSettings.httpupgradeSettings.host;
        break;
      case "h2":
        ib.streamSettings.httpSettings = {
          path: document.getElementById("wzH2Path").value.trim() || "/",
          host: [document.getElementById("wzH2Host").value.trim()].filter(Boolean),
        };
        break;
      case "grpc":
        ib.streamSettings.grpcSettings = {
          serviceName: document.getElementById("wzGRPCService").value.trim() || "grpc",
          multiMode:   document.getElementById("wzGRPCMulti").checked,
        };
        break;
    }
    // TLS / Reality
    if (tlsVal === "tls") {
      ib.streamSettings.security = "tls";
      ib.streamSettings.tlsSettings = {
        certificates: [{ certificateFile: document.getElementById("wzTLSCert").value.trim(), keyFile: document.getElementById("wzTLSKey").value.trim() }],
      };
    } else if (tlsVal === "reality" && proto === "vless") {
      ib.streamSettings.security = "reality";
      ib.streamSettings.realitySettings = {
        dest:        document.getElementById("wzRealityDest").value.trim(),
        serverNames: [document.getElementById("wzRealitySNI").value.trim()].filter(Boolean),
        privateKey:  document.getElementById("wzRealityPriv").value.trim(),
        shortIds:    [document.getElementById("wzRealityShortID").value.trim()].filter(Boolean),
      };
    }
  } else if (proto === "trojan") {
    ib.settings = { clients: [{ password: document.getElementById("wzTrojanPass").value.trim() || "change-me" }] };
    ib.streamSettings = { network: "tcp", security: "tls", tlsSettings: {} };
  } else if (proto === "shadowsocks") {
    ib.settings = { method: document.getElementById("wzSSMethod").value, password: document.getElementById("wzSSPass").value.trim() || "change-me", network: "tcp,udp" };
  } else if (proto === "socks") {
    ib.settings = { auth: "noauth", udp: true };
    ib.streamSettings = { network: "tcp" };
  }
  wzInbounds.push(ib);
  renderWzInbounds();
  document.getElementById("wzAddInboundForm").classList.add("hidden");
  document.getElementById("wzPort").value = "";
  document.getElementById("wzTag").value  = "";
  document.getElementById("wzListenIP").value = "";
}

async function applyWizardConfig() {
  const st = document.getElementById("wzStatus");
  st.textContent = "Saving…";
  const apiInbound = {
    tag: "api",
    listen: "127.0.0.1",
    port: 10085,
    protocol: "dokodemo-door",
    settings: { address: "127.0.0.1" }
  };
  const userInbounds = (wzInbounds || []).filter(ib => ib.tag !== "api");
  const cfg = {
    log: { loglevel: document.getElementById("wzLogLevel").value },
    api: { tag: "api", services: ["HandlerService", "LoggerService", "StatsService"] },
    stats: {},
    policy: { levels: { "0": { statsUserUplink: true, statsUserDownlink: true } }, system: { statsInboundUplink: true, statsInboundDownlink: true } },
    inbounds: [apiInbound, ...userInbounds],
    outbounds: [
      { tag:"direct",  protocol:"freedom",  settings:{} },
      { tag:"blocked", protocol:"blackhole", settings:{} },
      { tag:"api", protocol:"freedom", settings:{} }
    ],
    routing: { rules: [{ type: "field", inboundTag: ["api"], outboundTag: "api" }] }
  };
  try {
    const res = await api("/api/xray/config", { method:"POST", body: JSON.stringify(cfg, null, 2) });
    if (!res.ok) throw new Error(await res.text());
    st.textContent = "Saved. Restarting Xray…";
    await xrayCtrl("restart");
    st.textContent = "Config saved and Xray restarted.";
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else st.textContent = "Error: " + e.message;
  }
}

// ─── Auth error ───────────────────────────────────────────────────────────────
function doAuthError() {
  sessionToken = "";
  localStorage.removeItem("SESSION_TOKEN");
  clearTimers();
  mainApp.classList.add("hidden");
  loginOverlay.classList.remove("hidden");
  loginErr.textContent = "Session expired — please sign in again.";
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener("load", () => {
  if (sessionToken) {
    // Try to validate the stored token
    api("/api/auth/me").then(async res => {
      if (!res.ok) { doAuthError(); return; }
      const d = await res.json();
      currentRole = d.role;
      currentUser = d.username;
      loginOverlay.classList.add("hidden");
      mainApp.classList.remove("hidden");
      initAfterLogin();
    }).catch(() => doAuthError());
  } else {
    loginOverlay.classList.remove("hidden");
  }
});
