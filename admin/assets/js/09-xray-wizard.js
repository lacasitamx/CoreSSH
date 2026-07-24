// ─── Xray Client Edit ─────────────────────────────────────────────────────────
function openEditXrayClient(tag, client) {
  editingXrayClientId = client.id;
  document.getElementById("editClientUUID").textContent = client.id;
  document.getElementById("editXrayName").value    = client.name  || "";
  document.getElementById("editXrayEmail").value   = client.email || "";
  document.getElementById("editXrayExpiry").value  = client.expires_at ? localFromISO(client.expires_at) : "";
  document.getElementById("editXrayMaxConns").value = client.max_conns || 0;
  document.getElementById("editXrayQuotaGB").value = client.data_quota_bytes ? (Number(client.data_quota_bytes) / (1024 ** 3)).toFixed(2).replace(/\.00$/, "") : "0";
  document.getElementById("editXrayQuotaAction").value = client.quota_action === "throttle" ? "throttle" : "block";
  document.getElementById("editXrayQuotaThrottle").value = client.quota_throttle_mbps || 1;
  document.getElementById("editXrayUsage").value = `${formatBytes(client.total_bytes || 0)} (↑ ${formatBytes(client.uplink_bytes || 0)} · ↓ ${formatBytes(client.downlink_bytes || 0)})`;
  document.getElementById("editXrayResetUsage").checked = false;
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
    data_quota_bytes: Math.round((parseFloat(document.getElementById("editXrayQuotaGB").value || "0") || 0) * (1024 ** 3)),
    quota_action: document.getElementById("editXrayQuotaAction").value === "throttle" ? "throttle" : "block",
    quota_throttle_mbps: parseInt(document.getElementById("editXrayQuotaThrottle").value || "1", 10) || 1,
    reset_usage: !!document.getElementById("editXrayResetUsage").checked,
    server_id: selectedXrayServer(),
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

document.getElementById("wzLogLevel")?.addEventListener("change", () => { wzDirty = true; });

function cloneJsonSafe(obj) {
  return obj && typeof obj === "object" ? JSON.parse(JSON.stringify(obj)) : obj;
}

function loadWizardFromConfig() {
  const serverID = selectedXrayServer();
  const target = selectedXrayServerLabel();
  const st = document.getElementById("wzStatus");
  wzLoadedServerID = null;
  wzDirty = false;
  if (st) st.textContent = `Loading config from ${target}...`;
  api(withServerParam("/api/xray/config", serverID)).then(async res => {
    if (!res.ok) throw new Error(await res.text());
    const raw = await res.text();
    const cfg = JSON.parse(raw);
    wzLoadedServerID = serverID || "local";
    wzLoadedConfigText = raw;
    wzLoadedFullConfig = cloneJsonSafe(cfg);
    document.getElementById("wzLogLevel").value = cfg.log?.loglevel || "warning";
    wzInbounds = cloneJsonSafe((cfg.inbounds || []).filter(ib => ib && ib.tag !== "api")) || [];
    wzEditingIndex = -1;
    wzCancelInbound();
    renderWzInbounds();
    wzDirty = false;
    const presetStatus = document.getElementById("wzAzionDefaultStatus");
    if (presetStatus) presetStatus.textContent = "O padrão cria o certificado autoassinado, habilita TLS e salva/reinicia o Xray automaticamente.";
    if (st) st.textContent = `Config loaded from ${target}.`;
  }).catch(e => {
    wzLoadedServerID = null;
    wzLoadedConfigText = "";
    wzLoadedFullConfig = null;
    wzInbounds = [];
    wzEditingIndex = -1;
    wzCancelInbound();
    renderWzInbounds();
    if (e.message === "auth") doAuthError();
    else if (st) st.textContent = "Error: " + e.message;
  });
}

function renderWzInbounds() {
  const list = document.getElementById("wzInboundsList");
  if (!list) return;
  list.replaceChildren();
  if (!wzInbounds.length) {
    const empty = document.createElement("div");
    empty.className = "hint visual-empty-state";
    empty.textContent = "Nenhum inbound configurado. Use “Adicionar inbound” ou “Criar padrão Azion XHTTP”.";
    list.appendChild(empty);
    return;
  }
  wzInbounds.forEach((ib, i) => {
    const row = document.createElement("article");
    row.className = "visual-inbound-card";
    const portStr = ib.port !== undefined ? `:${ib.port}` : "";
    const ss  = ib.streamSettings || {};
    const net = ss.network || "";
    const sec = ss.security || "";
    const transportSettings = ss.xhttpSettings || ss.splithttpSettings || ss.wsSettings || ss.httpupgradeSettings || ss.httpSettings || ss.grpcSettings || {};
    const head = document.createElement("div");
    head.className = "visual-inbound-card-head";
    const name = document.createElement("div");
    name.className = "visual-inbound-name";
    const title = document.createElement("strong");
    title.textContent = ib.tag || "untagged";
    const address = document.createElement("small");
    address.textContent = `${ib.listen || "0.0.0.0"}${portStr}`;
    name.append(title, address);
    const protocol = document.createElement("span");
    protocol.className = "chip";
    protocol.textContent = String(ib.protocol || "unknown").toUpperCase();
    head.append(name, protocol);
    row.appendChild(head);

    const meta = document.createElement("div");
    meta.className = "visual-inbound-meta";
    [net || "default", transportSettings.path || transportSettings.serviceName || "no path", sec || "no TLS"].forEach(value => {
      const item = document.createElement("span");
      item.textContent = value;
      meta.appendChild(item);
    });
    row.appendChild(meta);
    const clients = ib.settings?.clients;
    if (Array.isArray(clients) && clients.length) {
      const badge = document.createElement("span");
      badge.className = "chip green";
      badge.textContent = clients.length + " client" + (clients.length!==1?"s":"");
      meta.appendChild(badge);
    }

    const actions = document.createElement("div");
    actions.className = "visual-inbound-actions";
    const xhttp = visualXHTTPSettings(ib);
    const proxyProtocol = String(ib.protocol || "").toLowerCase();
    if (xhttp && ["vless", "vmess"].includes(proxyProtocol)) {
      const sshRoute = findSSHRouteForInbound(ib);
      const sshBtn = document.createElement("button");
      sshBtn.className = sshRoute ? "btn btn-soft btn-sm legacy-ssh-btn is-enabled" : "btn btn-sm legacy-ssh-btn";
      sshBtn.type = "button";
      sshBtn.textContent = t(sshRoute ? "SSH /ssh enabled" : "Enable SSH /ssh");
      sshBtn.disabled = !!sshRoute;
      sshBtn.title = sshRoute ? t("This endpoint already has an SSH /ssh route.") : t("Add SSH /ssh without rebuilding this inbound.");
      sshBtn.onclick = () => enableSSHForWzInbound(i, true, sshBtn);
      actions.appendChild(sshBtn);
    }
    const duplicateBtn = document.createElement("button");
    duplicateBtn.className = "btn btn-ghost btn-sm";
    duplicateBtn.type = "button";
    duplicateBtn.textContent = "Duplicar";
    duplicateBtn.onclick = () => duplicateWzInbound(i);
    const editBtn = document.createElement("button");
    editBtn.className = "btn btn-ghost btn-sm";
    editBtn.type = "button";
    editBtn.textContent = "Editar";
    editBtn.onclick = () => editWzInbound(i);
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.type = "button";
    delBtn.textContent = "Remover";
    delBtn.onclick = async () => {
      const accepted = await panelConfirm({
        tone:"danger", icon:"×", title:t("Remove inbound"),
        message:t("Remove inbound {name}?", {name:ib.tag || "untagged"}),
        detail:t("Clients attached only to this inbound will stop connecting after the configuration is saved."),
        confirmLabel:t("Remove inbound"),
      });
      if (!accepted) return;
      wzInbounds.splice(i,1);
      if (wzEditingIndex === i) wzCancelInbound();
      else if (wzEditingIndex > i) wzEditingIndex--;
      wzDirty = true;
      renderWzInbounds();
    };
    actions.append(duplicateBtn, editBtn, delBtn);
    row.appendChild(actions);
    list.appendChild(row);
  });
}

function wzToggleAddInbound() {
  const form = document.getElementById("wzAddInboundForm");
  if (!form.classList.contains("hidden") && wzEditingIndex < 0) return wzCancelInbound();
  resetWzInboundForm();
  form.classList.remove("hidden");
  form.scrollIntoView({ behavior:"smooth", block:"nearest" });
}

function setWzValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? "";
}

function resetWzInboundForm() {
  wzEditingIndex = -1;
  setWzValue("wzProtocol", "vless");
  setWzValue("wzPort", "10086");
  setWzValue("wzListenIP", "0.0.0.0");
  setWzValue("wzTag", "vless-in");
  setWzValue("wzNetwork", "tcp");
  setWzValue("wzWSPath", "/ws");
  setWzValue("wzXHTTPPath", "/xhttp");
  setWzValue("wzXHTTPHost", "");
  setWzValue("wzXHTTPMode", "auto");
  setWzValue("wzHUPath", "/upgrade");
  setWzValue("wzHUHost", "");
  setWzValue("wzH2Path", "/h2");
  setWzValue("wzH2Host", "");
  setWzValue("wzGRPCService", "grpc-service");
  document.getElementById("wzGRPCMulti").checked = false;
  setWzValue("wzTLS", "none");
  ["wzTLSCert", "wzTLSKey", "wzTLSCertPath", "wzTLSKeyPath", "wzRealityDest", "wzRealitySNI", "wzRealityPriv", "wzRealityShortID", "wzTrojanPass", "wzSSPass"].forEach(id => setWzValue(id, ""));
  setWzValue("wzSSMethod", "chacha20-ietf-poly1305");
  document.getElementById("wzInboundFormKicker").textContent = "Novo inbound";
  document.getElementById("wzInboundFormTitle").textContent = "Adicionar inbound";
  document.getElementById("wzSaveInboundBtn").textContent = "Adicionar inbound";
  document.getElementById("wzEditingBadge").classList.add("hidden");
  onWzProtoChange("vless");
  onWzNetworkChange("tcp");
  onWzTLSChange("none");
}

function wzCancelInbound() {
  wzEditingIndex = -1;
  document.getElementById("wzAddInboundForm")?.classList.add("hidden");
  document.getElementById("wzEditingBadge")?.classList.add("hidden");
}

function editWzInbound(index) {
  const ib = wzInbounds[index];
  if (!ib) return;
  resetWzInboundForm();
  wzEditingIndex = index;
  const proto = String(ib.protocol || "vless").toLowerCase();
  setWzValue("wzProtocol", proto);
  onWzProtoChange(proto);
  setWzValue("wzPort", ib.port ?? "");
  setWzValue("wzListenIP", ib.listen || (proto === "socks" ? "127.0.0.1" : "0.0.0.0"));
  setWzValue("wzTag", ib.tag || `${proto}-in`);

  const ss = ib.streamSettings || {};
  const network = proto === "ssh" ? "xhttp" : (ss.network || "tcp");
  setWzValue("wzNetwork", network);
  onWzNetworkChange(network);
  const xh = ss.xhttpSettings || ss.splithttpSettings || {};
  setWzValue("wzWSPath", ss.wsSettings?.path || "/ws");
  setWzValue("wzXHTTPPath", xh.path || "/xhttp");
  setWzValue("wzXHTTPHost", xh.host || "");
  setWzValue("wzXHTTPMode", xh.mode || "auto");
  setWzValue("wzHUPath", ss.httpupgradeSettings?.path || "/upgrade");
  setWzValue("wzHUHost", ss.httpupgradeSettings?.host || "");
  setWzValue("wzH2Path", ss.httpSettings?.path || "/h2");
  setWzValue("wzH2Host", Array.isArray(ss.httpSettings?.host) ? (ss.httpSettings.host[0] || "") : (ss.httpSettings?.host || ""));
  setWzValue("wzGRPCService", ss.grpcSettings?.serviceName || "grpc-service");
  document.getElementById("wzGRPCMulti").checked = !!ss.grpcSettings?.multiMode;

  const security = ss.security === "tls" ? "tls" : (ss.security === "reality" ? "reality" : "none");
  setWzValue("wzTLS", security);
  onWzTLSChange(security);
  const cert = ss.tlsSettings?.certificates?.[0] || {};
  setWzValue("wzTLSCert", cert.certificateFile || "");
  setWzValue("wzTLSKey", cert.keyFile || "");
  setWzValue("wzTLSCertPath", cert.certificateFile || "");
  setWzValue("wzTLSKeyPath", cert.keyFile || "");
  setWzValue("wzRealityDest", ss.realitySettings?.dest || "");
  setWzValue("wzRealitySNI", ss.realitySettings?.serverNames?.[0] || "");
  setWzValue("wzRealityPriv", ss.realitySettings?.privateKey || "");
  setWzValue("wzRealityShortID", ss.realitySettings?.shortIds?.[0] || "");
  setWzValue("wzTrojanPass", ib.settings?.clients?.[0]?.password || "");
  setWzValue("wzSSPass", ib.settings?.password || "");
  setWzValue("wzSSMethod", ib.settings?.method || "chacha20-ietf-poly1305");

  document.getElementById("wzInboundFormTitle").textContent = `Editar ${ib.tag || "inbound"}`;
  document.getElementById("wzInboundFormKicker").textContent = "Editar inbound existente";
  document.getElementById("wzSaveInboundBtn").textContent = "Salvar alterações";
  document.getElementById("wzEditingBadge").classList.remove("hidden");
  const form = document.getElementById("wzAddInboundForm");
  form.classList.remove("hidden");
  form.scrollIntoView({ behavior:"smooth", block:"start" });
}

function duplicateWzInbound(index) {
  const source = wzInbounds[index];
  if (!source) return;
  const copy = cloneJsonSafe(source);
  const tags = new Set(wzInbounds.map(ib => ib?.tag));
  let n = 2;
  let tag = `${source.tag || source.protocol || "inbound"}-copy`;
  while (tags.has(tag)) tag = `${source.tag || source.protocol || "inbound"}-copy-${n++}`;
  copy.tag = tag;
  const port = Number(copy.port || 0);
  if (port > 0 && port < 65535) copy.port = port + 1;
  wzInbounds.push(copy);
  wzDirty = true;
  renderWzInbounds();
  editWzInbound(wzInbounds.length - 1);
}

function normalizeVisualPath(value) {
  let path = String(value || "/").trim().split("?", 1)[0];
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/+$/, "") || "/";
  return path;
}

function visualXHTTPSettings(ib) {
  const ss = ib?.streamSettings || {};
  if (!["xhttp", "splithttp"].includes(String(ss.network || "").toLowerCase())) return null;
  return ss.xhttpSettings || ss.splithttpSettings || {};
}

function sameVisualEndpoint(a, b) {
  return String(a?.listen || "0.0.0.0") === String(b?.listen || "0.0.0.0") && String(a?.port) === String(b?.port);
}

function findSSHRouteForInbound(source) {
  return wzInbounds.find(candidate => {
    const xh = visualXHTTPSettings(candidate);
    return sameVisualEndpoint(source, candidate) && !!xh && String(candidate?.protocol || "").toLowerCase() === "ssh" && normalizeVisualPath(xh.path) === "/ssh";
  }) || null;
}

function uniqueLegacySSHTag(source) {
  const tags = new Set(wzInbounds.map(ib => String(ib?.tag || "")));
  const sourceTag = String(source?.tag || source?.port || "xhttp").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "xhttp";
  let tag = `ssh-${sourceTag}`;
  let suffix = 2;
  while (tags.has(tag)) tag = `ssh-${sourceTag}-${suffix++}`;
  return tag;
}

// Adds SSH to a legacy VLESS/VMess XHTTP listener without rebuilding or
// modifying the original inbound. The companion inherits its listen address,
// port, host, XHTTP mode, advanced transport options, TLS certificate, and key;
// only its protocol, empty SSH settings, tag, and /ssh path differ.
function reportSSHMigration(message, tone = "error") {
  const st = document.getElementById("wzStatus");
  if (st) st.textContent = message;
  if (typeof showPanelToast === "function") {
    showPanelToast(message, tone, tone === "success" ? t("SSH /ssh enabled") : tone === "warning" ? t("SSH migration attention") : t("Could not enable SSH /ssh"));
  }
}

async function enableSSHForWzInbound(index, applyNow = true, trigger = null) {
  const st = document.getElementById("wzStatus");
  const source = wzInbounds[index];
  const selectedID = selectedXrayServer() || "local";
  if (!source || !visualXHTTPSettings(source) || !["vless", "vmess"].includes(String(source.protocol || "").toLowerCase())) {
    reportSSHMigration(t("Select a VLESS/VMess inbound using XHTTP."));
    return false;
  }
  if (!wzLoadedConfigText || String(wzLoadedServerID || "") !== String(selectedID)) {
    reportSSHMigration(t("Load the selected server configuration before enabling SSH."));
    return false;
  }
  if ((document.getElementById("xCoreMode")?.value || "native") !== "native") {
    reportSSHMigration(t("Shared SSH requires native Xray mode. Select Internal native emulator and save the mode first."));
    return false;
  }
  const security = String(source.streamSettings?.security || "").toLowerCase();
  if (security && security !== "none" && security !== "tls") {
    reportSSHMigration(t("Inbound {name} uses {security}, which native SSH XHTTP does not support. Use TLS or no TLS.", {name:source.tag || t("selected"), security}));
    return false;
  }
  const existingSSH = findSSHRouteForInbound(source);
  if (existingSSH) {
    reportSSHMigration(t("SSH is already enabled on /ssh by inbound {name}.", {name:existingSSH.tag}), "success");
    return true;
  }
  const pathConflict = wzInbounds.find(candidate => {
    const xh = visualXHTTPSettings(candidate);
    return sameVisualEndpoint(source, candidate) && !!xh && normalizeVisualPath(xh.path) === "/ssh";
  });
  if (pathConflict) {
    reportSSHMigration(t("Path /ssh is already used by inbound {name}. Edit that path first.", {name:pathConflict.tag || t("untagged")}));
    return false;
  }
  if (security === "tls") {
    const certificate = source.streamSettings?.tlsSettings?.certificates?.[0] || {};
    if (!certificate.certificateFile || !certificate.keyFile) {
      reportSSHMigration(t("This inbound uses TLS but has no reusable certificate and key file paths."));
      return false;
    }
  }
  if (applyNow) {
    const xhttp = visualXHTTPSettings(source) || {};
    const clients = Array.isArray(source.settings?.clients) ? source.settings.clients.length : 0;
    const accepted = await panelConfirm({
      tone:"success", icon:"SSH", eyebrow:t("Safe XHTTP migration"), title:t("Enable SSH on /ssh"),
      message:t("Add SSH to the same endpoint without rebuilding {name}?", {name:source.tag || t("this inbound")}),
      detail:[
        `${t("Listener")}: ${source.listen || "0.0.0.0"}:${source.port}`,
        `${t("Existing path preserved")}: ${normalizeVisualPath(xhttp.path)}`,
        `${t("New SSH path")}: /ssh`,
        `${t("Clients preserved")}: ${clients}`,
        `${t("Security")}: ${security === "tls" ? "TLS" : t("No TLS")}`,
      ].join("\n"),
      confirmLabel:t("Enable SSH /ssh"),
    });
    if (!accepted) return false;
  }
  if (trigger) {
    trigger.disabled = true;
    trigger.textContent = t("Enabling SSH…");
  }

  const streamSettings = cloneJsonSafe(source.streamSettings || {});
  const settingsKey = streamSettings.xhttpSettings ? "xhttpSettings" : (streamSettings.splithttpSettings ? "splithttpSettings" : "xhttpSettings");
  streamSettings[settingsKey] = Object.assign({}, streamSettings[settingsKey] || {}, { path:"/ssh" });
  const sshInbound = {
    tag: uniqueLegacySSHTag(source),
    listen: source.listen || "0.0.0.0",
    port: cloneJsonSafe(source.port),
    protocol: "ssh",
    settings: {},
    streamSettings,
  };
  const previousDirty = wzDirty;
  const before = cloneJsonSafe(source);
  wzInbounds.push(sshInbound);
  try {
    validateVisualInbounds(wzInbounds);
  } catch (error) {
    wzInbounds.pop();
    if (trigger) { trigger.disabled = false; trigger.textContent = t("Enable SSH /ssh"); }
    reportSSHMigration(t("Could not enable SSH: {error}", {error:error.message}));
    return false;
  }
  if (JSON.stringify(source) !== JSON.stringify(before)) {
    wzInbounds.pop();
    if (trigger) { trigger.disabled = false; trigger.textContent = t("Enable SSH /ssh"); }
    reportSSHMigration(t("Migration was cancelled because it would alter the old inbound."));
    return false;
  }
  wzDirty = true;
  renderWzInbounds();
  if (!applyNow) {
    if (st) st.textContent = t("SSH /ssh added to the draft without changing {name}.", {name:source.tag || t("the old inbound")});
    return true;
  }
  if (st) st.textContent = t("Enabling SSH /ssh without changing {name}…", {name:source.tag || t("the old inbound")});
  const result = await applyWizardConfig();
  if (!result?.saved) {
    const addedIndex = wzInbounds.indexOf(sshInbound);
    if (addedIndex >= 0) wzInbounds.splice(addedIndex, 1);
    wzDirty = previousDirty;
    renderWzInbounds();
    reportSSHMigration(result?.error || t("The SSH route could not be saved. The old inbound was not changed."));
    return false;
  }
  if (!result.restarted) {
    reportSSHMigration(t("SSH /ssh was saved, but Xray could not restart. Use the Restart button after checking the Xray log."), "warning");
    return true;
  }
  reportSSHMigration(t("SSH /ssh is active. The old inbound and all clients were preserved."), "success");
  return true;
}

function validateVisualInbounds(inbounds) {
  const tags = new Set();
  const binds = new Map();
  const nativeMode = (document.getElementById("xCoreMode")?.value || "native") === "native";
  for (const ib of inbounds || []) {
    const tag = String(ib?.tag || "").trim();
    if (!tag) throw new Error("every inbound needs a tag");
    if (tags.has(tag)) throw new Error(`duplicate inbound tag: ${tag}`);
    tags.add(tag);
    const port = Number(ib?.port || 0);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port on ${tag}`);
    const bind = `${String(ib?.listen || "0.0.0.0").trim()}:${port}`;
    const xh = visualXHTTPSettings(ib);
    if (!binds.has(bind)) binds.set(bind, []);
    binds.get(bind).push({ ib, xh });
    if (String(ib?.protocol || "").toLowerCase() === "ssh") {
      if (!xh) throw new Error(`SSH inbound ${tag} requires XHTTP`);
      if (!nativeMode) throw new Error(`SSH inbound ${tag} requires native Xray mode`);
    }
  }
  for (const [bind, rows] of binds) {
    if (rows.length < 2) continue;
    if (!nativeMode || rows.some(row => !row.xh)) throw new Error(`multiple inbounds cannot share ${bind} unless all use native XHTTP`);
    const paths = new Set();
    const firstSecurity = String(rows[0].ib.streamSettings?.security || "none");
    const firstCert = rows[0].ib.streamSettings?.tlsSettings?.certificates?.[0] || {};
    for (const row of rows) {
      const path = normalizeVisualPath(row.xh.path);
      if (paths.has(path)) throw new Error(`duplicate XHTTP path ${path} on ${bind}`);
      paths.add(path);
      const security = String(row.ib.streamSettings?.security || "none");
      const cert = row.ib.streamSettings?.tlsSettings?.certificates?.[0] || {};
      if (security !== firstSecurity) throw new Error(`shared XHTTP inbounds on ${bind} must use the same TLS setting`);
      if (security === "tls" && (cert.certificateFile !== firstCert.certificateFile || cert.keyFile !== firstCert.keyFile)) {
        throw new Error(`shared XHTTP inbounds on ${bind} must use the same certificate`);
      }
    }
  }
}

const azionPresetProxyTags = new Set(["azion-vless-xhttp", "shared-proxy-xhttp"]);
const azionPresetSSHTags = new Set(["azion-ssh-xhttp", "shared-ssh-xhttp"]);

function findAzionPresetInbound(tags) {
  return wzInbounds.find(ib => tags.has(String(ib?.tag || ""))) || null;
}

function azionVLESSClients(existingProxy) {
  const clients = Array.isArray(existingProxy?.settings?.clients) ? cloneJsonSafe(existingProxy.settings.clients) : [];
  if (String(existingProxy?.protocol || "").toLowerCase() === "vless") return clients;
  return clients.map(client => {
    const converted = { id:client?.id };
    if (client?.email) converted.email = client.email;
    if (client?.flow) converted.flow = client.flow;
    return converted;
  }).filter(client => client.id);
}

function buildAzionPresetInbounds(certFile, keyFile) {
  const existingProxy = findAzionPresetInbound(azionPresetProxyTags);
  const existingSSH = findAzionPresetInbound(azionPresetSSHTags);
  const managed = new Set([existingProxy, existingSSH].filter(Boolean));
  const others = wzInbounds.filter(ib => !managed.has(ib));
  const portConflict = others.find(ib => Number(ib?.port) === 443);
  if (portConflict) {
    throw new Error(`A porta 443 já é usada pelo inbound ${portConflict.tag || "sem tag"}. Edite ou remova esse inbound antes de criar o padrão Azion.`);
  }
  const stream = path => ({
    network:"xhttp",
    security:"tls",
    xhttpSettings:{ path, mode:"auto" },
    tlsSettings:{ certificates:[{ certificateFile:certFile, keyFile }] },
  });
  const proxyInbound = {
    tag:"azion-vless-xhttp",
    listen:"0.0.0.0",
    port:443,
    protocol:"vless",
    settings:{ clients:azionVLESSClients(existingProxy), decryption:"none" },
    streamSettings:stream("/"),
  };
  const sshInbound = {
    tag:"azion-ssh-xhttp",
    listen:"0.0.0.0",
    port:443,
    protocol:"ssh",
    settings:{},
    streamSettings:stream("/ssh"),
  };
  return [...others, proxyInbound, sshInbound];
}

async function createAzionDefaultXHTTP() {
  const status = document.getElementById("wzAzionDefaultStatus");
  const button = document.getElementById("wzAzionDefaultBtn");
  const selectedID = selectedXrayServer() || "local";
  const target = selectedXrayServerLabel();
  if (!wzLoadedConfigText || String(wzLoadedServerID || "") !== String(selectedID)) {
    if (status) status.textContent = `Carregue a configuração de ${target} antes de criar o padrão Azion.`;
    return;
  }
  if ((document.getElementById("xCoreMode")?.value || "native") !== "native") {
    if (status) status.textContent = "O padrão Azion com SSH requer o modo Xray nativo.";
    return;
  }

  let nextInbounds;
  try {
    nextInbounds = buildAzionPresetInbounds(
      "/opt/sshpanel/certs/example.com/cert.pem",
      "/opt/sshpanel/certs/example.com/key.pem",
    );
    validateVisualInbounds(nextInbounds);
  } catch (error) {
    if (status) status.textContent = error.message;
    return;
  }

  const existingProxy = findAzionPresetInbound(azionPresetProxyTags);
  const accepted = await panelConfirm({
    tone:"success",
    icon:"AZ",
    eyebrow:"Azion XHTTP",
    title:existingProxy ? "Atualizar padrão Azion" : "Criar padrão Azion",
    message:existingProxy
      ? "Atualizar o endpoint padrão e manter os clientes VLESS existentes?"
      : "Criar o endpoint padrão completo neste servidor?",
    detail:[
      `Servidor: ${target}`,
      "Listen: 0.0.0.0:443",
      "TLS autoassinado: example.com",
      "VLESS XHTTP: /",
      "SSH XHTTP: /ssh",
      "O Xray será salvo e reiniciado automaticamente.",
    ].join("\n"),
    confirmLabel:existingProxy ? "Atualizar padrão" : "Criar padrão",
  });
  if (!accepted) return;

  const previousInbounds = cloneJsonSafe(wzInbounds);
  const previousDirty = wzDirty;
  let presetApplied = false;
  let configSaved = false;
  if (button) {
    button.disabled = true;
    button.textContent = "Criando padrão…";
  }
  if (status) status.textContent = `Gerando certificado example.com em ${target}…`;
  try {
    const certResponse = await api(withServerParam("/api/tls/generate-selfsigned", selectedID), {
      method:"POST",
      body:JSON.stringify({ domain:"example.com" }),
    });
    if (!certResponse.ok) throw new Error(await certResponse.text());
    const cert = await certResponse.json();
    if (!cert?.cert_file || !cert?.key_file) throw new Error("o servidor não retornou os caminhos do certificado");

    wzInbounds = buildAzionPresetInbounds(cert.cert_file, cert.key_file);
    validateVisualInbounds(wzInbounds);
    presetApplied = true;
    wzDirty = true;
    wzCancelInbound();
    renderWzInbounds();
    if (status) status.textContent = "Certificado criado. Salvando configuração e reiniciando o Xray…";
    const result = await applyWizardConfig();
    if (!result?.saved) throw new Error(result?.error || "não foi possível salvar a configuração");
    configSaved = true;
    if (status) status.textContent = result.restarted
      ? "Padrão Azion ativo: TLS example.com, VLESS / e SSH /ssh em 0.0.0.0:443."
      : "O padrão foi salvo, mas o Xray não reiniciou. Verifique os logs e use Reiniciar.";
    if (typeof showPanelToast === "function") {
      showPanelToast(
        result.restarted ? "Padrão Azion XHTTP criado e ativo." : "Padrão Azion salvo; reinício pendente.",
        result.restarted ? "success" : "warning",
        "Azion XHTTP",
      );
    }
  } catch (error) {
    if (presetApplied && !configSaved) {
      wzInbounds = previousInbounds;
      wzDirty = previousDirty;
      renderWzInbounds();
    }
    if (error.message === "auth") doAuthError();
    else if (status) status.textContent = "Erro ao criar padrão Azion: " + error.message;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Criar padrão Azion XHTTP";
    }
  }
}

function onWzProtoChange(val) {
  const isSSH = val === "ssh";
  // SSH tunnels reuse the VLESS/VMess transport block to expose the XHTTP
  // fields, but carry no proxy client list of their own.
  const usesTransportFields = val === "vless" || val === "vmess" || isSSH;
  document.getElementById("wzVlessFields").style.display   = usesTransportFields  ? "grid" : "none";
  document.getElementById("wzTrojanFields").style.display  = val === "trojan"       ? "" : "none";
  document.getElementById("wzSSFields").style.display      = val === "shadowsocks"  ? "grid" : "none";

  // SSH runs only over XHTTP: force the network to xhttp and lock the dropdown
  // so the wizard can only emit a valid xhttp+ssh inbound.
  const netSel = document.getElementById("wzNetwork");
  if (isSSH) {
    netSel.value = "xhttp";
    netSel.disabled = true;
    onWzNetworkChange("xhttp");
  } else {
    netSel.disabled = false;
  }

  const tlsSel = document.getElementById("wzTLS");
  const realityOpt = document.querySelector("#wzTLS option[value='reality']");
  if (realityOpt) {
    // REALITY is not wired for the native XHTTP listener (tls/none only) and is
    // unavailable for VMess, so disable it for both.
    const noReality = val === "vmess" || isSSH;
    realityOpt.disabled = noReality;
    if (noReality && tlsSel.value === "reality") {
      tlsSel.value = "none";
      onWzTLSChange("none");
    }
  }

  const portMap = { vless:10086, vmess:10087, ssh:2087, trojan:8443, shadowsocks:8388, socks:10808 };
  const tagMap  = { vless:"vless-in", vmess:"vmess-in", ssh:"ssh-xhttp-in", trojan:"trojan-in", shadowsocks:"ss-in", socks:"socks-local" };
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
  const st = document.getElementById("wzStatus");
  if (!Number.isInteger(port) || port < 1 || port > 65535) { st.textContent = "Informe uma porta válida."; return; }
  if (/[\u0000-\u001f\u007f]/.test(`${listen}${tag}`)) { st.textContent = "Listen ou tag contém caracteres inválidos."; return; }
  if (wzInbounds.some((item, index) => index !== wzEditingIndex && item?.tag === tag)) { st.textContent = `A tag ${tag} já está em uso.`; return; }

  const original = wzEditingIndex >= 0 ? cloneJsonSafe(wzInbounds[wzEditingIndex]) : null;
  const ib = original || {};
  const previousClients = Array.isArray(original?.settings?.clients) ? cloneJsonSafe(original.settings.clients) : [];
  ib.tag = tag;
  ib.port = port;
  ib.listen = listen;
  ib.protocol = proto;
  ib.settings = {};
  if (proto === "vless" || proto === "vmess") {
    ib.settings = original?.protocol === proto && original.settings ? cloneJsonSafe(original.settings) : {};
    ib.settings.clients = previousClients;
    if (proto === "vless") ib.settings.decryption = "none";
    else delete ib.settings.decryption;
    const net    = document.getElementById("wzNetwork").value;
    const tlsVal = document.getElementById("wzTLS").value;
    const previousStream = original?.protocol === proto && original?.streamSettings?.network === net ? cloneJsonSafe(original.streamSettings) : {};
    ib.streamSettings = previousStream || {};
    ib.streamSettings.network = net;
    ["wsSettings", "xhttpSettings", "splithttpSettings", "httpupgradeSettings", "httpSettings", "grpcSettings"].forEach(key => {
      if (!((net === "ws" && key === "wsSettings") || (net === "xhttp" && (key === "xhttpSettings" || key === "splithttpSettings")) || (net === "httpupgrade" && key === "httpupgradeSettings") || (net === "h2" && key === "httpSettings") || (net === "grpc" && key === "grpcSettings"))) delete ib.streamSettings[key];
    });
    // Transport-specific settings
    switch (net) {
      case "ws":
        ib.streamSettings.wsSettings = Object.assign({}, ib.streamSettings.wsSettings || {}, { path: document.getElementById("wzWSPath").value.trim() || "/" });
        break;
      case "xhttp":
        ib.streamSettings.xhttpSettings = Object.assign({}, ib.streamSettings.xhttpSettings || ib.streamSettings.splithttpSettings || {}, {
          path: document.getElementById("wzXHTTPPath").value.trim() || "/xhttp",
          host: document.getElementById("wzXHTTPHost").value.trim() || undefined,
          mode: document.getElementById("wzXHTTPMode").value,
        });
        delete ib.streamSettings.splithttpSettings;
        if (!ib.streamSettings.xhttpSettings.host) delete ib.streamSettings.xhttpSettings.host;
        break;
      case "httpupgrade":
        ib.streamSettings.httpupgradeSettings = Object.assign({}, ib.streamSettings.httpupgradeSettings || {}, {
          path: document.getElementById("wzHUPath").value.trim() || "/",
          host: document.getElementById("wzHUHost").value.trim() || undefined,
        });
        if (!ib.streamSettings.httpupgradeSettings.host) delete ib.streamSettings.httpupgradeSettings.host;
        break;
      case "h2":
        ib.streamSettings.httpSettings = Object.assign({}, ib.streamSettings.httpSettings || {}, {
          path: document.getElementById("wzH2Path").value.trim() || "/",
          host: [document.getElementById("wzH2Host").value.trim()].filter(Boolean),
        });
        break;
      case "grpc":
        ib.streamSettings.grpcSettings = Object.assign({}, ib.streamSettings.grpcSettings || {}, {
          serviceName: document.getElementById("wzGRPCService").value.trim() || "grpc",
          multiMode:   document.getElementById("wzGRPCMulti").checked,
        });
        break;
    }
    // TLS / Reality
    if (tlsVal === "tls") {
      const certificateFile = document.getElementById("wzTLSCert").value.trim();
      const keyFile = document.getElementById("wzTLSKey").value.trim();
      if (!certificateFile || !keyFile) { st.textContent = "TLS exige os arquivos de certificado e chave."; return; }
      ib.streamSettings.security = "tls";
      ib.streamSettings.tlsSettings = Object.assign({}, ib.streamSettings.tlsSettings || {}, {
        certificates: [{ certificateFile, keyFile }],
      });
      delete ib.streamSettings.realitySettings;
    } else if (tlsVal === "reality" && proto === "vless") {
      ib.streamSettings.security = "reality";
      ib.streamSettings.realitySettings = Object.assign({}, ib.streamSettings.realitySettings || {}, {
        dest:        document.getElementById("wzRealityDest").value.trim(),
        serverNames: [document.getElementById("wzRealitySNI").value.trim()].filter(Boolean),
        privateKey:  document.getElementById("wzRealityPriv").value.trim(),
        shortIds:    [document.getElementById("wzRealityShortID").value.trim()].filter(Boolean),
      });
      delete ib.streamSettings.tlsSettings;
    } else {
      delete ib.streamSettings.security;
      delete ib.streamSettings.tlsSettings;
      delete ib.streamSettings.realitySettings;
    }
  } else if (proto === "ssh") {
    // SSH tunnel over XHTTP: no proxy clients — the decoded stream is handed to
    // the SSH server, so authentication is an ordinary SSH account.
    ib.settings = {};
    ib.streamSettings = original?.protocol === "ssh" ? (cloneJsonSafe(original.streamSettings) || {}) : {};
    ib.streamSettings.network = "xhttp";
    ib.streamSettings.xhttpSettings = Object.assign({}, ib.streamSettings.xhttpSettings || ib.streamSettings.splithttpSettings || {}, {
      path: document.getElementById("wzXHTTPPath").value.trim() || "/xhttp",
      host: document.getElementById("wzXHTTPHost").value.trim() || undefined,
      mode: document.getElementById("wzXHTTPMode").value,
    });
    delete ib.streamSettings.splithttpSettings;
    if (!ib.streamSettings.xhttpSettings.host) delete ib.streamSettings.xhttpSettings.host;
    const tlsVal = document.getElementById("wzTLS").value;
    if (tlsVal === "tls") {
      const certificateFile = document.getElementById("wzTLSCert").value.trim();
      const keyFile = document.getElementById("wzTLSKey").value.trim();
      if (!certificateFile || !keyFile) { st.textContent = "TLS exige os arquivos de certificado e chave."; return; }
      ib.streamSettings.security = "tls";
      ib.streamSettings.tlsSettings = Object.assign({}, ib.streamSettings.tlsSettings || {}, {
        certificates: [{ certificateFile, keyFile }],
      });
    } else {
      delete ib.streamSettings.security;
      delete ib.streamSettings.tlsSettings;
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
  if (wzEditingIndex >= 0) wzInbounds[wzEditingIndex] = ib;
  else wzInbounds.push(ib);
  wzDirty = true;
  renderWzInbounds();
  st.textContent = original ? `Inbound ${tag} atualizado no rascunho.` : `Inbound ${tag} adicionado ao rascunho.`;
  wzCancelInbound();
}


function buildConfigFromVisualEditor() {
  const selectedID = selectedXrayServer() || "local";
  if (!wzLoadedConfigText || String(wzLoadedServerID || "") !== String(selectedID)) {
    throw new Error("config for this server is not loaded yet");
  }

  let cfg;
  try {
    cfg = JSON.parse(wzLoadedConfigText);
  } catch (_) {
    cfg = cloneJsonSafe(wzLoadedFullConfig || {});
  }
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
    throw new Error("loaded config is not an object");
  }

  // Preserve the selected server's full JSON exactly as the base.
  // The visual tab is intentionally conservative: it only updates fields that
  // are visible here, so pressing Save cannot wipe routing/outbounds/policy/etc.
  cfg.log = cfg.log && typeof cfg.log === "object" ? cfg.log : {};
  cfg.log.loglevel = document.getElementById("wzLogLevel")?.value || cfg.log.loglevel || "warning";

  const existingInbounds = Array.isArray(cfg.inbounds) ? cfg.inbounds : [];
  const hiddenApiInbounds = existingInbounds.filter(ib => ib && ib.tag === "api");
  const visualInbounds = cloneJsonSafe((wzInbounds || []).filter(ib => ib && ib.tag !== "api")) || [];
  validateVisualInbounds(visualInbounds);
  cfg.inbounds = [...hiddenApiInbounds, ...visualInbounds];

  return cfg;
}

function updateFullConfigFromWizard() {
  const cfg = buildConfigFromVisualEditor();
  wzLoadedFullConfig = cloneJsonSafe(cfg);
  return cfg;
}

async function applyWizardConfig() {
  const st = document.getElementById("wzStatus");
  const target = selectedXrayServerLabel();
  const selectedID = selectedXrayServer() || "local";

  if (String(wzLoadedServerID || "") !== String(selectedID) || !wzLoadedConfigText) {
    if (st) st.textContent = `Reloading config from ${target} before saving...`;
    loadWizardFromConfig();
    return { saved:false, restarted:false, error:t("Configuration for this server was not loaded.") };
  }

  let cfg;
  try {
    cfg = buildConfigFromVisualEditor();
  } catch(e) {
    if (st) st.textContent = `Invalid visual config: ${e.message}`;
    return { saved:false, restarted:false, error:t("Invalid visual config: {error}", {error:e.message}) };
  }

  if (st) st.textContent = `Saving config to ${target}...`;
  try {
    const body = JSON.stringify(cfg, null, 2);
    const res = await api(withServerParam("/api/xray/config", selectedID), { method:"POST", body });
    if (!res.ok) throw new Error(await res.text());
    wzLoadedConfigText = body;
    wzLoadedFullConfig = cloneJsonSafe(cfg);
    wzLoadedServerID = selectedID;
    wzDirty = false;
    if (st) st.textContent = `Saved on ${target}. Restarting Xray...`;
    const restarted = await xrayCtrl("restart");
    if (st) st.textContent = restarted
      ? `Config saved on ${target} and Xray restarted.`
      : `Config saved on ${target}, but Xray could not restart. Check Xray logs before editing again.`;
    setTimeout(() => { loadXrayStatus(); loadInbounds({ force: true }); }, 700);
    return { saved:true, restarted:!!restarted, error:restarted ? "" : t("Xray could not restart.") };
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else if (st) st.textContent = "Error: " + e.message;
    return { saved:false, restarted:false, error:t("Could not save configuration: {error}", {error:e.message}) };
  }
}
