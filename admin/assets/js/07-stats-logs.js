// ─── Stats ────────────────────────────────────────────────────────────────────
document.querySelector("[data-tab='stats']")?.addEventListener("click", loadStats);

async function loadDashboardStats() {
  try {
    const res = await api("/api/stats");
    if (!res.ok) throw new Error(await res.text());
    const s = await res.json();
    updateDashboardStats(s);
    await loadDnsttHealth();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else {
      if (dashCpuVal) dashCpuVal.textContent = "erro";
      if (dashRamVal) dashRamVal.textContent = "erro";
      if (dashNetVal) dashNetVal.textContent = "erro";
    }
  }
}

function updateDashboardStats(s) {
  if (!s) return;
  const cpu = Number(s.cpu_percent ?? 0);
  const mem = s.mem_percent == null ? null : Number(s.mem_percent);
  if (dashCpuVal) dashCpuVal.textContent = fmtPct(cpu);
  if (dashCpuBar) dashCpuBar.style.width = Math.min(100, Math.max(0, cpu)) + "%";
  if (dashCpuText) dashCpuText.textContent = cpu >= 85 ? "Carga alta" : cpu >= 60 ? "Carga moderada" : "Carga normal";
  if (dashRamVal) dashRamVal.textContent = mem == null ? "--%" : fmtPct(mem);
  if (dashRamBar) dashRamBar.style.width = mem == null ? "0%" : Math.min(100, Math.max(0, mem)) + "%";
  if (dashRamText) {
    const used = s.mem_used_bytes, total = s.mem_total_bytes;
    dashRamText.textContent = used != null && total != null ? `${fmtBytes(used)} / ${fmtBytes(total)}` : "Memória usada";
  }
  const ifaces = Array.isArray(s.interfaces) ? s.interfaces : [];
  let rx = 0, tx = 0, rxTotal = 0, txTotal = 0;
  ifaces.forEach(it => {
    rx += Number(it.rx_mbps || 0);
    tx += Number(it.tx_mbps || 0);
    rxTotal += Number(it.rx_bytes || 0);
    txTotal += Number(it.tx_bytes || 0);
  });
  if (dashNetVal) dashNetVal.textContent = `${fmtMbps(rx + tx)} Mb/s`;
  if (dashNetText) dashNetText.textContent = `RX ${fmtMbps(rx)} · TX ${fmtMbps(tx)} Mb/s`;
  if (dashNetTotal) dashNetTotal.textContent = `Total ${fmtBytes(rxTotal + txTotal)}`;
}

async function loadDnsttHealth() {
  if (!dnsttDashboardCard && !dnsttHealthBody && !dnsttActiveSessions) return;
  if (currentRole !== "superadmin") {
    dnsttDashboardCard?.classList.add("hidden");
    return;
  }
  try {
    const res = await api("/api/dnstt");
    if (!res.ok) throw new Error(await res.text());
    const d = await res.json();
    const enabled = d.enabled !== false;
    if (dnsttDashboardCard) dnsttDashboardCard.classList.toggle("hidden", !enabled);
    if (!enabled) return;

    if (dnsttActiveSessions) dnsttActiveSessions.textContent = fmtInt(d.active_sessions);
    if (dnsttActiveStreams) dnsttActiveStreams.textContent = fmtInt(d.active_streams);
    if (dnsttDNSRx) dnsttDNSRx.textContent = fmtInt(d.dns_rx);
    if (dnsttQueueLen) dnsttQueueLen.textContent = fmtInt(d.ch_len);
    if (dnsttHealthUpdated) dnsttHealthUpdated.textContent = d.running === false ? "DNSTT stopped" : fmtDnsttTimestamp(d.timestamp);

    const rows = [
      ["Session rejected", d.sess_rejected],
      ["Stream rejected", d.stream_rejected],
      ["DNS parse errors", d.parse_err],
      ["No EDNS", d.no_edns],
      ["EDNS limit 512", d.limit512],
      ["Local DNS workers", d.fake_dns_workers],
      ["Response workers", d.dns_response_workers],
      ["Responses queued", d.rec_queued],
      ["Responses dropped", d.rec_dropped],
      ["Responses sent", d.resp_sent],
      ["Response bytes", d.resp_bytes],
      ["Empty responses", d.resp_empty],
      ["Data responses", d.resp_data],
      ["Oversize responses", d.resp_oversize],
      ["KCP sessions new", d.kcp_new],
      ["KCP sessions ended", d.kcp_end],
      ["SMUX streams new", d.smux_new],
      ["SMUX streams ended", d.smux_end],
      ["Panic recovered", d.panic_recovered],
    ];
    if (dnsttHealthBody) {
      dnsttHealthBody.innerHTML = "";
      for (let i = 0; i < rows.length; i += 2) {
        const a = rows[i];
        const b = rows[i + 1] || ["", ""];
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${a[0]}</td><td>${fmtInt(a[1])}</td><td>${b[0]}</td><td>${b[0] ? fmtInt(b[1]) : ""}</td>`;
        dnsttHealthBody.appendChild(tr);
      }
    }
    const bad = Number(d.sess_rejected || 0) + Number(d.stream_rejected || 0) + Number(d.rec_dropped || 0) + Number(d.panic_recovered || 0);
    if (dnsttHealthSummary) {
      if (d.running === false) {
        dnsttHealthSummary.textContent = "DNSTT is enabled but not running. Check key/domain/listen config or recent logs.";
      } else {
        dnsttHealthSummary.textContent = bad > 0
          ? `Attention: ${fmtInt(bad)} overload/recovery events in the last DNSTT stats window.`
          : "DNSTT health OK: no rejects, drops, or recovered panics in the last stats window.";
      }
    }
  } catch (e) {
    if (e.message === "auth") throw e;
    dnsttDashboardCard?.classList.add("hidden");
    if (dnsttHealthUpdated) dnsttHealthUpdated.textContent = "Error loading DNSTT stats.";
    if (dnsttHealthSummary) dnsttHealthSummary.textContent = e.message || "DNSTT stats unavailable.";
  }
}


async function loadStats() {
  try {
    const res = await api("/api/stats");
    if (!res.ok) throw new Error(await res.text());
    const s   = await res.json();
    updateDashboardStats(s);
    const cpu = Number(s?.cpu_percent ?? 0);
    if (cpuVal) cpuVal.textContent = fmtPct(cpu);
    if (cpuBar) cpuBar.style.width = Math.min(100, Math.max(0, cpu)) + "%";
    const mp  = s?.mem_percent == null ? null : Number(s.mem_percent);
    if (memVal) memVal.textContent = mp == null ? "--%"  : fmtPct(mp);
    if (memBar) memBar.style.width = mp == null ? "0%"   : Math.min(100, Math.max(0, mp)) + "%";
    const mu = s?.mem_used_bytes, mt = s?.mem_total_bytes;
    if (memDetail) memDetail.textContent = (mu != null && mt != null) ? `${fmtBytes(mu)} / ${fmtBytes(mt)}` : "";
    const ifaces = Array.isArray(s.interfaces) ? s.interfaces : [];
    if (ifaceBody) ifaceBody.innerHTML = "";
    let totRx = 0, totTx = 0;
    ifaces.forEach(it => {
      totRx += Number(it.rx_bytes||0); totTx += Number(it.tx_bytes||0);
      if (!ifaceBody) return;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${it.name}</td><td>${fmtMbps(it.rx_mbps)}</td><td>${fmtMbps(it.tx_mbps)}</td><td>${fmtBytes(it.rx_bytes)}</td><td>${fmtBytes(it.tx_bytes)}</td>`;
      ifaceBody.appendChild(tr);
    });
    if (ifaceSummary) ifaceSummary.textContent = `Total: ${fmtBytes(totRx)} rx / ${fmtBytes(totTx)} tx`;
    if (statsUpdated) statsUpdated.textContent = "Updated: " + new Date().toLocaleTimeString();
    await loadDnsttHealth();
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else if (statsUpdated) statsUpdated.textContent = "Erro ao carregar stats.";
  }
}

resetIfaceStatsBtn?.addEventListener("click", resetInterfaceStats);

async function resetInterfaceStats() {
  if (!confirm("Clean the live Interface totals now? This does not delete VnStat daily/monthly history.")) return;
  resetIfaceStatsBtn.disabled = true;
  ifaceSummary.textContent = "Cleaning interface totals…";
  try {
    const res = await api("/api/stats/interfaces/reset", { method:"POST" });
    if (!res.ok) throw new Error(await res.text());
    ifaceSummary.textContent = "Interface totals cleaned. Auto-clean remains every 30 days.";
    loadStats();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else ifaceSummary.textContent = "Error cleaning totals: " + e.message;
  } finally {
    resetIfaceStatsBtn.disabled = false;
  }
}

// ─── VnStat ───────────────────────────────────────────────────────────────────
document.querySelector("[data-tab='vnstat']")?.addEventListener("click", loadVnstat);
reloadVnstatBtn?.addEventListener("click", loadVnstat);
resetVnstatBtn?.addEventListener("click", resetVnstatHistory);

function renderVnstatRows(body, rows, emptyLabel) {
  body.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" class="hint">${emptyLabel}</td>`;
    body.appendChild(tr);
    return;
  }
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.period || "--"}</td><td>${r.iface || "--"}</td><td>${fmtBytes(r.rx_bytes||0)}</td><td>${fmtBytes(r.tx_bytes||0)}</td><td>${fmtBytes(r.total_bytes||((r.rx_bytes||0)+(r.tx_bytes||0)))}</td>`;
    body.appendChild(tr);
  });
}

async function loadVnstat() {
  vnstatStatus.textContent = "Loading VnStat usage…";
  try {
    const res = await api("/api/vnstat?days=31&months=12");
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const daily = Array.isArray(data.daily) ? data.daily : [];
    const monthly = Array.isArray(data.monthly) ? data.monthly : [];
    renderVnstatRows(vnstatDailyBody, daily, "No daily usage recorded yet.");
    renderVnstatRows(vnstatMonthlyBody, monthly, "No monthly usage recorded yet.");

    // Use the server/database periods when available. Falling back to the
    // newest row avoids browser UTC/local-time mismatches that can make
    // "Today total" show 0 while the daily table has data.
    const today = data.today_period || daily[0]?.period || localDateKey();
    const month = data.month_period || today.slice(0,7);
    const todayTotal = data.today_total_bytes ?? daily.filter(r => r.period === today).reduce((sum, r) => sum + (r.total_bytes||0), 0);
    const monthTotal = data.month_total_bytes ?? monthly.filter(r => r.period === month).reduce((sum, r) => sum + (r.total_bytes||0), 0);
    const ifaces = new Set([...daily, ...monthly].map(r => r.iface).filter(Boolean));
    vnTodayTotal.textContent = fmtBytes(todayTotal);
    vnMonthTotal.textContent = fmtBytes(monthTotal);
    vnIfaceCount.textContent = String(data.interface_count ?? ifaces.size ?? 0);
    vnstatStatus.textContent = "Updated: " + new Date().toLocaleTimeString() + " · history is kept until manually cleaned.";
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else vnstatStatus.textContent = "Error loading VnStat usage: " + e.message;
  }
}

async function resetVnstatHistory() {
  if (!confirm("Clean all VnStat daily/monthly usage history? This does not reset the live Interface totals.")) return;
  resetVnstatBtn.disabled = true;
  vnstatStatus.textContent = "Cleaning VnStat history…";
  try {
    const res = await api("/api/vnstat/reset", { method:"POST" });
    if (!res.ok) throw new Error(await res.text());
    vnstatStatus.textContent = "VnStat history cleaned.";
    loadVnstat();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else vnstatStatus.textContent = "Error cleaning VnStat history: " + e.message;
  } finally {
    resetVnstatBtn.disabled = false;
  }
}

// ─── Logs ─────────────────────────────────────────────────────────────────────
document.querySelector("[data-tab='logs']")?.addEventListener("click", loadSystemLogs);
document.getElementById("logSource")?.addEventListener("change", loadSystemLogs);
document.getElementById("clearPanelLogBtn")?.addEventListener("click", clearPanelLog);

async function loadSystemLogs() {
  const box = document.getElementById("systemLogBox");
  const st = document.getElementById("systemLogStatus");
  const source = document.getElementById("logSource")?.value || "panel";
  const clearBtn = document.getElementById("clearPanelLogBtn");
  if (clearBtn) clearBtn.disabled = source !== "panel";
  st.textContent = "Loading…";
  try {
    const res = await api(`/api/system/logs?source=${encodeURIComponent(source)}&lines=500`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const lines = Array.isArray(data.lines) ? data.lines : [];
    box.textContent = lines.length ? lines.join("\n") : "No log lines yet.";
    box.scrollTop = box.scrollHeight;
    st.textContent = `${data.source || source} logs${data.path ? " · " + data.path : ""} · ${lines.length} lines · ` + new Date().toLocaleTimeString();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else st.textContent = "Error: " + e.message;
  }
}

async function clearPanelLog() {
  const st = document.getElementById("systemLogStatus");
  if (!confirm("Clean the panel log now? Logs are already auto-cleaned after 1 MiB.")) return;
  st.textContent = "Cleaning panel log…";
  try {
    const res = await api("/api/system/logs/reset", { method:"POST" });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    st.textContent = `Panel log cleaned · ${data.path || "panel.log"} · max ${fmtBytes(data.max_bytes || 1048576)}`;
    await loadSystemLogs();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else st.textContent = "Error cleaning panel log: " + e.message;
  }
}

