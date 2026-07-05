// ─── Auth error ───────────────────────────────────────────────────────────────
function doAuthError() {
  sessionToken = "";
  localStorage.removeItem("SESSION_TOKEN");
  clearTimers();
  mainApp.classList.add("hidden");
  loginOverlay.classList.remove("hidden");
  loginErr.textContent = t("Session expired — please sign in again.");
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener("load", () => {
  if (sessionToken) {
    // Try to validate the stored token
    api("/api/auth/me").then(async res => {
      if (!res.ok) { doAuthError(); return; }
      const d = await res.json();
      currentRole = d.role;
      currentUser = d.username;
      loginOverlay.classList.add("hidden");
      mainApp.classList.remove("hidden");
      initAfterLogin();
    }).catch(() => doAuthError());
  } else {
    loginOverlay.classList.remove("hidden");
  }
});
