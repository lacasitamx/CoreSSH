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
    renderWzInbounds();
    wzDirty = false;
    if (st) st.textContent = `Config loaded from ${target}.`;
  }).catch(e => {
    wzLoadedServerID = null;
    wzLoadedConfigText = "";
    wzLoadedFullConfig = null;
    wzInbounds = [];
    renderWzInbounds();
    if (e.message === "auth") doAuthError();
    else if (st) st.textContent = "Error: " + e.message;
  });
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
    delBtn.onclick = () => { wzInbounds.splice(i,1); wzDirty = true; renderWzInbounds(); };
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
          path: document.getElementById("wzXHTTPPath").value.trim() || "/xhttp",
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
  } else if (proto === "ssh") {
    // SSH tunnel over XHTTP: no proxy clients — the decoded stream is handed to
    // the SSH server, so authentication is an ordinary SSH account.
    ib.settings = {};
    ib.streamSettings = { network: "xhttp" };
    ib.streamSettings.xhttpSettings = {
      path: document.getElementById("wzXHTTPPath").value.trim() || "/xhttp",
      host: document.getElementById("wzXHTTPHost").value.trim() || undefined,
      mode: document.getElementById("wzXHTTPMode").value,
    };
    if (!ib.streamSettings.xhttpSettings.host) delete ib.streamSettings.xhttpSettings.host;
    const tlsVal = document.getElementById("wzTLS").value;
    if (tlsVal === "tls") {
      ib.streamSettings.security = "tls";
      ib.streamSettings.tlsSettings = {
        certificates: [{ certificateFile: document.getElementById("wzTLSCert").value.trim(), keyFile: document.getElementById("wzTLSKey").value.trim() }],
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
  wzDirty = true;
  renderWzInbounds();
  document.getElementById("wzAddInboundForm").classList.add("hidden");
  document.getElementById("wzPort").value = "";
  document.getElementById("wzTag").value  = "";
  document.getElementById("wzListenIP").value = "";
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
    return;
  }

  let cfg;
  try {
    cfg = buildConfigFromVisualEditor();
  } catch(e) {
    if (st) st.textContent = `Invalid visual config: ${e.message}`;
    return;
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
    await xrayCtrl("restart");
    if (st) st.textContent = `Config saved on ${target} and Xray restarted.`;
    setTimeout(() => { loadXrayStatus(); loadInbounds({ force: true }); }, 700);
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else if (st) st.textContent = "Error: " + e.message;
  }
}

