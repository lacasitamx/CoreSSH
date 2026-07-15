// ─── SSH Users ────────────────────────────────────────────────────────────────
document.getElementById("reloadUsersBtn").addEventListener("click", loadUsers);
document.getElementById("sshHeroRefreshBtn")?.addEventListener("click", loadUsers);
newUserBtn.addEventListener("click", () => navigateWorkspaceSection("ssh", "create"));
cancelUserBtn.addEventListener("click", () => {
  prepareNewSSHUser();
  setWorkspaceSection("ssh", "users");
});
function prepareNewSSHUser() {
  userForm.reset();
  fTotpPeriod.value = 60; fTotpWindow.value = 1; fTotpDigits.value = 6;
  fQuotaAction.value = "block";
  fQuotaThrottle.value = 1;
  fUsageDisplay.value = "0 B";
  fResetUsage.checked = false;
  const heading = document.getElementById("userFormHeading");
  const title = document.getElementById("userFormTitle");
  if (heading) heading.textContent = t("Create user");
  if (title) title.textContent = t("Create SSH user");
  userStatus.textContent = t("New user.");
  requestAnimationFrame(() => fUsername.focus());
}
document.getElementById("genTotpBtn").addEventListener("click", () => {
  fTotpSecret.value = genBase32();
  if (!fTotpPeriod.value) fTotpPeriod.value = 60;
  if (!fTotpWindow.value) fTotpWindow.value = 1;
  if (!fTotpDigits.value) fTotpDigits.value = 6;
  userStatus.textContent = t("TOTP secret generated.");
});
document.getElementById("clearTotpBtn").addEventListener("click", () => { fTotpSecret.value = ""; });

async function loadUsers() {
  userStatus.textContent = t("Loading…");
  if (sshLiveStatus) {
    sshLiveStatus.textContent = t("Loading SSH status…");
    sshLiveStatus.className = "workspace-live-status is-loading";
  }
  if (sshMetricState) sshMetricState.textContent = t("Loading");
  try {
    const res  = await api(withServerParam("/api/users", selectedSSHServer()));
    const data = await res.json();
    renderUsers(data || []);
    userStatus.textContent = t("Loaded.");
    lastReload.textContent = t("Last reload: {time}", {time: new Date().toLocaleTimeString()});
  } catch (e) {
    if (sshLiveStatus) {
      sshLiveStatus.textContent = t("Could not load SSH status");
      sshLiveStatus.className = "workspace-live-status is-error";
    }
    if (sshMetricState) sshMetricState.textContent = t("Error");
    if (e.message==="auth") { doAuthError(); } else { userStatus.textContent = t("Error loading users."); }
  }
}
async function loadUsersSilent() {
  try {
    const res  = await api(withServerParam("/api/users", selectedSSHServer()));
    const data = await res.json();
    renderUsers(data || []);
  } catch (e) {
    if (e.message==="auth") doAuthError();
  }
}

// ---- Column sorting (click a header to sort) ----
// Value extractor per sortable column. Numbers sort numerically, strings
// alphabetically; online counts as 1 so "status" groups online users together.
const USER_SORT_EXTRACT = {
  username: u => String(u.username || "").toLowerCase(),
  status:   u => (u.active_conns || 0) > 0 ? 1 : 0,
  auth:     u => u.use_pam ? "pam" : (u.totp_enabled ? (u.allow_static_password ? "totp+pw" : "totp") : "password"),
  conn:     u => u.active_conns || 0,
  max:      u => u.max_connections || 0,
  up:       u => u.limit_mbps_up || 0,
  down:     u => u.limit_mbps_down || 0,
  usage:    u => Number(u.total_bytes || ((u.total_uplink_bytes || 0) + (u.total_downlink_bytes || 0)) || 0),
  expires:  u => u.expires_at ? new Date(u.expires_at).getTime() : Infinity,
  owner:    u => String(u.owner_username || "").toLowerCase(),
};
// Columns that default to descending on first click (most/online first).
const USER_SORT_DEFAULT_DESC = new Set(["status", "conn", "max", "up", "down", "usage"]);

let userSort = { key: "username", dir: "asc" };
let lastUsersData = [];

function sortUsers(list) {
  const ext = USER_SORT_EXTRACT[userSort.key] || USER_SORT_EXTRACT.username;
  const dir = userSort.dir === "desc" ? -1 : 1;
  return list.slice().sort((a, b) => {
    const va = ext(a), vb = ext(b);
    let cmp;
    if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb));
    // Stable tie-break by username so equal rows never shuffle between polls.
    if (cmp === 0) cmp = String(a.username || "").localeCompare(String(b.username || ""));
    return cmp * dir;
  });
}

function updateSortIndicators() {
  const table = usersBody && usersBody.closest("table");
  if (!table) return;
  table.querySelectorAll("th[data-sort-key]").forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.getAttribute("data-sort-key") === userSort.key) {
      th.classList.add(userSort.dir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

function setUserSort(key) {
  if (!USER_SORT_EXTRACT[key]) return;
  if (userSort.key === key) {
    userSort.dir = userSort.dir === "asc" ? "desc" : "asc";
  } else {
    userSort.key = key;
    userSort.dir = USER_SORT_DEFAULT_DESC.has(key) ? "desc" : "asc";
  }
  updateSortIndicators();
  renderUsers(lastUsersData);
}

(function initUserSortHeaders() {
  const table = usersBody && usersBody.closest("table");
  if (!table) return;
  table.querySelectorAll("th[data-sort-key]").forEach(th => {
    th.addEventListener("click", () => setUserSort(th.getAttribute("data-sort-key")));
  });
  updateSortIndicators();
})();

function renderUsers(users) {
  // Cache the raw list so a header click can re-sort without refetching, and
  // order by the active column so rows don't shuffle on each live poll.
  lastUsersData = users || [];
  users = sortUsers(lastUsersData);
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
    const totalBytes = Number(u.total_bytes || ((u.total_uplink_bytes || 0) + (u.total_downlink_bytes || 0)) || 0);
    const quotaBytes = Number(u.data_quota_bytes || 0);
    const quotaLabel = quotaBytes > 0 ? formatBytes(quotaBytes) : "∞";
    const quotaState = u.quota_exceeded
      ? (u.quota_action === "throttle" ? ` · ${t("throttled")}` : ` · ${t("blocked")}`)
      : "";
    const tr = document.createElement("tr");
    const cells = [
      u.username,
      on ? `<span class="badge-on">${t("online")}</span>` : `<span class="badge-off">${t("idle")}</span>`,
      u.use_pam ? "PAM" : (u.totp_enabled ? (u.allow_static_password ? "TOTP+pw" : "TOTP") : "Password"),
      u.active_conns ?? 0,
      u.max_connections || 0,
      u.limit_mbps_up || 0,
      u.limit_mbps_down || 0,
      `${formatBytes(totalBytes)} / ${quotaLabel}${quotaState}`,
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
      className:"btn btn-ghost btn-sm", textContent:t("Edit"),
      onclick: () => fillUserForm(u),
    });
    const resetBtn = Object.assign(document.createElement("button"), {
      className:"btn btn-warn btn-sm", textContent:t("Reset"),
      style: "margin-left:4px;",
      title: t("Reset traffic"),
      onclick: () => resetUserTraffic(u.username, resetBtn),
    });
    const delBtn = Object.assign(document.createElement("button"), {
      className:"btn btn-danger btn-sm", textContent:t("Del"),
      style: "margin-left:4px;",
      onclick: () => deleteUser(u.username),
    });
    tdA.append(editBtn, resetBtn, delBtn);
    tr.appendChild(tdA);
    usersBody.appendChild(tr);
  });
  const activeCount = Math.max(0, users.length - expiredCount);
  userCountChip.textContent = t("{count} total · {active} active · {online} online", {count: users.length, active: activeCount, online});
  if (sshMetricTotal) sshMetricTotal.textContent = String(users.length);
  if (sshMetricActive) sshMetricActive.textContent = String(activeCount);
  if (sshMetricOnline) sshMetricOnline.textContent = String(online);
  if (sshMetricState) sshMetricState.textContent = t("Online");
  if (sshLiveStatus) {
    sshLiveStatus.textContent = t("SSH data updated at {time}", {time:new Date().toLocaleTimeString()});
    sshLiveStatus.className = "workspace-live-status is-ok";
  }
}

function fillUserForm(u) {
  setWorkspaceSection("ssh", "create");
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
  fQuotaGB.value        = u.data_quota_bytes ? (Number(u.data_quota_bytes) / (1024 ** 3)).toFixed(2).replace(/\.00$/, "") : "0";
  fQuotaAction.value    = u.quota_action === "throttle" ? "throttle" : "block";
  fQuotaThrottle.value  = u.quota_throttle_mbps || 1;
  const totalBytes      = Number(u.total_bytes || ((u.total_uplink_bytes || 0) + (u.total_downlink_bytes || 0)) || 0);
  fUsageDisplay.value   = `${formatBytes(totalBytes)} (↑ ${formatBytes(u.total_uplink_bytes || 0)} · ↓ ${formatBytes(u.total_downlink_bytes || 0)})`;
  fResetUsage.checked   = false;
  fExpires.value        = u.expires_at ? localFromISO(u.expires_at) : "";
  const heading = document.getElementById("userFormHeading");
  const title = document.getElementById("userFormTitle");
  if (heading) heading.textContent = t("Edit user");
  if (title) title.textContent = t("Editing {name}", {name:u.username});
  userStatus.textContent = t("Editing {name}", {name: u.username});
}

userForm.addEventListener("submit", async e => {
  e.preventDefault();
  saveUserBtn.disabled = true;
  userStatus.textContent = t("Saving…");
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
    data_quota_bytes: Math.round((parseFloat(fQuotaGB.value || "0") || 0) * (1024 ** 3)),
    quota_action: fQuotaAction.value === "throttle" ? "throttle" : "block",
    quota_throttle_mbps: parseInt(fQuotaThrottle.value || "1", 10) || 1,
    reset_usage: !!fResetUsage.checked,
    server_id: selectedSSHServer(),
  };
  try {
    const res = await api("/api/users/create", { method:"POST", body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(await res.text());
    userStatus.textContent = t("Saved.");
    fPassword.value = "";
    fResetUsage.checked = false;
    loadUsers();
    if (currentRole === "reseller") loadMe();
    showPanelToast(t("SSH user saved successfully."), "success", t("SSH / SlowDNS"));
    setWorkspaceSection("ssh", "users");
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else userStatus.textContent = t("Error: {error}", {error: e.message});
  } finally {
    saveUserBtn.disabled = false;
  }
});

async function resetUserTraffic(username, button) {
  const accepted = await panelConfirm({
    tone:"warning", icon:"↺", title:t("Reset SSH traffic"),
    message:t("Reset traffic for user \"{name}\"?", {name: username}),
    detail:t("Current uploaded and downloaded usage will return to zero. The account, password, expiry and quota remain unchanged."),
    confirmLabel:t("Reset traffic"),
  });
  if (!accepted) return;
  const previousDisabled = !!button?.disabled;
  if (button) button.disabled = true;
  userStatus.textContent = t("Resetting traffic for {name}…", {name: username});
  try {
    const res = await api("/api/users/reset-traffic", {
      method:"POST",
      body: JSON.stringify({ username, server_id:selectedSSHServer() }),
    });
    if (!res.ok) throw new Error((await res.text()) || "reset failed");
    userStatus.textContent = t("Traffic reset successfully.");
    showPanelToast(t("Traffic reset successfully."), "success", t("SSH / SlowDNS"));
    await loadUsers();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else {
      userStatus.textContent = t("Could not reset traffic: {error}", {error:e.message});
      showPanelToast(t("Could not reset traffic: {error}", {error:e.message}), "error", t("SSH / SlowDNS"));
    }
  } finally {
    if (button) button.disabled = previousDisabled;
  }
}

async function deleteUser(username) {
  const accepted = await panelConfirm({
    tone:"danger", icon:"×", title:t("Delete SSH account"),
    message:t("Delete user \"{name}\"?", {name: username}),
    detail:t("The active SSH sessions for this account will be disconnected."),
    confirmLabel:t("Delete account"),
  });
  if (!accepted) return;
  userStatus.textContent = t("Deleting {name}…", {name: username});
  try {
    const res = await api(withServerParam(`/api/users/delete?username=${encodeURIComponent(username)}`, selectedSSHServer()), { method:"DELETE" });
    if (!res.ok && res.status !== 204) throw new Error("delete failed");
    userStatus.textContent = t("Deleted.");
    loadUsers();
    if (currentRole === "reseller") loadMe();
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else userStatus.textContent = t("Error deleting.");
  }
}
