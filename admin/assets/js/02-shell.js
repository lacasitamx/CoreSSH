// ─── Navigation / shell ──────────────────────────────────────────────────────
const tabTitles = {
  dashboard: ["Dashboard", "Overview"],
  ssh: ["Accounts", "SSH / SlowDNS"],
  xray: ["Accounts", "Xray Users"],
  resellers: ["Administration", "Resellers"],
  servers: ["Administration", "Servers"],
  "servers-status": ["Administration", "Servers Status"],
  stats: ["Server", "Monitoring"],
  vnstat: ["Traffic", "VnStat"],
  logs: ["System", "Logs"],
  server: ["System", "Settings"],
};
function updatePageHeading() {
  const [eyebrow, title] = tabTitles[currentTab] || ["Dashboard", currentTab];
  if (pageEyebrow) pageEyebrow.textContent = t(eyebrow);
  if (pageTitle) pageTitle.textContent = t(title);
}

function selectTab(tab) {
  currentTab = tab;
  const pane = document.getElementById("tab-" + tab);
  const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (!pane || !btn) return;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
  btn.classList.add("active");
  pane.classList.add("active");
  updatePageHeading();
  document.body.classList.remove("sidebar-open");

  if (tab === "dashboard") refreshDashboard();
  if (tab === "xray") {
    loadXrayStatus();
    loadInbounds({ silent: true });
    if (currentRole === "superadmin") loadWizardFromConfig();
  }
  if (tab === "stats" && currentRole === "superadmin") loadStats();
  if (tab === "servers-status" && currentRole === "superadmin") loadServersStatus();
  if (tab === "resellers" && currentRole === "superadmin") loadResellers();
  if (tab === "servers" && currentRole === "superadmin") loadServers();
}

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
      loginErr.textContent = res.status === 401 ? t("Invalid credentials.") :
                             res.status === 403 ? t("Account suspended or expired.") :
                             t("Login failed.");
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

  resellerInfoCard.classList.toggle("hidden", currentRole !== "reseller");
  dashboardQuotaCard?.classList.toggle("hidden", currentRole !== "reseller");

  selectTab("dashboard");
  loadServers();

  if (currentRole === "superadmin") {
    loadDashboardStats();
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

