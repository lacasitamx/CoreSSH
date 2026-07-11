// ─── Git update status ───────────────────────────────────────────────────────
const DRAGON_UPDATE_COMMAND = "sudo bash /opt/sshpanel/update.sh";

function updateStatusErrorText(error) {
  switch (String(error || "")) {
    case "remote update check timed out":
      return t("Update check timed out.");
    case "could not read the remote Git branch":
      return t("Could not reach the Git repository.");
    case "current build commit is unavailable":
      return t("Current build commit is unavailable.");
    default:
      return error || t("Unknown update-check error.");
  }
}

function setUpdateState(label, tone = "") {
  const chip = document.getElementById("updateStateChip");
  if (!chip) return;
  chip.className = "chip" + (tone ? ` ${tone}` : "");
  chip.textContent = label;
}

function setCommitValue(elementID, shortValue, fullValue) {
  const el = document.getElementById(elementID);
  if (!el) return;
  el.textContent = shortValue || "--";
  el.title = fullValue || "";
}

function renderUpdateStatus(data) {
  setCommitValue("updateCurrentCommit", data.current_commit_short, data.current_commit);
  setCommitValue("updateLatestCommit", data.latest_commit_short, data.latest_commit);

  const branch = document.getElementById("updateBranch");
  if (branch) branch.textContent = data.branch || "main";

  const checked = document.getElementById("updateCheckedAt");
  if (checked) {
    const date = data.checked_at ? new Date(data.checked_at) : null;
    checked.textContent = date && Number.isFinite(date.getTime()) ? date.toLocaleString() : "--";
  }

  const repoLink = document.getElementById("updateRepoLink");
  if (repoLink && data.repo_web_url) repoLink.href = data.repo_web_url;

  const text = document.getElementById("updateStatusText");
  const commandWrap = document.getElementById("updateCommandWrap");
  commandWrap?.classList.toggle("hidden", !data.update_available);

  if (data.status === "up_to_date") {
    setUpdateState(t("Up to date"), "green");
    if (text) text.textContent = t("The installed version matches the latest commit on {branch}.", { branch: data.branch || "main" });
    return;
  }

  if (data.status === "update_available") {
    setUpdateState(t("Update available"), "warn");
    if (text) text.textContent = t("A newer commit is available on {branch}.", { branch: data.branch || "main" });
    return;
  }

  if (data.status === "local_changes") {
    setUpdateState(t("Local changes"), "warn");
    if (text) text.textContent = t("This build contains local changes, so it cannot be compared safely.");
    return;
  }

  setUpdateState(t("Unknown"), "red");
  if (text) {
    text.textContent = data.error
      ? t("Could not check for updates: {error}", { error: updateStatusErrorText(data.error) })
      : t("The update status could not be determined.");
  }
}

async function loadUpdateStatus(force = false) {
  if (currentRole !== "superadmin") return;

  const button = document.getElementById("checkUpdateBtn");
  const text = document.getElementById("updateStatusText");
  if (button) button.disabled = true;
  setUpdateState(t("Checking…"));
  if (text) text.textContent = t("Checking repository…");

  try {
    const path = "/api/system/update-status" + (force ? "?refresh=1" : "");
    const res = await api(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderUpdateStatus(await res.json());
  } catch (error) {
    setUpdateState(t("Unknown"), "red");
    if (text) text.textContent = t("Could not check for updates: {error}", { error: error.message || t("Network error.") });
  } finally {
    if (button) button.disabled = false;
  }
}

document.getElementById("checkUpdateBtn")?.addEventListener("click", () => loadUpdateStatus(true));
document.getElementById("copyUpdateCommandBtn")?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(DRAGON_UPDATE_COMMAND);
  } catch {
    const input = document.createElement("textarea");
    input.value = DRAGON_UPDATE_COMMAND;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  const button = document.getElementById("copyUpdateCommandBtn");
  if (button) {
    const oldText = button.textContent;
    button.textContent = t("Copied");
    setTimeout(() => { button.textContent = oldText; }, 1400);
  }
});
