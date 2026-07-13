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
  inbounds.forEach((ib, inboundIndex) => {
	const formKey = String(inboundIndex);
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
	openButton.textContent = t("+ Add Client");
	openButton.addEventListener("click", () => openAddClient(ib.tag, formKey));
	hdr.appendChild(openButton);
    section.appendChild(hdr);

    // Add client mini-form (hidden by default)
    const addForm = document.createElement("div");
    addForm.id = `add-form-${formKey}`;
    addForm.className = "hidden";
    addForm.style = "background:rgba(15,23,42,.9);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px;";
    addForm.innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr 1fr;">
        <div class="field">
          <label>UUID</label>
          <div class="field-row">
			<input id="newUUID-${formKey}" placeholder="auto-generate" style="border-radius:6px;"/>
			<button class="btn btn-ghost btn-sm" id="genUUID-${formKey}" type="button">Gen</button>
          </div>
        </div>
		<div class="field"><label>${t("Email / label")}</label><input id="newEmail-${formKey}" placeholder="user@example" style="border-radius:6px;"/></div>
		<div class="field"><label>${t("Display Name")}</label><input id="newName-${formKey}" placeholder="e.g. Maykinho01" style="border-radius:6px;"/></div>
		<div class="field"><label>${t("Expiry Date")}</label><input type="datetime-local" id="newExpiry-${formKey}" style="border-radius:6px;color-scheme:dark;"/></div>
		<div class="field"><label>${t("Max Connections")} <span class="hint">${t("(0 = unlimited)")}</span></label><input type="number" min="0" id="newMaxConns-${formKey}" placeholder="0" style="border-radius:6px;"/></div>
      </div>
      <div class="form-actions" style="margin-top:6px;">
		<button class="btn btn-sm" id="addClient-${formKey}" type="button">${t("Add")}</button>
		<button class="btn btn-ghost btn-sm" id="cancelAddClient-${formKey}" type="button">${t("Cancel")}</button>
      </div>`;
	addForm.querySelector(`#genUUID-${formKey}`).addEventListener("click", () => { document.getElementById(`newUUID-${formKey}`).value = genUUID(); });
	addForm.querySelector(`#addClient-${formKey}`).addEventListener("click", () => addClient(ib.tag, formKey));
	addForm.querySelector(`#cancelAddClient-${formKey}`).addEventListener("click", () => addForm.classList.add("hidden"));
    section.appendChild(addForm);

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
        const delBtn = document.createElement("button");
        delBtn.className = "btn btn-danger btn-sm";
        delBtn.style.marginLeft = "4px";
        delBtn.textContent = t("Del");
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

function openAddClient(tag, formKey = tag) {
	const form = document.getElementById(`add-form-${formKey}`);
  if (form) { form.classList.remove("hidden"); }
	const uuidField = document.getElementById(`newUUID-${formKey}`);
  if (uuidField && !uuidField.value) uuidField.value = genUUID();
}

async function addClient(tag, formKey = tag) {
	const uuidEl     = document.getElementById(`newUUID-${formKey}`);
	const emailEl    = document.getElementById(`newEmail-${formKey}`);
	const nameEl     = document.getElementById(`newName-${formKey}`);
	const expiryEl   = document.getElementById(`newExpiry-${formKey}`);
	const maxConnsEl = document.getElementById(`newMaxConns-${formKey}`);
  const uuid       = (uuidEl?.value || "").trim();
  const email      = (emailEl?.value || "").trim();
  const name       = (nameEl?.value || "").trim();
  const expiresAt  = isoFromLocal(expiryEl?.value || "");
  const maxConns   = parseInt(maxConnsEl?.value || "0", 10) || 0;
  if (!uuid) { xStatus.textContent = t("UUID required."); return; }
  try {
    const res = await api("/api/xray/clients/add", {
      method: "POST",
      body: JSON.stringify({ inbound_tag: tag, uuid, email, name, expires_at: expiresAt, max_connections: maxConns, server_id: selectedXrayServer() }),
    });
    if (!res.ok) throw new Error(await res.text());
    xStatus.textContent = t("Client {id}… added. Native mode hot-reloads without restart.", {id: uuid.slice(0,8)});
    setTimeout(() => { loadInbounds({ force: true }); if (currentRole === "reseller") loadMe(); }, 1500);
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else xStatus.textContent = t("Error: {error}", {error: e.message});
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
