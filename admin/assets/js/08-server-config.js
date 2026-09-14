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


// Only operator-safe knobs remain. Global transport/XHTTP count admission is
// fixed to unlimited; byte backpressure and protocol buffers stay internal so a
// panel value cannot turn normal VPN traffic into HTTP overload responses.
const XRAY_NATIVE_TUNING_DEFAULTS = {
  safe: {
    runtime_gomaxprocs: 0,
    mux_global_sessions: 32768,
    max_concurrent_connections: -1,
    max_concurrent_xhttp_requests: -1,
    xhttp_max_sessions: -1,
    trace_packets: false,
  },
  "high": {
    runtime_gomaxprocs: 0,
    mux_global_sessions: 65536,
    max_concurrent_connections: -1,
    max_concurrent_xhttp_requests: -1,
    xhttp_max_sessions: -1,
    trace_packets: false,
  },
};

const XRAY_NATIVE_TUNING_FIELDS = {
  runtime_gomaxprocs: "cfgXrayRuntimeGomaxprocs",
  mux_global_sessions: "cfgXrayMuxGlobalSessions",
};

function setXrayNativeTuningDefaults(profile = "high") {
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
  // These legacy JSON keys are intentionally fixed at unlimited. Keeping them
  // in saved configs makes upgrades/downgrades explicit without exposing web
  // request ceilings that do not belong on a VPN transport.
  out.max_concurrent_connections = -1;
  out.max_concurrent_xhttp_requests = -1;
  out.xhttp_max_sessions = -1;
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
    document.getElementById("cfgLocalSSHListen").value = c.local_ssh_listen || "127.0.0.1:2222";
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
    document.getElementById("cfgDnsttUDP").value       = d.udp_listen || "0.0.0.0:5300";
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

    // BHTTP + BTUN
    writeBhttpConfig(c);
    writeBtunConfig(c);
    writeHcrConfig(c);
    loadBhttpHealth();
    loadBtunHealth();
    loadHcrHealth();

    // TLS forwarders
    tlsForwardersState = c.tls_forwarders || [];
    renderTLSForwarders();
    loadTLSCertificates();

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
    local_ssh_listen:     document.getElementById("cfgLocalSSHListen").value.trim() || "127.0.0.1:2222",
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
      udp_listen:          document.getElementById("cfgDnsttUDP").value.trim() || "0.0.0.0:5300",
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
    bhttp: readBhttpConfig(),
    btun: readBtunConfig(),
    hcr: readHcrConfig(),
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
    loadBhttpHealth();
    loadBtunHealth();
    loadHcrHealth();
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

// ─── TLS Certificates (renew fullchain + privkey) ─────────────────────────────
let tlsCertsState = [];

async function loadTLSCertificates() {
  const st = document.getElementById("tlsCertsStatus");
  const list = document.getElementById("tlsCertsList");
  if (!list) return;
  if (st) st.textContent = "Carregando certificados…";
  try {
    const res = await api("/api/tls/certs");
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    tlsCertsState = data.certs || [];
    renderTLSCertificates();
    if (st) st.textContent = tlsCertsState.length
      ? `${tlsCertsState.length} certificado(s). Pasta do painel: ${data.certs_dir || "/opt/sshpanel/certs"}`
      : "Nenhum certificado encontrado.";
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else if (st) st.textContent = "Erro: " + e.message;
  }
}

function certExpiryChip(c) {
  if (!c.exists) return '<span class="chip red">arquivo ausente</span>';
  if (c.error) return `<span class="chip red">${escapeHTML(c.error)}</span>`;
  if (c.expired) return '<span class="chip red">expirado</span>';
  if (c.expiring) return `<span class="chip warn">expira em ${c.days_left} dia(s)</span>`;
  return `<span class="chip green">válido por ${c.days_left} dia(s)</span>`;
}

function renderTLSCertificates() {
  const list = document.getElementById("tlsCertsList");
  const chip = document.getElementById("tlsCertsCountChip");
  if (!list) return;
  if (chip) chip.textContent = tlsCertsState.length;
  if (!tlsCertsState.length) {
    list.innerHTML = '<div class="hint" style="padding:4px 0;">Nenhum certificado encontrado neste servidor.</div>';
    return;
  }
  list.innerHTML = "";
  tlsCertsState.forEach((c, i) => {
    const row = document.createElement("div");
    row.style = "padding:8px 0;border-bottom:1px solid var(--border);font-size:.73rem;";

    const usedBy = (c.used_by || []).map(u => {
      const label = u.kind === "tls_forwarder" ? "TLS " + u.ref : "Xray " + u.ref;
      return `<span class="chip">${escapeHTML(label)}</span>`;
    }).join(" ") || '<span class="hint">não referenciado na configuração</span>';

    const head = document.createElement("div");
    head.style = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;";
    head.innerHTML = `<strong style="font-size:.78rem;">${escapeHTML(c.name || "cert")}</strong>
      ${certExpiryChip(c)}
      ${c.self_signed ? '<span class="chip warn">autoassinado</span>' : ""}
      ${c.managed ? '<span class="chip">painel</span>' : ""}
      <span style="flex:1"></span>`;

    const btn = document.createElement("button");
    btn.className = "btn btn-ghost btn-sm";
    btn.type = "button";
    btn.textContent = "Atualizar certificado";
    btn.onclick = () => toggleCertRenewForm(i);
    head.appendChild(btn);
    row.appendChild(head);

    const meta = document.createElement("div");
    meta.className = "hint";
    meta.style = "margin-top:3px;font-family:monospace;word-break:break-all;";
    const domains = (c.domains || []).join(", ") || "sem SAN";
    meta.innerHTML = `${escapeHTML(domains)}<br/>${escapeHTML(c.cert_file || "")}<br/>${escapeHTML(c.key_file || "sem chave")}`;
    row.appendChild(meta);

    const extra = document.createElement("div");
    extra.className = "hint";
    extra.style = "margin-top:3px;";
    const bits = [];
    if (c.issuer) bits.push("emissor: " + c.issuer);
    if (c.key_type) bits.push("chave: " + c.key_type);
    if (c.chain_length) bits.push("cadeia: " + c.chain_length + " cert(s)");
    if (c.not_after) bits.push("expira: " + c.not_after.replace("T", " ").replace("Z", " UTC"));
    extra.textContent = bits.join(" · ");
    row.appendChild(extra);

    const usage = document.createElement("div");
    usage.style = "margin-top:5px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;";
    usage.innerHTML = `<span class="hint">em uso por:</span> ${usedBy}`;
    row.appendChild(usage);

    const panel = document.createElement("div");
    panel.id = "certRenewPanel-" + i;
    panel.className = "hidden";
    panel.style = "border:1px solid var(--border);border-radius:8px;padding:10px;margin-top:8px;";
    panel.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div class="field"><label>fullchain.pem <span class="hint">(certificado + intermediários)</span></label>
          <textarea id="certRenewFullchain-${i}" rows="6" placeholder="-----BEGIN CERTIFICATE-----&#10;…" style="font-family:monospace;font-size:.7rem;width:100%;box-sizing:border-box;resize:vertical;background:var(--input-bg);border:1px solid var(--border);border-radius:4px;color:inherit;padding:4px;"></textarea></div>
        <div class="field"><label>privkey.pem <span class="hint">(chave privada)</span></label>
          <textarea id="certRenewPrivkey-${i}" rows="6" placeholder="-----BEGIN PRIVATE KEY-----&#10;…" style="font-family:monospace;font-size:.7rem;width:100%;box-sizing:border-box;resize:vertical;background:var(--input-bg);border:1px solid var(--border);border-radius:4px;color:inherit;padding:4px;"></textarea></div>
      </div>
      <div class="hint" style="margin-top:6px;">Grava em <code>${escapeHTML(c.cert_file || "")}</code> e <code>${escapeHTML(c.key_file || "")}</code>. O conteúdo anterior fica salvo como <code>.bak</code>.</div>
      <div class="form-actions" style="margin-top:8px;">
        <button class="btn btn-sm" type="button" onclick="submitCertRenew(${i})">Salvar e recarregar</button>
        <button class="btn btn-ghost btn-sm" type="button" onclick="toggleCertRenewForm(${i})">Cancelar</button>
      </div>
      <div id="certRenewStatus-${i}" class="hint" style="margin-top:4px;"></div>`;
    row.appendChild(panel);

    list.appendChild(row);
  });
}

function toggleCertRenewForm(i) {
  const panel = document.getElementById("certRenewPanel-" + i);
  if (!panel) return;
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) {
    document.getElementById("certRenewStatus-" + i).textContent = "";
    document.getElementById("certRenewFullchain-" + i).focus();
  }
}

function reportCertUpdate(statusEl, data) {
  const r = data?.reloaded || {};
  const applied = [];
  if ((r.tls_forwarders || []).length) applied.push("TLS " + r.tls_forwarders.join(", "));
  if (r.xray_restarted) applied.push("Xray reiniciado (" + (r.xray_inbounds || []).join(", ") + ")");
  const warnings = data?.warnings || [];
  const cert = data?.cert || {};
  const parts = ["Certificado gravado."];
  if (cert.not_after) parts.push("Válido até " + cert.not_after.replace("T", " ").replace("Z", " UTC") + ".");
  if (applied.length) parts.push("Recarregado: " + applied.join(" | ") + ".");
  else parts.push("Nenhum listener em uso precisou recarregar.");
  if (warnings.length) parts.push("Avisos: " + warnings.join(" | "));
  statusEl.textContent = parts.join(" ");
  showPanelToast(
    warnings.length ? "Certificado atualizado com avisos." : "Certificado atualizado e aplicado.",
    warnings.length ? "warning" : "success",
  );
}

async function submitCertRenew(i) {
  const c = tlsCertsState[i];
  const st = document.getElementById("certRenewStatus-" + i);
  if (!c || !st) return;
  const fullchain = document.getElementById("certRenewFullchain-" + i).value.trim();
  const privkey   = document.getElementById("certRenewPrivkey-" + i).value.trim();
  if (!fullchain || !privkey) { st.textContent = "Cole o fullchain.pem e o privkey.pem."; return; }

  const usedBy = (c.used_by || []).length;
  const ok = await panelConfirm({
    title: "Atualizar certificado",
    message: `Substituir o certificado de ${c.name || c.cert_file}?`,
    detail: usedBy
      ? "Os listeners TLS que usam este certificado serão reabertos e o Xray será reiniciado se algum inbound usar o certificado. Conexões já estabelecidas não são encerradas."
      : "Os arquivos serão substituídos (backup .bak).",
    confirmLabel: "Atualizar",
  });
  if (!ok) return;

  st.textContent = "Gravando e recarregando…";
  await postCertUpdate({ cert_file: c.cert_file, key_file: c.key_file, fullchain, privkey }, st, () => {
    document.getElementById("certRenewPanel-" + i)?.classList.add("hidden");
    loadTLSCertificates();
  });
}

async function postCertUpdate(payload, st, onDone) {
  try {
    let res = await api("/api/tls/certs/update", { method: "POST", body: JSON.stringify(payload) });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 400 && text.includes("force=true")) {
        const force = await panelConfirm({
          title: "Certificado expirado",
          message: text.split(";")[0],
          detail: "Gravar mesmo assim? Clientes não conseguirão validar um certificado expirado.",
          confirmLabel: "Gravar mesmo assim",
          danger: true,
        });
        if (!force) { st.textContent = "Cancelado."; return; }
        res = await api("/api/tls/certs/update", { method: "POST", body: JSON.stringify({ ...payload, force: true }) });
        if (!res.ok) throw new Error(await res.text());
      } else {
        throw new Error(text);
      }
    }
    const data = await res.json();
    reportCertUpdate(st, data);
    onDone?.();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else st.textContent = "Erro: " + e.message;
  }
}

function toggleNewCertForm() {
  const panel = document.getElementById("newCertPanel");
  if (!panel) return;
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) {
    document.getElementById("newCertStatus").textContent = "";
    document.getElementById("newCertName").value = "";
    document.getElementById("newCertFullchain").value = "";
    document.getElementById("newCertPrivkey").value = "";
  }
}

async function saveNewCert() {
  const st = document.getElementById("newCertStatus");
  const name = document.getElementById("newCertName").value.trim();
  const fullchain = document.getElementById("newCertFullchain").value.trim();
  const privkey = document.getElementById("newCertPrivkey").value.trim();
  if (!name || !fullchain || !privkey) { st.textContent = "Nome, fullchain.pem e privkey.pem são obrigatórios."; return; }
  st.textContent = "Gravando…";
  await postCertUpdate({ name, fullchain, privkey }, st, () => {
    document.getElementById("newCertFullchain").value = "";
    document.getElementById("newCertPrivkey").value = "";
    loadTLSCertificates();
  });
}

// Inline onclick handlers in index.html need these exposed explicitly.
window.loadTLSCertificates = loadTLSCertificates;
window.toggleCertRenewForm = toggleCertRenewForm;
window.submitCertRenew = submitCertRenew;
window.toggleNewCertForm = toggleNewCertForm;
window.saveNewCert = saveNewCert;

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
    const res = await api(withServerParam("/api/tls/upload-pem", selectedXrayServer()), { method:"POST", body: JSON.stringify({ name, cert, key }) });
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
    const res = await api(withServerParam("/api/tls/generate-selfsigned", selectedXrayServer()), { method:"POST", body: JSON.stringify({ domain }) });
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

// ─── BHTTP / BTUN ─────────────────────────────────────────────────────────────
// Both transports terminate inside this process: BHTTP hands each session to
// the built-in SSH server, and BTUN authenticates against the panel accounts.
// Neither uses the system sshd or PAM, so there is nothing host-side to set up
// here beyond the listeners and (for BTUN) the TUN/NAT settings.

function toggleBhttpFields(on) {
  const el = document.getElementById("bhttpFields");
  if (!el) return;
  el.style.opacity = on ? "1" : ".4";
  el.style.pointerEvents = on ? "" : "none";
}
function toggleBtunFields(on) {
  const el = document.getElementById("btunFields");
  if (!el) return;
  el.style.opacity = on ? "1" : ".4";
  el.style.pointerEvents = on ? "" : "none";
}

function readListenLines(id) {
  const el = document.getElementById(id);
  if (!el) return [];
  const seen = new Set();
  return el.value.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean).filter(s => {
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}


// ─── Null-safe field access ───────────────────────────────────────────────────
// A browser can hold a cached index.html while loading newer JS. Reading a
// field that does not exist there must not throw, because an exception here
// aborts loadServerConfig() and blanks the entire settings tab. Missing fields
// are simply skipped, so an older panel keeps working against a newer build.
function fieldSet(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}
function fieldCheck(id, checked) {
  const el = document.getElementById(id);
  if (el) el.checked = !!checked;
}
function fieldText(id, fallback = "") {
  const el = document.getElementById(id);
  return el ? el.value.trim() : fallback;
}
function fieldRaw(id, fallback = "") {
  const el = document.getElementById(id);
  return el ? el.value : fallback;
}
function fieldInt(id, fallback = 0) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const n = parseInt(el.value || "0", 10);
  return Number.isNaN(n) ? fallback : n;
}
function fieldBool(id, fallback = false) {
  const el = document.getElementById(id);
  return el ? !!el.checked : fallback;
}

function writeBhttpConfig(c) {
  const hasBhttp = !!c.bhttp;
  fieldCheck("cfgBhttpEnabled", hasBhttp);
  toggleBhttpFields(hasBhttp);
  const b = c.bhttp || {};
  // Sharing the panel's own ports is the point of enabling BHTTP for most
  // setups, so a config that has never had a bhttp block starts with it on.
  fieldCheck("cfgBhttpSharedPorts", hasBhttp ? !!b.shared_ports : true);
  fieldSet("cfgBhttpListen", (b.listen || []).join("\n"));
  fieldSet("cfgBhttpSessionTimeout", b.session_timeout || "");
  fieldSet("cfgBhttpMaxLanes", b.max_v2_lanes || 0);
  fieldSet("cfgBhttpMaxSessions", b.max_sessions || 0);
  fieldSet("cfgBhttpMaxConnections", b.max_connections || 0);
  fieldSet("cfgBhttpAutoRestart", b.auto_restart_interval || "");
  fieldSet("cfgBhttpRestartGrace", b.auto_restart_grace || "");
  fieldCheck("cfgBhttpNoConsole", !!b.disable_console_log);
  fieldCheck("cfgBhttpLogConnections", !!b.log_connections);
}

function readBhttpConfig() {
  if (!fieldBool("cfgBhttpEnabled")) return null;
  const listen = readListenLines("cfgBhttpListen");
  const shared = fieldBool("cfgBhttpSharedPorts");
  return {
    // With shared ports on, a dedicated listener is optional; without it there
    // has to be one or nothing would serve BHTTP at all.
    listen: listen.length ? listen : (shared ? [] : ["0.0.0.0:8880"]),
    shared_ports: shared,
    session_timeout: fieldText("cfgBhttpSessionTimeout"),
    max_v2_lanes: fieldInt("cfgBhttpMaxLanes"),
    max_sessions: fieldInt("cfgBhttpMaxSessions"),
    max_connections: fieldInt("cfgBhttpMaxConnections"),
    auto_restart_interval: fieldText("cfgBhttpAutoRestart"),
    auto_restart_grace: fieldText("cfgBhttpRestartGrace"),
    disable_console_log: fieldBool("cfgBhttpNoConsole"),
    log_connections: fieldBool("cfgBhttpLogConnections"),
  };
}

function writeBtunConfig(c) {
  const hasBtun = !!c.btun;
  fieldCheck("cfgBtunEnabled", hasBtun);
  toggleBtunFields(hasBtun);
  const b = c.btun || {};
  // Sharing the panel's ports is the least-friction way to reach BTUN, so a
  // config that has never had a btun block starts with it on.
  fieldCheck("cfgBtunSharedPorts", hasBtun ? !!b.shared_ports : true);
  fieldSet("cfgBtunTCPListen", b.tcp_listen || "");
  fieldSet("cfgBtunUDPListen", b.udp_listen || "");
  fieldSet("cfgBtunTUNName", b.tun_name || "");
  fieldSet("cfgBtunSubnet", b.subnet || "");
  fieldSet("cfgBtunGateway", b.gateway || "");
  fieldSet("cfgBtunMTU", b.mtu || 0);
  fieldCheck("cfgBtunManageRouting", !!b.manage_routing);
  fieldSet("cfgBtunWAN", b.wan_interface || "");
  fieldSet("cfgBtunHandshakeTimeout", b.handshake_timeout || "");
  fieldSet("cfgBtunIdleTimeout", b.idle_timeout || "");
  fieldSet("cfgBtunMaxPacketSize", b.max_packet_size || 0);
  fieldSet("cfgBtunMaxCoverBytes", b.max_cover_bytes || 0);
  fieldSet("cfgBtunMaxSessions", b.max_sessions || 0);
  fieldSet("cfgBtunAutoRestart", b.auto_restart_interval || "");
  fieldSet("cfgBtunRestartGrace", b.auto_restart_grace || "");
  fieldCheck("cfgBtunNoConsole", !!b.disable_console_log);
  fieldCheck("cfgBtunLogConnections", !!b.log_connections);
}

function readBtunConfig() {
  if (!fieldBool("cfgBtunEnabled")) return null;
  const tcp = fieldText("cfgBtunTCPListen");
  const udp = fieldText("cfgBtunUDPListen");
  const shared = fieldBool("cfgBtunSharedPorts");
  return {
    // The server refuses to start with nothing to serve on, so default both
    // listeners rather than saving a config that cannot come up. With shared
    // ports on, having neither is a valid TCP-only deployment.
    tcp_listen: tcp || (udp || shared ? "" : "0.0.0.0:7300"),
    udp_listen: udp || (tcp || shared ? "" : "0.0.0.0:7300"),
    shared_ports: shared,
    tun_name: fieldText("cfgBtunTUNName"),
    subnet: fieldText("cfgBtunSubnet"),
    gateway: fieldText("cfgBtunGateway"),
    mtu: fieldInt("cfgBtunMTU"),
    manage_routing: fieldBool("cfgBtunManageRouting"),
    wan_interface: fieldText("cfgBtunWAN"),
    handshake_timeout: fieldText("cfgBtunHandshakeTimeout"),
    idle_timeout: fieldText("cfgBtunIdleTimeout"),
    max_packet_size: fieldInt("cfgBtunMaxPacketSize"),
    max_cover_bytes: fieldInt("cfgBtunMaxCoverBytes"),
    max_sessions: fieldInt("cfgBtunMaxSessions"),
    auto_restart_interval: fieldText("cfgBtunAutoRestart"),
    auto_restart_grace: fieldText("cfgBtunRestartGrace"),
    disable_console_log: fieldBool("cfgBtunNoConsole"),
    log_connections: fieldBool("cfgBtunLogConnections"),
  };
}

// renderCounterRows fills a two-column counter table, matching the DNSTT health
// card so all transports read the same way.
function renderCounterRows(bodyId, rows) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  body.innerHTML = "";
  for (let i = 0; i < rows.length; i += 2) {
    const a = rows[i];
    const b = rows[i + 1] || ["", ""];
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHTML(a[0])}</td><td>${escapeHTML(fmtInt(a[1]))}</td>` +
      `<td>${escapeHTML(b[0])}</td><td>${b[0] ? escapeHTML(fmtInt(b[1])) : ""}</td>`;
    body.appendChild(tr);
  }
}

function setServiceChip(chipId, data) {
  const chip = document.getElementById(chipId);
  if (!chip) return;
  if (!data || data.enabled === false) {
    chip.textContent = "disabled";
    chip.className = "chip";
    return;
  }
  chip.textContent = data.running ? "running" : "stopped";
  chip.className = data.running ? "chip green" : "chip red";
}

async function loadBhttpHealth() {
  const summary = document.getElementById("bhttpStatusSummary");
  if (!summary) return;
  try {
    const res = await api("/api/bhttp");
    if (!res.ok) throw new Error(await res.text());
    const d = await res.json();
    setServiceChip("bhttpStatusChip", d);

    document.getElementById("bhttpActiveSessions").textContent = fmtInt(d.activeSessions);
    document.getElementById("bhttpActiveConns").textContent = fmtInt(d.activeConnections);
    document.getElementById("bhttpUploadBytes").textContent = fmtBytes(d.uploadBytes || 0);
    document.getElementById("bhttpDownloadBytes").textContent = fmtBytes(d.downloadBytes || 0);

    renderCounterRows("bhttpHealthBody", [
      ["Sockets accepted", d.accepted],
      ["Sockets rejected", d.connectionsRejected],
      ["Sessions rejected", d.sessionsRejected],
      ["Sessions expired", d.sessionsExpired],
      ["Probes (BHP1)", (d.probes || 0) - (d.probesV2 || 0)],
      ["Probes (BHP2)", d.probesV2],
      ["HTTP cover upgrades", d.httpUpgrades],
      ["v2 lanes attached", d.lanesAttached],
      ["v2 lanes rejected", d.lanesRejected],
      ["SSH target failures", d.targetFailures],
      ["Protocol errors", d.protocolErrors],
    ]);

    if (d.enabled === false) {
      summary.textContent = "BHTTP está desativado na configuração.";
    } else if (!d.running) {
      summary.textContent = "BHTTP está ativado mas não está rodando. Verifique se a porta está livre nos logs abaixo.";
    } else {
      const bad = Number(d.connectionsRejected || 0) + Number(d.sessionsRejected || 0) +
        Number(d.targetFailures || 0);
      summary.textContent = bad > 0
        ? `Rodando em ${d.listen || "?"} — atenção: ${fmtInt(bad)} rejeições/falhas acumuladas.`
        : `Rodando em ${d.listen || "?"} — sem rejeições nem falhas de alvo.`;
    }
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else summary.textContent = "Erro ao carregar status: " + e.message;
  }
}

async function loadBhttpLogs() {
  const box = document.getElementById("bhttpLogs");
  if (!box) return;
  box.textContent = "Carregando…";
  try {
    const res = await api("/api/bhttp/logs");
    if (!res.ok) throw new Error(await res.text());
    const lines = await res.json();
    box.textContent = lines && lines.length ? lines.join("\n") : "Sem logs.";
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else box.textContent = "Erro: " + e.message;
  }
}

async function loadBtunHealth() {
  const summary = document.getElementById("btunStatusSummary");
  if (!summary) return;
  try {
    const res = await api("/api/btun");
    if (!res.ok) throw new Error(await res.text());
    const d = await res.json();
    setServiceChip("btunStatusChip", d);

    document.getElementById("btunActiveSessions").textContent = fmtInt(d.activeSessions);
    document.getElementById("btunAuthSucceeded").textContent = fmtInt(d.authSucceeded);
    document.getElementById("btunClientBytes").textContent = fmtBytes(d.clientBytes || 0);
    document.getElementById("btunInternetBytes").textContent = fmtBytes(d.internetBytes || 0);

    renderCounterRows("btunHealthBody", [
      ["Handshakes accepted", d.accepted],
      ["Auth rejected", d.authRejected],
      ["Sessions rejected", d.sessionsRejected],
      ["Dropped packets", d.droppedPackets],
      ["Client → net packets", d.clientPackets],
      ["Net → client packets", d.internetPackets],
    ]);

    if (d.enabled === false) {
      summary.textContent = "BTUN está desativado na configuração.";
    } else if (!d.running) {
      summary.textContent = "BTUN está ativado mas não está rodando. Normalmente falta /dev/net/tun, ou a interface/porta já está em uso — veja os logs.";
    } else {
      const where = [d.listen, d.tunName, d.subnet].filter(Boolean).join(" · ");
      summary.textContent = Number(d.droppedPackets || 0) > 0
        ? `Rodando em ${where} — ${fmtInt(d.droppedPackets)} pacotes descartados (confira MTU e rota).`
        : `Rodando em ${where} — sem pacotes descartados.`;
    }
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else summary.textContent = "Erro ao carregar status: " + e.message;
  }
}

async function loadBtunLogs() {
  const box = document.getElementById("btunLogs");
  if (!box) return;
  box.textContent = "Carregando…";
  try {
    const res = await api("/api/btun/logs");
    if (!res.ok) throw new Error(await res.text());
    const lines = await res.json();
    box.textContent = lines && lines.length ? lines.join("\n") : "Sem logs.";
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else box.textContent = "Erro: " + e.message;
  }
}

// Inline onchange/onclick handlers in index.html need these on window.
window.toggleBhttpFields = toggleBhttpFields;
window.toggleBtunFields = toggleBtunFields;
window.loadBhttpHealth = loadBhttpHealth;
window.loadBhttpLogs = loadBhttpLogs;
window.loadBtunHealth = loadBtunHealth;
window.loadBtunLogs = loadBtunLogs;


function toggleHcrFields(on) {
  const el = document.getElementById("hcrFields");
  if (!el) return;
  el.style.opacity = on ? "1" : ".4";
  el.style.pointerEvents = on ? "" : "none";
}

function writeHcrConfig(c) {
  const has = !!c.hcr;
  fieldCheck("cfgHcrEnabled", has);
  toggleHcrFields(has);
  const h = c.hcr || {};
  // Sharing the panel's ports (alongside BHTTP) is the least-friction setup, so
  // a config that never had an hcr block starts with it on.
  fieldCheck("cfgHcrSharedPorts", has ? !!h.shared_ports : true);
  fieldSet("cfgHcrListen", (h.listen || []).join("\n"));
  fieldSet("cfgHcrMaxSessions", h.max_sessions || 0);
  fieldSet("cfgHcrMaxConnections", h.max_connections || 0);
  fieldSet("cfgHcrMaxSource", h.max_source_sessions || 0);
  fieldSet("cfgHcrMaxFrame", h.max_download_frame || 0);
  fieldSet("cfgHcrPollTimeout", h.download_poll_timeout || "");
  fieldSet("cfgHcrIdleTimeout", h.idle_session_timeout || "");
  fieldSet("cfgHcrAutoRestart", h.auto_restart_interval || "");
  fieldSet("cfgHcrRestartGrace", h.auto_restart_grace || "");
  fieldCheck("cfgHcrNoConsole", !!h.disable_console_log);
  fieldCheck("cfgHcrLogConnections", !!h.log_connections);
}

function readHcrConfig() {
  if (!fieldBool("cfgHcrEnabled")) return null;
  const listen = readListenLines("cfgHcrListen");
  const shared = fieldBool("cfgHcrSharedPorts");
  return {
    // With shared ports on, a dedicated listener is optional.
    listen: listen.length ? listen : (shared ? [] : ["0.0.0.0:8181"]),
    shared_ports: shared,
    max_sessions: fieldInt("cfgHcrMaxSessions"),
    max_connections: fieldInt("cfgHcrMaxConnections"),
    max_source_sessions: fieldInt("cfgHcrMaxSource"),
    max_download_frame: fieldInt("cfgHcrMaxFrame"),
    download_poll_timeout: fieldText("cfgHcrPollTimeout"),
    idle_session_timeout: fieldText("cfgHcrIdleTimeout"),
    auto_restart_interval: fieldText("cfgHcrAutoRestart"),
    auto_restart_grace: fieldText("cfgHcrRestartGrace"),
    disable_console_log: fieldBool("cfgHcrNoConsole"),
    log_connections: fieldBool("cfgHcrLogConnections"),
  };
}

async function loadHcrHealth() {
  const summary = document.getElementById("hcrStatusSummary");
  if (!summary) return;
  try {
    const res = await api("/api/hcr");
    if (!res.ok) throw new Error(await res.text());
    const d = await res.json();
    setServiceChip("hcrStatusChip", d);
    document.getElementById("hcrActiveSessions").textContent = fmtInt(d.activeSessions);
    document.getElementById("hcrActiveConns").textContent = fmtInt(d.activeConnections);
    document.getElementById("hcrUploadBytes").textContent = fmtBytes(d.uploadBytes || 0);
    document.getElementById("hcrDownloadBytes").textContent = fmtBytes(d.downloadBytes || 0);
    renderCounterRows("hcrHealthBody", [
      ["Sockets accepted", d.accepted],
      ["Sockets rejected", d.connectionsRejected],
      ["Sessions created", d.sessionsCreated],
      ["Sessions rejected", d.sessionsRejected],
      ["Protocol errors", d.protocolErrors],
    ]);
    if (d.enabled === false) {
      summary.textContent = "HCR está desativado na configuração.";
    } else if (!d.running) {
      summary.textContent = "HCR está ativado mas não está rodando. Verifique se a porta está livre nos logs abaixo.";
    } else {
      const bad = Number(d.connectionsRejected || 0) + Number(d.sessionsRejected || 0) + Number(d.protocolErrors || 0);
      summary.textContent = bad > 0
        ? `Rodando em ${d.listen || "?"} — atenção: ${fmtInt(bad)} rejeições/erros acumulados.`
        : `Rodando em ${d.listen || "?"} — sem rejeições nem erros.`;
    }
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else summary.textContent = "Erro ao carregar status: " + e.message;
  }
}

async function loadHcrLogs() {
  const box = document.getElementById("hcrLogs");
  if (!box) return;
  box.textContent = "Carregando…";
  try {
    const res = await api("/api/hcr/logs");
    if (!res.ok) throw new Error(await res.text());
    const lines = await res.json();
    box.textContent = lines && lines.length ? lines.join("\n") : "Sem logs.";
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else box.textContent = "Erro: " + e.message;
  }
}

window.toggleHcrFields = toggleHcrFields;
window.loadHcrHealth = loadHcrHealth;
window.loadHcrLogs = loadHcrLogs;
