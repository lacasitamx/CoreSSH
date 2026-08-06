// ─── Navigation / shell ──────────────────────────────────────────────────────
const tabTitles = {
  dashboard: ["Dashboard", "Overview"],
  ssh: ["Accounts", "SSH / SlowDNS"],
  xray: ["Accounts", "Xray Users"],
  resellers: ["Administration", "Resellers"],
  servers: ["Infrastructure", "Servers"],
  "servers-status": ["Infrastructure", "Servers Status"],
  stats: ["Infrastructure", "Monitoring"],
  vnstat: ["Infrastructure", "Traffic"],
  logs: ["System", "Logs"],
  bot: ["Vendas", "Bot / Telegram"],
  server: ["System", "Settings"],
};
const infrastructureTabs = ["servers", "servers-status", "stats", "vnstat"];
const infrastructureNavItems = [
  { tab:"servers", icon:"▣", label:"Servers" },
  { tab:"servers-status", icon:"●", label:"Status" },
  { tab:"stats", icon:"◴", label:"Server" },
  { tab:"vnstat", icon:"⇅", label:"Traffic" },
];

function syncInfrastructureNavigation(tab = currentTab) {
  if (!infrastructureTabs.includes(tab)) return;
  document.querySelectorAll("[data-infra-tab]").forEach(button => button.classList.toggle("active", button.dataset.infraTab === tab));
  document.querySelectorAll(".infra-section-select").forEach(select => { select.value = tab; });
}

function mountInfrastructureNavigation() {
  document.querySelectorAll(".infra-nav-mount").forEach(mount => {
    const shell = document.createElement("div");
    shell.className = "infra-nav-shell";
    const nav = document.createElement("nav");
    nav.className = "infra-section-nav";
    nav.setAttribute("aria-label", t("Infrastructure areas"));
    const select = document.createElement("select");
    select.className = "infra-section-select";
    select.setAttribute("aria-label", t("Infrastructure area"));
    infrastructureNavItems.forEach(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.infraTab = item.tab;
      const icon = document.createElement("span");
      icon.textContent = item.icon;
      button.append(icon, document.createTextNode(" " + t(item.label)));
      button.addEventListener("click", () => selectTab(item.tab));
      nav.appendChild(button);
      const option = document.createElement("option");
      option.value = item.tab;
      option.textContent = t(item.label);
      select.appendChild(option);
    });
    select.addEventListener("change", () => selectTab(select.value));
    shell.append(nav, select);
    mount.replaceChildren(shell);
  });
  syncInfrastructureNavigation();
}

const workspaceSectionDefaults = {
  ssh: "users",
  xray: "users",
  resellers: "users",
  config: "general",
};

function workspaceSectionRoot(workspace) {
  const tab = workspace === "config" ? "server" : workspace;
  return document.getElementById(`tab-${tab}`);
}

function activeWorkspaceSection(workspace) {
  const root = workspaceSectionRoot(workspace);
  return root?.querySelector(`[data-workspace-panel="${workspace}"].active`)?.dataset.workspaceSectionPanel
    || workspaceSectionDefaults[workspace]
    || "";
}

function setWorkspaceSection(workspace, section, options = {}) {
  const root = workspaceSectionRoot(workspace);
  if (!root) return false;
  const panels = Array.from(root.querySelectorAll(`[data-workspace-panel="${workspace}"]`));
  const targets = panels.filter(panel => panel.dataset.workspaceSectionPanel === section && !panel.classList.contains("hidden"));
  if (!targets.length) {
    section = workspaceSectionDefaults[workspace] || panels.find(panel => !panel.classList.contains("hidden"))?.dataset.workspaceSectionPanel || "";
  }
  panels.forEach(panel => panel.classList.toggle("active", panel.dataset.workspaceSectionPanel === section));
  root.querySelectorAll(`[data-workspace="${workspace}"][data-workspace-section]`).forEach(button => {
    const active = button.dataset.workspaceSection === section;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  const select = root.querySelector(`[data-workspace-select="${workspace}"]`);
  if (select) select.value = section;

  if (!options.silent) {
    if (workspace === "xray" && section === "config" && currentRole === "superadmin" && typeof loadWizardFromConfig === "function") loadWizardFromConfig();
    if (workspace === "xray" && section === "logs" && currentRole === "superadmin" && typeof loadXrayLogs === "function") loadXrayLogs();
    if (workspace === "config" && section === "tls" && currentRole === "superadmin" && typeof loadTLSCertificates === "function") loadTLSCertificates();
  }
  return true;
}

function prepareWorkspaceSection(workspace, section) {
  if (section !== "create") return;
  if (workspace === "ssh" && typeof prepareNewSSHUser === "function") prepareNewSSHUser();
  if (workspace === "xray" && typeof prepareXrayClientCreator === "function") prepareXrayClientCreator();
  if (workspace === "resellers" && typeof prepareNewReseller === "function") prepareNewReseller();
}

function navigateWorkspaceSection(workspace, section) {
  prepareWorkspaceSection(workspace, section);
  return setWorkspaceSection(workspace, section);
}

function mountWorkspaceSectionNavigation() {
  document.querySelectorAll("[data-workspace][data-workspace-section]").forEach(button => {
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => navigateWorkspaceSection(button.dataset.workspace, button.dataset.workspaceSection));
  });
  document.querySelectorAll("[data-workspace-select]").forEach(select => {
    select.addEventListener("change", () => navigateWorkspaceSection(select.dataset.workspaceSelect, select.value));
  });
  Object.entries(workspaceSectionDefaults).forEach(([workspace, section]) => setWorkspaceSection(workspace, section, { silent:true }));
}

function updatePageHeading() {
  const [eyebrow, title] = tabTitles[currentTab] || ["Dashboard", currentTab];
  if (pageEyebrow) pageEyebrow.textContent = t(eyebrow);
  if (pageTitle) pageTitle.textContent = t(title);
}

function selectTab(tab) {
  currentTab = tab;
  const pane = document.getElementById("tab-" + tab);
  const navTab = infrastructureTabs.includes(tab) ? "servers" : tab;
  const btn = document.querySelector(`.tab-btn[data-tab="${navTab}"]`);
  if (!pane) return;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
  btn?.classList.add("active");
  pane.classList.add("active");
  syncInfrastructureNavigation(tab);
  updatePageHeading();
  document.body.classList.remove("sidebar-open");

  if (tab === "dashboard") refreshDashboard();
  if (tab === "xray") {
    loadXrayStatus();
    loadInbounds({ silent: true });
    if (currentRole === "superadmin" && activeWorkspaceSection("xray") === "config") loadWizardFromConfig();
  }
  if (tab === "stats" && currentRole === "superadmin") loadStats();
  if (tab === "vnstat" && currentRole === "superadmin") loadVnstat();
  if (tab === "servers-status" && currentRole === "superadmin") loadServersStatus();
  if (tab === "resellers" && currentRole === "superadmin") loadResellers();
  if (tab === "servers" && currentRole === "superadmin") loadServers();
  if (tab === "bot" && currentRole === "superadmin" && typeof loadBotTab === "function") loadBotTab();
}

mountInfrastructureNavigation();
mountWorkspaceSectionNavigation();
document.querySelectorAll(".tab-btn").forEach(btn => btn.addEventListener("click", () => selectTab(btn.dataset.tab)));
menuToggle?.addEventListener("click", () => document.body.classList.add("sidebar-open"));
drawerBackdrop?.addEventListener("click", () => document.body.classList.remove("sidebar-open"));
languageSelect?.addEventListener("change", () => { applyLanguage(languageSelect.value); renderDashboardCounters(); });
applyLanguage(currentLang, { persist: false });
startI18nObserver();

// ─── Login / Logout ───────────────────────────────────────────────────────────
loginBtn.addEventListener("click", doLogin);
loginPass.addEventListener("keydown", e => { if (e.key==="Enter") doLogin(); });
logoutBtn.addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  sessionToken = "";
  sessionStorage.removeItem("SESSION_TOKEN");
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
      loginErr.textContent = res.status === 401 ? t("Invalid credentials.") :
                             res.status === 403 ? t("Account suspended or expired.") :
                             t("Login failed.");
      return;
    }
    const data = await res.json();
    sessionToken = data.token;
    currentRole  = data.role;
    currentUser  = data.username;
    sessionStorage.setItem("SESSION_TOKEN", sessionToken);
    loginOverlay.classList.add("hidden");
    mainApp.classList.remove("hidden");
    initAfterLogin();
  } catch (e) {
    loginErr.textContent = t("Network error.");
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
  mainApp.classList.remove("role-superadmin", "role-reseller");
  mainApp.classList.add(currentRole === "superadmin" ? "role-superadmin" : "role-reseller");
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
  document.querySelectorAll("option.xray-admin-only").forEach(option => {
    option.hidden = currentRole !== "superadmin";
    option.disabled = currentRole !== "superadmin";
  });
  if (currentRole !== "superadmin" && ["config", "logs"].includes(activeWorkspaceSection("xray"))) {
    setWorkspaceSection("xray", "users", { silent:true });
  }

  resellerInfoCard.classList.toggle("hidden", currentRole !== "reseller");
  dashboardQuotaCard?.classList.toggle("hidden", currentRole !== "reseller");

  selectTab("dashboard");
  loadServers();

  if (currentRole === "superadmin") {
    loadDashboardStats();
    if (typeof loadUpdateStatus === "function") loadUpdateStatus();
    statsTimer = setInterval(() => {
      loadDashboardStats();
      if (currentTab === "stats") loadStats();
      if (currentTab === "servers-status") loadServersStatus({ silent: true });
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

// ─── Me (reseller info) ───────────────────────────────────────────────────────
async function loadMe() {
  try {
    const res = await api("/api/auth/me");
    const d   = await res.json();
    dashboardCache.me = d;
    const used = d.used_users ?? 0;
    const max = d.max_users || 0;
    rUsedMax.textContent = used + " / " + (max || "∞");
    rExpiry.textContent  = d.expires_at ? fmtDate(d.expires_at) : t("No expiration");
    rStatus.textContent  = d.is_active  ? t("Active") : t("Suspended");
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
    ? t("No limit set by admin")
    : t("{remaining} accounts available · {pct}% used", {remaining, pct});
  dashQuotaBreakdown.textContent = t("SSH {ssh} · Xray {xray}", {ssh: sshUsed, xray: xrayUsed});
  dashQuotaBar.style.width = `${pct}%`;

  if (dashQuotaRemaining) {
    dashQuotaRemaining.textContent = String(remaining);
    setQuotaTone(dashQuotaRemaining, tone);
  }
  if (dashQuotaSummaryText) {
    dashQuotaSummaryText.textContent = unlimited
      ? t("{used} used · unlimited", {used})
      : t("{used}/{max} used · {pct}% of plan", {used, max, pct});
  }
  if (dashQuotaMiniBar) dashQuotaMiniBar.style.width = `${pct}%`;
  if (xrayResellerQuotaUsed) xrayResellerQuotaUsed.textContent = `${used}/${labelMax}`;
  if (xrayResellerQuotaRemaining) {
    xrayResellerQuotaRemaining.textContent = String(remaining);
    setQuotaTone(xrayResellerQuotaRemaining, tone);
  }
  if (xrayResellerQuotaMix) xrayResellerQuotaMix.textContent = t("SSH {ssh} · Xray {xray}", {ssh: sshUsed, xray: xrayUsed});
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
  if (sec < 60) return `${sec}s ${t("ago")}`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${t("ago")}`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ${t("ago")}`;
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
  if (dashConnectionsText) dashConnectionsText.textContent = t("{ssh} SSH · {xray} Xray online", {ssh: sshConns, xray: xrayOnline});
  if (dashXrayClients) dashXrayClients.textContent = xrayClients.length;
  if (dashXrayStatus) {
    const running = xrayChip?.textContent || "--";
    dashXrayStatus.textContent = t("{online} online · {active} active · {expired} expired · Core: {core}", {online: xrayOnline, active: xrayActive, expired: xrayExpired, core: running});
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
