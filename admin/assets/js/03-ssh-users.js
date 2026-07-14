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
      on ? `<span class="badge-on">${t("online")}</span>` : `<span class="badge-off">${t("idle")}</span>`,
      u.use_pam ? "PAM" : (u.totp_enabled ? (u.allow_static_password ? "TOTP+pw" : "TOTP") : "Password"),
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
      className:"btn btn-ghost btn-sm", textContent:t("Edit"),
      onclick: () => fillUserForm(u),
    });
    const delBtn = Object.assign(document.createElement("button"), {
      className:"btn btn-danger btn-sm", textContent:t("Del"),
      style: "margin-left:4px;",
      onclick: () => deleteUser(u.username),
    });
    tdA.append(editBtn, delBtn);
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
    server_id: selectedSSHServer(),
  };
  try {
    const res = await api("/api/users/create", { method:"POST", body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(await res.text());
    userStatus.textContent = t("Saved.");
    fPassword.value = "";
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
