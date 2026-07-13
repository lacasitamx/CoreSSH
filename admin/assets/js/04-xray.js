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
  updateDashboardXray(inbounds);
  syncXrayCreatorInbounds(inbounds);
  const nextStructure = inboundStructure(inbounds);

  if (silent && !force && nextStructure === lastInboundsStructure && patchRenderedInbounds(inbounds)) return;
  if (silent && !force && isXrayClientEditorActive()) {
    patchRenderedInbounds(inbounds);
    if (xStatus) xStatus.textContent = t("New client data is available; editing was preserved.");
    return;
  }

  if (!inbounds.length) {
    inboundsContainer.innerHTML = `<div class="hint" style="padding:8px 0;">${t("No VLESS/VMess/Trojan inbounds found.")}</div>`;
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
      tbl.innerHTML = `<thead><tr><th>${t("Name")}</th><th>UUID</th><th>${t("Email")}</th><th>${t("Expiry")}</th><th>${t("Status")}</th><th>${t("Online")}</th><th>${t("Traffic")}</th><th>${t("Max")}</th><th>${t("Actions")}</th></tr></thead>`;
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
        const renewBtn = document.createElement("button");
        renewBtn.className = "btn btn-ghost btn-sm";
        renewBtn.style.marginLeft = "4px";
        renewBtn.textContent = "+30d";
        renewBtn.onclick = () => renewXrayClient(c);
        const delBtn = document.createElement("button");
        delBtn.className = "btn btn-danger btn-sm";
        delBtn.style.marginLeft = "4px";
        delBtn.textContent = t("Del");
        delBtn.onclick = () => removeClient(ib.tag, c.id);
        actTd.append(copyBtn, renewBtn, editBtn, delBtn);
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
  if (maxConns) {
    maxConns.min = currentRole === "reseller" ? "1" : "0";
    maxConns.value = currentRole === "reseller" ? "1" : "0";
  }
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

async function renewXrayClient(client) {
  const creditCost = Math.max(1, Number(client.max_conns || 0));
  const creditDetail = currentRole === "reseller" && currentQuotaMode === "credits"
    ? `Serão usados ${creditCost} crédito(s) e a conta receberá 31 dias.`
    : "A validade será estendida em 30 dias a partir da data atual ou da validade existente.";
  const accepted = await panelConfirm({
    icon:"+30", title:"Renovar Xray", message:`Renovar “${client.name || client.email || client.id.slice(0, 8)}”?`,
    detail:creditDetail, confirmLabel:"Renovar conta",
  });
  if (!accepted) return;
  xStatus.textContent = "Renovando cliente Xray…";
  try {
    const res = await api("/api/xray/clients/renew", {
      method:"POST",
      body:JSON.stringify({ uuid:client.id, days:30, server_id:selectedXrayServer() }),
    });
    if (!res.ok) throw new Error((await res.text()).trim());
    const data = await res.json();
    if (data.runtime_warning) showPanelToast(data.runtime_warning, "warning", "Renovar Xray");
    else showPanelToast("Cliente Xray renovado.", "success", "Xray");
    await loadInbounds({ force:true });
    if (currentRole === "reseller") loadMe();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else showPanelToast(e.message, "error", "Renovar Xray");
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
