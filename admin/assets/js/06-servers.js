// ─── Managed Servers ─────────────────────────────────────────────────────────
sshServerSelect?.addEventListener("change", () => {
  selectedSSHServerID = selectedSSHServer();
  localStorage.setItem("SSH_SERVER_ID", selectedSSHServerID);
  loadUsers();
});
xrayServerSelect?.addEventListener("change", () => {
  selectedXrayServerID = selectedXrayServer();
  localStorage.setItem("XRAY_SERVER_ID", selectedXrayServerID);
  lastInboundsStructure = "";
  closeEditXrayClient?.();
  if (xStatus) xStatus.textContent = `Switched Xray target to ${selectedXrayServerLabel()}.`;
  loadXrayStatus();
  loadInbounds({ force: true });
  reloadXrayConfigForSelectedServer();
  loadXrayLogs();
});
document.getElementById("reloadServersBtn")?.addEventListener("click", loadServers);
document.getElementById("reloadServersBtn2")?.addEventListener("click", loadServers);
document.getElementById("refreshServersBtn")?.addEventListener("click", loadServers);
document.getElementById("refreshServersStatusBtn")?.addEventListener("click", () => loadServersStatus());
document.getElementById("clearServerFormBtn")?.addEventListener("click", clearServerForm);
document.getElementById("testServerBtn")?.addEventListener("click", testServerForm);
document.getElementById("backToServersBtn")?.addEventListener("click", () => showServerListView());
document.getElementById("loadManagedConfigBtn")?.addEventListener("click", () => loadManagedServerConfig(configuringServerID));
document.getElementById("saveManagedConfigBtn")?.addEventListener("click", saveManagedServerConfig);
document.getElementById("saveManagedConfigBottomBtn")?.addEventListener("click", saveManagedServerConfig);
document.getElementById("reloadManagedConfigBottomBtn")?.addEventListener("click", () => loadManagedServerConfig(configuringServerID));
serverForm?.addEventListener("submit", async e => {
  e.preventDefault();
  await saveServerForm();
});

async function loadServers() {
  let loadError = null;
  if (fleetLiveStatus) {
    fleetLiveStatus.textContent = t("Loading infrastructure…");
    fleetLiveStatus.className = "workspace-live-status is-loading";
  }
  try {
    const res = await api("/api/servers");
    if (!res.ok) throw new Error(await res.text());
    serversCache = await res.json() || [];
  } catch (e) {
    loadError = e;
    serversCache = [{ id:"local", name:"Master node", base_url:"local", enable_ssh:true, enable_xray:true, is_active:true, is_local:true }];
    if (serversStatus) serversStatus.textContent = "Error loading servers: " + e.message;
    if (e.message === "auth") doAuthError();
  }
  renderServerSelectors();
  renderServersTable();
  updateFleetOverview(loadError);
}

function updateFleetOverview(error = null) {
  const rows = Array.isArray(serversCache) ? serversCache.filter(Boolean) : [];
  const active = rows.filter(server => server.is_active !== false);
  if (fleetMetricNodes) fleetMetricNodes.textContent = String(rows.length);
  if (fleetMetricActive) fleetMetricActive.textContent = String(active.length);
  if (fleetMetricSSH) fleetMetricSSH.textContent = String(active.filter(server => server.enable_ssh || server.is_local).length);
  if (fleetMetricXray) fleetMetricXray.textContent = String(active.filter(server => server.enable_xray || server.is_local).length);
  if (fleetLiveStatus) {
    fleetLiveStatus.textContent = error
      ? t("Infrastructure loaded with fallback data")
      : t("{count} active nodes · updated {time}", {count:active.length, time:new Date().toLocaleTimeString()});
    fleetLiveStatus.className = `workspace-live-status ${error ? "is-warn" : "is-ok"}`;
  }
}


async function loadServersStatus(options = {}) {
  const silent = !!options.silent;
  if (!serversStatusGrid) return;
  try {
    if (!Array.isArray(serversCache) || serversCache.length === 0) await loadServers();
    const nodes = (serversCache || []).filter(Boolean);
    if (serversStatusCountChip) serversStatusCountChip.textContent = String(nodes.length);
    if (!silent) {
      serversStatusPageStatus && (serversStatusPageStatus.textContent = "Loading servers...");
      if (serversStatusPageStatus) serversStatusPageStatus.className = "workspace-live-status is-loading";
      serversStatusGrid.innerHTML = `<div class="hint">Loading servers...</div>`;
    }
    const rows = await Promise.all(nodes.map(loadSingleServerStatus));
    renderServersStatusCards(rows);
    if (serversStatusPageStatus) {
      const online = rows.filter(r => r.ok).length;
      serversStatusPageStatus.textContent = `${online}/${rows.length} servers online - Updated ${new Date().toLocaleTimeString()}`;
      serversStatusPageStatus.className = `workspace-live-status ${online === rows.length ? "is-ok" : online > 0 ? "is-warn" : "is-error"}`;
    }
    const online = rows.filter(row => row.ok).length;
    const sessions = rows.reduce((total, row) => {
      const ssh = (Array.isArray(row.users) ? row.users : []).reduce((sum, user) => sum + Number(user.active_conns || 0), 0);
      let xray = 0;
      (Array.isArray(row.inbounds) ? row.inbounds : []).forEach(inbound => { xray += (inbound.clients || []).filter(client => !!client.online).length; });
      return total + ssh + xray;
    }, 0);
    if (fleetStatusOnline) fleetStatusOnline.textContent = String(online);
    if (fleetStatusOffline) fleetStatusOffline.textContent = String(Math.max(0, rows.length - online));
    if (fleetStatusSessions) fleetStatusSessions.textContent = String(sessions);
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else {
      serversStatusPageStatus && (serversStatusPageStatus.textContent = "Error loading server status: " + e.message);
      if (serversStatusPageStatus) serversStatusPageStatus.className = "workspace-live-status is-error";
      if (!silent) serversStatusGrid.innerHTML = `<div class="hint">Error loading server status.</div>`;
    }
  }
}

async function fetchJSONForServer(path, serverID) {
  const res = await api(withServerParam(path, serverID));
  if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
  return await res.json();
}

async function loadSingleServerStatus(server) {
  const id = String(server.id || "local");
  const out = { server, ok: true, error: "", stats: null, users: [], inbounds: [], xray: null };
  if (server.is_active === false) { out.ok = false; out.error = "disabled"; return out; }
  try {
    out.stats = await fetchJSONForServer("/api/stats", id);
  } catch (e) {
    out.ok = false;
    out.error = e.message || "stats failed";
  }
  if (server.enable_ssh || server.is_local) {
    try { out.users = await fetchJSONForServer("/api/users", id) || []; }
    catch (e) { out.usersError = e.message || "users failed"; }
  }
  if (server.enable_xray || server.is_local) {
    try { out.xray = await fetchJSONForServer("/api/xray/status", id); }
    catch (e) { out.xrayError = e.message || "xray status failed"; }
    try { out.inbounds = await fetchJSONForServer("/api/xray/inbounds", id) || []; }
    catch (e) { out.inboundsError = e.message || "xray clients failed"; }
  }
  return out;
}

function renderServersStatusCards(rows = []) {
  if (!serversStatusGrid) return;
  if (!rows.length) {
    serversStatusGrid.innerHTML = `<div class="hint">No active servers configured.</div>`;
    return;
  }
  serversStatusGrid.innerHTML = rows.map(serverStatusCardHTML).join("");
}

function serverStatusCardHTML(row) {
  const s = row.server || {};
  const stats = row.stats || {};
  const ifaces = Array.isArray(stats.interfaces) ? stats.interfaces : [];
  let rx = 0, tx = 0, rxTotal = 0, txTotal = 0;
  ifaces.forEach(it => {
    rx += Number(it.rx_mbps || 0);
    tx += Number(it.tx_mbps || 0);
    rxTotal += Number(it.rx_bytes || 0);
    txTotal += Number(it.tx_bytes || 0);
  });
  const cpu = Number(stats.cpu_percent || 0);
  const mem = stats.mem_percent == null ? 0 : Number(stats.mem_percent || 0);
  const users = Array.isArray(row.users) ? row.users : [];
  const now = Date.now();
  const sshActive = users.filter(u => !u.expires_at || new Date(u.expires_at).getTime() > now).length;
  const sshExpired = Math.max(0, users.length - sshActive);
  const sshConns = users.reduce((sum, u) => sum + Number(u.active_conns || 0), 0);
  const clients = [];
  (Array.isArray(row.inbounds) ? row.inbounds : []).forEach(ib => (ib.clients || []).forEach(c => clients.push(c)));
  const xrayOnline = clients.filter(c => !!c.online).length;
  const xrayActive = clients.filter(c => !c.expired && (!c.expires_at || new Date(c.expires_at).getTime() > now)).length;
  const xrayExpired = Math.max(0, clients.length - xrayActive);
  const netNow = rx + tx;
  const running = row.xray ? !!row.xray.running : false;
  const nodeStatus = row.ok ? `<span class="badge-on">online</span>` : `<span class="badge-off">offline</span>`;
  const options = `${s.enable_ssh ? "SSH" : ""}${s.enable_ssh && s.enable_xray ? " / " : ""}${s.enable_xray ? "Xray" : ""}` || "disabled";
  const err = row.ok ? "" : `<div class="server-status-error">${escapeHTML(row.error || "connection failed")}</div>`;
  return `
    <article class="server-status-card ${row.ok ? "" : "server-status-offline"}">
      <div class="server-status-head">
        <div>
          <div class="server-status-title">${escapeHTML(s.name || "Server")}</div>
          <div class="server-status-url">${escapeHTML(s.base_url || "local")}</div>
        </div>
        <div class="server-status-badges">
          ${nodeStatus}
          <span class="chip">${escapeHTML(options)}</span>
        </div>
      </div>
      ${err}
      <div class="server-mini-grid">
        ${miniMetricHTML("CPU", fmtPct(cpu), cpu, cpu >= 85 ? "High load" : cpu >= 60 ? "Moderate load" : "Normal load")}
        ${miniMetricHTML("RAM", fmtPct(mem), mem, stats.mem_used_bytes && stats.mem_total_bytes ? `${fmtBytes(stats.mem_used_bytes)} / ${fmtBytes(stats.mem_total_bytes)}` : "Memory used")}
        ${miniMetricHTML("Network", `${fmtMbps(netNow)} Mb/s`, Math.min(100, netNow / 20), `RX ${fmtMbps(rx)} - TX ${fmtMbps(tx)}`)}
        ${miniMetricHTML("Accounts", String(users.length + clients.length), Math.min(100, (users.length + clients.length) * 3), `SSH ${users.length} - Xray ${clients.length}`)}
      </div>
      <div class="server-status-footer">
        <span>SSH: ${sshConns} online - ${sshActive} active - ${sshExpired} expired</span>
        <span>Xray: ${xrayOnline} online - ${xrayActive} active - ${xrayExpired} expired - Core ${running ? "running" : "stopped"}</span>
        <span>Total traffic: ${fmtBytes(rxTotal + txTotal)}</span>
      </div>
    </article>`;
}

function miniMetricHTML(label, value, pct, note) {
  const width = Math.min(100, Math.max(0, Number(pct) || 0));
  return `<div class="server-mini-metric">
    <div class="server-mini-label">${escapeHTML(label)}</div>
    <div class="server-mini-value">${escapeHTML(value)}</div>
    <div class="server-mini-note">${escapeHTML(note || "")}</div>
    <div class="server-mini-bar"><span style="width:${width}%"></span></div>
  </div>`;
}

function renderServerSelectors() {
  const active = serversCache.filter(s => s.is_active !== false);
  const sshServers = active.filter(s => s.enable_ssh || s.is_local);
  const xrayServers = active.filter(s => s.enable_xray || s.is_local);
  populateServerSelect(sshServerSelect, sshServers, selectedSSHServerID, "ssh");
  populateServerSelect(xrayServerSelect, xrayServers, selectedXrayServerID, "xray");
  const hasMultiSSH = sshServers.length > 1;
  const hasMultiXray = xrayServers.length > 1;
  sshServerPickerCard?.classList.toggle("hidden", !hasMultiSSH);
  xrayServerPickerCard?.classList.toggle("hidden", !hasMultiXray);
  if (sshServerHint) { sshServerHint.textContent = ""; sshServerHint.classList.add("hidden"); }
  if (xrayServerHint) { xrayServerHint.textContent = ""; xrayServerHint.classList.add("hidden"); }
  if (dashServers) dashServers.textContent = String(active.length || 1);
  if (dashServerStatus) dashServerStatus.textContent = active.length > 1 ? `${active.length} nodes configured` : "master only";
}

function populateServerSelect(select, list, selected, kind) {
  if (!select) return;
  const current = String(selected || select.value || "local");
  select.innerHTML = "";
  list.forEach(s => {
    const opt = document.createElement("option");
    opt.value = String(s.id);
    opt.textContent = `${s.name || s.base_url || s.id}${s.is_local ? " (master)" : ""}`;
    select.appendChild(opt);
  });
  const allowed = list.some(s => String(s.id) === current);
  select.value = allowed ? current : "local";
  if (kind === "ssh") {
    selectedSSHServerID = select.value || "local";
    localStorage.setItem("SSH_SERVER_ID", selectedSSHServerID);
  } else {
    selectedXrayServerID = select.value || "local";
    localStorage.setItem("XRAY_SERVER_ID", selectedXrayServerID);
  }
}

function renderServersTable() {
  if (!serversBody) return;
  const rows = serversCache || [];
  serversCountChip && (serversCountChip.textContent = String(Math.max(0, rows.length - 1)));
  serversBody.innerHTML = "";
  rows.forEach(s => {
    const tr = document.createElement("tr");
    const opts = `${s.enable_ssh ? "SSH" : ""}${s.enable_ssh && s.enable_xray ? " / " : ""}${s.enable_xray ? "Xray" : ""}` || "disabled";
    tr.innerHTML = `
      <td>${escapeHTML(s.name || "—")}${s.is_local ? ' <span class="chip">master</span>' : ""}</td>
      <td style="font-family:monospace;font-size:.68rem;">${escapeHTML(s.base_url || "local")}</td>
      <td>${escapeHTML(opts)}</td>
      <td>${s.is_active ? '<span class="badge-on">active</span>' : '<span class="badge-off">disabled</span>'}</td>`;
    const td = document.createElement("td");
    td.style.whiteSpace = "nowrap";
    const cfgBtn = document.createElement("button");
    cfgBtn.className = "btn btn-ghost btn-sm";
    cfgBtn.textContent = "Configure";
    cfgBtn.onclick = () => openManagedServerConfig(String(s.id));
    td.appendChild(cfgBtn);
    if (!s.is_local) {
      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-warn btn-sm";
      editBtn.style.marginLeft = "4px";
      editBtn.textContent = "Edit";
      editBtn.onclick = () => fillServerForm(s);
      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-danger btn-sm";
      delBtn.style.marginLeft = "4px";
      delBtn.textContent = "Del";
      delBtn.onclick = () => deleteServer(s);
      td.append(editBtn, delBtn);
    }
    tr.appendChild(td);
    serversBody.appendChild(tr);
  });
}

function clearServerForm() {
  if (!serverForm) return;
  srvID.value = "";
  srvName.value = "";
  srvBaseURL.value = "";
  srvAdminUser.value = "admin";
  srvAdminKey.value = "";
  srvEnableSSH.checked = true;
  srvEnableXray.checked = true;
  srvIsActive.checked = true;
  if (serverFormTitle) serverFormTitle.textContent = "Add / edit server";
  if (serverFormStatus) serverFormStatus.textContent = "";
}

function fillServerForm(s) {
  srvID.value = s.id || "";
  srvName.value = s.name || "";
  srvBaseURL.value = s.base_url || "";
  srvAdminUser.value = s.admin_username || "admin";
  srvAdminKey.value = "";
  srvEnableSSH.checked = !!s.enable_ssh;
  srvEnableXray.checked = !!s.enable_xray;
  srvIsActive.checked = s.is_active !== false;
  if (serverFormTitle) serverFormTitle.textContent = "Edit: " + (s.name || s.base_url);
  if (serverFormStatus) serverFormStatus.textContent = "Leave admin key blank to keep the saved key.";
}

function serverPayloadFromForm() {
  return {
    id: srvID?.value || "",
    name: srvName?.value.trim() || "",
    base_url: srvBaseURL?.value.trim() || "",
    admin_username: srvAdminUser?.value.trim() || "admin",
    admin_key: srvAdminKey?.value || "",
    enable_ssh: !!srvEnableSSH?.checked,
    enable_xray: !!srvEnableXray?.checked,
    is_active: !!srvIsActive?.checked,
  };
}

async function saveServerForm() {
  if (!serverFormStatus) return;
  serverFormStatus.textContent = "Saving…";
  try {
    const res = await api("/api/servers", { method:"POST", body: JSON.stringify(serverPayloadFromForm()) });
    if (!res.ok) throw new Error(await res.text());
    serverFormStatus.textContent = "Saved.";
    clearServerForm();
    await loadServers();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else serverFormStatus.textContent = "Error: " + e.message;
  }
}

async function testServerForm() {
  if (!serverFormStatus) return;
  serverFormStatus.textContent = "Testing remote login…";
  try {
    const res = await api("/api/servers/test", { method:"POST", body: JSON.stringify(serverPayloadFromForm()) });
    if (!res.ok) throw new Error(await res.text());
    serverFormStatus.textContent = "Connection OK.";
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else serverFormStatus.textContent = "Test failed: " + e.message;
  }
}

async function deleteServer(s) {
  const accepted = await panelConfirm({
    tone:"danger", icon:"×", title:t("Delete managed server"),
    message:t("Delete server \"{name}\"?", {name:s.name || s.base_url}),
    detail:t("The remote node is not erased, but it will be removed from this panel and can no longer receive managed actions."),
    confirmLabel:t("Delete server"),
  });
  if (!accepted) return;
  try {
    const res = await api(`/api/servers?id=${encodeURIComponent(s.id)}`, { method:"DELETE" });
    if (!res.ok && res.status !== 204) throw new Error(await res.text());
    await loadServers();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else serversStatus && (serversStatus.textContent = "Delete failed: " + e.message);
  }
}

function showServerListView() {
  serversListView?.classList.remove("hidden");
  serverConfigSubpage?.classList.add("hidden");
  configuringServerID = "";
}

function openManagedServerConfig(id) {
  configuringServerID = id || "local";
  const srv = serverByID(configuringServerID) || { name: "Master node" };
  if (cfgServerName) cfgServerName.textContent = srv.name || srv.base_url || configuringServerID;
  serversListView?.classList.add("hidden");
  serverConfigSubpage?.classList.remove("hidden");
  loadManagedServerConfig(configuringServerID);
}

function toggleManagedDnsttFields(on) {
  const el = document.getElementById("managedDnsttFields");
  if (!el) return;
  el.style.opacity = on ? "1" : ".4";
  el.style.pointerEvents = on ? "" : "none";
}
function toggleManagedUdpgwFields(on) {
  const el = document.getElementById("managedUdpgwFields");
  if (!el) return;
  el.style.opacity = on ? "1" : ".4";
  el.style.pointerEvents = on ? "" : "none";
}

async function loadManagedServerConfig(id) {
  if (!id) return;
  const st = document.getElementById("managedConfigStatus");
  if (st) st.textContent = "Loading config…";
  try {
    const res = await api(withServerParam("/api/servers/config", id));
    if (!res.ok) throw new Error(await res.text());
    const c = await res.json();

    document.getElementById("managedCfgListen").value = c.listen || "";
    document.getElementById("managedCfgExtraListen").value = (c.extra_listen || []).join("\n");
    document.getElementById("managedCfgProxyAutoRestart").value = c.proxy_auto_restart_interval || "";
    document.getElementById("managedCfgProxyRestartGrace").value = c.proxy_auto_restart_grace || "";

    document.getElementById("managedCfgLimitUp").value = c.default_limit_mbps_up || 0;
    document.getElementById("managedCfgLimitDown").value = c.default_limit_mbps_down || 0;
    document.getElementById("managedCfgSSHIdleTimeout").value = c.ssh_idle_timeout || "0s";
    document.getElementById("managedCfgQuiet").checked = !!c.quiet;
    document.getElementById("managedCfgUserCount").checked = !!c.user_count;
    document.getElementById("managedCfgPamAuth").checked = !!c.pam_auth_enabled;
    document.getElementById("managedCfgBanner").value = c.banner || "";

    const hasDnstt = !!c.dnstt;
    document.getElementById("managedCfgDnsttEnabled").checked = hasDnstt;
    toggleManagedDnsttFields(hasDnstt);
    const d = c.dnstt || {};
    document.getElementById("managedCfgDnsttDomains").value = dnsttDomainsText(d);
    document.getElementById("managedCfgDnsttUDP").value = d.udp_listen || "0.0.0.0:5300";
    document.getElementById("managedCfgDnsttFakeEnabled").checked = !!d.fake_dns_enabled;
    document.getElementById("managedCfgDnsttFakeListen").value = d.fake_dns_listen || "";
    document.getElementById("managedCfgDnsttFakeDomain").value = d.fake_dns_domain || "t.local.lan";
    document.getElementById("managedCfgDnsttFakeWorkers").value = d.fake_dns_workers || 0;
    document.getElementById("managedCfgDnsttRespWorkers").value = d.dns_response_workers || 0;
    document.getElementById("managedCfgDnsttAutoRestart").value = d.auto_restart_interval || "";
    document.getElementById("managedCfgDnsttRestartGrace").value = d.auto_restart_grace || "";
    document.getElementById("managedCfgDnsttMaxSessions").value = d.max_sessions || 0;
    document.getElementById("managedCfgDnsttMaxStreams").value = d.max_streams || 0;
    document.getElementById("managedCfgDnsttPendingResponses").value = d.pending_responses || 0;
    document.getElementById("managedCfgDnsttStreamBuffer").value = d.stream_buffer || 0;
    document.getElementById("managedCfgDnsttUDPReadBuffer").value = d.udp_read_buffer || 0;
    document.getElementById("managedCfgDnsttUDPWriteBuffer").value = d.udp_write_buffer || 0;
    document.getElementById("managedCfgDnsttKey").value = d.privkey_file || "/opt/sshpanel/dnstt.key";
    document.getElementById("managedCfgDnsttNoStats").checked = !!d.disable_stats_log;
    document.getElementById("managedCfgDnsttNoConsole").checked = !!d.disable_console_log;
    document.getElementById("managedCfgDnsttLogConnections").checked = !!d.log_connections;

    const hasUdpgw = !!c.udpgw;
    document.getElementById("managedCfgUdpgwEnabled").checked = hasUdpgw;
    toggleManagedUdpgwFields(hasUdpgw);
    const u = c.udpgw || {};
    document.getElementById("managedCfgUdpgwListen").value = u.listen || "";
    document.getElementById("managedCfgUdpgwMaxConns").value = u.max_client_conns || 0;
    document.getElementById("managedCfgUdpgwIdle").value = u.idle_timeout || "";
    document.getElementById("managedCfgUdpgwMapTTL").value = u.map_ttl || "";
    document.getElementById("managedCfgUdpgwAutoRestart").value = u.auto_restart_interval || "";
    document.getElementById("managedCfgUdpgwRestartGrace").value = u.auto_restart_grace || "";
    document.getElementById("managedCfgUdpgwDebug").checked = !!u.debug;

    managedTlsForwardersState = c.tls_forwarders || [];
    renderManagedTLSForwarders();

    const x = c.xray || {};
    document.getElementById("managedCfgXrayEnabled").checked = !!x.enabled;
    document.getElementById("managedCfgXrayMode").value = xrayModeFromConfig(x);

    document.getElementById("managedDnsttPubkeyWrap")?.classList.add("hidden");
    if (st) st.textContent = "Config loaded.";
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else if (st) st.textContent = "Error: " + e.message;
  }
}

function managedConfigFromForm() {
  const extraLines = document.getElementById("managedCfgExtraListen").value
    .split("\n").map(s => s.trim()).filter(Boolean);
  const dnsttDomains = readDnsttDomains("managedCfgDnsttDomains");
  return {
    listen: document.getElementById("managedCfgListen").value.trim(),
    extra_listen: extraLines,
    proxy_auto_restart_interval: document.getElementById("managedCfgProxyAutoRestart").value.trim(),
    proxy_auto_restart_grace: document.getElementById("managedCfgProxyRestartGrace").value.trim(),
    host_key_file: "/opt/sshpanel/ssh_host_rsa_key",
    admin_dir: "/opt/sshpanel/admin",
    default_limit_mbps_up: parseInt(document.getElementById("managedCfgLimitUp").value || "0", 10),
    default_limit_mbps_down: parseInt(document.getElementById("managedCfgLimitDown").value || "0", 10),
    ssh_idle_timeout: document.getElementById("managedCfgSSHIdleTimeout").value.trim() || "0s",
    quiet: document.getElementById("managedCfgQuiet").checked,
    user_count: document.getElementById("managedCfgUserCount").checked,
    pam_auth_enabled: document.getElementById("managedCfgPamAuth").checked,
    banner: document.getElementById("managedCfgBanner").value,
    banner_file: "/opt/sshpanel/banner.txt",
    dnstt: document.getElementById("managedCfgDnsttEnabled").checked ? {
      domain: dnsttDomains[0] || "",
      domains: dnsttDomains,
      udp_listen: document.getElementById("managedCfgDnsttUDP").value.trim() || "0.0.0.0:5300",
      fake_dns_enabled: document.getElementById("managedCfgDnsttFakeEnabled").checked,
      fake_dns_listen: document.getElementById("managedCfgDnsttFakeListen").value.trim(),
      fake_dns_domain: document.getElementById("managedCfgDnsttFakeDomain").value.trim(),
      fake_dns_workers: parseInt(document.getElementById("managedCfgDnsttFakeWorkers").value || "0", 10),
      dns_response_workers: parseInt(document.getElementById("managedCfgDnsttRespWorkers").value || "0", 10),
      auto_restart_interval: document.getElementById("managedCfgDnsttAutoRestart").value.trim(),
      auto_restart_grace: document.getElementById("managedCfgDnsttRestartGrace").value.trim(),
      max_sessions: parseInt(document.getElementById("managedCfgDnsttMaxSessions").value || "0", 10),
      max_streams: parseInt(document.getElementById("managedCfgDnsttMaxStreams").value || "0", 10),
      pending_responses: parseInt(document.getElementById("managedCfgDnsttPendingResponses").value || "0", 10),
      stream_buffer: parseInt(document.getElementById("managedCfgDnsttStreamBuffer").value || "0", 10),
      udp_read_buffer: parseInt(document.getElementById("managedCfgDnsttUDPReadBuffer").value || "0", 10),
      udp_write_buffer: parseInt(document.getElementById("managedCfgDnsttUDPWriteBuffer").value || "0", 10),
      privkey_file: document.getElementById("managedCfgDnsttKey").value.trim(),
      disable_stats_log: document.getElementById("managedCfgDnsttNoStats").checked,
      disable_console_log: document.getElementById("managedCfgDnsttNoConsole").checked,
      log_connections: document.getElementById("managedCfgDnsttLogConnections").checked,
    } : null,
    udpgw: document.getElementById("managedCfgUdpgwEnabled").checked ? {
      listen: document.getElementById("managedCfgUdpgwListen").value.trim(),
      max_client_conns: parseInt(document.getElementById("managedCfgUdpgwMaxConns").value || "0", 10),
      idle_timeout: document.getElementById("managedCfgUdpgwIdle").value.trim(),
      map_ttl: document.getElementById("managedCfgUdpgwMapTTL").value.trim(),
      auto_restart_interval: document.getElementById("managedCfgUdpgwAutoRestart").value.trim(),
      auto_restart_grace: document.getElementById("managedCfgUdpgwRestartGrace").value.trim(),
      debug: document.getElementById("managedCfgUdpgwDebug").checked,
    } : null,
    tls_forwarders: managedTlsForwardersState,
    xray: {
      enabled: document.getElementById("managedCfgXrayEnabled").checked,
      mode: document.getElementById("managedCfgXrayMode").value === "external" ? "external" : "native",
      native: document.getElementById("managedCfgXrayMode").value !== "external",
      bin_path: "/opt/sshpanel/xray",
      config_file: "/opt/sshpanel/xray_config.json",
      native_config_file: "/opt/sshpanel/xray_native_config.json",
      api_server: "127.0.0.1:10085",
      online_window_seconds: 90,
      stats_poll_seconds: 15,
    },
  };
}

async function saveManagedServerConfig() {
  if (!configuringServerID) return;
  const st = document.getElementById("managedConfigStatus");
  if (st) st.textContent = "Saving config…";
  try {
    const cfg = managedConfigFromForm();
    const res = await api(withServerParam("/api/servers/config", configuringServerID), { method:"POST", body: JSON.stringify(cfg) });
    if (!res.ok) throw new Error(await res.text());
    const report = await res.json().catch(() => null);
    const warnings = report?.warnings || [];
    const bad = Object.entries(report?.services || {}).filter(([_, v]) => v?.enabled && !v?.running);
    if (warnings.length || bad.length) {
      const badText = bad.map(([name, v]) => `${name}: ${v.error || "not running"}`).join(" | ");
      if (st) st.textContent = "Saved live with warnings: " + [...warnings, badText].filter(Boolean).join(" | ");
    } else if (st) {
      st.textContent = "Saved and applied live.";
    }
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else if (st) st.textContent = "Error: " + e.message;
  }
}

function renderManagedTLSForwarders() {
  const list = document.getElementById("managedTlsForwardersList");
  const chip = document.getElementById("managedTlsCountChip");
  if (!list) return;
  if (chip) chip.textContent = managedTlsForwardersState.length;
  if (!managedTlsForwardersState.length) {
    list.innerHTML = '<div class="hint" style="padding:4px 0;">No TLS forwarders configured.</div>';
    return;
  }
  list.innerHTML = "";
  managedTlsForwardersState.forEach((fw, i) => {
    const row = document.createElement("div");
    row.style = "display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:.73rem;";
    row.innerHTML = `<span style="flex:1;font-family:monospace;">${escapeHTML(fw.listen || "")}</span>
      <span class="hint">${escapeHTML(fw.cert_file ? fw.cert_file.split("/").pop() : "no cert")}</span>`;
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.textContent = "Remove";
    delBtn.onclick = () => { managedTlsForwardersState.splice(i,1); renderManagedTLSForwarders(); };
    row.appendChild(delBtn);
    list.appendChild(row);
  });
}

function toggleManagedAddTLSForm() {
  const panel = document.getElementById("managedAddTLSPanel");
  if (!panel) return;
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) {
    document.getElementById("managedTlsAddStatus").textContent = "";
    document.getElementById("managedTlsListenAddr").value = "";
    document.getElementById("managedTlsSSLDomain").value = "";
    document.getElementById("managedTlsCertType").value = "selfsigned";
    onManagedTLSTypeChange("selfsigned");
  }
}

function onManagedTLSTypeChange(val) {
  const setVisible = (id, on, display = "") => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("hidden", !on);
    el.style.display = on ? display : "none";
  };
  setVisible("managedTlsSSFields", val === "selfsigned", "");
  setVisible("managedTlsLEFields", val === "letsencrypt", "grid");
  setVisible("managedTlsPasteFields", val === "paste", "");
  setVisible("managedTlsCustomFields", val === "custom", "grid");
}

async function addManagedTLSForwarder() {
  const st = document.getElementById("managedTlsAddStatus");
  const listen = document.getElementById("managedTlsListenAddr").value.trim();
  const certType = document.getElementById("managedTlsCertType").value;
  if (!listen) { st.textContent = "Listen address required."; return; }
  let certFile = "", keyFile = "";
  st.textContent = "Processing…";
  if (certType === "selfsigned") {
    const domain = document.getElementById("managedTlsSSLDomain").value.trim();
    if (!domain) { st.textContent = "Domain required."; return; }
    try {
      const res = await api(withServerParam("/api/tls/generate-selfsigned", configuringServerID), { method:"POST", body: JSON.stringify({ domain }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      certFile = data.cert_file; keyFile = data.key_file;
      st.textContent = "Self-signed cert generated.";
    } catch (e) {
      if (e.message === "auth") doAuthError();
      else st.textContent = "Cert error: " + e.message;
      return;
    }
  } else if (certType === "letsencrypt") {
    const domain = document.getElementById("managedTlsLEDomain").value.trim();
    const email = document.getElementById("managedTlsLEEmail").value.trim();
    if (!domain || !email) { st.textContent = "Domain and email required."; return; }
    st.textContent = "Running certbot… (may take ~30s)";
    try {
      const res = await api(withServerParam("/api/tls/letsencrypt", configuringServerID), { method:"POST", body: JSON.stringify({ domain, email }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      certFile = data.cert_file; keyFile = data.key_file;
      st.textContent = "Let's Encrypt cert issued.";
    } catch (e) {
      if (e.message === "auth") doAuthError();
      else st.textContent = "certbot error: " + e.message;
      return;
    }
  } else if (certType === "paste") {
    const name = document.getElementById("managedTlsPasteName").value.trim();
    const cert = document.getElementById("managedTlsPasteCert").value.trim();
    const key = document.getElementById("managedTlsPasteKey").value.trim();
    if (!name || !cert || !key) { st.textContent = "Name, cert PEM, and key PEM required."; return; }
    try {
      const res = await api(withServerParam("/api/tls/upload-pem", configuringServerID), { method:"POST", body: JSON.stringify({ name, cert, key }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      certFile = data.cert_file; keyFile = data.key_file;
      st.textContent = "PEM saved.";
    } catch (e) {
      if (e.message === "auth") doAuthError();
      else st.textContent = "Upload error: " + e.message;
      return;
    }
  } else {
    certFile = document.getElementById("managedTlsCustomCert").value.trim();
    keyFile = document.getElementById("managedTlsCustomKey").value.trim();
    if (!certFile || !keyFile) { st.textContent = "Cert and key paths required."; return; }
  }
  managedTlsForwardersState.push({ listen, cert_file: certFile, key_file: keyFile });
  renderManagedTLSForwarders();
  document.getElementById("managedAddTLSPanel").classList.add("hidden");
  st.textContent = "Added. Save config to apply.";
}

async function generateManagedDnsttKey() {
  const st = document.getElementById("managedDnsttKeyStatus");
  if (st) st.textContent = "Generating key…";
  try {
    const res = await api(withServerParam("/api/dnstt/genkey", configuringServerID), { method:"POST" });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    document.getElementById("managedCfgDnsttKey").value = data.privkey_file || "/opt/sshpanel/dnstt.key";
    if (st) st.textContent = "Key generated. Save config to apply.";
    await loadManagedDnsttPubkey();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else if (st) st.textContent = "Error: " + e.message;
  }
}

async function loadManagedDnsttPubkey() {
  const st = document.getElementById("managedDnsttKeyStatus");
  if (st) st.textContent = "Loading public key…";
  try {
    const res = await api(withServerParam("/api/dnstt/pubkey", configuringServerID));
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const val = data.public_key || data.pubkey || "";
    document.getElementById("managedDnsttPubkeyVal").value = val;
    document.getElementById("managedDnsttPubkeyWrap")?.classList.remove("hidden");
    if (st) st.textContent = val ? "Public key loaded." : "No public key returned.";
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else if (st) st.textContent = "Error: " + e.message;
  }
}
