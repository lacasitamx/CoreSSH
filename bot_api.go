package main

// bot_api.go — /api/bot/* admin endpoints (superadmin).

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

func botWriteJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func botStoreReady(w http.ResponseWriter, store *Store) bool {
	if store == nil {
		http.Error(w, "database not configured", http.StatusServiceUnavailable)
		return false
	}
	return true
}

// ---------- Config ----------

type botConfigDTO struct {
	Enabled              bool    `json:"enabled"`
	MPConfirmMode        string  `json:"mp_confirm_mode"`
	MPPollInterval       string  `json:"mp_poll_interval"`
	PixExpirationMinutes int     `json:"pix_expiration_minutes"`
	TrialEnabled         bool    `json:"trial_enabled"`
	TrialHours           int     `json:"trial_hours"`
	TrialMaxConnections  int     `json:"trial_max_connections"`
	TrialKind            string  `json:"trial_kind"`
	TrialInboundTag      string  `json:"trial_inbound_tag"`
	AdminTelegramIDs     []int64 `json:"admin_telegram_ids"`
	Currency             string  `json:"currency"`
	PublicHost           string  `json:"public_host"`
	XrayPublicHost       string  `json:"xray_public_host"`
	HasTelegramToken     bool    `json:"has_telegram_token"`
	HasMPAccessToken     bool    `json:"has_mp_access_token"`
	HasMPWebhookSecret   bool    `json:"has_mp_webhook_secret"`
	// Write-only secret fields (empty on GET; empty on POST = keep existing).
	TelegramToken   string `json:"telegram_token"`
	MPAccessToken   string `json:"mp_access_token"`
	MPWebhookSecret string `json:"mp_webhook_secret"`
}

func handleBotConfig(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !botStoreReady(w, store) {
			return
		}
		ctx := r.Context()
		switch r.Method {
		case http.MethodGet:
			cfg, err := LoadBotConfig(ctx, store)
			if err != nil {
				http.Error(w, "load config: "+err.Error(), http.StatusInternalServerError)
				return
			}
			botWriteJSON(w, botConfigDTO{
				Enabled:              cfg.Enabled,
				MPConfirmMode:        cfg.MPConfirmMode,
				MPPollInterval:       cfg.MPPollInterval,
				PixExpirationMinutes: cfg.PixExpirationMinutes,
				TrialEnabled:         cfg.TrialEnabled,
				TrialHours:           cfg.TrialHours,
				TrialMaxConnections:  cfg.TrialMaxConnections,
				TrialKind:            cfg.TrialKind,
				TrialInboundTag:      cfg.TrialInboundTag,
				AdminTelegramIDs:     cfg.AdminTelegramIDs,
				Currency:             cfg.Currency,
				PublicHost:           cfg.PublicHost,
				XrayPublicHost:       cfg.XrayPublicHost,
				HasTelegramToken:     cfg.TelegramToken != "",
				HasMPAccessToken:     cfg.MPAccessToken != "",
				HasMPWebhookSecret:   cfg.MPWebhookSecret != "",
			})
		case http.MethodPost:
			var dto botConfigDTO
			if err := json.NewDecoder(r.Body).Decode(&dto); err != nil {
				http.Error(w, "invalid json", http.StatusBadRequest)
				return
			}
			cfg := &BotConfig{
				Enabled:              dto.Enabled,
				TelegramToken:        strings.TrimSpace(dto.TelegramToken),
				MPAccessToken:        strings.TrimSpace(dto.MPAccessToken),
				MPConfirmMode:        dto.MPConfirmMode,
				MPWebhookSecret:      strings.TrimSpace(dto.MPWebhookSecret),
				MPPollInterval:       dto.MPPollInterval,
				PixExpirationMinutes: dto.PixExpirationMinutes,
				TrialEnabled:         dto.TrialEnabled,
				TrialHours:           dto.TrialHours,
				TrialMaxConnections:  dto.TrialMaxConnections,
				TrialKind:            dto.TrialKind,
				TrialInboundTag:      strings.TrimSpace(dto.TrialInboundTag),
				AdminTelegramIDs:     dto.AdminTelegramIDs,
				Currency:             dto.Currency,
				PublicHost:           strings.TrimSpace(dto.PublicHost),
				XrayPublicHost:       strings.TrimSpace(dto.XrayPublicHost),
			}
			if err := SaveBotConfig(ctx, store, cfg); err != nil {
				http.Error(w, "save config: "+err.Error(), http.StatusInternalServerError)
				return
			}
			reloadBotService(store)
			botWriteJSON(w, map[string]bool{"ok": true})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

// ---------- Plans ----------

func handleBotPlans(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !botStoreReady(w, store) {
			return
		}
		ctx := r.Context()
		switch r.Method {
		case http.MethodGet:
			plans, err := store.ListPlans(ctx, false)
			if err != nil {
				http.Error(w, "db error", http.StatusInternalServerError)
				return
			}
			botWriteJSON(w, plans)
		case http.MethodPost:
			var p BotPlan
			if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
				http.Error(w, "invalid json", http.StatusBadRequest)
				return
			}
			if p.Kind == "" {
				p.Kind = "ssh"
			}
			if err := store.UpsertPlan(ctx, &p); err != nil {
				http.Error(w, "db error: "+err.Error(), http.StatusInternalServerError)
				return
			}
			botWriteJSON(w, p)
		case http.MethodDelete:
			id, _ := strconv.Atoi(r.URL.Query().Get("id"))
			if id <= 0 {
				http.Error(w, "invalid id", http.StatusBadRequest)
				return
			}
			if err := store.DeletePlan(ctx, id); err != nil {
				http.Error(w, "db error", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

// ---------- Credit packages ----------

func handleBotCreditPackages(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !botStoreReady(w, store) {
			return
		}
		ctx := r.Context()
		switch r.Method {
		case http.MethodGet:
			pkgs, err := store.ListCreditPackages(ctx, false)
			if err != nil {
				http.Error(w, "db error", http.StatusInternalServerError)
				return
			}
			botWriteJSON(w, pkgs)
		case http.MethodPost:
			var p BotCreditPackage
			if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
				http.Error(w, "invalid json", http.StatusBadRequest)
				return
			}
			if err := store.UpsertCreditPackage(ctx, &p); err != nil {
				http.Error(w, "db error", http.StatusInternalServerError)
				return
			}
			botWriteJSON(w, p)
		case http.MethodDelete:
			id, _ := strconv.Atoi(r.URL.Query().Get("id"))
			if id <= 0 {
				http.Error(w, "invalid id", http.StatusBadRequest)
				return
			}
			if err := store.DeleteCreditPackage(ctx, id); err != nil {
				http.Error(w, "db error", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

// ---------- Bot users ----------

func handleBotUsers(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !botStoreReady(w, store) {
			return
		}
		ctx := r.Context()
		switch r.Method {
		case http.MethodGet:
			users, err := store.ListBotUsers(ctx)
			if err != nil {
				http.Error(w, "db error", http.StatusInternalServerError)
				return
			}
			botWriteJSON(w, users)
		case http.MethodPost:
			var req struct {
				TelegramID          int64  `json:"telegram_id"`
				Action              string `json:"action"`
				Role                string `json:"role"`
				LinkedAdminUsername string `json:"linked_admin_username"`
				Credits             int    `json:"credits"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TelegramID == 0 {
				http.Error(w, "invalid json", http.StatusBadRequest)
				return
			}
			switch req.Action {
			case "set_role":
				if req.Role == "" {
					req.Role = "customer"
				}
				if err := store.SetBotUserRole(ctx, req.TelegramID, req.Role, req.LinkedAdminUsername); err != nil {
					http.Error(w, "db error", http.StatusInternalServerError)
					return
				}
			case "block":
				if err := store.SetBotUserRole(ctx, req.TelegramID, "blocked", ""); err != nil {
					http.Error(w, "db error", http.StatusInternalServerError)
					return
				}
			case "unblock":
				if err := store.SetBotUserRole(ctx, req.TelegramID, "customer", ""); err != nil {
					http.Error(w, "db error", http.StatusInternalServerError)
					return
				}
			case "adjust_credits":
				if _, err := store.AdjustCredits(ctx, req.TelegramID, req.Credits, "admin_adjust", nil); err != nil {
					http.Error(w, "adjust: "+err.Error(), http.StatusBadRequest)
					return
				}
			default:
				http.Error(w, "unknown action", http.StatusBadRequest)
				return
			}
			botWriteJSON(w, map[string]bool{"ok": true})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

// ---------- Transactions ----------

func handleBotTransactions(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !botStoreReady(w, store) {
			return
		}
		ctx := r.Context()
		switch r.Method {
		case http.MethodGet:
			status := r.URL.Query().Get("status")
			limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
			txns, err := store.ListTransactions(ctx, status, limit)
			if err != nil {
				http.Error(w, "db error", http.StatusInternalServerError)
				return
			}
			botWriteJSON(w, txns)
		case http.MethodPost:
			var req struct {
				ID     int    `json:"id"`
				Action string `json:"action"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == 0 {
				http.Error(w, "invalid json", http.StatusBadRequest)
				return
			}
			switch req.Action {
			case "refund":
				if err := store.SetTransactionStatus(ctx, req.ID, "refunded"); err != nil {
					http.Error(w, "db error", http.StatusInternalServerError)
					return
				}
			case "reprocess":
				if b := currentBot(); b != nil {
					go b.tryFulfill(req.ID)
				} else {
					http.Error(w, "bot not running", http.StatusServiceUnavailable)
					return
				}
			default:
				http.Error(w, "unknown action", http.StatusBadRequest)
				return
			}
			botWriteJSON(w, map[string]bool{"ok": true})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

// ---------- Settings (bot texts) ----------

func handleBotSettings(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !botStoreReady(w, store) {
			return
		}
		ctx := r.Context()
		switch r.Method {
		case http.MethodGet:
			all, err := store.AllSettings(ctx)
			if err != nil {
				http.Error(w, "db error", http.StatusInternalServerError)
				return
			}
			botWriteJSON(w, all)
		case http.MethodPost:
			var kv map[string]string
			if err := json.NewDecoder(r.Body).Decode(&kv); err != nil {
				http.Error(w, "invalid json", http.StatusBadRequest)
				return
			}
			for k, v := range kv {
				if err := store.SetSetting(ctx, k, v); err != nil {
					http.Error(w, "db error", http.StatusInternalServerError)
					return
				}
			}
			botWriteJSON(w, map[string]bool{"ok": true})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

// ---------- Connectivity test ----------

func handleBotTest(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !botStoreReady(w, store) {
			return
		}
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		ctx := r.Context()
		var req struct {
			TelegramToken string `json:"telegram_token"`
			MPAccessToken string `json:"mp_access_token"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		cfg, _ := LoadBotConfig(ctx, store)
		tgToken := strings.TrimSpace(req.TelegramToken)
		mpToken := strings.TrimSpace(req.MPAccessToken)
		if cfg != nil {
			if tgToken == "" {
				tgToken = cfg.TelegramToken
			}
			if mpToken == "" {
				mpToken = cfg.MPAccessToken
			}
		}
		out := map[string]interface{}{}
		if tgToken != "" {
			name, err := newTGClient(tgToken).getMe(ctx)
			if err != nil {
				out["telegram_ok"] = false
				out["telegram_error"] = err.Error()
			} else {
				out["telegram_ok"] = true
				out["telegram_bot"] = "@" + name
			}
		} else {
			out["telegram_ok"] = false
			out["telegram_error"] = "no token configured"
		}
		if mpToken != "" {
			_, err := newMPClient(mpToken).do(ctx, http.MethodGet, "/v1/payment_methods", nil, "")
			if err != nil {
				out["mp_ok"] = false
				out["mp_error"] = err.Error()
			} else {
				out["mp_ok"] = true
			}
		} else {
			out["mp_ok"] = false
			out["mp_error"] = "no token configured"
		}
		botWriteJSON(w, out)
	}
}
