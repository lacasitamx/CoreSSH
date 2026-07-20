// ─── Xray ─────────────────────────────────────────────────────────────────────
document.getElementById("xStartBtn").addEventListener("click", () => xrayCtrl("start"));
document.getElementById("xStopBtn").addEventListener("click", () => xrayCtrl("stop"));
document.getElementById("xRestartBtn").addEventListener("click", () => xrayCtrl("restart"));
document.getElementById("xRepairStatsBtn")?.addEventListener("click", repairXrayStats);
xSaveModeBtn?.addEventListener("click", saveXrayCoreMode);
document.getElementById("xRefreshBtn").addEventListener("click", () => { loadXrayStatus(); loadInbounds({ force: true }); });
document.getElementById("xLoadInboundsBtn").addEventListener("click", () => loadInbounds({ force: true }));
document.getElementById("xLoadCfgBtn").addEventListener("click", loadXrayCfg);
document.getElementById("xSaveCfgBtn").addEventListener("click", saveXrayCfg);
document.getElementById("xLoadLogsBtn").addEventListener("click", loadXrayLogs);
document.getElementById("xrayOpenCreateBtn")?.addEventListener("click", () => navigateWorkspaceSection("xray", "create"));
document.getElementById("xCreateCancelBtn")?.addEventListener("click", () => setWorkspaceSection("xray", "users"));
document.getElementById("xCreateUUIDBtn")?.addEventListener("click", () => {
  const field = document.getElementById("xCreateUUID");
  if (field) field.value = genUUID();
});
document.getElementById("xCreateInbound")?.addEventListener("change", updateXrayCreatorInboundLabel);
document.getElementById("xCreateClientForm")?.addEventListener("submit", submitXrayClientCreator);

// Keep Xray list controls consistent with the sortable SSH user table while
// preserving the inbound grouping. Sorting is applied inside each inbound;
// filters apply across all inbound groups.
const XRAY_CLIENT_SORT_EXTRACT = {
  name: c => String(c.name || c.email || c.id || "").toLowerCase(),
  status: c => c.expired ? 0 : 1,
  online: c => c.online ? 1 : 0,
  connections: c => Number(c.active_connections || 0),
  usage: c => Number(c.total_bytes || ((c.uplink_bytes || 0) + (c.downlink_bytes || 0)) || 0),
  expiry: c => c.expires_at ? new Date(c.expires_at).getTime() : Infinity,
  max: c => Number(c.max_conns || 0),
};
const XRAY_CLIENT_SORT_DEFAULT_DESC = new Set(["status", "online", "connections", "usage", "max"]);
const XRAY_CLIENT_SORT_OPTIONS = [
  ["name", "Name"], ["status", "Status"], ["online", "Online"],
  ["connections", "Connections"], ["usage", "Usage"], ["expiry", "Expiry"], ["max", "Max"],
];
const XRAY_CLIENT_FILTER_OPTIONS = [
  ["all", "All"], ["online", "Online"], ["offline", "Offline"],
  ["active", "Active"], ["expired", "Expired"], ["quota", "Quota reached"],
];
let xrayClientSort = { key: "name", dir: "asc" };
let xrayClientFilter = "all";
let lastXrayInboundsData = [];

function xrayClientMatchesFilter(client) {
  switch (xrayClientFilter) {
    case "online": return !!client.online;
    case "offline": return !client.online;
    case "active": return !client.expired;
    case "expired": return !!client.expired;
    case "quota": return !!client.quota_exceeded;
    default: return true;
  }
}

function sortXrayClients(clients = []) {
  const extract = XRAY_CLIENT_SORT_EXTRACT[xrayClientSort.key] || XRAY_CLIENT_SORT_EXTRACT.name;
  const direction = xrayClientSort.dir === "desc" ? -1 : 1;
  return clients.slice().sort((a, b) => {
    const left = extract(a), right = extract(b);
    let comparison;
    if (typeof left === "number" && typeof right === "number") comparison = left - right;
    else comparison = String(left).localeCompare(String(right));
    if (comparison === 0) comparison = String(a.name || a.email || a.id || "").localeCompare(String(b.name || b.email || b.id || ""));
    return comparison * direction;
  });
}

function prepareXrayInboundsForList(inbounds = []) {
  return (inbounds || []).map(inbound => ({
    ...inbound,
    clients: sortXrayClients((inbound.clients || []).filter(xrayClientMatchesFilter)),
  })).filter(inbound => xrayClientFilter === "all" || inbound.clients.length > 0);
}

function xrayClientListCounts(inbounds = []) {
  const clients = (inbounds || []).flatMap(inbound => inbound.clients || []);
  return { total: clients.length, visible: clients.filter(xrayClientMatchesFilter).length };
}

function renderXrayListControls() {
  const sortLabel = document.getElementById("xraySortLabel");
  const filterLabel = document.getElementById("xrayFilterLabel");
  const sortButtons = document.getElementById("xraySortButtons");
  const filterButtons = document.getElementById("xrayFilterButtons");
  const count = document.getElementById("xrayListCount");
  if (sortLabel) sortLabel.textContent = t("Sort by");
  if (filterLabel) filterLabel.textContent = t("Show");
  if (sortButtons) {
    sortButtons.replaceChildren(...XRAY_CLIENT_SORT_OPTIONS.map(([key, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "user-list-filter-btn" + (xrayClientSort.key === key ? " active" : "");
      button.textContent = t(label);
      button.setAttribute("aria-pressed", xrayClientSort.key === key ? "true" : "false");
      if (xrayClientSort.key === key) button.dataset.direction = xrayClientSort.dir;
      button.addEventListener("click", () => setXrayClientSort(key));
      return button;
    }));
  }
  if (filterButtons) {
    filterButtons.replaceChildren(...XRAY_CLIENT_FILTER_OPTIONS.map(([key, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "user-list-filter-btn" + (xrayClientFilter === key ? " active" : "");
      button.textContent = t(label);
      button.setAttribute("aria-pressed", xrayClientFilter === key ? "true" : "false");
      button.addEventListener("click", () => setXrayClientFilter(key));
      return button;
    }));
  }
  if (count) {
    const counts = xrayClientListCounts(lastXrayInboundsData);
    count.textContent = t("{visible} of {total} users", counts);
  }
}

function setXrayClientSort(key) {
  if (!XRAY_CLIENT_SORT_EXTRACT[key]) return;
  if (xrayClientSort.key === key) xrayClientSort.dir = xrayClientSort.dir === "asc" ? "desc" : "asc";
  else {
    xrayClientSort.key = key;
    xrayClientSort.dir = XRAY_CLIENT_SORT_DEFAULT_DESC.has(key) ? "desc" : "asc";
  }
  renderInbounds(lastXrayInboundsData, { force:true, fromControls:true });
}

function setXrayClientFilter(filter) {
  if (!XRAY_CLIENT_FILTER_OPTIONS.some(([key]) => key === filter)) return;
  xrayClientFilter = filter;
  renderInbounds(lastXrayInboundsData, { force:true, fromControls:true });
}

function bindXrayTableSortHeaders(table) {
  table.querySelectorAll("th[data-sort-key]").forEach(header => {
    const key = header.dataset.sortKey;
    const selected = key === xrayClientSort.key;
    header.classList.toggle("sort-asc", selected && xrayClientSort.dir === "asc");
    header.classList.toggle("sort-desc", selected && xrayClientSort.dir === "desc");
    header.setAttribute("aria-sort", selected ? (xrayClientSort.dir === "asc" ? "ascending" : "descending") : "none");
    header.addEventListener("click", () => setXrayClientSort(key));
  });
}

renderXrayListControls();


async function loadXrayStatus() {
  if (xrayChip) {
    xrayChip.textContent = t("Loading Xray status…");
    xrayChip.className = "workspace-live-status is-loading";
  }
  try {
    const res = await api(withServerParam("/api/xray/status", selectedXrayServer()));
    if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
    const s   = await res.json();
    const run = !!s.running;
    xrayChip.textContent  = run ? t("running") : (s.enabled ? t("stopped") : t("disabled"));
    xrayChip.className    = "workspace-live-status " + (run ? "is-ok" : (s.enabled ? "is-warn" : "is-error"));
    xRunning.textContent  = run ? t("Running") : t("Stopped");
    xRunning.style.color  = run ? "var(--success)" : "var(--danger)";
    xPID.textContent      = s.pid    || (s.native ? "internal" : "--");
    xUptime.textContent   = s.uptime || "--";
    if (xCoreMode) xCoreMode.value = String(s.mode || (s.native ? "native" : "external")).toLowerCase() === "external" ? "external" : "native";
    const statsCfgEl = document.getElementById("xStatsConfig");
    const repairBtn = document.getElementById("xRepairStatsBtn");
    if (statsCfgEl) {
      statsCfgEl.textContent = s.stats_configured ? t("OK") : t("Needs repair");
      statsCfgEl.style.color = s.stats_configured ? "var(--success)" : "var(--warning)";
    }
    if (repairBtn) repairBtn.style.display = s.stats_configured ? "none" : "";
    if (xOnlineUsers) xOnlineUsers.textContent = String(s.online_users ?? 0);
    if (!s.stats_configured && xStatus) {
      const missing = Array.isArray(s.stats_missing) && s.stats_missing.length ? ` Missing: ${s.stats_missing.join(", ")}.` : "";
      xStatus.textContent = t("Online counters need Stats API repair.") + missing;
    } else if (s.stats_error && xStatus) {
      xStatus.textContent = t("Online counters: {error}", {error: s.stats_error});
    } else if (xStatus) {
      xStatus.textContent = s.api_server ? t("Counters API ready at {server}.", {server: s.api_server}) : t("Counters API ready.");
    }
    if (dashServers) dashServers.textContent = String((serversCache || []).filter(n => n.is_active !== false).length || (s.enabled ? 1 : 0));
    if (dashServerStatus) dashServerStatus.textContent = (serversCache || []).length > 1 ? `${(serversCache || []).filter(n => n.is_active !== false).length} nodes configured` : (run ? t("{count} online", {count: 1}) : (s.enabled ? t("stopped") : t("disabled")));
    renderDashboardCounters();
    if (s.error) xStatus.textContent = t("Error: {error}", {error: s.error});
  } catch (e) {
    if (xrayChip) {
      xrayChip.textContent = t("Could not load Xray status");
      xrayChip.className = "workspace-live-status is-error";
    }
    if (xRunning) { xRunning.textContent = t("Error"); xRunning.style.color = "var(--danger)"; }
    if (xStatus && e.message !== "auth") xStatus.textContent = t("Error: {error}", {error:e.message});
    if (e.message==="auth") doAuthError();
  }
}

async function saveXrayCoreMode() {
  const mode = xCoreMode?.value === "external" ? "external" : "native";
  const target = selectedXrayServerLabel();
  const selectedID = selectedXrayServer() || "local";
  if (xStatus) xStatus.textContent = `Saving Xray mode on ${target}...`;
  try {
    const getRes = await api(withServerParam("/api/servers/config", selectedID));
    if (!getRes.ok) throw new Error(await getRes.text());
    const cfg = await getRes.json();
    applyXrayModeToConfig(cfg, mode);
    const postRes = await api(withServerParam("/api/servers/config", selectedID), { method:"POST", body: JSON.stringify(cfg) });
    if (!postRes.ok) throw new Error(await postRes.text());
    if (xStatus) xStatus.textContent = mode === "native"
      ? `Saved on ${target}: using internal native emulator.`
      : `Saved on ${target}: using external Xray binary.`;
    setTimeout(loadXrayStatus, 700);
    setTimeout(() => loadInbounds({ force: true }), 1200);
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else if (xStatus) xStatus.textContent = t("Error: {error}", {error: e.message});
  }
}

async function repairXrayStats() {
  const btn = document.getElementById("xRepairStatsBtn");
  if (btn) btn.disabled = true;
  xStatus.textContent = currentLang === "pt-BR" ? "Verificando e reparando a API de contadores do Xray…" : "Checking and repairing Xray counters API…";
  try {
    const res = await api(withServerParam("/api/xray/stats/repair", selectedXrayServer()), { method:"POST" });
    if (!res.ok) throw new Error(await res.text());
    const d = await res.json().catch(() => ({}));
    xStatus.textContent = d.changed
      ? (d.restarted ? (currentLang === "pt-BR" ? "API de contadores reparada e Xray reiniciado." : "Counters API repaired and Xray restarted.") : (currentLang === "pt-BR" ? "API de contadores reparada. Reinicie o Xray para aplicar." : "Counters API repaired. Restart Xray to apply it."))
      : (currentLang === "pt-BR" ? "A API de contadores já parece correta." : "Counters API already looks correct.");
    setTimeout(loadXrayStatus, 700);
    setTimeout(() => loadInbounds({ force: true }), 1200);
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else xStatus.textContent = (currentLang === "pt-BR" ? "Erro ao reparar contadores: " : "Error repairing counters: ")+e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function xrayCtrl(action) {
  xStatus.textContent = (currentLang === "pt-BR" ? "Processando Xray…" : action.charAt(0).toUpperCase()+action.slice(1)+"ing Xray…");
  try {
    const res = await api(withServerParam(`/api/xray/${action}`, selectedXrayServer()), { method:"POST" });
    if (!res.ok) throw new Error(await res.text());
    xStatus.textContent = currentLang === "pt-BR" ? "Xray OK." : "Xray "+action+" OK.";
    setTimeout(loadXrayStatus, 700);
    setTimeout(() => loadInbounds({ force: true }), 1200);
    return true;
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else xStatus.textContent = t("Error: {error}", {error: e.message});
    return false;
  }
}

async function loadInbounds(options = {}) {
  const { silent = false, force = false } = options || {};
  if (inboundsRefreshInFlight) return;
  inboundsRefreshInFlight = true;
  if (!silent) inboundsContainer.innerHTML = `<div class="hint" style="padding:8px 0;">${t("Loading…")}</div>`;
  else inboundsContainer.classList.add("xray-refreshing");
  try {
    const res      = await api(withServerParam("/api/xray/inbounds", selectedXrayServer()));
    if (!res.ok) throw new Error(await res.text());
    const inbounds = await res.json();
    renderInbounds(inbounds || [], { silent, force });
  } catch (e) {
    if (!silent) inboundsContainer.textContent = t("Error loading inbounds.");
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
  lastXrayInboundsData = Array.isArray(inbounds) ? inbounds : [];
  updateDashboardXray(lastXrayInboundsData);
  syncXrayCreatorInbounds(lastXrayInboundsData);
  const listInbounds = prepareXrayInboundsForList(lastXrayInboundsData);
  const nextStructure = inboundStructure(listInbounds);
  renderXrayListControls();

  if (silent && !force && nextStructure === lastInboundsStructure && patchRenderedInbounds(listInbounds)) return;
  if (silent && !force && isXrayClientEditorActive()) {
    patchRenderedInbounds(listInbounds);
    if (xStatus) xStatus.textContent = t("New client data is available; editing was preserved.");
    return;
  }

  if (!lastXrayInboundsData.length) {
    inboundsContainer.innerHTML = `<div class="hint" style="padding:8px 0;">${t("No VLESS/VMess/Trojan inbounds found.")}</div>`;
    lastInboundsStructure = nextStructure;
    return;
  }
  if (!listInbounds.length) {
    inboundsContainer.innerHTML = `<div class="hint" style="padding:8px 0;">${t("No Xray users match this filter.")}</div>`;
    lastInboundsStructure = nextStructure;
    return;
  }
  inboundsContainer.innerHTML = "";
  lastInboundsStructure = nextStructure;
  listInbounds.forEach(ib => {
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
        <span class="chip ${onlineCount ? "green" : ""}" data-role="inbound-online-chip">${t("{count} online", {count: onlineCount})}</span>
	  </div>`;
	const openButton = document.createElement("button");
	openButton.className = "btn btn-sm";
	openButton.type = "button";
	openButton.textContent = t("Create user");
	openButton.addEventListener("click", () => openAddClient(ib.tag));
	hdr.appendChild(openButton);
    section.appendChild(hdr);

    // Clients table
    const tblWrap = document.createElement("div");
    tblWrap.className = "tbl-wrap";
    if (!clients.length) {
      tblWrap.innerHTML = `<div class="hint" style="padding:4px 0;">${t("No clients.")}</div>`;
    } else {
      const tbl = document.createElement("table");
      tbl.innerHTML = `<thead><tr><th data-sort-key="name">${t("Name")}</th><th>UUID</th><th>${t("Email")}</th><th data-sort-key="expiry">${t("Expiry")}</th><th data-sort-key="status">${t("Status")}</th><th data-sort-key="online">${t("Online")}</th><th data-sort-key="connections">${t("Conn")}</th><th data-sort-key="usage">${t("Traffic")}</th><th data-sort-key="max">${t("Max")}</th><th>${t("Actions")}</th></tr></thead>`;
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
          <td data-cell="connections" style="font-size:.7rem;">${escapeHTML(c.active_connections || 0)}</td>
          <td data-cell="traffic" style="font-size:.7rem;">${clientTrafficHTML(c)}</td>
          <td data-cell="max" style="font-size:.7rem;">${escapeHTML(c.max_conns || "∞")}</td>`;
        const actTd = document.createElement("td");
        actTd.style.whiteSpace = "nowrap";
        const copyBtn = document.createElement("button");
        copyBtn.className = "btn btn-ghost btn-sm";
        copyBtn.textContent = t("Copy");
        copyBtn.onclick = async () => { await copyText(c.id); xStatus.textContent = t("Copied client ID."); };
        const editBtn = document.createElement("button");
        editBtn.className = "btn btn-warn btn-sm";
        editBtn.style.marginLeft = "4px";
        editBtn.textContent = t("Edit");
        editBtn.onclick = () => openEditXrayClient(ib.tag, c);
        const resetBtn = document.createElement("button");
        resetBtn.className = "btn btn-warn btn-sm";
        resetBtn.style.marginLeft = "4px";
        resetBtn.textContent = t("Reset");
        resetBtn.title = t("Reset traffic");
        resetBtn.onclick = () => resetXrayClientTraffic(c.id, resetBtn);
        const delBtn = document.createElement("button");
        delBtn.className = "btn btn-danger btn-sm";
        delBtn.style.marginLeft = "4px";
        delBtn.textContent = t("Del");
        delBtn.onclick = () => removeClient(ib.tag, c.id);
        actTd.append(copyBtn, editBtn, resetBtn, delBtn);
        tr.appendChild(actTd);
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);
      bindXrayTableSortHeaders(tbl);
      tblWrap.appendChild(tbl);
    }
    section.appendChild(tblWrap);

    const divider = document.createElement("hr");
    divider.style = "border:none;border-top:1px solid var(--border);margin-top:10px;";
    section.appendChild(divider);

    inboundsContainer.appendChild(section);
  });
}

let xrayCreatorInbounds = [];
let xrayCreatorInboundSignature = "";

function syncXrayCreatorInbounds(inbounds = []) {
  const select = document.getElementById("xCreateInbound");
  if (!select) return;
  const previous = select.value;
  const nextInbounds = (inbounds || []).filter(ib => ib?.tag).map(ib => ({
    tag: String(ib.tag),
    protocol: String(ib.protocol || "xray").toUpperCase(),
    port: ib.port ?? "?",
  }));
  const nextSignature = JSON.stringify(nextInbounds);
  xrayCreatorInbounds = nextInbounds;
  if (nextSignature === xrayCreatorInboundSignature) {
    updateXrayCreatorInboundLabel();
    return;
  }
  xrayCreatorInboundSignature = nextSignature;
  select.replaceChildren();
  if (!xrayCreatorInbounds.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t("No compatible inbound found");
    select.appendChild(option);
    select.disabled = true;
  } else {
    xrayCreatorInbounds.forEach(inbound => {
      const option = document.createElement("option");
      option.value = inbound.tag;
      option.textContent = `${inbound.protocol} · ${inbound.tag} · :${inbound.port}`;
      select.appendChild(option);
    });
    select.disabled = false;
    select.value = xrayCreatorInbounds.some(inbound => inbound.tag === previous) ? previous : xrayCreatorInbounds[0].tag;
  }
  updateXrayCreatorInboundLabel();
}

function updateXrayCreatorInboundLabel() {
  const selected = document.getElementById("xCreateInbound")?.value || "";
  const inbound = xrayCreatorInbounds.find(item => item.tag === selected);
  const chip = document.getElementById("xCreateProtocolChip");
  const hint = document.getElementById("xCreateInboundHint");
  if (chip) chip.textContent = inbound ? inbound.protocol : t("No inbound");
  if (hint) hint.textContent = inbound
    ? t("The client will be added to {tag} on port {port}.", {tag:inbound.tag, port:inbound.port})
    : t("Create or enable a compatible inbound before adding a client.");
}

function prepareXrayClientCreator(preferredTag = "") {
  const form = document.getElementById("xCreateClientForm");
  form?.reset();
  const inbound = document.getElementById("xCreateInbound");
  if (inbound && preferredTag && xrayCreatorInbounds.some(item => item.tag === preferredTag)) inbound.value = preferredTag;
  const uuid = document.getElementById("xCreateUUID");
  if (uuid) uuid.value = genUUID();
  const maxConns = document.getElementById("xCreateMaxConns");
  if (maxConns) maxConns.value = "0";
  const quotaGB = document.getElementById("xCreateQuotaGB");
  if (quotaGB) quotaGB.value = "0";
  const quotaAction = document.getElementById("xCreateQuotaAction");
  if (quotaAction) quotaAction.value = "block";
  const quotaThrottle = document.getElementById("xCreateQuotaThrottle");
  if (quotaThrottle) quotaThrottle.value = "1";
  const status = document.getElementById("xCreateClientStatus");
  if (status) status.textContent = xrayCreatorInbounds.length ? t("Ready to create a new Xray client.") : t("Waiting for a compatible inbound.");
  updateXrayCreatorInboundLabel();
  requestAnimationFrame(() => document.getElementById("xCreateName")?.focus());
}

function openAddClient(tag) {
  setWorkspaceSection("xray", "create");
  prepareXrayClientCreator(tag);
}

async function submitXrayClientCreator(event) {
  event?.preventDefault?.();
  const tag = document.getElementById("xCreateInbound")?.value || "";
  const uuid = (document.getElementById("xCreateUUID")?.value || "").trim();
  const status = document.getElementById("xCreateClientStatus");
  const button = document.getElementById("xCreateClientBtn");
  if (!tag) { if (status) status.textContent = t("Select a compatible inbound."); return false; }
  if (!uuid) { if (status) status.textContent = t("UUID required."); return false; }
  const payload = {
    inbound_tag: tag,
    uuid,
    email: (document.getElementById("xCreateEmail")?.value || "").trim(),
    name: (document.getElementById("xCreateName")?.value || "").trim(),
    expires_at: isoFromLocal(document.getElementById("xCreateExpiry")?.value || ""),
    max_connections: parseInt(document.getElementById("xCreateMaxConns")?.value || "0", 10) || 0,
    data_quota_bytes: Math.round((parseFloat(document.getElementById("xCreateQuotaGB")?.value || "0") || 0) * (1024 ** 3)),
    quota_action: document.getElementById("xCreateQuotaAction")?.value === "throttle" ? "throttle" : "block",
    quota_throttle_mbps: parseInt(document.getElementById("xCreateQuotaThrottle")?.value || "1", 10) || 1,
    server_id: selectedXrayServer(),
  };
  if (button) button.disabled = true;
  if (status) status.textContent = t("Creating Xray client…");
  try {
    const res = await api("/api/xray/clients/add", { method:"POST", body:JSON.stringify(payload) });
    if (!res.ok) throw new Error(await res.text());
    const success = t("Client {id}… added. Native mode hot-reloads without restart.", {id:uuid.slice(0,8)});
    if (status) status.textContent = success;
    xStatus.textContent = success;
    showPanelToast(t("Xray user created successfully."), "success", t("Xray user"));
    setTimeout(() => { loadInbounds({ force:true }); if (currentRole === "reseller") loadMe(); }, 700);
    const name = document.getElementById("xCreateName");
    const email = document.getElementById("xCreateEmail");
    const expiry = document.getElementById("xCreateExpiry");
    if (name) name.value = "";
    if (email) email.value = "";
    if (expiry) expiry.value = "";
    const nextUUID = document.getElementById("xCreateUUID");
    if (nextUUID) nextUUID.value = genUUID();
    return true;
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else {
      if (status) status.textContent = t("Error: {error}", {error:e.message});
      xStatus.textContent = t("Error: {error}", {error:e.message});
      showPanelToast(t("Could not create the Xray user: {error}", {error:e.message}), "error", t("Xray user"));
    }
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

async function resetXrayClientTraffic(uuid, button) {
  const shortID = String(uuid || "").slice(0, 8);
  const accepted = await panelConfirm({
    tone:"warning", icon:"↺", title:t("Reset Xray traffic"),
    message:t("Reset traffic for client {id}…?", {id:shortID}),
    detail:t("Current uploaded and downloaded usage will return to zero. The account, expiry and quota remain unchanged."),
    confirmLabel:t("Reset traffic"),
  });
  if (!accepted) return;
  const previousDisabled = !!button?.disabled;
  if (button) button.disabled = true;
  xStatus.textContent = t("Resetting traffic for client {id}…", {id:shortID});
  try {
    const res = await api("/api/xray/clients/reset-traffic", {
      method:"POST",
      body:JSON.stringify({ uuid, server_id:selectedXrayServer() }),
    });
    if (!res.ok) throw new Error((await res.text()) || "reset failed");
    xStatus.textContent = t("Xray traffic reset successfully.");
    showPanelToast(t("Xray traffic reset successfully."), "success", t("Xray user"));
    if (editingXrayClientId === uuid) {
      const usage = document.getElementById("editXrayUsage");
      if (usage) usage.value = "0 B (↑ 0 B · ↓ 0 B)";
      const resetUsage = document.getElementById("editXrayResetUsage");
      if (resetUsage) resetUsage.checked = false;
    }
    await loadInbounds({ force:true });
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else {
      xStatus.textContent = t("Could not reset traffic: {error}", {error:e.message});
      showPanelToast(t("Could not reset traffic: {error}", {error:e.message}), "error", t("Xray user"));
    }
  } finally {
    if (button) button.disabled = previousDisabled;
  }
}

async function removeClient(tag, uuid) {
  const accepted = await panelConfirm({
    tone:"danger", icon:"×", title:t("Remove Xray client"),
    message:t("Remove client {id}… from {tag}?", {id: uuid.slice(0,8), tag}),
    detail:t("The client will lose access immediately after the configuration reload."),
    confirmLabel:t("Remove client"),
  });
  if (!accepted) return;
  try {
    const res = await api(withServerParam(`/api/xray/clients/remove?inbound_tag=${encodeURIComponent(tag)}&uuid=${encodeURIComponent(uuid)}`, selectedXrayServer()), { method:"DELETE" });
    if (!res.ok && res.status !== 204) throw new Error(await res.text());
    xStatus.textContent = t("Client removed. Native mode hot-reloads without restart.");
    showPanelToast(t("Client removed successfully."), "success", t("Xray client"));
    setTimeout(() => { loadInbounds({ force: true }); if (currentRole === "reseller") loadMe(); }, 1500);
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else xStatus.textContent = t("Error: {error}", {error: e.message});
  }
}

async function loadXrayCfg() {
  if (!xCfgEditor) return;
  const target = selectedXrayServerLabel();
  if (xCfgStatus) xCfgStatus.textContent = `Loading config from ${target}…`;
  try {
    const res  = await api(withServerParam("/api/xray/config", selectedXrayServer()));
    if (!res.ok) throw new Error(await res.text());
    const text = await res.text();
    try { xCfgEditor.value = JSON.stringify(JSON.parse(text), null, 2); }
    catch { xCfgEditor.value = text; }
    if (xCfgStatus) xCfgStatus.textContent = `Config loaded from ${target}.`;
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else if (xCfgStatus) xCfgStatus.textContent = t("Error: {error}", {error: e.message});
  }
}

async function saveXrayCfg() {
  const text = (xCfgEditor?.value || "").trim();
  const target = selectedXrayServerLabel();
  try { JSON.parse(text); } catch(e) { if (xCfgStatus) xCfgStatus.textContent = t("Invalid JSON: {error}", {error: e.message}); return; }
  if (xCfgStatus) xCfgStatus.textContent = `Saving config to ${target}…`;
  try {
    const res = await api(withServerParam("/api/xray/config", selectedXrayServer()), { method:"POST", body: text });
    if (!res.ok) throw new Error(await res.text());
    if (xCfgStatus) xCfgStatus.textContent = `Saved on ${target}. Restarting Xray…`;
    await xrayCtrl("restart");
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else if (xCfgStatus) xCfgStatus.textContent = t("Error: {error}", {error: e.message});
  }
}

async function loadXrayLogs() {
  try {
    const res  = await api(withServerParam("/api/xray/logs", selectedXrayServer()));
    const data = await res.json();
    xLogsBox.textContent = (data.lines||[]).join("\n");
    xLogsBox.scrollTop   = xLogsBox.scrollHeight;
  } catch (e) { if (e.message==="auth") doAuthError(); }
}
