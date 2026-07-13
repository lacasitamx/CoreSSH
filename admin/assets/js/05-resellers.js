// ─── Hierarchical resellers ───────────────────────────────────────────────────
let resellersCache = [];
let editingReseller = "";

document.getElementById("reloadResellersBtn")?.addEventListener("click", loadResellers);
document.getElementById("resellerHeroReloadBtn")?.addEventListener("click", loadResellers);
document.getElementById("newResellerBtn")?.addEventListener("click", () => {
  prepareNewReseller();
  navigateWorkspaceSection("resellers", "create");
});
document.getElementById("cancelResellerBtn")?.addEventListener("click", () => {
  prepareNewReseller();
  setWorkspaceSection("resellers", "users");
});
document.getElementById("reloadResellerAuditBtn")?.addEventListener("click", loadResellerAudit);
document.querySelector("[data-tab='resellers']")?.addEventListener("click", loadResellers);
document.querySelectorAll("[data-workspace='resellers'][data-workspace-section='audit']").forEach(el => {
  el.addEventListener("click", loadResellerAudit);
});
document.querySelector("[data-workspace-select='resellers']")?.addEventListener("change", e => {
  if (e.target.value === "audit") loadResellerAudit();
});
rQuotaMode?.addEventListener("change", toggleResellerPlanFields);

function toggleResellerPlanFields() {
  const credit = rQuotaMode.value === "credits";
  document.getElementById("rSlotsField")?.classList.toggle("hidden", credit);
  document.getElementById("rCreditsField")?.classList.toggle("hidden", !credit);
  document.getElementById("rExpiresField")?.classList.toggle("hidden", credit);
  if (credit) rExpires.value = "";
}

function prepareNewReseller() {
  editingReseller = "";
  resellerFormTitle.textContent = t("Create Reseller");
  const heading = document.getElementById("resellerFormHeading");
  if (heading) heading.textContent = t("Create reseller");
  resellerForm.reset();
  rUsername.disabled = false;
  rParent.disabled = false;
  rQuotaMode.disabled = currentRole === "reseller";
  rQuotaMode.value = currentRole === "reseller" ? currentQuotaMode : "slots";
  rMaxUsers.min = currentRole === "reseller" ? "1" : "0";
  rMaxUsers.value = currentRole === "reseller" ? "1" : "30";
  rCredits.value = "1";
  rActive.checked = true;
  populateResellerParents();
  toggleResellerPlanFields();
  resellerStatus.textContent = t("New reseller.");
  requestAnimationFrame(() => rUsername.focus());
}

async function loadResellers() {
  resellerStatus.textContent = t("Loading…");
  setResellerLiveStatus("Carregando revendedores…", "is-loading");
  try {
    const res = await api("/api/resellers");
    if (!res.ok) throw new Error(await res.text());
    resellersCache = await res.json() || [];
    renderResellers(resellersCache);
    populateResellerParents();
    resellerStatus.textContent = t("Loaded.");
    setResellerLiveStatus(`Atualizado às ${new Date().toLocaleTimeString()}`, "is-ok");
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else {
      resellerStatus.textContent = `${t("Error loading.")} ${e.message || ""}`.trim();
      setResellerLiveStatus("Falha ao carregar revendedores", "is-error");
    }
  }
}

function setResellerLiveStatus(message, tone) {
  const el = document.getElementById("resellerLiveStatus");
  if (!el) return;
  el.textContent = message;
  el.className = `workspace-live-status ${tone || ""}`.trim();
}

function renderResellerMetrics(list) {
  const active = list.filter(r => r.effective_active).length;
  const allocated = list.reduce((sum, r) => sum + (r.quota_mode === "slots" ? Number(r.max_users || 0) : 0), 0);
  const credits = list.reduce((sum, r) => sum + (r.quota_mode === "credits" ? Number(r.credit_balance || 0) : 0), 0);
  document.getElementById("resellerMetricTotal").textContent = String(list.length);
  document.getElementById("resellerMetricActive").textContent = String(active);
  document.getElementById("resellerMetricAllocated").textContent = String(allocated);
  document.getElementById("resellerMetricCredits").textContent = String(credits);
}

function renderResellers(list) {
  resellerCountChip.textContent = list.length;
  renderResellerMetrics(list);
  resellersBody.innerHTML = "";
  if (!list.length) {
    resellersBody.innerHTML = `<tr class="bot-empty-row"><td colspan="5">Nenhum revendedor direto cadastrado.</td></tr>`;
    return;
  }
  list.forEach(r => {
    const expired = !!r.expires_at && new Date(r.expires_at) < new Date();
    const effective = !!r.effective_active && !expired;
    const maxUsers = Number(r.max_users || 0);
    const directUsed = Number(r.used_users || 0);
    const childAllocation = Number(r.child_allocation || 0);
    const committed = directUsed + childAllocation;
    const remaining = maxUsers ? Math.max(0, maxUsers - committed) : "∞";
    const pct = maxUsers ? Math.min(100, Math.round((committed / maxUsers) * 100)) : 0;
    const isCredit = r.quota_mode === "credits";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="bot-primary-cell"><strong>${escapeHTML(r.username)}</strong>
          <small>${r.parent_username ? `pai: ${escapeHTML(r.parent_username)}` : "revenda principal"}${r.child_count ? ` · ${r.child_count} sub-revenda(s)` : ""}</small>
          ${r.whatsapp ? `<small>${escapeHTML(r.whatsapp)}</small>` : ""}
        </div>
      </td>
      <td>
        <strong>${isCredit ? `${r.credit_balance || 0} créditos` : `${committed} / ${maxUsers || "∞"}`}</strong>
        <div class="hint">${isCredit ? "31 dias por renovação" : `Disponível ${remaining} · capacidade usada ${directUsed} · reservado ${childAllocation}`} · SSH ${r.used_ssh_users || 0} contas · Xray ${r.used_xray_users || 0} contas</div>
        ${isCredit ? "" : `<div class="table-meter"><span style="width:${pct}%"></span></div>`}
      </td>
      <td>${isCredit ? "Sem expiração" : r.expires_at ? escapeHTML(fmtDate(r.expires_at)) : "—"}</td>
      <td><span class="${effective ? "badge-on" : "badge-off"}">${effective ? "Ativo" : expired ? "Expirado" : r.is_active ? "Bloqueado pelo pai" : "Suspenso"}</span></td>
      <td></td>`;
    const actions = document.createElement("div");
    actions.className = "bot-row-actions reseller-row-actions";
    actions.appendChild(resellerActionButton(t("Edit"), "btn btn-ghost btn-sm", () => fillResellerForm(r)));
    if (!isCredit) actions.appendChild(resellerActionButton("+30d", "btn btn-ghost btn-sm", () => runResellerAction(r, "renew")));
    if (currentRole === "superadmin" && r.parent_username) actions.appendChild(resellerActionButton("Puxar", "btn btn-ghost btn-sm", () => runResellerAction(r, "pull")));
    actions.appendChild(resellerActionButton(r.is_active ? "Suspender" : "Reativar", r.is_active ? "btn btn-warn btn-sm" : "btn btn-ghost btn-sm", () => runResellerAction(r, r.is_active ? "suspend" : "reactivate")));
    actions.appendChild(resellerActionButton(t("Del"), "btn btn-danger btn-sm", () => deleteReseller(r)));
    tr.lastElementChild.appendChild(actions);
    resellersBody.appendChild(tr);
  });
}

function resellerActionButton(label, className, onclick) {
  return Object.assign(document.createElement("button"), { type: "button", className, textContent: label, onclick });
}

function populateResellerParents() {
  if (!rParent) return;
  const selected = rParent.value;
  rParent.innerHTML = `<option value="">Principal / sem pai</option>`;
  resellersCache
    .filter(r => r.username !== editingReseller && r.effective_active)
    .forEach(r => {
      const option = document.createElement("option");
      option.value = r.username;
      option.textContent = `${r.username} · ${r.quota_mode === "credits" ? `${r.credit_balance || 0} Cr` : `${r.available < 0 ? "∞" : r.available} slots`}`;
      rParent.appendChild(option);
    });
  if ([...rParent.options].some(o => o.value === selected)) rParent.value = selected;
}

function fillResellerForm(r) {
  editingReseller = r.username;
  setWorkspaceSection("resellers", "create");
  resellerFormTitle.textContent = `${t("Edit")}: ${r.username}`;
  const heading = document.getElementById("resellerFormHeading");
  if (heading) heading.textContent = t("Edit reseller");
  rUsername.value = r.username;
  rUsername.disabled = true;
  rPassword.value = "";
  populateResellerParents();
  rParent.value = r.parent_username || "";
  rParent.disabled = true;
  rQuotaMode.value = r.quota_mode || "slots";
  rQuotaMode.disabled = true;
  rMaxUsers.value = r.max_users || 0;
  rCredits.value = r.credit_balance || 0;
  rExpires.value = r.expires_at ? localFromISO(r.expires_at) : "";
  rWhatsApp.value = r.whatsapp || "";
  rMonthlyPrice.value = ((r.monthly_price_cents || 0) / 100).toFixed(2);
  rActive.checked = !!r.is_active;
  toggleResellerPlanFields();
  resellerStatus.textContent = t("Editing {name}.", {name: r.username});
}

resellerForm.addEventListener("submit", async e => {
  e.preventDefault();
  const btn = document.getElementById("saveResellerBtn");
  btn.disabled = true;
  resellerStatus.textContent = t("Saving…");
  const mode = rQuotaMode.value || "slots";
  const payload = {
    username: rUsername.value.trim(),
    password: rPassword.value || undefined,
    parent_username: currentRole === "superadmin" ? rParent.value : undefined,
    quota_mode: mode,
    max_users: parseInt(rMaxUsers.value || "0", 10),
    credits: parseInt(rCredits.value || "0", 10),
    expires_at: mode === "slots" ? isoFromLocal(rExpires.value) : "",
    whatsapp: rWhatsApp.value.trim(),
    monthly_price_cents: Math.round(Math.max(0, parseFloat(rMonthlyPrice.value || "0")) * 100),
    is_active: rActive.checked,
  };
  try {
    const res = await api("/api/resellers/create", { method: "POST", body: JSON.stringify(payload) });
    if (!res.ok) throw new Error((await res.text()).trim());
    showPanelToast(t("Reseller saved successfully."), "success", t("Resellers"));
    prepareNewReseller();
    await loadResellers();
    setWorkspaceSection("resellers", "users");
    if (currentRole === "reseller") loadMe();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else {
      resellerStatus.textContent = `${t("Error")}: ${e.message}`;
      showPanelToast(e.message, "error", t("Resellers"));
    }
  } finally {
    btn.disabled = false;
  }
});

async function runResellerAction(reseller, action) {
  const labels = { renew: "Renovar por 30 dias", suspend: "Suspender revendedor", reactivate: "Reativar revendedor", pull: "Puxar para o painel principal" };
  const descriptions = {
    renew: "A validade será estendida a partir da data atual ou da validade existente.",
    suspend: "A conta, seus descendentes e os acessos SSH/Xray ficarão bloqueados sem apagar os cadastros.",
    reactivate: "Os acessos preservados serão restaurados nos servidores disponíveis.",
    pull: "O revendedor deixará a revenda atual e passará a ser administrado diretamente pelo superadmin. Os créditos já transferidos não serão duplicados.",
  };
  const accepted = await panelConfirm({
    tone: action === "suspend" ? "danger" : "default",
    icon: action === "renew" ? "+30" : action === "suspend" ? "!" : action === "pull" ? "↥" : "✓",
    title: labels[action],
    message: `${labels[action]} “${reseller.username}”?`,
    detail: descriptions[action],
    confirmLabel: labels[action],
  });
  if (!accepted) return;
  resellerStatus.textContent = `${labels[action]}…`;
  try {
    const res = await api("/api/resellers/action", {
      method: "POST",
      body: JSON.stringify({ username: reseller.username, action, days: action === "renew" ? 30 : undefined }),
    });
    if (!res.ok) throw new Error((await res.text()).trim());
    const data = await res.json();
    if (data.runtime_warning) showPanelToast(data.runtime_warning, "warning", labels[action]);
    else showPanelToast(`${reseller.username}: operação concluída.`, "success", labels[action]);
    await loadResellers();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else showPanelToast(e.message, "error", labels[action]);
  }
}

async function deleteReseller(reseller) {
  const accepted = await panelConfirm({
    tone: "danger", icon: "×", title: t("Delete reseller"),
    message: t("Delete reseller \"{name}\"?", {name: reseller.username}),
    detail: `Serão removidos ${reseller.child_count || 0} sub-revendedores e todos os acessos SSH/Xray pertencentes à árvore. Esta ação não pode ser desfeita.`,
    confirmLabel: t("Delete reseller"),
  });
  if (!accepted) return;
  resellerStatus.textContent = t("Deleting {name}…", {name: reseller.username});
  try {
    const res = await api(`/api/resellers/delete?username=${encodeURIComponent(reseller.username)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) throw new Error((await res.text()).trim());
    showPanelToast(`${reseller.username} removido.`, "success", t("Resellers"));
    await loadResellers();
    if (currentRole === "reseller") loadMe();
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else showPanelToast(e.message || "Falha ao excluir.", "error", t("Delete reseller"));
  }
}

async function loadResellerAudit() {
  const body = document.getElementById("resellerAuditBody");
  if (!body) return;
  body.innerHTML = `<tr class="bot-empty-row"><td colspan="5">Carregando atividade…</td></tr>`;
  try {
    const res = await api("/api/resellers/audit");
    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json() || [];
    body.innerHTML = "";
    if (!rows.length) {
      body.innerHTML = `<tr class="bot-empty-row"><td colspan="5">Nenhuma atividade registrada.</td></tr>`;
      return;
    }
    rows.forEach(item => {
      const tr = document.createElement("tr");
      [fmtDate(item.created_at), item.actor_username, item.target_username, item.action, item.details || "—"].forEach(value => {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  } catch (e) {
    if (e.message === "auth") doAuthError();
    else body.innerHTML = `<tr class="bot-empty-row"><td colspan="5">Falha ao carregar a atividade.</td></tr>`;
  }
}
