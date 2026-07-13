package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type accountRenewPayload struct {
	Username string `json:"username,omitempty"`
	UUID     string `json:"uuid,omitempty"`
	Days     int    `json:"days,omitempty"`
	ServerID string `json:"server_id,omitempty"`
}

func renewalDays(owner string, requested int) int {
	if u, ok := adminUsers.get(owner); ok && normalizeQuotaMode(u.QuotaMode) == QuotaModeCredit {
		return 31
	}
	if requested == 0 {
		return 30
	}
	return requested
}

func renewalExpiry(existing *time.Time, days int) time.Time {
	base := time.Now()
	if existing != nil && existing.After(base) {
		base = *existing
	}
	return base.AddDate(0, 0, days)
}

func jsonInt(value interface{}) int {
	switch value := value.(type) {
	case int:
		return value
	case int64:
		return int(value)
	case float64:
		return int(value)
	case json.Number:
		result, _ := strconv.Atoi(value.String())
		return result
	default:
		result, _ := strconv.ParseFloat(fmt.Sprint(value), 64)
		return int(result)
	}
}

func handleRenewSSHUser(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var p accountRenewPayload
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&p); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		p.Username = strings.TrimSpace(p.Username)
		if err := validateAccountUsername(p.Username); err != nil {
			http.Error(w, "invalid username", http.StatusBadRequest)
			return
		}
		if p.Days < 0 || p.Days > 3650 {
			http.Error(w, "days must be between 1 and 3650", http.StatusBadRequest)
			return
		}
		ctx := r.Context()
		sess := sessionFromCtx(ctx)
		if sess != nil && sess.Role == RoleReseller {
			quotaUnlock := lockResellerQuota(sess.Username)
			defer quotaUnlock()
		}
		if ms, remote, err := managedServerFromID(ctx, store, p.ServerID); err != nil {
			writeManagedServerSelectionError(w, err)
			return
		} else if remote {
			row, exists, infoErr := remoteSSHUserInfo(ctx, ms, p.Username)
			if infoErr != nil {
				http.Error(w, "could not verify remote account", http.StatusBadGateway)
				return
			}
			if !exists {
				http.Error(w, "SSH account not found", http.StatusNotFound)
				return
			}
			owner := strings.TrimSpace(fmt.Sprint(row["owner_username"]))
			charged, cost := false, 0
			if sess != nil && sess.Role == RoleReseller {
				if owner != sess.Username {
					http.Error(w, "forbidden", http.StatusForbidden)
					return
				}
				cost = resellerProvisionCost(jsonInt(row["max_connections"]))
				charged, infoErr = reserveResellerProvisionCredits(ctx, store, owner, cost, "renew-ssh:"+p.Username)
				if infoErr != nil {
					writeResellerProvisionError(w, infoErr)
					return
				}
				p.Days = renewalDays(owner, p.Days)
			}
			if sess != nil && sess.Role == RoleReseller {
				if syncErr := syncOwnerChainToManagedServer(ctx, ms, owner); syncErr != nil {
					if charged {
						refundResellerProvisionCredits(ctx, store, owner, cost, "renew-ssh:"+p.Username)
					}
					http.Error(w, "could not synchronize reseller state with the remote server", http.StatusBadGateway)
					return
				}
			}
			p.ServerID = ""
			body, _ := json.Marshal(p)
			status, data, contentType, proxyErr := proxyManagedServer(ctx, ms, http.MethodPost, "/api/users/renew", body, "application/json")
			if proxyErr != nil || status < 200 || status >= 300 {
				if charged {
					refundResellerProvisionCredits(ctx, store, owner, cost, "renew-ssh:"+p.Username)
				}
				if proxyErr != nil {
					writeBadGatewayError(w, "renew SSH account on managed server", proxyErr)
					return
				}
			}
			writeProxyResponse(w, status, data, contentType)
			return
		}

		state, ok := userMgr.Get(p.Username)
		if !ok {
			http.Error(w, "SSH account not found", http.StatusNotFound)
			return
		}
		state.mu.Lock()
		cfg := state.Cfg
		existingExpiry := state.ExpiresAt
		state.mu.Unlock()
		charged, cost := false, 0
		if sess != nil && sess.Role == RoleReseller {
			if cfg.OwnerUsername != sess.Username {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			cost = resellerProvisionCost(cfg.MaxConnections)
			var creditErr error
			charged, creditErr = reserveResellerProvisionCredits(ctx, store, sess.Username, cost, "renew-ssh:"+p.Username)
			if creditErr != nil {
				writeResellerProvisionError(w, creditErr)
				return
			}
			p.Days = renewalDays(sess.Username, p.Days)
		}
		if p.Days == 0 {
			p.Days = 30
		}
		next := renewalExpiry(existingExpiry, p.Days)
		cfg.ExpiresAt = next.UTC().Format(time.RFC3339)
		if err := store.UpsertUser(ctx, cfg); err != nil {
			if charged {
				refundResellerProvisionCredits(ctx, store, cfg.OwnerUsername, cost, "renew-ssh:"+p.Username)
			}
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		userMgr.DisconnectUser(p.Username)
		reloadUsersFromDB(ctx, store)
		if sess != nil {
			_ = store.appendResellerAudit(ctx, sess.Username, cfg.OwnerUsername, "renewed SSH account",
				fmt.Sprintf("account=%s days=%d", p.Username, p.Days))
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "expires_at": next})
	}
}

func handleRenewXrayClient(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var p accountRenewPayload
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&p); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		p.UUID = strings.TrimSpace(p.UUID)
		if _, err := parseUUID(p.UUID); err != nil {
			http.Error(w, "invalid UUID", http.StatusBadRequest)
			return
		}
		if p.Days < 0 || p.Days > 3650 {
			http.Error(w, "days must be between 1 and 3650", http.StatusBadRequest)
			return
		}
		ctx := r.Context()
		sess := sessionFromCtx(ctx)
		if sess != nil && sess.Role == RoleReseller {
			quotaUnlock := lockResellerQuota(sess.Username)
			defer quotaUnlock()
		}
		if ms, remote, err := managedServerFromID(ctx, store, p.ServerID); err != nil {
			writeManagedServerSelectionError(w, err)
			return
		} else if remote {
			row, exists, infoErr := remoteXrayClientInfo(ctx, ms, p.UUID)
			if infoErr != nil {
				http.Error(w, "could not verify remote account", http.StatusBadGateway)
				return
			}
			if !exists {
				http.Error(w, "Xray account not found", http.StatusNotFound)
				return
			}
			owner := strings.TrimSpace(fmt.Sprint(row["owner_username"]))
			charged, cost := false, 0
			if sess != nil && sess.Role == RoleReseller {
				if owner != sess.Username {
					http.Error(w, "forbidden", http.StatusForbidden)
					return
				}
				cost = resellerProvisionCost(jsonInt(row["max_conns"]))
				charged, infoErr = reserveResellerProvisionCredits(ctx, store, owner, cost, "renew-xray:"+p.UUID)
				if infoErr != nil {
					writeResellerProvisionError(w, infoErr)
					return
				}
				p.Days = renewalDays(owner, p.Days)
			}
			if sess != nil && sess.Role == RoleReseller {
				if syncErr := syncOwnerChainToManagedServer(ctx, ms, owner); syncErr != nil {
					if charged {
						refundResellerProvisionCredits(ctx, store, owner, cost, "renew-xray:"+p.UUID)
					}
					http.Error(w, "could not synchronize reseller state with the remote server", http.StatusBadGateway)
					return
				}
			}
			p.ServerID = ""
			body, _ := json.Marshal(p)
			status, data, contentType, proxyErr := proxyManagedServer(ctx, ms, http.MethodPost, "/api/xray/clients/renew", body, "application/json")
			if proxyErr != nil || status < 200 || status >= 300 {
				if charged {
					refundResellerProvisionCredits(ctx, store, owner, cost, "renew-xray:"+p.UUID)
				}
				if proxyErr != nil {
					writeBadGatewayError(w, "renew Xray account on managed server", proxyErr)
					return
				}
			}
			writeProxyResponse(w, status, data, contentType)
			return
		}

		meta, err := store.GetXrayClientMeta(ctx, p.UUID)
		if err != nil {
			http.Error(w, "Xray account not found", http.StatusNotFound)
			return
		}
		charged, cost := false, 0
		if sess != nil && sess.Role == RoleReseller {
			if meta.OwnerUsername != sess.Username {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			cost = resellerProvisionCost(meta.MaxConns)
			var creditErr error
			charged, creditErr = reserveResellerProvisionCredits(ctx, store, sess.Username, cost, "renew-xray:"+p.UUID)
			if creditErr != nil {
				writeResellerProvisionError(w, creditErr)
				return
			}
			p.Days = renewalDays(sess.Username, p.Days)
		}
		if p.Days == 0 {
			p.Days = 30
		}
		next := renewalExpiry(meta.ExpiresAt, p.Days)
		meta.ExpiresAt = &next
		if err := store.UpsertXrayClientMeta(ctx, *meta); err != nil {
			if charged {
				refundResellerProvisionCredits(ctx, store, meta.OwnerUsername, cost, "renew-xray:"+p.UUID)
			}
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		runtimeWarning := ""
		if meta.OwnerUsername != "" {
			if runtimeErr := restoreOwnerXrayClients(ctx, store, meta.OwnerUsername); runtimeErr != nil {
				log.Printf("restore renewed Xray account %s: %v", p.UUID, runtimeErr)
				runtimeWarning = "The account was renewed, but Xray could not restore it yet. Check the Xray service."
			}
		} else if err := ensureXrayClientPresent(*meta); err != nil {
			log.Printf("restore renewed Xray account %s: %v", p.UUID, err)
			runtimeWarning = "The account was renewed, but Xray could not restore it yet. Check the Xray service."
		}
		if sess != nil {
			_ = store.appendResellerAudit(ctx, sess.Username, meta.OwnerUsername, "renewed Xray account",
				fmt.Sprintf("uuid=%s days=%d", p.UUID, p.Days))
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "expires_at": next, "runtime_warning": runtimeWarning})
	}
}

func ensureXrayClientPresent(meta XrayClientMeta) error {
	inbounds, err := xrayMgr.ListInbounds()
	if err != nil {
		return err
	}
	for _, inbound := range inbounds {
		if inbound.Tag != meta.InboundTag {
			continue
		}
		for _, client := range inbound.Clients {
			if client.UUID == meta.UUID {
				return nil
			}
		}
		email := strings.TrimSpace(meta.Email)
		if email == "" {
			email = meta.UUID
		}
		if err := xrayMgr.AddXrayClient(meta.InboundTag, meta.UUID, email); err != nil {
			return err
		}
		xrayMgr.restartIfExternalRunning()
		return nil
	}
	return fmt.Errorf("inbound %s no longer exists", meta.InboundTag)
}
