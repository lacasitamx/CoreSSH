package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
)

// XrayConfig holds Xray process management settings embedded in the main Config.
type XrayConfig struct {
	Enabled    bool   `json:"enabled"`
	BinPath    string `json:"bin_path"`    // e.g. /opt/sshpanel/xray
	ConfigFile string `json:"config_file"` // e.g. /opt/sshpanel/xray_config.json
}

// xrayLogRing is a fixed-capacity circular buffer for captured log lines.
type xrayLogRing struct {
	mu    sync.Mutex
	lines []string
	pos   int
}

const xrayLogCap = 200

func (r *xrayLogRing) add(line string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.lines) < xrayLogCap {
		r.lines = append(r.lines, line)
	} else {
		r.lines[r.pos] = line
		r.pos = (r.pos + 1) % xrayLogCap
	}
}

func (r *xrayLogRing) snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.lines) == 0 {
		return nil
	}
	out := make([]string, len(r.lines))
	if len(r.lines) < xrayLogCap {
		copy(out, r.lines)
	} else {
		n := copy(out, r.lines[r.pos:])
		copy(out[n:], r.lines[:r.pos])
	}
	return out
}

var xrayLogBuf = &xrayLogRing{}

// xrayWriter captures writes from the xray subprocess into the log ring buffer
// and forwards them to stderr so they appear in the process log.
type xrayWriter struct{}

func (w xrayWriter) Write(p []byte) (int, error) {
	text := strings.TrimRight(string(p), "\n")
	for _, line := range strings.Split(text, "\n") {
		if line != "" {
			xrayLogBuf.add(line)
		}
	}
	return os.Stderr.Write(p)
}

// XrayManager manages the lifecycle of the external xray subprocess.
type XrayManager struct {
	mu        sync.Mutex
	cmd       *exec.Cmd
	doneCh    chan struct{}
	cfg       *XrayConfig
	startTime time.Time
	lastErr   string
}

var xrayMgr = &XrayManager{}

// initXrayManager stores the config and auto-starts Xray if Enabled is true.
func initXrayManager(cfg *XrayConfig) {
	if cfg == nil {
		return
	}
	xrayMgr.mu.Lock()
	xrayMgr.cfg = cfg
	xrayMgr.mu.Unlock()

	if cfg.Enabled {
		if err := xrayMgr.Start(); err != nil {
			log.Printf("xray: auto-start failed: %v", err)
		}
	}
}

// isRunning returns true if the subprocess is currently alive.
// Must be called with m.mu held.
func (m *XrayManager) isRunning() bool {
	if m.doneCh == nil {
		return false
	}
	select {
	case <-m.doneCh:
		return false
	default:
		return true
	}
}

// Start launches the xray subprocess. Returns an error if already running or misconfigured.
func (m *XrayManager) Start() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.isRunning() {
		return fmt.Errorf("xray already running (pid %d)", m.cmd.Process.Pid)
	}
	if m.cfg == nil {
		return fmt.Errorf("xray not configured")
	}
	if _, err := os.Stat(m.cfg.BinPath); err != nil {
		return fmt.Errorf("xray binary not found at %s", m.cfg.BinPath)
	}

	args := []string{"run"}
	if m.cfg.ConfigFile != "" {
		args = append(args, "-c", m.cfg.ConfigFile)
	}

	cmd := exec.Command(m.cfg.BinPath, args...)
	cmd.Stdout = xrayWriter{}
	cmd.Stderr = xrayWriter{}

	if err := cmd.Start(); err != nil {
		m.lastErr = err.Error()
		return fmt.Errorf("xray start: %w", err)
	}

	doneCh := make(chan struct{})
	m.cmd = cmd
	m.doneCh = doneCh
	m.startTime = time.Now()
	m.lastErr = ""

	go func() {
		err := cmd.Wait()
		close(doneCh)
		m.mu.Lock()
		if err != nil {
			m.lastErr = err.Error()
		}
		m.mu.Unlock()
		log.Printf("xray: process exited: %v", err)
	}()

	log.Printf("xray: started (pid %d)", cmd.Process.Pid)
	return nil
}

// Stop sends SIGTERM and waits up to 5 s before forcing SIGKILL.
func (m *XrayManager) Stop() error {
	m.mu.Lock()
	if !m.isRunning() {
		m.mu.Unlock()
		return nil
	}
	doneCh := m.doneCh
	cmd := m.cmd
	m.mu.Unlock()

	_ = cmd.Process.Signal(syscall.SIGTERM)

	select {
	case <-doneCh:
	case <-time.After(5 * time.Second):
		_ = cmd.Process.Kill()
		select {
		case <-doneCh:
		case <-time.After(2 * time.Second):
		}
	}
	log.Printf("xray: stopped")
	return nil
}

// Restart stops then starts the xray subprocess.
func (m *XrayManager) Restart() error {
	if err := m.Stop(); err != nil {
		return err
	}
	return m.Start()
}

// XrayStatusDTO is returned by /api/xray/status.
type XrayStatusDTO struct {
	Enabled bool   `json:"enabled"`
	Running bool   `json:"running"`
	PID     int    `json:"pid,omitempty"`
	Uptime  string `json:"uptime,omitempty"`
	Error   string `json:"error,omitempty"`
}

// Status returns a snapshot of the current xray process state.
func (m *XrayManager) Status() XrayStatusDTO {
	m.mu.Lock()
	defer m.mu.Unlock()

	s := XrayStatusDTO{}
	if m.cfg != nil {
		s.Enabled = m.cfg.Enabled
	}
	if m.isRunning() && m.cmd != nil && m.cmd.Process != nil {
		s.Running = true
		s.PID = m.cmd.Process.Pid
		s.Uptime = time.Since(m.startTime).Round(time.Second).String()
	}
	if m.lastErr != "" {
		s.Error = m.lastErr
	}
	return s
}

// GetConfig reads the current xray JSON config file.
func (m *XrayManager) GetConfig() ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cfg == nil || m.cfg.ConfigFile == "" {
		return nil, fmt.Errorf("xray config file not configured")
	}
	return os.ReadFile(m.cfg.ConfigFile)
}

// SetConfig validates and atomically writes a new xray JSON config file.
func (m *XrayManager) SetConfig(data []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cfg == nil || m.cfg.ConfigFile == "" {
		return fmt.Errorf("xray config file not configured")
	}
	if !json.Valid(data) {
		return fmt.Errorf("invalid JSON")
	}
	return os.WriteFile(m.cfg.ConfigFile, data, 0o600)
}

// ---- Admin HTTP handlers ----

func handleXrayStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(xrayMgr.Status())
}

func handleXrayStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if err := xrayMgr.Start(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func handleXrayStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if err := xrayMgr.Stop(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func handleXrayRestart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if err := xrayMgr.Restart(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func handleXrayConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		data, err := xrayMgr.GetConfig()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(data)

	case http.MethodPost:
		body, err := io.ReadAll(io.LimitReader(r.Body, 512*1024))
		if err != nil {
			http.Error(w, "failed to read body", http.StatusBadRequest)
			return
		}
		if err := xrayMgr.SetConfig(body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func handleXrayLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	lines := xrayLogBuf.snapshot()
	if lines == nil {
		lines = []string{}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"lines": lines})
}

// ---- Inbound / client management ----

// XrayClientInfo is a single client entry inside an Xray inbound.
type XrayClientInfo struct {
	UUID  string `json:"id"`
	Email string `json:"email"`
	Level int    `json:"level,omitempty"`
	// Metadata from PostgreSQL (enriched by handleXrayInbounds)
	Name           string     `json:"name,omitempty"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	ExpirationDays int        `json:"expiration_days"`
	MaxConns       int        `json:"max_conns"`
	Expired        bool       `json:"expired,omitempty"`
}

// XrayInboundInfo is returned by /api/xray/inbounds.
type XrayInboundInfo struct {
	Tag      string           `json:"tag"`
	Protocol string           `json:"protocol"`
	Port     json.RawMessage  `json:"port,omitempty"`
	Listen   string           `json:"listen,omitempty"`
	Clients  []XrayClientInfo `json:"clients"`
}

// protocols that carry a "clients" array in their settings
var xrayClientProtos = map[string]bool{
	"vless": true, "vmess": true, "trojan": true,
}

// ListInbounds parses the config and returns only inbounds that support client lists.
func (m *XrayManager) ListInbounds() ([]XrayInboundInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cfg == nil || m.cfg.ConfigFile == "" {
		return nil, fmt.Errorf("xray config file not configured")
	}
	data, err := os.ReadFile(m.cfg.ConfigFile)
	if err != nil {
		return nil, err
	}
	var cfg struct {
		Inbounds []json.RawMessage `json:"inbounds"`
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse xray config: %w", err)
	}
	var result []XrayInboundInfo
	for _, raw := range cfg.Inbounds {
		var ib struct {
			Tag      string          `json:"tag"`
			Protocol string          `json:"protocol"`
			Port     json.RawMessage `json:"port"`
			Listen   string          `json:"listen"`
			Settings struct {
				Clients []XrayClientInfo `json:"clients"`
			} `json:"settings"`
		}
		if err := json.Unmarshal(raw, &ib); err != nil {
			continue
		}
		if !xrayClientProtos[strings.ToLower(ib.Protocol)] {
			continue
		}
		clients := ib.Settings.Clients
		if clients == nil {
			clients = []XrayClientInfo{}
		}
		result = append(result, XrayInboundInfo{
			Tag:      ib.Tag,
			Protocol: strings.ToLower(ib.Protocol),
			Port:     ib.Port,
			Listen:   ib.Listen,
			Clients:  clients,
		})
	}
	if result == nil {
		result = []XrayInboundInfo{}
	}
	return result, nil
}

// modifyRawConfig reads the config as a generic map, calls fn to mutate it, then writes it back.
// Caller must hold m.mu.
func (m *XrayManager) modifyRawConfig(fn func(cfg map[string]interface{}) error) error {
	if m.cfg == nil || m.cfg.ConfigFile == "" {
		return fmt.Errorf("xray config file not configured")
	}
	data, err := os.ReadFile(m.cfg.ConfigFile)
	if err != nil {
		return err
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("parse xray config: %w", err)
	}
	if err := fn(raw); err != nil {
		return err
	}
	out, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(m.cfg.ConfigFile, out, 0o600)
}

// AddXrayClient adds a client to the named inbound and saves the config.
func (m *XrayManager) AddXrayClient(inboundTag, uuid, email string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.modifyRawConfig(func(raw map[string]interface{}) error {
		inbounds, _ := raw["inbounds"].([]interface{})
		for _, ib := range inbounds {
			ibMap, ok := ib.(map[string]interface{})
			if !ok {
				continue
			}
			if tag, _ := ibMap["tag"].(string); tag != inboundTag {
				continue
			}
			settings, _ := ibMap["settings"].(map[string]interface{})
			if settings == nil {
				settings = make(map[string]interface{})
				ibMap["settings"] = settings
			}
			clients, _ := settings["clients"].([]interface{})
			for _, c := range clients {
				if cm, ok := c.(map[string]interface{}); ok {
					if id, _ := cm["id"].(string); id == uuid {
						return fmt.Errorf("UUID %s already exists in inbound %s", uuid, inboundTag)
					}
				}
			}
			proto, _ := ibMap["protocol"].(string)
			client := map[string]interface{}{
				"id": uuid, "email": email, "level": 0,
			}
			if strings.EqualFold(proto, "vmess") {
				client["alterId"] = 0
			}
			settings["clients"] = append(clients, client)
			return nil
		}
		return fmt.Errorf("inbound %q not found", inboundTag)
	})
}

// RemoveXrayClient removes a client by UUID from the named inbound and saves the config.
func (m *XrayManager) RemoveXrayClient(inboundTag, uuid string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.modifyRawConfig(func(raw map[string]interface{}) error {
		inbounds, _ := raw["inbounds"].([]interface{})
		for _, ib := range inbounds {
			ibMap, ok := ib.(map[string]interface{})
			if !ok {
				continue
			}
			if tag, _ := ibMap["tag"].(string); tag != inboundTag {
				continue
			}
			settings, _ := ibMap["settings"].(map[string]interface{})
			if settings == nil {
				return fmt.Errorf("inbound %s has no settings", inboundTag)
			}
			clients, _ := settings["clients"].([]interface{})
			var kept []interface{}
			removed := false
			for _, c := range clients {
				if cm, ok := c.(map[string]interface{}); ok {
					if id, _ := cm["id"].(string); id == uuid {
						removed = true
						continue
					}
				}
				kept = append(kept, c)
			}
			if !removed {
				return fmt.Errorf("UUID %s not found in inbound %s", uuid, inboundTag)
			}
			settings["clients"] = kept
			return nil
		}
		return fmt.Errorf("inbound %q not found", inboundTag)
	})
}

// ---- HTTP handlers for inbound/client management ----

func handleXrayInbounds(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	inbounds, err := xrayMgr.ListInbounds()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Enrich clients with metadata from PostgreSQL when available.
	if statsStore != nil {
		metas, err := statsStore.ListAllXrayClients(r.Context())
		if err == nil {
			metaMap := make(map[string]*XrayClientMeta, len(metas))
			for _, m := range metas {
				metaMap[m.UUID] = m
			}
			now := time.Now()
			for i := range inbounds {
				for j := range inbounds[i].Clients {
					c := &inbounds[i].Clients[j]
					m, ok := metaMap[c.UUID]
					if !ok {
						c.ExpirationDays = -1
						continue
					}
					c.Name = m.Name
					c.ExpiresAt = m.ExpiresAt
					c.MaxConns = m.MaxConns
					if m.ExpiresAt == nil {
						c.ExpirationDays = -1
					} else if m.ExpiresAt.Before(now) {
						c.Expired = true
						c.ExpirationDays = 0
					} else {
						c.ExpirationDays = int(m.ExpiresAt.Sub(now).Hours() / 24)
					}
				}
			}
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(inbounds)
}

func handleXrayClientAdd(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		InboundTag     string `json:"inbound_tag"`
		UUID           string `json:"uuid"`
		Email          string `json:"email"`
		Name           string `json:"name"`
		ExpiresAt      string `json:"expires_at"` // RFC3339 or YYYY-MM-DD or empty
		MaxConnections int    `json:"max_connections"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if req.InboundTag == "" || req.UUID == "" {
		http.Error(w, "inbound_tag and uuid required", http.StatusBadRequest)
		return
	}
	if err := xrayMgr.AddXrayClient(req.InboundTag, req.UUID, req.Email); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if statsStore != nil {
		meta := XrayClientMeta{
			UUID:       req.UUID,
			Name:       req.Name,
			Email:      req.Email,
			InboundTag: req.InboundTag,
			MaxConns:   req.MaxConnections,
		}
		if req.ExpiresAt != "" {
			var t time.Time
			var err error
			for _, layout := range []string{time.RFC3339, "2006-01-02T15:04", "2006-01-02"} {
				t, err = time.Parse(layout, req.ExpiresAt)
				if err == nil {
					break
				}
			}
			if err == nil {
				meta.ExpiresAt = &t
			}
		}
		if err := statsStore.UpsertXrayClientMeta(r.Context(), meta); err != nil {
			log.Printf("xray: save meta for %s: %v", req.UUID, err)
		}
	}
	_ = xrayMgr.Restart()
	w.WriteHeader(http.StatusCreated)
}

// handleXrayClientUpdate updates the metadata (name, email, expiry, max_conns)
// of an existing Xray client in PostgreSQL without touching the config file.
func handleXrayClientUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		UUID           string `json:"uuid"`
		Name           string `json:"name"`
		Email          string `json:"email"`
		ExpiresAt      string `json:"expires_at"`
		MaxConnections int    `json:"max_connections"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if req.UUID == "" {
		http.Error(w, "uuid required", http.StatusBadRequest)
		return
	}
	if statsStore == nil {
		http.Error(w, "storage not available", http.StatusInternalServerError)
		return
	}
	meta := XrayClientMeta{
		UUID:     req.UUID,
		Name:     req.Name,
		Email:    req.Email,
		MaxConns: req.MaxConnections,
	}
	if req.ExpiresAt != "" {
		for _, layout := range []string{time.RFC3339, "2006-01-02T15:04", "2006-01-02"} {
			if t, err := time.Parse(layout, req.ExpiresAt); err == nil {
				meta.ExpiresAt = &t
				break
			}
		}
	}
	if err := statsStore.UpsertXrayClientMeta(r.Context(), meta); err != nil {
		http.Error(w, "update failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func handleXrayClientRemove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	inboundTag := r.URL.Query().Get("inbound_tag")
	uuid := r.URL.Query().Get("uuid")
	if inboundTag == "" || uuid == "" {
		http.Error(w, "inbound_tag and uuid required", http.StatusBadRequest)
		return
	}
	if err := xrayMgr.RemoveXrayClient(inboundTag, uuid); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if statsStore != nil {
		_ = statsStore.DeleteXrayClientMeta(r.Context(), uuid)
	}
	_ = xrayMgr.Restart()
	w.WriteHeader(http.StatusNoContent)
}
