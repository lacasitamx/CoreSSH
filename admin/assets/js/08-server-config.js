// ─── Server Config ────────────────────────────────────────────────────────────
document.querySelector("[data-tab='server']")?.addEventListener("click", loadServerConfig);


function dnsttDomainsText(d) {
  const domains = Array.isArray(d?.domains) && d.domains.length ? d.domains : (d?.domain ? [d.domain] : []);
  return domains.join("\n");
}
function readDnsttDomains(id) {
  const el = document.getElementById(id);
  if (!el) return [];
  const seen = new Set();
  return el.value.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean).map(s => s.replace(/\.$/, "").toLowerCase()).filter(s => {
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

function toggleDnsttFields(on) {
  const el = document.getElementById("dnsttFields");
  el.style.opacity = on ? "1" : ".4";
  el.style.pointerEvents = on ? "" : "none";
}
function toggleUdpgwFields(on) {
  const el = document.getElementById("udpgwFields");
  el.style.opacity = on ? "1" : ".4";
  el.style.pointerEvents = on ? "" : "none";
}


// Only operator-safe knobs remain. Transport buffers (HTTP/2 flow control, XHTTP
// reorder buffer, mux/UDP buffers) are fixed to xray-core defaults in the backend
// and are no longer exposed here, so they cannot be misconfigured.
const XRAY_NATIVE_TUNING_DEFAULTS = {
  safe: {
    runtime_gomaxprocs: 0,
    mux_global_sessions: 8192,
    max_concurrent_connections: 4096,
    max_concurrent_xhttp_requests: 8192,
    xhttp_max_sessions: 4096,
    trace_packets: false,
  },
  "2k": {
    runtime_gomaxprocs: 0,
    mux_global_sessions: 32768,
    max_concurrent_connections: 8192,
    max_concurrent_xhttp_requests: 16384,
    xhttp_max_sessions: 8192,
    trace_packets: false,
  },
};

const XRAY_NATIVE_TUNING_FIELDS = {
  runtime_gomaxprocs: "cfgXrayRuntimeGomaxprocs",
  mux_global_sessions: "cfgXrayMuxGlobalSessions",
  max_concurrent_connections: "cfgXrayMaxConnections",
  max_concurrent_xhttp_requests: "cfgXrayMaxXHTTPRequests",
  xhttp_max_sessions: "cfgXrayMaxXHTTPSessions",
};

function setXrayNativeTuningDefaults(profile = "2k") {
  const t = XRAY_NATIVE_TUNING_DEFAULTS[profile] || XRAY_NATIVE_TUNING_DEFAULTS.safe;
  writeXrayNativeTuning(t);
}

function writeXrayNativeTuning(t = {}) {
  const defaults = XRAY_NATIVE_TUNING_DEFAULTS.safe;
  Object.entries(XRAY_NATIVE_TUNING_FIELDS).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.value = Number(t[key] || defaults[key] || 0);
  });
  const trace = document.getElementById("cfgXrayTracePackets");
  if (trace) trace.checked = !!t.trace_packets;
}

function readXrayNativeTuning() {
  const out = {};
  Object.entries(XRAY_NATIVE_TUNING_FIELDS).forEach(([key, id]) => {
    const el = document.getElementById(id);
    out[key] = parseInt(el?.value || "0", 10) || 0;
  });
  out.trace_packets = !!document.getElementById("cfgXrayTracePackets")?.checked;
  return out;
}

// Inline onclick handlers in index.html need this exposed on window explicitly.
window.setXrayNativeTuningDefaults = setXrayNativeTuningDefaults;

async function loadServerConfig() {
  const st = document.getElementById("srvCfgStatus");
  st.textContent = "Loading…";
  try {
    const res = await api("/api/server/config");
    if (!res.ok) throw new Error(await res.text());
    const c = await res.json();

    // Network
    document.getElementById("cfgListen").value       = c.listen || "";
    document.getElementById("cfgExtraListen").value  = (c.extra_listen || []).join("\n");
    document.getElementById("cfgProxyAutoRestart").value = c.proxy_auto_restart_interval || "";
    document.getElementById("cfgProxyRestartGrace").value = c.proxy_auto_restart_grace || "";

    // SSH / general
    document.getElementById("cfgLimitUp").value      = c.default_limit_mbps_up || 0;
    document.getElementById("cfgLimitDown").value    = c.default_limit_mbps_down || 0;
    document.getElementById("cfgMaxTotalConns").value = c.max_total_connections || 0;
    document.getElementById("cfgSSHIdleTimeout").value = c.ssh_idle_timeout || "0s";
    document.getElementById("cfgQuiet").checked      = !!c.quiet;
    document.getElementById("cfgUserCount").checked  = !!c.user_count;
    document.getElementById("cfgPamAuth").checked    = !!c.pam_auth_enabled;

    // Banner
    document.getElementById("cfgBanner").value       = c.banner || "";

    // DNSTT
    const hasDnstt = !!c.dnstt;
    document.getElementById("cfgDnsttEnabled").checked = hasDnstt;
    toggleDnsttFields(hasDnstt);
    const d = c.dnstt || {};
    document.getElementById("cfgDnsttDomains").value = dnsttDomainsText(d);
    document.getElementById("cfgDnsttUDP").value       = d.udp_listen || "";
    document.getElementById("cfgDnsttFakeEnabled").checked = !!d.fake_dns_enabled;
    document.getElementById("cfgDnsttFakeListen").value = d.fake_dns_listen || "";
    document.getElementById("cfgDnsttFakeDomain").value = d.fake_dns_domain || "t.local.lan";
    document.getElementById("cfgDnsttFakeWorkers").value = d.fake_dns_workers || 0;
    document.getElementById("cfgDnsttRespWorkers").value = d.dns_response_workers || 0;
    document.getElementById("cfgDnsttAutoRestart").value = d.auto_restart_interval || "";
    document.getElementById("cfgDnsttRestartGrace").value = d.auto_restart_grace || "";
    document.getElementById("cfgDnsttMaxSessions").value = d.max_sessions || 0;
    document.getElementById("cfgDnsttMaxStreams").value = d.max_streams || 0;
    document.getElementById("cfgDnsttPendingResponses").value = d.pending_responses || 0;
    document.getElementById("cfgDnsttStreamBuffer").value = d.stream_buffer || 0;
    document.getElementById("cfgDnsttUDPReadBuffer").value = d.udp_read_buffer || 0;
    document.getElementById("cfgDnsttUDPWriteBuffer").value = d.udp_write_buffer || 0;
    document.getElementById("cfgDnsttKey").value       = d.privkey_file || "/opt/sshpanel/dnstt.key";
    document.getElementById("cfgDnsttNoStats").checked = !!d.disable_stats_log;
    document.getElementById("cfgDnsttNoConsole").checked = !!d.disable_console_log;
    document.getElementById("cfgDnsttLogConnections").checked = !!d.log_connections;

    // UDPGW
    const hasUdpgw = !!c.udpgw;
    document.getElementById("cfgUdpgwEnabled").checked = hasUdpgw;
    toggleUdpgwFields(hasUdpgw);
    const u = c.udpgw || {};
    document.getElementById("cfgUdpgwListen").value    = u.listen || "";
    document.getElementById("cfgUdpgwMaxConns").value  = u.max_client_conns || 0;
    document.getElementById("cfgUdpgwMaxClients").value = u.max_clients || 0;
    document.getElementById("cfgUdpgwIdle").value      = u.idle_timeout || "";
    document.getElementById("cfgUdpgwMapTTL").value    = u.map_ttl || "";
    document.getElementById("cfgUdpgwAutoRestart").value = u.auto_restart_interval || "";
    document.getElementById("cfgUdpgwRestartGrace").value = u.auto_restart_grace || "";
    document.getElementById("cfgUdpgwDebug").checked   = !!u.debug;

    // TLS forwarders
    tlsForwardersState = c.tls_forwarders || [];
    renderTLSForwarders();

    // Xray
    const x = c.xray || {};
    document.getElementById("cfgXrayEnabled").checked = !!x.enabled;
    document.getElementById("cfgXrayMode").value = xrayModeFromConfig(x);
    writeXrayNativeTuning(x.native_tuning || XRAY_NATIVE_TUNING_DEFAULTS.safe);

    st.textContent = "Config loaded.";
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else st.textContent = "Error: " + e.message;
  }
}

async function saveServerConfig() {
  const st = document.getElementById("srvCfgStatus");
  st.textContent = "Saving…";

  const tlsArr = tlsForwardersState;

  const extraLines = document.getElementById("cfgExtraListen").value
    .split("\n").map(s => s.trim()).filter(Boolean);
  const dnsttDomains = readDnsttDomains("cfgDnsttDomains");

  const cfg = {
    listen:               document.getElementById("cfgListen").value.trim(),
    extra_listen:         extraLines,
    proxy_auto_restart_interval: document.getElementById("cfgProxyAutoRestart").value.trim(),
    proxy_auto_restart_grace:    document.getElementById("cfgProxyRestartGrace").value.trim(),
    host_key_file:        "/opt/sshpanel/ssh_host_rsa_key",
    admin_dir:            "/opt/sshpanel/admin",
    default_limit_mbps_up:   parseInt(document.getElementById("cfgLimitUp").value  || "0", 10),
    default_limit_mbps_down: parseInt(document.getElementById("cfgLimitDown").value || "0", 10),
    max_total_connections:   parseInt(document.getElementById("cfgMaxTotalConns").value || "0", 10),
    ssh_idle_timeout:         document.getElementById("cfgSSHIdleTimeout").value.trim() || "0s",
    quiet:      document.getElementById("cfgQuiet").checked,
    user_count: document.getElementById("cfgUserCount").checked,
    pam_auth_enabled: document.getElementById("cfgPamAuth").checked,
    banner:      document.getElementById("cfgBanner").value,
    banner_file: "/opt/sshpanel/banner.txt",
    dnstt: document.getElementById("cfgDnsttEnabled").checked ? {
      domain:              dnsttDomains[0] || "",
      domains:             dnsttDomains,
      udp_listen:          document.getElementById("cfgDnsttUDP").value.trim(),
      fake_dns_enabled:    document.getElementById("cfgDnsttFakeEnabled").checked,
      fake_dns_listen:     document.getElementById("cfgDnsttFakeListen").value.trim(),
      fake_dns_domain:     document.getElementById("cfgDnsttFakeDomain").value.trim(),
      fake_dns_workers: parseInt(document.getElementById("cfgDnsttFakeWorkers").value || "0", 10),
      dns_response_workers: parseInt(document.getElementById("cfgDnsttRespWorkers").value || "0", 10),
      auto_restart_interval: document.getElementById("cfgDnsttAutoRestart").value.trim(),
      auto_restart_grace:  document.getElementById("cfgDnsttRestartGrace").value.trim(),
      max_sessions: parseInt(document.getElementById("cfgDnsttMaxSessions").value || "0", 10),
      max_streams: parseInt(document.getElementById("cfgDnsttMaxStreams").value || "0", 10),
      pending_responses: parseInt(document.getElementById("cfgDnsttPendingResponses").value || "0", 10),
      stream_buffer: parseInt(document.getElementById("cfgDnsttStreamBuffer").value || "0", 10),
      udp_read_buffer: parseInt(document.getElementById("cfgDnsttUDPReadBuffer").value || "0", 10),
      udp_write_buffer: parseInt(document.getElementById("cfgDnsttUDPWriteBuffer").value || "0", 10),
      privkey_file:        document.getElementById("cfgDnsttKey").value.trim(),
      disable_stats_log:   document.getElementById("cfgDnsttNoStats").checked,
      disable_console_log: document.getElementById("cfgDnsttNoConsole").checked,
      log_connections: document.getElementById("cfgDnsttLogConnections").checked,
    } : null,
    udpgw: document.getElementById("cfgUdpgwEnabled").checked ? {
      listen:          document.getElementById("cfgUdpgwListen").value.trim(),
      max_client_conns: parseInt(document.getElementById("cfgUdpgwMaxConns").value || "0", 10),
      max_clients:     parseInt(document.getElementById("cfgUdpgwMaxClients").value || "0", 10),
      idle_timeout:    document.getElementById("cfgUdpgwIdle").value.trim(),
      map_ttl:         document.getElementById("cfgUdpgwMapTTL").value.trim(),
      auto_restart_interval: document.getElementById("cfgUdpgwAutoRestart").value.trim(),
      auto_restart_grace:    document.getElementById("cfgUdpgwRestartGrace").value.trim(),
      debug:           document.getElementById("cfgUdpgwDebug").checked,
    } : null,
    tls_forwarders: tlsArr,
    xray: {
      enabled:     document.getElementById("cfgXrayEnabled").checked,
      mode:        document.getElementById("cfgXrayMode").value === "external" ? "external" : "native",
      native:      document.getElementById("cfgXrayMode").value !== "external",
      bin_path:    "/opt/sshpanel/xray",
      config_file: "/opt/sshpanel/xray_config.json",
      native_config_file: "/opt/sshpanel/xray_native_config.json",
      api_server:  "127.0.0.1:10085",
      online_window_seconds: 90,
      stats_poll_seconds: 15,
      native_tuning: readXrayNativeTuning(),
    },
  };

  try {
    const res = await api("/api/server/config", { method: "POST", body: JSON.stringify(cfg) });
    if (!res.ok) throw new Error(await res.text());
    const report = await res.json().catch(() => null);
    const warnings = report?.warnings || [];
    const bad = Object.entries(report?.services || {}).filter(([_, v]) => v?.enabled && !v?.running);
    if (warnings.length || bad.length) {
      const badText = bad.map(([name, v]) => `${name}: ${v.error || "not running"}`).join(" | ");
      st.textContent = "Saved live with warnings: " + [...warnings, badText].filter(Boolean).join(" | ");
    } else {
      st.textContent = "Saved and applied live.";
    }
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else st.textContent = "Error: " + e.message;
  }
}

// ─── TLS Forwarders ────────────────────────────────────────────────────────────
function renderTLSForwarders() {
  const list = document.getElementById("tlsForwardersList");
  const chip = document.getElementById("tlsCountChip");
  if (!list) return;
  chip.textContent = tlsForwardersState.length;
  if (!tlsForwardersState.length) {
    list.innerHTML = '<div class="hint" style="padding:4px 0;">No TLS forwarders configured.</div>';
    return;
  }
  list.innerHTML = "";
  tlsForwardersState.forEach((fw, i) => {
    const row = document.createElement("div");
    row.style = "display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:.73rem;";
    row.innerHTML = `<span style="flex:1;font-family:monospace;">${escapeHTML(fw.listen || "")}</span>
      <span class="hint">${escapeHTML(fw.cert_file ? fw.cert_file.split("/").pop() : "no cert")}</span>`;
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.textContent = "Remove";
    delBtn.onclick = () => { tlsForwardersState.splice(i,1); renderTLSForwarders(); };
    row.appendChild(delBtn);
    list.appendChild(row);
  });
}

function toggleAddTLSForm() {
  const panel = document.getElementById("addTLSPanel");
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) {
    document.getElementById("tlsAddStatus").textContent = "";
    document.getElementById("tlsListenAddr").value = "";
    document.getElementById("tlsSSLDomain").value = "";
    document.getElementById("tlsCertType").value = "selfsigned";
    onTLSTypeChange("selfsigned");
  }
}

function onTLSTypeChange(val) {
  const setVisible = (id, on, display = "") => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("hidden", !on);
    el.style.display = on ? display : "none";
  };
  setVisible("tlsSSFields", val === "selfsigned", "");
  setVisible("tlsLEFields", val === "letsencrypt", "grid");
  setVisible("tlsPasteFields", val === "paste", "");
  setVisible("tlsCustomFields", val === "custom", "grid");
}

async function addTLSForwarder() {
  const st = document.getElementById("tlsAddStatus");
  const listen   = document.getElementById("tlsListenAddr").value.trim();
  const certType = document.getElementById("tlsCertType").value;
  if (!listen) { st.textContent = "Listen address required."; return; }
  let certFile = "", keyFile = "";
  st.textContent = "Processing…";
  if (certType === "selfsigned") {
    const domain = document.getElementById("tlsSSLDomain").value.trim();
    if (!domain) { st.textContent = "Domain required."; return; }
    try {
      const res = await api("/api/tls/generate-selfsigned", { method:"POST", body: JSON.stringify({ domain }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      certFile = data.cert_file; keyFile = data.key_file;
      st.textContent = "Self-signed cert generated.";
    } catch (e) {
      if (e.message==="auth") doAuthError();
      else st.textContent = "Cert error: " + e.message;
      return;
    }
  } else if (certType === "letsencrypt") {
    const domain = document.getElementById("tlsLEDomain").value.trim();
    const email  = document.getElementById("tlsLEEmail").value.trim();
    if (!domain || !email) { st.textContent = "Domain and email required."; return; }
    st.textContent = "Running certbot… (may take ~30s)";
    try {
      const res = await api("/api/tls/letsencrypt", { method:"POST", body: JSON.stringify({ domain, email }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      certFile = data.cert_file; keyFile = data.key_file;
      st.textContent = "Let's Encrypt cert issued.";
    } catch (e) {
      if (e.message==="auth") doAuthError();
      else st.textContent = "certbot error: " + e.message;
      return;
    }
  } else if (certType === "paste") {
    const name = document.getElementById("tlsPasteName").value.trim();
    const cert = document.getElementById("tlsPasteCert").value.trim();
    const key  = document.getElementById("tlsPasteKey").value.trim();
    if (!name || !cert || !key) { st.textContent = "Name, cert PEM, and key PEM required."; return; }
    try {
      const res = await api("/api/tls/upload-pem", { method:"POST", body: JSON.stringify({ name, cert, key }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      certFile = data.cert_file; keyFile = data.key_file;
      st.textContent = "PEM saved.";
    } catch (e) {
      if (e.message==="auth") doAuthError();
      else st.textContent = "Upload error: " + e.message;
      return;
    }
  } else {
    certFile = document.getElementById("tlsCustomCert").value.trim();
    keyFile  = document.getElementById("tlsCustomKey").value.trim();
    if (!certFile || !keyFile) { st.textContent = "Cert and key paths required."; return; }
  }
  tlsForwardersState.push({ listen, cert_file: certFile, key_file: keyFile });
  renderTLSForwarders();
  document.getElementById("addTLSPanel").classList.add("hidden");
  st.textContent = "Added. Save config to apply.";
}

// ─── Xray wizard cert source picker ──────────────────────────────────────────
function setWzCertSrc(mode) {
  ["file","paste","gen"].forEach(m => {
    const cap = m.charAt(0).toUpperCase() + m.slice(1);
    document.getElementById("wzCertSrc"+cap).style.display = m === mode ? "" : "none";
    const btn = document.getElementById("wzCertSrc"+cap+"Btn");
    if (btn) btn.className = (m === mode ? "btn btn-sm" : "btn btn-ghost btn-sm");
  });
  document.getElementById("wzPasteCertStatus").textContent = "";
  document.getElementById("wzGenCertStatus").textContent   = "";
}

async function wzSavePastedCert() {
  const st   = document.getElementById("wzPasteCertStatus");
  const name = document.getElementById("wzPastedName").value.trim();
  const cert = document.getElementById("wzPastedCert").value.trim();
  const key  = document.getElementById("wzPastedKey").value.trim();
  if (!name || !cert || !key) { st.textContent = "Name, cert, and key required."; return; }
  st.textContent = "Saving…";
  try {
    const res = await api("/api/tls/upload-pem", { method:"POST", body: JSON.stringify({ name, cert, key }) });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    document.getElementById("wzTLSCert").value = data.cert_file;
    document.getElementById("wzTLSKey").value  = data.key_file;
    st.textContent = "Saved ✓ paths set.";
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else st.textContent = "Error: " + e.message;
  }
}

async function wzGenerateCert() {
  const st     = document.getElementById("wzGenCertStatus");
  const domain = document.getElementById("wzGenDomain").value.trim();
  if (!domain) { st.textContent = "Domain required."; return; }
  st.textContent = "Generating…";
  try {
    const res = await api("/api/tls/generate-selfsigned", { method:"POST", body: JSON.stringify({ domain }) });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    document.getElementById("wzTLSCert").value = data.cert_file;
    document.getElementById("wzTLSKey").value  = data.key_file;
    st.textContent = "Generated ✓ paths set.";
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else st.textContent = "Error: " + e.message;
  }
}

// ─── DNSTT Key Management ─────────────────────────────────────────────────────
async function generateDnsttKey() {
  const st = document.getElementById("dnsttKeyStatus");
  st.textContent = "Generating key…";
  try {
    const res = await api("/api/dnstt/genkey", { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    document.getElementById("cfgDnsttKey").value = data.privkey_file;
    document.getElementById("dnsttPubkeyVal").value = data.pubkey;
    document.getElementById("dnsttPubkeyWrap").classList.remove("hidden");
    st.textContent = "Key generated. Save config to apply.";
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else st.textContent = "Error: " + e.message;
  }
}

async function loadDnsttPubkey() {
  const st = document.getElementById("dnsttKeyStatus");
  st.textContent = "Loading public key…";
  try {
    const res = await api("/api/dnstt/pubkey");
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    document.getElementById("dnsttPubkeyVal").value = data.pubkey;
    document.getElementById("dnsttPubkeyWrap").classList.remove("hidden");
    st.textContent = "";
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else st.textContent = "Error: " + e.message;
  }
}
