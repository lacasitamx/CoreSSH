package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	errResellerForbidden    = errors.New("reseller is outside your management scope")
	errResellerQuota        = errors.New("insufficient reseller quota")
	errResellerCredits      = errors.New("insufficient reseller credits")
	errResellerHasUsage     = errors.New("limit cannot be lower than current committed usage")
	errResellerInvalidState = errors.New("reseller cannot be activated while its parent is inactive or expired")
	errResellerParent       = errors.New("parent reseller not found")
	errResellerPlan         = errors.New("sub-reseller plan must match its parent")
	errResellerConnLimit    = errors.New("reseller accounts require at least one allowed connection")
	errCreditLimitImmutable = errors.New("the connection limit of a credit account cannot be changed")
)

var (
	resellerQuotaLocks  sync.Map
	resellerLifecycleMu sync.Mutex
)

func lockResellerQuota(username string) func() {
	value, _ := resellerQuotaLocks.LoadOrStore(strings.TrimSpace(username), &sync.Mutex{})
	mu := value.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

func lockResellerQuotaSet(usernames []string) func() {
	unique := make(map[string]struct{}, len(usernames))
	ordered := make([]string, 0, len(usernames))
	for _, username := range usernames {
		username = strings.TrimSpace(username)
		if username == "" {
			continue
		}
		if _, exists := unique[username]; exists {
			continue
		}
		unique[username] = struct{}{}
		ordered = append(ordered, username)
	}
	sort.Strings(ordered)
	unlocks := make([]func(), 0, len(ordered))
	for _, username := range ordered {
		unlocks = append(unlocks, lockResellerQuota(username))
	}
	return func() {
		for i := len(unlocks) - 1; i >= 0; i-- {
			unlocks[i]()
		}
	}
}

func resellerSubtreeUsernames(users []*AdminUser) []string {
	usernames := make([]string, 0, len(users))
	for _, user := range users {
		if user != nil {
			usernames = append(usernames, user.Username)
		}
	}
	return usernames
}

func normalizeQuotaMode(mode string) string {
	if strings.EqualFold(strings.TrimSpace(mode), QuotaModeCredit) || strings.EqualFold(strings.TrimSpace(mode), "credito") {
		return QuotaModeCredit
	}
	return QuotaModeSlots
}

func normalizeWhatsApp(value string) string {
	value = strings.TrimSpace(value)
	var b strings.Builder
	for i, r := range value {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		} else if r == '+' && i == 0 {
			b.WriteRune(r)
		}
		if b.Len() >= 32 {
			break
		}
	}
	return b.String()
}

func resellerProvisionCost(maxConnections int) int {
	if maxConnections < 1 {
		return 1
	}
	return maxConnections
}

func adminAccountChainActive(username string) error {
	username = strings.TrimSpace(username)
	if username == "" {
		return nil
	}
	seen := make(map[string]bool)
	now := time.Now()
	for depth := 0; username != "" && depth < 128; depth++ {
		if seen[username] {
			return fmt.Errorf("reseller hierarchy cycle detected")
		}
		seen[username] = true
		parentUsername := ""
		active := false
		var expiresAt *time.Time
		if u, ok := adminUsers.get(username); ok {
			active = u.IsActive
			expiresAt = u.ExpiresAt
			parentUsername = u.ParentUsername
		} else if state, ok := resellerRuntimeStates.get(username); ok {
			active = state.IsActive
			expiresAt = state.ExpiresAt
			parentUsername = state.ParentUsername
		} else {
			return fmt.Errorf("reseller account not found")
		}
		if !active {
			return fmt.Errorf("reseller account suspended")
		}
		if expiresAt != nil && now.After(*expiresAt) {
			return fmt.Errorf("reseller account expired")
		}
		username = strings.TrimSpace(parentUsername)
	}
	if username != "" {
		return fmt.Errorf("reseller hierarchy is too deep")
	}
	return nil
}

func resellerCanManage(sess *AdminSession, target *AdminUser) bool {
	if sess == nil || target == nil || target.Role != RoleReseller {
		return false
	}
	if sess.Role == RoleSuperAdmin {
		return true
	}
	return sess.Role == RoleReseller && target.ParentUsername == sess.Username
}

func listResellerSubtree(all []*AdminUser, root string) []*AdminUser {
	children := make(map[string][]*AdminUser)
	byUsername := make(map[string]*AdminUser)
	for _, u := range all {
		if u == nil || u.Role != RoleReseller {
			continue
		}
		byUsername[u.Username] = u
		children[u.ParentUsername] = append(children[u.ParentUsername], u)
	}
	rootUser := byUsername[root]
	if rootUser == nil {
		return nil
	}
	out := make([]*AdminUser, 0, 4)
	queue := []*AdminUser{rootUser}
	seen := make(map[string]bool)
	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		if u == nil || seen[u.Username] {
			continue
		}
		seen[u.Username] = true
		out = append(out, u)
		queue = append(queue, children[u.Username]...)
	}
	return out
}

func (s *Store) directChildAllocation(ctx context.Context, parentUsername, excludeUsername string) (int, error) {
	var total int
	err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(max_users), 0)
		FROM admin_users
		WHERE role=$1 AND parent_username=$2 AND quota_mode=$3 AND username<>$4`,
		RoleReseller, parentUsername, QuotaModeSlots, excludeUsername).Scan(&total)
	return total, err
}

func (s *Store) directChildCount(ctx context.Context, parentUsername string) int {
	var total int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM admin_users WHERE role=$1 AND parent_username=$2`,
		RoleReseller, parentUsername).Scan(&total); err != nil {
		log.Printf("count child resellers for %s: %v", parentUsername, err)
		return 0
	}
	return total
}

func (s *Store) appendResellerAudit(ctx context.Context, actor, target, action, details string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO reseller_audit_log (actor_username, target_username, action, details)
		VALUES ($1,$2,$3,$4)`, actor, target, action, details)
	return err
}

type ResellerDTO struct {
	ID                int        `json:"id"`
	Username          string     `json:"username"`
	Role              string     `json:"role"`
	ParentUsername    string     `json:"parent_username,omitempty"`
	QuotaMode         string     `json:"quota_mode"`
	MaxUsers          int        `json:"max_users"`
	CreditBalance     int        `json:"credit_balance"`
	UsedUsers         int        `json:"used_users"`
	UsedSSH           int        `json:"used_ssh_users"`
	UsedXray          int        `json:"used_xray_users"`
	ChildAllocation   int        `json:"child_allocation"`
	ChildCount        int        `json:"child_count"`
	Available         int        `json:"available"`
	UsageIncomplete   bool       `json:"usage_incomplete,omitempty"`
	WhatsApp          string     `json:"whatsapp,omitempty"`
	MonthlyPriceCents int        `json:"monthly_price_cents"`
	ExpiresAt         *time.Time `json:"expires_at,omitempty"`
	IsActive          bool       `json:"is_active"`
	EffectiveActive   bool       `json:"effective_active"`
	CreatedAt         time.Time  `json:"created_at"`
}

type ResellerPayload struct {
	Username          string `json:"username"`
	Password          string `json:"password,omitempty"`
	ParentUsername    string `json:"parent_username,omitempty"`
	QuotaMode         string `json:"quota_mode"`
	MaxUsers          int    `json:"max_users"`
	Credits           int    `json:"credits"`
	ExpiresAt         string `json:"expires_at"`
	IsActive          bool   `json:"is_active"`
	WhatsApp          string `json:"whatsapp"`
	MonthlyPriceCents int    `json:"monthly_price_cents"`
}

func handleListResellers(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		sess := sessionFromCtx(r.Context())
		users, err := store.ListAdminUsers(r.Context())
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		out := make([]ResellerDTO, 0, len(users))
		for _, u := range users {
			if u.Role != RoleReseller || !resellerCanManage(sess, u) {
				continue
			}
			usage, usageErr := ownedQuotaUsageAcrossManagedServers(r.Context(), store, u.Username)
			used := usage.Weighted
			usedSSH := usage.SSHAccounts
			usedXray := usage.XrayAccounts
			if usageErr != nil {
				used = countOwnedQuota(r.Context(), store, u.Username)
				usedSSH = countOwnedUsers(u.Username)
				usedXray = countOwnedXrayClients(r.Context(), store, u.Username)
			}
			childAllocation, _ := store.directChildAllocation(r.Context(), u.Username, "")
			available := u.CreditBalance
			if normalizeQuotaMode(u.QuotaMode) == QuotaModeSlots {
				if u.MaxUsers == 0 {
					available = -1
				} else {
					available = max(0, u.MaxUsers-used-childAllocation)
				}
			}
			out = append(out, ResellerDTO{
				ID:                u.ID,
				Username:          u.Username,
				Role:              u.Role,
				ParentUsername:    u.ParentUsername,
				QuotaMode:         normalizeQuotaMode(u.QuotaMode),
				MaxUsers:          u.MaxUsers,
				CreditBalance:     u.CreditBalance,
				UsedUsers:         used,
				UsedSSH:           usedSSH,
				UsedXray:          usedXray,
				ChildAllocation:   childAllocation,
				ChildCount:        store.directChildCount(r.Context(), u.Username),
				Available:         available,
				UsageIncomplete:   usageErr != nil,
				WhatsApp:          u.WhatsApp,
				MonthlyPriceCents: u.MonthlyPriceCents,
				ExpiresAt:         u.ExpiresAt,
				IsActive:          u.IsActive,
				EffectiveActive:   adminAccountChainActive(u.Username) == nil,
				CreatedAt:         u.CreatedAt,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}
}

func parseResellerExpiry(raw string) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, fmt.Errorf("invalid expires_at (RFC3339 required)")
	}
	return &t, nil
}

func (s *Store) saveResellerRecord(ctx context.Context, actor string, desired, existing *AdminUser, parentDirectUsed int) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if desired.ParentUsername != "" {
		var parentMode string
		var parentMax, parentCredits int
		var parentActive bool
		var parentExpiry sql.NullTime
		if err := tx.QueryRowContext(ctx, `
			SELECT COALESCE(quota_mode, 'slots'), max_users, COALESCE(credit_balance, 0), is_active, expires_at
			FROM admin_users WHERE username=$1 AND role=$2 FOR UPDATE`,
			desired.ParentUsername, RoleReseller).Scan(&parentMode, &parentMax, &parentCredits, &parentActive, &parentExpiry); err != nil {
			if err == sql.ErrNoRows {
				return errResellerParent
			}
			return err
		}
		if !parentActive || (parentExpiry.Valid && time.Now().After(parentExpiry.Time)) {
			return errResellerInvalidState
		}
		parentMode = normalizeQuotaMode(parentMode)
		if parentMode != desired.QuotaMode {
			return errResellerPlan
		}
		if parentMode == QuotaModeSlots {
			var allocated int
			if err := tx.QueryRowContext(ctx, `
				SELECT COALESCE(SUM(max_users), 0) FROM admin_users
				WHERE role=$1 AND parent_username=$2 AND quota_mode=$3 AND username<>$4`,
				RoleReseller, desired.ParentUsername, QuotaModeSlots, desired.Username).Scan(&allocated); err != nil {
				return err
			}
			if parentMax > 0 && parentDirectUsed+allocated+desired.MaxUsers > parentMax {
				return errResellerQuota
			}
		} else {
			oldCredits := 0
			if existing != nil {
				if err := tx.QueryRowContext(ctx, `
					SELECT COALESCE(credit_balance, 0) FROM admin_users
					WHERE id=$1 AND role=$2 FOR UPDATE`, existing.ID, RoleReseller).Scan(&oldCredits); err != nil {
					return err
				}
			}
			diff := desired.CreditBalance - oldCredits
			if diff > parentCredits {
				return errResellerCredits
			}
			if diff != 0 {
				parentCredits -= diff
				if _, err := tx.ExecContext(ctx,
					`UPDATE admin_users SET credit_balance=$1 WHERE username=$2`,
					parentCredits, desired.ParentUsername); err != nil {
					return err
				}
				if _, err := tx.ExecContext(ctx, `
					INSERT INTO reseller_credit_ledger
					(reseller_username, actor_username, delta, balance_after, action, target)
					VALUES ($1,$2,$3,$4,$5,$6)`,
					desired.ParentUsername, actor, -diff, parentCredits, "sub-reseller transfer", desired.Username); err != nil {
					return err
				}
			}
		}
	}

	var expiresAt interface{}
	if desired.ExpiresAt != nil {
		expiresAt = *desired.ExpiresAt
	}
	if existing == nil {
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO admin_users
			(username, password_hash, role, max_users, parent_username, quota_mode,
			 credit_balance, whatsapp, monthly_price_cents, expires_at, is_active)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
			RETURNING id, created_at`,
			desired.Username, desired.PasswordHash, RoleReseller, desired.MaxUsers,
			desired.ParentUsername, desired.QuotaMode, desired.CreditBalance, desired.WhatsApp,
			desired.MonthlyPriceCents, expiresAt, desired.IsActive).Scan(&desired.ID, &desired.CreatedAt); err != nil {
			return err
		}
	} else {
		if _, err := tx.ExecContext(ctx, `
			UPDATE admin_users SET password_hash=$2, max_users=$3, credit_balance=$4,
			 whatsapp=$5, monthly_price_cents=$6, expires_at=$7, is_active=$8
			WHERE id=$1 AND role=$9`,
			desired.ID, desired.PasswordHash, desired.MaxUsers, desired.CreditBalance,
			desired.WhatsApp, desired.MonthlyPriceCents, expiresAt, desired.IsActive,
			RoleReseller); err != nil {
			return err
		}
	}
	details := fmt.Sprintf("mode=%s limit=%d credits=%d parent=%s active=%t",
		desired.QuotaMode, desired.MaxUsers, desired.CreditBalance, desired.ParentUsername, desired.IsActive)
	action := "created reseller"
	if existing != nil {
		action = "updated reseller"
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO reseller_audit_log (actor_username, target_username, action, details)
		VALUES ($1,$2,$3,$4)`, actor, desired.Username, action, details); err != nil {
		return err
	}
	return tx.Commit()
}

func handleCreateReseller(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 32*1024)
		var p ResellerPayload
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&p); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		p.Username = strings.TrimSpace(p.Username)
		if err := validateAdminUsername(p.Username); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if p.MaxUsers < 0 || p.MaxUsers > 1000000 || p.Credits < 0 || p.Credits > 1000000000 {
			http.Error(w, "limit is outside the allowed range", http.StatusBadRequest)
			return
		}
		if p.MonthlyPriceCents < 0 || p.MonthlyPriceCents > 1000000000 {
			http.Error(w, "monthly price is outside the allowed range", http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		sess := sessionFromCtx(ctx)
		if sess == nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		resellerLifecycleMu.Lock()
		defer resellerLifecycleMu.Unlock()
		existing, err := store.GetAdminUserByUsername(ctx, p.Username)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if existing != nil && !resellerCanManage(sess, existing) {
			http.Error(w, errResellerForbidden.Error(), http.StatusForbidden)
			return
		}

		desired := &AdminUser{Username: p.Username, Role: RoleReseller, IsActive: p.IsActive}
		if existing != nil {
			*desired = *existing
			desired.IsActive = p.IsActive
		}
		if existing == nil && strings.TrimSpace(p.Password) == "" {
			http.Error(w, "password required for new account", http.StatusBadRequest)
			return
		}
		if strings.TrimSpace(p.Password) != "" {
			if err := validateAdminPassword(p.Password); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			hash, err := hashAdminPassword(p.Password)
			if err != nil {
				http.Error(w, "failed to hash password", http.StatusInternalServerError)
				return
			}
			desired.PasswordHash = hash
		}

		if existing == nil {
			desired.ParentUsername = strings.TrimSpace(p.ParentUsername)
			desired.QuotaMode = normalizeQuotaMode(p.QuotaMode)
			if sess.Role == RoleReseller {
				parent, ok := adminUsers.get(sess.Username)
				if !ok {
					http.Error(w, "parent reseller not found", http.StatusForbidden)
					return
				}
				desired.ParentUsername = sess.Username
				desired.QuotaMode = normalizeQuotaMode(parent.QuotaMode)
			}
		} else {
			if strings.TrimSpace(p.ParentUsername) != "" && strings.TrimSpace(p.ParentUsername) != existing.ParentUsername {
				http.Error(w, "a reseller parent cannot be changed from the edit form", http.StatusBadRequest)
				return
			}
			if strings.TrimSpace(p.QuotaMode) != "" && normalizeQuotaMode(p.QuotaMode) != normalizeQuotaMode(existing.QuotaMode) {
				http.Error(w, "plan mode cannot be changed after creation", http.StatusBadRequest)
				return
			}
			desired.QuotaMode = normalizeQuotaMode(existing.QuotaMode)
		}

		if desired.ParentUsername != "" {
			parent, err := store.GetAdminUserByUsername(ctx, desired.ParentUsername)
			if err != nil || parent == nil || parent.Role != RoleReseller {
				http.Error(w, "parent reseller not found", http.StatusBadRequest)
				return
			}
			if adminAccountChainActive(parent.Username) != nil {
				http.Error(w, "parent reseller is inactive or expired", http.StatusForbidden)
				return
			}
			if normalizeQuotaMode(parent.QuotaMode) != desired.QuotaMode {
				http.Error(w, "sub-reseller plan must match its parent", http.StatusBadRequest)
				return
			}
		}

		if desired.QuotaMode == QuotaModeCredit {
			desired.MaxUsers = 0
			desired.CreditBalance = p.Credits
			desired.ExpiresAt = nil
		} else {
			desired.MaxUsers = p.MaxUsers
			desired.CreditBalance = 0
			desired.ExpiresAt, err = parseResellerExpiry(p.ExpiresAt)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if desired.ParentUsername != "" && desired.MaxUsers < 1 {
				http.Error(w, "sub-reseller limit must be at least 1", http.StatusBadRequest)
				return
			}
		}
		desired.WhatsApp = normalizeWhatsApp(p.WhatsApp)
		desired.MonthlyPriceCents = p.MonthlyPriceCents
		lockNames := []string{desired.ParentUsername}
		if existing != nil {
			lockNames = append(lockNames, desired.Username)
		}
		quotaUnlock := lockResellerQuotaSet(lockNames)
		defer quotaUnlock()

		if desired.IsActive && desired.ParentUsername != "" && adminAccountChainActive(desired.ParentUsername) != nil {
			http.Error(w, errResellerInvalidState.Error(), http.StatusForbidden)
			return
		}
		if desired.QuotaMode == QuotaModeSlots && existing != nil && desired.MaxUsers > 0 {
			directUsed, usageErr := countOwnedQuotaAcrossManagedServers(ctx, store, desired.Username)
			if usageErr != nil {
				http.Error(w, "could not verify current reseller usage", http.StatusBadGateway)
				return
			}
			children, childErr := store.directChildAllocation(ctx, desired.Username, "")
			if childErr != nil {
				http.Error(w, "database error", http.StatusInternalServerError)
				return
			}
			if directUsed+children > desired.MaxUsers {
				http.Error(w, errResellerHasUsage.Error(), http.StatusConflict)
				return
			}
		}

		parentDirectUsed := 0
		if desired.ParentUsername != "" && desired.QuotaMode == QuotaModeSlots {
			parentDirectUsed, err = countOwnedQuotaAcrossManagedServers(ctx, store, desired.ParentUsername)
			if err != nil {
				http.Error(w, "could not verify parent quota", http.StatusBadGateway)
				return
			}
		}
		wasActive := existing != nil && adminAccountChainActive(existing.Username) == nil
		if err := store.saveResellerRecord(ctx, sess.Username, desired, existing, parentDirectUsed); err != nil {
			switch {
			case errors.Is(err, errResellerQuota), errors.Is(err, errResellerCredits), errors.Is(err, errResellerHasUsage):
				http.Error(w, err.Error(), http.StatusConflict)
			case errors.Is(err, errResellerParent), errors.Is(err, errResellerPlan):
				http.Error(w, err.Error(), http.StatusBadRequest)
			case errors.Is(err, errResellerInvalidState):
				http.Error(w, err.Error(), http.StatusConflict)
			default:
				writeInternalError(w, "save reseller "+desired.Username, err)
			}
			return
		}
		if err := loadAdminUsersIntoCache(ctx, store); err != nil {
			log.Printf("reload reseller cache: %v", err)
		}
		if existing != nil && strings.TrimSpace(p.Password) != "" {
			sessions.DeleteUser(desired.ID)
		}
		isActive := adminAccountChainActive(desired.Username) == nil
		if wasActive != isActive {
			if err := applyResellerSubtreeRuntime(ctx, store, desired.Username, isActive); err != nil {
				log.Printf("apply reseller runtime for %s: %v", desired.Username, err)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"username": desired.Username, "created": existing == nil})
	}
}

type resellerRuntimePayload struct {
	Owner           string     `json:"owner_username"`
	ParentUsername  string     `json:"parent_username,omitempty"`
	Action          string     `json:"action"`
	EffectiveActive bool       `json:"effective_active"`
	ExpiresAt       *time.Time `json:"expires_at,omitempty"`
}

func resellerRuntimePayloadFromState(state ResellerRuntimeState, action string) resellerRuntimePayload {
	return resellerRuntimePayload{
		Owner:           state.OwnerUsername,
		ParentUsername:  state.ParentUsername,
		Action:          action,
		EffectiveActive: state.IsActive,
		ExpiresAt:       state.ExpiresAt,
	}
}

func sendResellerRuntimeToServer(ctx context.Context, ms *ManagedServer, payload resellerRuntimePayload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	status, data, _, err := proxyManagedServer(ctx, ms, http.MethodPost, "/api/resellers/runtime", body, "application/json")
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("HTTP %d: %q", status, remoteErrorSnippet(data))
	}
	return nil
}

func applyOwnerRuntimeLocal(ctx context.Context, store *Store, owner, action string) error {
	switch action {
	case "suspend":
		disconnectOwnerUsers(owner)
		return suspendOwnerXrayClients(ctx, store, owner)
	case "reactivate":
		return restoreOwnerXrayClients(ctx, store, owner)
	case "delete":
		rows, err := store.db.QueryContext(ctx, `SELECT username FROM ssh_users WHERE owner_username=$1`, owner)
		if err != nil {
			return err
		}
		var usernames []string
		for rows.Next() {
			var username string
			if err := rows.Scan(&username); err != nil {
				rows.Close()
				return err
			}
			usernames = append(usernames, username)
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, username := range usernames {
			userMgr.DisconnectUser(username)
		}
		if _, err := store.db.ExecContext(ctx, `DELETE FROM ssh_users WHERE owner_username=$1`, owner); err != nil {
			return err
		}
		removeOwnerXrayClients(ctx, store, owner)
		reloadUsersFromDB(ctx, store)
		return nil
	default:
		return fmt.Errorf("unsupported runtime action")
	}
}

func applyOwnerRuntimeRemote(ctx context.Context, store *Store, owner, action string) error {
	servers, err := store.ListManagedServers(ctx)
	if err != nil {
		return err
	}
	effectiveActive := action == "reactivate" && adminAccountChainActive(owner) == nil
	state, err := resellerRuntimeStateFor(owner, effectiveActive)
	if err != nil {
		return err
	}
	payload := resellerRuntimePayloadFromState(state, action)
	var failures []string
	for _, ms := range servers {
		// Cleanup also targets disabled nodes: skipping one could leave access that
		// becomes live again when the node or protocol is re-enabled.
		if err := sendResellerRuntimeToServer(ctx, ms, payload); err != nil {
			failures = append(failures, ms.Name+": "+err.Error())
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf("managed server runtime update failed: %s", strings.Join(failures, "; "))
	}
	return nil
}

func applyResellerSubtreeRuntime(ctx context.Context, store *Store, root string, active bool) error {
	all, err := store.ListAdminUsers(ctx)
	if err != nil {
		return err
	}
	action := "suspend"
	if active {
		action = "reactivate"
	}
	var failures []string
	for _, owner := range listResellerSubtree(all, root) {
		if active && adminAccountChainActive(owner.Username) != nil {
			continue
		}
		if err := applyOwnerRuntimeLocal(ctx, store, owner.Username, action); err != nil {
			failures = append(failures, "local "+owner.Username+": "+err.Error())
		}
		if err := applyOwnerRuntimeRemote(ctx, store, owner.Username, action); err != nil {
			failures = append(failures, owner.Username+": "+err.Error())
		}
	}
	if len(failures) > 0 {
		return errors.New(strings.Join(failures, "; "))
	}
	return nil
}

func handleResellerRuntime(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var p resellerRuntimePayload
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024)).Decode(&p); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		p.Owner = strings.TrimSpace(p.Owner)
		p.ParentUsername = strings.TrimSpace(p.ParentUsername)
		if err := validateAdminUsername(p.Owner); err != nil {
			http.Error(w, "invalid owner", http.StatusBadRequest)
			return
		}
		if p.ParentUsername != "" {
			if err := validateAdminUsername(p.ParentUsername); err != nil || p.ParentUsername == p.Owner {
				http.Error(w, "invalid parent owner", http.StatusBadRequest)
				return
			}
		}
		p.Action = strings.ToLower(strings.TrimSpace(p.Action))
		state := ResellerRuntimeState{
			OwnerUsername:  p.Owner,
			ParentUsername: p.ParentUsername,
			IsActive:       p.EffectiveActive,
			ExpiresAt:      p.ExpiresAt,
		}
		ctx := r.Context()
		switch p.Action {
		case "sync":
			if err := store.UpsertResellerRuntimeState(ctx, state); err != nil {
				log.Printf("sync reseller runtime state for %s: %v", p.Owner, err)
				http.Error(w, "runtime state update failed", http.StatusInternalServerError)
				return
			}
			action := "suspend"
			if resellerRuntimeChainActive(state.OwnerUsername) == nil {
				action = "reactivate"
			}
			if err := applyOwnerRuntimeLocal(ctx, store, p.Owner, action); err != nil {
				if action == "reactivate" {
					// State synchronization is still useful for SSH authentication even
					// when an unrelated legacy Xray client cannot be restored.
					log.Printf("restore Xray while syncing reseller %s: %v", p.Owner, err)
					break
				}
				log.Printf("reconcile synced reseller runtime for %s: %v", p.Owner, err)
				http.Error(w, "runtime update failed", http.StatusInternalServerError)
				return
			}
		case "suspend":
			state.IsActive = false
			if err := store.UpsertResellerRuntimeState(ctx, state); err != nil {
				log.Printf("suspend reseller runtime state for %s: %v", p.Owner, err)
				http.Error(w, "runtime state update failed", http.StatusInternalServerError)
				return
			}
			if err := applyOwnerRuntimeLocal(ctx, store, p.Owner, "suspend"); err != nil {
				log.Printf("suspend reseller runtime for %s: %v", p.Owner, err)
				http.Error(w, "runtime update failed", http.StatusInternalServerError)
				return
			}
		case "reactivate":
			state.IsActive = true
			if err := store.UpsertResellerRuntimeState(ctx, state); err != nil {
				log.Printf("reactivate reseller runtime state for %s: %v", p.Owner, err)
				http.Error(w, "runtime state update failed", http.StatusInternalServerError)
				return
			}
			if err := applyOwnerRuntimeLocal(ctx, store, p.Owner, "reactivate"); err != nil {
				state.IsActive = false
				_ = store.UpsertResellerRuntimeState(ctx, state)
				_ = applyOwnerRuntimeLocal(ctx, store, p.Owner, "suspend")
				log.Printf("reactivate reseller runtime for %s: %v", p.Owner, err)
				http.Error(w, "runtime update failed", http.StatusInternalServerError)
				return
			}
		case "delete":
			state.IsActive = false
			if err := store.UpsertResellerRuntimeState(ctx, state); err != nil {
				log.Printf("block reseller runtime state before delete for %s: %v", p.Owner, err)
				http.Error(w, "runtime state update failed", http.StatusInternalServerError)
				return
			}
			if err := applyOwnerRuntimeLocal(ctx, store, p.Owner, "delete"); err != nil {
				log.Printf("delete reseller runtime for %s: %v", p.Owner, err)
				http.Error(w, "runtime cleanup failed", http.StatusInternalServerError)
				return
			}
			if err := store.DeleteResellerRuntimeState(ctx, p.Owner); err != nil {
				log.Printf("delete reseller runtime state for %s: %v", p.Owner, err)
				http.Error(w, "runtime state cleanup failed", http.StatusInternalServerError)
				return
			}
		default:
			http.Error(w, "unsupported runtime action", http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type resellerActionPayload struct {
	Username string `json:"username"`
	Action   string `json:"action"`
	Days     int    `json:"days,omitempty"`
}

func handleResellerAction(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var p resellerActionPayload
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024)).Decode(&p); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		p.Username = strings.TrimSpace(p.Username)
		resellerLifecycleMu.Lock()
		defer resellerLifecycleMu.Unlock()
		target, err := store.GetAdminUserByUsername(r.Context(), p.Username)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		sess := sessionFromCtx(r.Context())
		if target == nil {
			http.Error(w, "reseller not found", http.StatusNotFound)
			return
		}
		if !resellerCanManage(sess, target) {
			http.Error(w, errResellerForbidden.Error(), http.StatusForbidden)
			return
		}
		all, err := store.ListAdminUsers(r.Context())
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		quotaUnlock := lockResellerQuotaSet(resellerSubtreeUsernames(listResellerSubtree(all, target.Username)))
		defer quotaUnlock()
		// The target may have changed while another lifecycle action held the
		// subtree lock, so base this action on a fresh row.
		target, err = store.GetAdminUserByUsername(r.Context(), p.Username)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if target == nil {
			http.Error(w, "reseller not found", http.StatusNotFound)
			return
		}
		if !resellerCanManage(sess, target) {
			http.Error(w, errResellerForbidden.Error(), http.StatusForbidden)
			return
		}

		action := strings.ToLower(strings.TrimSpace(p.Action))
		details := ""
		active := target.IsActive
		expiresAt := target.ExpiresAt
		switch action {
		case "suspend":
			active = false
		case "reactivate":
			if target.ExpiresAt != nil && time.Now().After(*target.ExpiresAt) {
				http.Error(w, "renew this reseller before reactivating it", http.StatusConflict)
				return
			}
			if target.ParentUsername != "" && adminAccountChainActive(target.ParentUsername) != nil {
				http.Error(w, errResellerInvalidState.Error(), http.StatusConflict)
				return
			}
			active = true
		case "renew":
			if normalizeQuotaMode(target.QuotaMode) == QuotaModeCredit {
				http.Error(w, "credit resellers do not expire", http.StatusBadRequest)
				return
			}
			if p.Days == 0 {
				p.Days = 30
			}
			if p.Days < 1 || p.Days > 3650 {
				http.Error(w, "days must be between 1 and 3650", http.StatusBadRequest)
				return
			}
			base := time.Now()
			if target.ExpiresAt != nil && target.ExpiresAt.After(base) {
				base = *target.ExpiresAt
			}
			next := base.AddDate(0, 0, p.Days)
			expiresAt = &next
			active = true
			details = "days=" + strconv.Itoa(p.Days)
		case "pull":
			if sess.Role != RoleSuperAdmin {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			if target.ParentUsername == "" {
				http.Error(w, "reseller is already attached to the main panel", http.StatusConflict)
				return
			}
			details = "previous_parent=" + target.ParentUsername
		default:
			http.Error(w, "unsupported reseller action", http.StatusBadRequest)
			return
		}

		tx, err := store.db.BeginTx(r.Context(), nil)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()
		updateQuery := `UPDATE admin_users SET is_active=$1, expires_at=$2 WHERE id=$3 AND role=$4`
		updateArgs := []interface{}{active, expiresAt, target.ID, RoleReseller}
		if action == "pull" {
			updateQuery = `UPDATE admin_users SET parent_username='' WHERE id=$1 AND role=$2`
			updateArgs = []interface{}{target.ID, RoleReseller}
		}
		if _, err := tx.ExecContext(r.Context(), updateQuery, updateArgs...); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if _, err := tx.ExecContext(r.Context(), `
			INSERT INTO reseller_audit_log (actor_username, target_username, action, details)
			VALUES ($1,$2,$3,$4)`, sess.Username, target.Username, action+" reseller", details); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		_ = loadAdminUsersIntoCache(r.Context(), store)
		if !active {
			sessions.DeleteUser(target.ID)
		}
		runtimeActive := active
		if action == "pull" {
			runtimeActive = adminAccountChainActive(target.Username) == nil
		}
		runtimeErr := applyResellerSubtreeRuntime(r.Context(), store, target.Username, runtimeActive)
		runtimeWarning := ""
		if runtimeErr != nil {
			log.Printf("apply reseller action runtime for %s: %v", target.Username, runtimeErr)
			runtimeWarning = "Some managed servers could not be updated. Check server status and retry."
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":              true,
			"runtime_warning": runtimeWarning,
		})
	}
}

func handleDeleteReseller(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		username := strings.TrimSpace(r.URL.Query().Get("username"))
		if err := validateAdminUsername(username); err != nil {
			http.Error(w, "invalid username", http.StatusBadRequest)
			return
		}
		ctx := r.Context()
		sess := sessionFromCtx(ctx)
		resellerLifecycleMu.Lock()
		defer resellerLifecycleMu.Unlock()
		target, err := store.GetAdminUserByUsername(ctx, username)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if target == nil {
			http.Error(w, "reseller not found", http.StatusNotFound)
			return
		}
		if !resellerCanManage(sess, target) {
			http.Error(w, errResellerForbidden.Error(), http.StatusForbidden)
			return
		}
		all, err := store.ListAdminUsers(ctx)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		subtree := listResellerSubtree(all, username)
		quotaUnlock := lockResellerQuotaSet(resellerSubtreeUsernames(subtree))
		defer quotaUnlock()
		// Reload balances after acquiring the provisioning locks. This prevents an
		// in-flight credit spend or child transfer from being refunded twice.
		all, err = store.ListAdminUsers(ctx)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		subtree = listResellerSubtree(all, username)
		if len(subtree) == 0 {
			http.Error(w, "reseller not found", http.StatusNotFound)
			return
		}
		// Suspend first and refresh the session cache before distributed cleanup.
		// A failed node cleanup can then be retried safely without allowing new
		// accounts to appear underneath the reseller being deleted.
		blockTx, err := store.db.BeginTx(ctx, nil)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		for _, owner := range subtree {
			if _, err := blockTx.ExecContext(ctx, `UPDATE admin_users SET is_active=FALSE WHERE id=$1 AND role=$2`, owner.ID, RoleReseller); err != nil {
				_ = blockTx.Rollback()
				http.Error(w, "database error", http.StatusInternalServerError)
				return
			}
		}
		if err := blockTx.Commit(); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		_ = loadAdminUsersIntoCache(ctx, store)
		for _, owner := range subtree {
			sessions.DeleteUser(owner.ID)
		}
		for _, owner := range subtree {
			if err := applyOwnerRuntimeRemote(ctx, store, owner.Username, "delete"); err != nil {
				writeBadGatewayError(w, "delete reseller resources from managed servers", err)
				return
			}
		}
		for i := len(subtree) - 1; i >= 0; i-- {
			if err := applyOwnerRuntimeLocal(ctx, store, subtree[i].Username, "delete"); err != nil {
				writeInternalError(w, "delete local reseller resources", err)
				return
			}
		}

		tx, err := store.db.BeginTx(ctx, nil)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()
		if target.ParentUsername != "" && normalizeQuotaMode(target.QuotaMode) == QuotaModeCredit {
			refund := 0
			for _, u := range subtree {
				if normalizeQuotaMode(u.QuotaMode) == QuotaModeCredit {
					refund += u.CreditBalance
				}
			}
			if refund > 0 {
				var balance int
				if err := tx.QueryRowContext(ctx, `
					UPDATE admin_users SET credit_balance=credit_balance+$1
					WHERE username=$2 AND quota_mode=$3 RETURNING credit_balance`,
					refund, target.ParentUsername, QuotaModeCredit).Scan(&balance); err != nil {
					http.Error(w, "database error", http.StatusInternalServerError)
					return
				}
				if _, err := tx.ExecContext(ctx, `
					INSERT INTO reseller_credit_ledger
					(reseller_username, actor_username, delta, balance_after, action, target)
					VALUES ($1,$2,$3,$4,$5,$6)`,
					target.ParentUsername, sess.Username, refund, balance, "deleted sub-reseller refund", target.Username); err != nil {
					http.Error(w, "database error", http.StatusInternalServerError)
					return
				}
			}
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO reseller_audit_log (actor_username, target_username, action, details)
			VALUES ($1,$2,$3,$4)`, sess.Username, target.Username, "deleted reseller",
			fmt.Sprintf("removed_accounts=%d", len(subtree))); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		for i := len(subtree) - 1; i >= 0; i-- {
			if _, err := tx.ExecContext(ctx, `DELETE FROM admin_users WHERE id=$1 AND role=$2`, subtree[i].ID, RoleReseller); err != nil {
				http.Error(w, "database error", http.StatusInternalServerError)
				return
			}
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		for _, u := range subtree {
			sessions.DeleteUser(u.ID)
			adminUsers.delete(u.Username)
		}
		_ = loadAdminUsersIntoCache(ctx, store)
		w.WriteHeader(http.StatusNoContent)
	}
}

type ResellerAuditDTO struct {
	ID             int64     `json:"id"`
	ActorUsername  string    `json:"actor_username"`
	TargetUsername string    `json:"target_username"`
	Action         string    `json:"action"`
	Details        string    `json:"details"`
	CreatedAt      time.Time `json:"created_at"`
}

func handleResellerAudit(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		sess := sessionFromCtx(r.Context())
		if sess == nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		query := `SELECT id, actor_username, target_username, action, details, created_at
			FROM reseller_audit_log ORDER BY created_at DESC LIMIT 200`
		args := []interface{}{}
		if sess.Role == RoleReseller {
			query = `SELECT id, actor_username, target_username, action, details, created_at
				FROM reseller_audit_log
				WHERE actor_username=$1 OR target_username=$1 OR target_username IN
					(SELECT username FROM admin_users WHERE parent_username=$1 AND role=$2)
				ORDER BY created_at DESC LIMIT 200`
			args = append(args, sess.Username, RoleReseller)
		}
		rows, err := store.db.QueryContext(r.Context(), query, args...)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		out := make([]ResellerAuditDTO, 0, 64)
		for rows.Next() {
			var item ResellerAuditDTO
			if err := rows.Scan(&item.ID, &item.ActorUsername, &item.TargetUsername, &item.Action, &item.Details, &item.CreatedAt); err != nil {
				http.Error(w, "database error", http.StatusInternalServerError)
				return
			}
			out = append(out, item)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}
}

func reserveResellerProvisionCredits(ctx context.Context, store *Store, owner string, cost int, target string) (bool, error) {
	u, ok := adminUsers.get(owner)
	if !ok || normalizeQuotaMode(u.QuotaMode) != QuotaModeCredit {
		return false, nil
	}
	if cost < 1 {
		cost = 1
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var balance int
	err = tx.QueryRowContext(ctx, `
		UPDATE admin_users SET credit_balance=credit_balance-$1
		WHERE username=$2 AND role=$3 AND quota_mode=$4 AND is_active=TRUE AND credit_balance >= $1
		RETURNING credit_balance`, cost, owner, RoleReseller, QuotaModeCredit).Scan(&balance)
	if err == sql.ErrNoRows {
		return false, errResellerCredits
	}
	if err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO reseller_credit_ledger
		(reseller_username, actor_username, delta, balance_after, action, target)
		VALUES ($1,$2,$3,$4,$5,$6)`, owner, owner, -cost, balance, "provision account", target); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO reseller_audit_log (actor_username, target_username, action, details)
		VALUES ($1,$2,$3,$4)`, owner, owner, "spent credits", fmt.Sprintf("target=%s cost=%d", target, cost)); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	copyUser := *u
	copyUser.CreditBalance = balance
	adminUsers.set(&copyUser)
	return true, nil
}

func refundResellerProvisionCredits(ctx context.Context, store *Store, owner string, cost int, target string) {
	if cost < 1 {
		return
	}
	var balance int
	err := store.db.QueryRowContext(ctx, `
		UPDATE admin_users SET credit_balance=credit_balance+$1
		WHERE username=$2 AND quota_mode=$3 RETURNING credit_balance`,
		cost, owner, QuotaModeCredit).Scan(&balance)
	if err != nil {
		log.Printf("refund reseller credits for %s: %v", owner, err)
		return
	}
	_, _ = store.db.ExecContext(ctx, `
		INSERT INTO reseller_credit_ledger
		(reseller_username, actor_username, delta, balance_after, action, target)
		VALUES ($1,$2,$3,$4,$5,$6)`, owner, owner, cost, balance, "provision refund", target)
	if u, ok := adminUsers.get(owner); ok {
		copyUser := *u
		copyUser.CreditBalance = balance
		adminUsers.set(&copyUser)
	}
}

func authorizeResellerProvision(ctx context.Context, store *Store, owner, target string, maxConnections int) (bool, int, error) {
	u, ok := adminUsers.get(owner)
	if !ok || u.Role != RoleReseller {
		return false, 0, fmt.Errorf("reseller account not found")
	}
	if err := adminAccountChainActive(owner); err != nil {
		return false, 0, err
	}
	if maxConnections < 1 {
		return false, 0, errResellerConnLimit
	}
	cost := resellerProvisionCost(maxConnections)
	if normalizeQuotaMode(u.QuotaMode) == QuotaModeCredit {
		charged, err := reserveResellerProvisionCredits(ctx, store, owner, cost, target)
		return charged, cost, err
	}
	used, err := countOwnedQuotaAcrossManagedServers(ctx, store, owner)
	if err != nil {
		return false, 0, err
	}
	children, err := store.directChildAllocation(ctx, owner, "")
	if err != nil {
		return false, 0, err
	}
	if u.MaxUsers > 0 && used+children+cost > u.MaxUsers {
		return false, 0, errResellerQuota
	}
	return false, 0, nil
}

func authorizeResellerQuotaChange(ctx context.Context, store *Store, owner string, oldMaxConnections, newMaxConnections int) error {
	u, ok := adminUsers.get(owner)
	if !ok || u.Role != RoleReseller {
		return fmt.Errorf("reseller account not found")
	}
	if err := adminAccountChainActive(owner); err != nil {
		return err
	}
	if newMaxConnections < 1 {
		return errResellerConnLimit
	}
	oldCost := resellerProvisionCost(oldMaxConnections)
	newCost := resellerProvisionCost(newMaxConnections)
	if normalizeQuotaMode(u.QuotaMode) == QuotaModeCredit {
		if newCost != oldCost {
			return errCreditLimitImmutable
		}
		return nil
	}
	delta := newCost - oldCost
	if delta <= 0 || u.MaxUsers == 0 {
		return nil
	}
	used, err := countOwnedQuotaAcrossManagedServers(ctx, store, owner)
	if err != nil {
		return err
	}
	children, err := store.directChildAllocation(ctx, owner, "")
	if err != nil {
		return err
	}
	if used+children+delta > u.MaxUsers {
		return errResellerQuota
	}
	return nil
}

func writeResellerProvisionError(w http.ResponseWriter, err error) {
	if errors.Is(err, errResellerConnLimit) || errors.Is(err, errCreditLimitImmutable) {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if errors.Is(err, errResellerCredits) || errors.Is(err, errResellerQuota) {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	writeBadGatewayError(w, "verify reseller quota", err)
}

func resellerProvisionExpiry(owner string) string {
	u, ok := adminUsers.get(owner)
	if !ok || normalizeQuotaMode(u.QuotaMode) != QuotaModeCredit {
		return ""
	}
	return time.Now().UTC().AddDate(0, 0, 31).Format(time.RFC3339)
}

func resellerExpiryExtended(existing, requested string) bool {
	requested = strings.TrimSpace(requested)
	if requested == "" || requested == strings.TrimSpace(existing) {
		return false
	}
	requestedTime, err := time.Parse(time.RFC3339, requested)
	if err != nil {
		return true
	}
	existingTime, err := time.Parse(time.RFC3339, strings.TrimSpace(existing))
	if err != nil {
		return true
	}
	return requestedTime.After(existingTime)
}

func resellerTimeExtended(existing *time.Time, requested string) bool {
	requested = strings.TrimSpace(requested)
	if requested == "" {
		return false
	}
	var requestedTime time.Time
	var err error
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04", "2006-01-02"} {
		requestedTime, err = time.Parse(layout, requested)
		if err == nil {
			break
		}
	}
	if err != nil || existing == nil {
		return true
	}
	return requestedTime.After(*existing)
}
