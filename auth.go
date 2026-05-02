package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

const (
	RoleSuperAdmin = "superadmin"
	RoleReseller   = "reseller"
	sessionTTL     = 12 * time.Hour
)

// ---------- AdminUser ----------

type AdminUser struct {
	ID           int
	Username     string
	PasswordHash string
	Role         string
	MaxUsers     int
	ExpiresAt    *time.Time
	IsActive     bool
	CreatedAt    time.Time
}

// ---------- Session store (in-memory) ----------

type AdminSession struct {
	Token     string
	UserID    int
	Username  string
	Role      string
	ExpiresAt time.Time
}

type sessionStoreT struct {
	mu sync.RWMutex
	m  map[string]*AdminSession
}

var sessions = &sessionStoreT{m: make(map[string]*AdminSession)}

func (s *sessionStoreT) Create(userID int, username, role string) *AdminSession {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	tok := hex.EncodeToString(b)
	sess := &AdminSession{
		Token:     tok,
		UserID:    userID,
		Username:  username,
		Role:      role,
		ExpiresAt: time.Now().Add(sessionTTL),
	}
	s.mu.Lock()
	s.m[tok] = sess
	s.mu.Unlock()
	return sess
}

func (s *sessionStoreT) Get(token string) *AdminSession {
	if token == "" {
		return nil
	}
	s.mu.RLock()
	sess := s.m[token]
	s.mu.RUnlock()
	if sess == nil || time.Now().After(sess.ExpiresAt) {
		return nil
	}
	return sess
}

func (s *sessionStoreT) Delete(token string) {
	s.mu.Lock()
	delete(s.m, token)
	s.mu.Unlock()
}

func (s *sessionStoreT) cleanup() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for tok, sess := range s.m {
		if now.After(sess.ExpiresAt) {
			delete(s.m, tok)
		}
	}
}

// ---------- In-memory AdminUser cache ----------

type adminUserMgrT struct {
	mu sync.RWMutex
	m  map[string]*AdminUser
}

var adminUsers = &adminUserMgrT{m: make(map[string]*AdminUser)}

func (m *adminUserMgrT) set(u *AdminUser) {
	m.mu.Lock()
	m.m[u.Username] = u
	m.mu.Unlock()
}

func (m *adminUserMgrT) get(username string) (*AdminUser, bool) {
	m.mu.RLock()
	u, ok := m.m[username]
	m.mu.RUnlock()
	return u, ok
}

func (m *adminUserMgrT) delete(username string) {
	m.mu.Lock()
	delete(m.m, username)
	m.mu.Unlock()
}

func (m *adminUserMgrT) list() []*AdminUser {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*AdminUser, 0, len(m.m))
	for _, u := range m.m {
		cp := *u
		out = append(out, &cp)
	}
	return out
}

func (m *adminUserMgrT) replaceAll(users []*AdminUser) {
	m.mu.Lock()
	m.m = make(map[string]*AdminUser, len(users))
	for _, u := range users {
		cp := *u
		m.m[u.Username] = &cp
	}
	m.mu.Unlock()
}

// ---------- Context helpers ----------

type ctxKeyAdmin struct{}

func withSession(ctx context.Context, s *AdminSession) context.Context {
	return context.WithValue(ctx, ctxKeyAdmin{}, s)
}

func sessionFromCtx(ctx context.Context) *AdminSession {
	s, _ := ctx.Value(ctxKeyAdmin{}).(*AdminSession)
	return s
}

// ---------- Middleware ----------

// sessionMiddleware requires a valid X-Session-Token header.
func sessionMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("X-Session-Token")
		s := sessions.Get(token)
		if s == nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(withSession(r.Context(), s)))
	})
}

// superAdminOnly wraps a handler to require role == superadmin.
// Must be used AFTER sessionMiddleware (session must be in context).
func superAdminOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s := sessionFromCtx(r.Context())
		if s == nil || s.Role != RoleSuperAdmin {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// saSession chains sessionMiddleware + superAdminOnly.
func saSession(next http.Handler) http.Handler {
	return sessionMiddleware(superAdminOnly(next))
}

// ---------- Password hashing ----------

func hashAdminPassword(pw string) string {
	h := sha256.Sum256([]byte(pw))
	return hex.EncodeToString(h[:])
}

// ---------- DB methods on Store ----------

func (s *Store) EnsureAdminUsersSchema(ctx context.Context) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS admin_users (
			id            SERIAL PRIMARY KEY,
			username      TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			role          TEXT NOT NULL DEFAULT 'reseller',
			max_users     INT  NOT NULL DEFAULT 30,
			expires_at    TIMESTAMPTZ,
			is_active     BOOLEAN NOT NULL DEFAULT TRUE,
			created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`ALTER TABLE ssh_users ADD COLUMN IF NOT EXISTS owner_username TEXT NOT NULL DEFAULT ''`,
	}
	for _, stmt := range stmts {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("EnsureAdminUsersSchema: %w", err)
		}
	}
	return nil
}

func (s *Store) GetAdminUserByUsername(ctx context.Context, username string) (*AdminUser, error) {
	u := &AdminUser{}
	var expiresAt sql.NullTime
	err := s.db.QueryRowContext(ctx,
		`SELECT id, username, password_hash, role, max_users, expires_at, is_active, created_at
		 FROM admin_users WHERE username = $1`, username,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.MaxUsers,
		&expiresAt, &u.IsActive, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if expiresAt.Valid {
		u.ExpiresAt = &expiresAt.Time
	}
	return u, nil
}

func (s *Store) ListAdminUsers(ctx context.Context) ([]*AdminUser, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, username, password_hash, role, max_users, expires_at, is_active, created_at
		 FROM admin_users ORDER BY role, username`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*AdminUser
	for rows.Next() {
		u := &AdminUser{}
		var expiresAt sql.NullTime
		if err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role,
			&u.MaxUsers, &expiresAt, &u.IsActive, &u.CreatedAt); err != nil {
			return nil, err
		}
		if expiresAt.Valid {
			u.ExpiresAt = &expiresAt.Time
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) UpsertAdminUser(ctx context.Context, u *AdminUser) error {
	var expiresAt interface{}
	if u.ExpiresAt != nil {
		expiresAt = *u.ExpiresAt
	}
	if u.ID == 0 {
		return s.db.QueryRowContext(ctx,
			`INSERT INTO admin_users (username, password_hash, role, max_users, expires_at, is_active)
			 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
			u.Username, u.PasswordHash, u.Role, u.MaxUsers, expiresAt, u.IsActive,
		).Scan(&u.ID)
	}
	_, err := s.db.ExecContext(ctx,
		`UPDATE admin_users SET password_hash=$2, role=$3, max_users=$4,
		 expires_at=$5, is_active=$6 WHERE id=$1`,
		u.ID, u.PasswordHash, u.Role, u.MaxUsers, expiresAt, u.IsActive)
	return err
}

func (s *Store) DeleteAdminUser(ctx context.Context, username string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM admin_users WHERE username=$1`, username)
	return err
}

func (s *Store) SetAdminUserActive(ctx context.Context, username string, active bool) error {
	_, err := s.db.ExecContext(ctx, `UPDATE admin_users SET is_active=$1 WHERE username=$2`, active, username)
	return err
}

func (s *Store) ListExpiredResellers(ctx context.Context) ([]*AdminUser, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, username, password_hash, role, max_users, expires_at, is_active, created_at
		 FROM admin_users
		 WHERE role=$1 AND is_active=TRUE AND expires_at IS NOT NULL AND expires_at < NOW()`,
		RoleReseller)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAdminUsers(rows)
}

func (s *Store) ListInactiveButRenewedResellers(ctx context.Context) ([]*AdminUser, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, username, password_hash, role, max_users, expires_at, is_active, created_at
		 FROM admin_users
		 WHERE role=$1 AND is_active=FALSE AND (expires_at IS NULL OR expires_at > NOW())`,
		RoleReseller)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAdminUsers(rows)
}

func scanAdminUsers(rows *sql.Rows) ([]*AdminUser, error) {
	var out []*AdminUser
	for rows.Next() {
		u := &AdminUser{}
		var expiresAt sql.NullTime
		if err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role,
			&u.MaxUsers, &expiresAt, &u.IsActive, &u.CreatedAt); err != nil {
			return nil, err
		}
		if expiresAt.Valid {
			u.ExpiresAt = &expiresAt.Time
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// BootstrapSuperAdmin creates a default "admin" superadmin if none exists.
// Returns the generated password, or "" if a superadmin already existed.
func (s *Store) BootstrapSuperAdmin(ctx context.Context) (string, error) {
	var count int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM admin_users WHERE role=$1`, RoleSuperAdmin,
	).Scan(&count); err != nil {
		return "", err
	}
	if count > 0 {
		return "", nil
	}
	b := make([]byte, 10)
	_, _ = rand.Read(b)
	pw := hex.EncodeToString(b)
	u := &AdminUser{
		Username:     "admin",
		PasswordHash: hashAdminPassword(pw),
		Role:         RoleSuperAdmin,
		MaxUsers:     0,
		IsActive:     true,
	}
	if err := s.UpsertAdminUser(ctx, u); err != nil {
		return "", err
	}
	return pw, nil
}

// loadAdminUsersIntoCache reloads all admin_users rows into the in-memory cache.
func loadAdminUsersIntoCache(ctx context.Context, store *Store) error {
	users, err := store.ListAdminUsers(ctx)
	if err != nil {
		return err
	}
	adminUsers.replaceAll(users)
	return nil
}

// ---------- Owner check (called from SSH auth callbacks) ----------

// ownerIsActive returns nil if an SSH user's reseller owner is active, or an error if suspended/expired.
func ownerIsActive(ownerUsername string) error {
	if ownerUsername == "" {
		return nil
	}
	u, ok := adminUsers.get(ownerUsername)
	if !ok {
		return fmt.Errorf("reseller account not found")
	}
	if !u.IsActive {
		return fmt.Errorf("reseller account suspended")
	}
	if u.ExpiresAt != nil && time.Now().After(*u.ExpiresAt) {
		return fmt.Errorf("reseller account expired")
	}
	return nil
}

// disconnectOwnerUsers forcibly closes all active SSH connections for users owned by owner.
func disconnectOwnerUsers(ownerUsername string) {
	for _, u := range userMgr.List() {
		if u.Cfg.OwnerUsername == ownerUsername {
			userMgr.DisconnectUser(u.Cfg.Username)
		}
	}
}

// countOwnedUsers counts SSH users in memory that belong to owner.
func countOwnedUsers(ownerUsername string) int {
	n := 0
	for _, u := range userMgr.List() {
		if u.Cfg.OwnerUsername == ownerUsername {
			n++
		}
	}
	return n
}

// ---------- Reseller expiry background checker ----------

func startResellerExpiryChecker(store *Store) {
	if store == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			ctx := context.Background()

			// Expire active resellers past their deadline
			expired, err := store.ListExpiredResellers(ctx)
			if err != nil {
				log.Printf("reseller expiry check: %v", err)
			}
			for _, u := range expired {
				log.Printf("reseller %s expired — suspending", u.Username)
				if err := store.SetAdminUserActive(ctx, u.Username, false); err != nil {
					log.Printf("reseller expiry: %v", err)
					continue
				}
				u.IsActive = false
				adminUsers.set(u)
				disconnectOwnerUsers(u.Username)
			}

			// Reactivate resellers that have been renewed (inactive but expiry now in future/nil)
			renewed, err := store.ListInactiveButRenewedResellers(ctx)
			if err != nil {
				log.Printf("reseller renewal check: %v", err)
			}
			for _, u := range renewed {
				log.Printf("reseller %s renewed — reactivating", u.Username)
				if err := store.SetAdminUserActive(ctx, u.Username, true); err != nil {
					log.Printf("reseller renewal: %v", err)
					continue
				}
				u.IsActive = true
				adminUsers.set(u)
			}

			sessions.cleanup()
		}
	}()
}

// ---------- HTTP handlers ----------

func handleLogin(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		if req.Username == "" || req.Password == "" {
			http.Error(w, "username and password required", http.StatusBadRequest)
			return
		}

		u, err := store.GetAdminUserByUsername(r.Context(), req.Username)
		if err != nil {
			log.Printf("login db: %v", err)
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		if u == nil || u.PasswordHash != hashAdminPassword(req.Password) {
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
			return
		}
		if !u.IsActive {
			http.Error(w, "account suspended", http.StatusForbidden)
			return
		}
		if u.ExpiresAt != nil && time.Now().After(*u.ExpiresAt) {
			http.Error(w, "account expired", http.StatusForbidden)
			return
		}

		sess := sessions.Create(u.ID, u.Username, u.Role)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"token":    sess.Token,
			"username": u.Username,
			"role":     u.Role,
		})
	}
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	sessions.Delete(r.Header.Get("X-Session-Token"))
	w.WriteHeader(http.StatusOK)
}

func handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	s := sessionFromCtx(r.Context())
	resp := map[string]interface{}{
		"username": s.Username,
		"role":     s.Role,
	}
	if s.Role == RoleReseller {
		if u, ok := adminUsers.get(s.Username); ok {
			resp["max_users"]  = u.MaxUsers
			resp["used_users"] = countOwnedUsers(s.Username)
			resp["expires_at"] = u.ExpiresAt
			resp["is_active"]  = u.IsActive
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// ---------- Reseller management (superadmin only) ----------

type ResellerDTO struct {
	ID        int        `json:"id"`
	Username  string     `json:"username"`
	Role      string     `json:"role"`
	MaxUsers  int        `json:"max_users"`
	UsedUsers int        `json:"used_users"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	IsActive  bool       `json:"is_active"`
	CreatedAt time.Time  `json:"created_at"`
}

func handleListResellers(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		users, err := store.ListAdminUsers(r.Context())
		if err != nil {
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		out := make([]ResellerDTO, 0, len(users))
		for _, u := range users {
			out = append(out, ResellerDTO{
				ID:        u.ID,
				Username:  u.Username,
				Role:      u.Role,
				MaxUsers:  u.MaxUsers,
				UsedUsers: countOwnedUsers(u.Username),
				ExpiresAt: u.ExpiresAt,
				IsActive:  u.IsActive,
				CreatedAt: u.CreatedAt,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}
}

type ResellerPayload struct {
	Username  string `json:"username"`
	Password  string `json:"password,omitempty"`
	MaxUsers  int    `json:"max_users"`
	ExpiresAt string `json:"expires_at"`
	IsActive  bool   `json:"is_active"`
}

func handleCreateReseller(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var p ResellerPayload
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		if p.Username == "" {
			http.Error(w, "username required", http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		existing, err := store.GetAdminUserByUsername(ctx, p.Username)
		if err != nil {
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}

		var u *AdminUser
		if existing != nil {
			u = existing
		} else {
			if p.Password == "" {
				http.Error(w, "password required for new account", http.StatusBadRequest)
				return
			}
			u = &AdminUser{Username: p.Username, Role: RoleReseller}
		}

		if p.Password != "" {
			u.PasswordHash = hashAdminPassword(p.Password)
		}
		u.MaxUsers  = p.MaxUsers
		u.IsActive  = p.IsActive
		u.ExpiresAt = nil
		if p.ExpiresAt != "" {
			t, err := time.Parse(time.RFC3339, p.ExpiresAt)
			if err != nil {
				http.Error(w, "invalid expires_at (RFC3339 required)", http.StatusBadRequest)
				return
			}
			u.ExpiresAt = &t
		}

		if err := store.UpsertAdminUser(ctx, u); err != nil {
			log.Printf("upsert reseller: %v", err)
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		adminUsers.set(u)

		// If reseller was reactivated, users can reconnect automatically.
		// Reconnect of existing SSH connections happens via the expiry checker.

		w.WriteHeader(http.StatusCreated)
	}
}

func handleDeleteReseller(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		username := r.URL.Query().Get("username")
		if username == "" {
			http.Error(w, "username required", http.StatusBadRequest)
			return
		}
		ctx := r.Context()
		if err := store.DeleteAdminUser(ctx, username); err != nil {
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		disconnectOwnerUsers(username)
		adminUsers.delete(username)
		w.WriteHeader(http.StatusNoContent)
	}
}
