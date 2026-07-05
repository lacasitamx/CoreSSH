// ─── Resellers ────────────────────────────────────────────────────────────────
document.getElementById("reloadResellersBtn").addEventListener("click", loadResellers);
document.getElementById("newResellerBtn").addEventListener("click", () => {
  resellerFormTitle.textContent = "Create Reseller";
  resellerForm.reset();
  rActive.checked = true;
  resellerStatus.textContent = "New reseller.";
});
document.getElementById("cancelResellerBtn").addEventListener("click", () => {
  resellerForm.reset();
  rActive.checked = true;
  resellerFormTitle.textContent = "Create Reseller";
});

document.querySelector("[data-tab='resellers']")?.addEventListener("click", loadResellers);

async function loadResellers() {
  resellerStatus.textContent = "Loading…";
  try {
    const res  = await api("/api/resellers");
    const data = await res.json();
    renderResellers(data || []);
    resellerStatus.textContent = "Loaded.";
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else resellerStatus.textContent = "Error loading.";
  }
}

function renderResellers(list) {
  resellerCountChip.textContent = list.length;
  resellersBody.innerHTML = "";
  list.forEach(r => {
    const expired = r.expires_at && new Date(r.expires_at) < new Date();
    const max = r.max_users || 0;
    const used = r.used_users || 0;
    const remaining = max ? Math.max(0, max - used) : "∞";
    const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.username}</td>
      <td>
        <strong>${used} / ${max || "∞"}</strong>
        <div class="hint">Disponível ${remaining} · SSH ${r.used_ssh_users || 0} · Xray ${r.used_xray_users || 0}</div>
        <div class="table-meter"><span style="width:${pct}%"></span></div>
      </td>
      <td>${r.expires_at ? fmtDate(r.expires_at) : "—"}</td>
      <td><span class="${r.is_active && !expired ? 'badge-on' : 'badge-off'}">${r.is_active && !expired ? "Active" : expired ? "Expired" : "Suspended"}</span></td>
      <td></td>`;
    const tdA = tr.lastElementChild;
    const editBtn = Object.assign(document.createElement("button"),{
      className:"btn btn-ghost btn-sm", textContent:t("Edit"),
      onclick: () => fillResellerForm(r),
    });
    const delBtn = Object.assign(document.createElement("button"),{
      className:"btn btn-danger btn-sm", textContent:t("Del"),
      style: "margin-left:4px;",
      onclick: () => deleteReseller(r.username),
    });
    tdA.append(editBtn, delBtn);
    resellersBody.appendChild(tr);
  });
}

function fillResellerForm(r) {
  resellerFormTitle.textContent = `Edit: ${r.username}`;
  rUsername.value  = r.username;
  rPassword.value  = "";
  rMaxUsers.value  = r.max_users || 0;
  rExpires.value   = r.expires_at ? localFromISO(r.expires_at) : "";
  rActive.checked  = r.is_active;
  resellerStatus.textContent = `Editing ${r.username}.`;
}

resellerForm.addEventListener("submit", async e => {
  e.preventDefault();
  const btn = document.getElementById("saveResellerBtn");
  btn.disabled = true;
  resellerStatus.textContent = "Saving…";
  const payload = {
    username:   rUsername.value.trim(),
    password:   rPassword.value || undefined,
    max_users:  parseInt(rMaxUsers.value||"0",10),
    expires_at: isoFromLocal(rExpires.value),
    is_active:  rActive.checked,
  };
  try {
    const res = await api("/api/resellers/create", { method:"POST", body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(await res.text());
    resellerStatus.textContent = "Saved.";
    resellerForm.reset(); rActive.checked = true;
    resellerFormTitle.textContent = "Create Reseller";
    loadResellers();
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else resellerStatus.textContent = "Error: "+e.message;
  } finally { btn.disabled = false; }
});

async function deleteReseller(username) {
  if (!confirm(`Delete reseller "${username}"? All their SSH sessions will be disconnected.`)) return;
  resellerStatus.textContent = `Deleting ${username}…`;
  try {
    const res = await api(`/api/resellers/delete?username=${encodeURIComponent(username)}`, { method:"DELETE" });
    if (!res.ok && res.status !== 204) throw new Error("failed");
    resellerStatus.textContent = "Deleted.";
    loadResellers();
  } catch (e) {
    if (e.message==="auth") doAuthError();
    else resellerStatus.textContent = "Error deleting.";
  }
}

