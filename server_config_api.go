package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"sync"
)

// Note: applyFullConfigReload is defined in hotreload.go

// ---------- Global config holder ----------

var (
	globalCfgMu   sync.RWMutex
	globalCfg     *Config
	globalCfgPath string // set in main() from the -config flag

	bannerMu          sync.RWMutex
	currentBannerText string
)

func setGlobalCfg(c *Config) {
	globalCfgMu.Lock()
	globalCfg = c
	globalCfgMu.Unlock()
}

func getGlobalCfg() *Config {
	globalCfgMu.RLock()
	defer globalCfgMu.RUnlock()
	return globalCfg
}

func setBannerText(s string) {
	bannerMu.Lock()
	currentBannerText = s
	bannerMu.Unlock()
}

func getBannerText() string {
	bannerMu.RLock()
	defer bannerMu.RUnlock()
	return currentBannerText
}

// ---------- HTTP handler ----------

// handleServerConfig dispatches GET (read) and POST (write) for /api/server/config.
func handleServerConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		serverConfigGet(w, r)
	case http.MethodPost:
		serverConfigPost(w, r)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func serverConfigGet(w http.ResponseWriter, _ *http.Request) {
	if globalCfgPath == "" {
		http.Error(w, "config path not set", http.StatusInternalServerError)
		return
	}
	data, err := os.ReadFile(globalCfgPath)
	if err != nil {
		http.Error(w, "failed to read config: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(data)
}

func serverConfigPost(w http.ResponseWriter, r *http.Request) {
	if globalCfgPath == "" {
		http.Error(w, "config path not set", http.StatusInternalServerError)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 512*1024))
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}
	var newCfg Config
	if err := json.Unmarshal(body, &newCfg); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if newCfg.Listen == "" {
		http.Error(w, "listen address required", http.StatusBadRequest)
		return
	}

	// Preserve file-based users array (not editable through the UI).
	globalCfgMu.RLock()
	if globalCfg != nil {
		newCfg.Users = globalCfg.Users
	}
	globalCfgMu.RUnlock()

	portWarnings := normalizeRuntimePorts(&newCfg)

	out, err := json.MarshalIndent(newCfg, "", "  ")
	if err != nil {
		http.Error(w, "marshal error", http.StatusInternalServerError)
		return
	}
	if err := os.WriteFile(globalCfgPath, out, 0o644); err != nil {
		http.Error(w, "failed to write config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Apply all changes live and return health checks to the panel.
	report := applyFullConfigReload(&newCfg)
	if len(portWarnings) > 0 {
		report.Warnings = append(portWarnings, report.Warnings...)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(report)
}
