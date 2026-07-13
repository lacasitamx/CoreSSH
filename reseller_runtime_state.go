package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"
)

// ResellerRuntimeState is a password-free ownership record replicated from a
// master panel to its managed nodes. It lets a node enforce reseller
// suspension and parent hierarchy locally without copying login credentials.
type ResellerRuntimeState struct {
	OwnerUsername  string
	ParentUsername string
	IsActive       bool
	ExpiresAt      *time.Time
}

type resellerRuntimeStateCacheT struct {
	mu sync.RWMutex
	m  map[string]ResellerRuntimeState
}

var resellerRuntimeStates = &resellerRuntimeStateCacheT{m: make(map[string]ResellerRuntimeState)}

func (m *resellerRuntimeStateCacheT) get(username string) (ResellerRuntimeState, bool) {
	m.mu.RLock()
	state, ok := m.m[username]
	m.mu.RUnlock()
	return state, ok
}

func (m *resellerRuntimeStateCacheT) set(state ResellerRuntimeState) {
	m.mu.Lock()
	m.m[state.OwnerUsername] = state
	m.mu.Unlock()
}

func (m *resellerRuntimeStateCacheT) delete(username string) {
	m.mu.Lock()
	delete(m.m, username)
	m.mu.Unlock()
}

func (m *resellerRuntimeStateCacheT) list() []ResellerRuntimeState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]ResellerRuntimeState, 0, len(m.m))
	for _, state := range m.m {
		out = append(out, state)
	}
	return out
}

func (m *resellerRuntimeStateCacheT) replaceAll(states []ResellerRuntimeState) {
	m.mu.Lock()
	m.m = make(map[string]ResellerRuntimeState, len(states))
	for _, state := range states {
		m.m[state.OwnerUsername] = state
	}
	m.mu.Unlock()
}

func (s *Store) ListResellerRuntimeStates(ctx context.Context) ([]ResellerRuntimeState, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT owner_username, parent_username, is_active, expires_at
		FROM reseller_runtime_state`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ResellerRuntimeState
	for rows.Next() {
		var state ResellerRuntimeState
		var expiresAt sql.NullTime
		if err := rows.Scan(&state.OwnerUsername, &state.ParentUsername, &state.IsActive, &expiresAt); err != nil {
			return nil, err
		}
		if expiresAt.Valid {
			state.ExpiresAt = &expiresAt.Time
		}
		out = append(out, state)
	}
	return out, rows.Err()
}

func (s *Store) UpsertResellerRuntimeState(ctx context.Context, state ResellerRuntimeState) error {
	var expiresAt interface{}
	if state.ExpiresAt != nil {
		expiresAt = *state.ExpiresAt
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO reseller_runtime_state
		(owner_username, parent_username, is_active, expires_at, updated_at)
		VALUES ($1,$2,$3,$4,NOW())
		ON CONFLICT (owner_username) DO UPDATE SET
		 parent_username=EXCLUDED.parent_username,
		 is_active=EXCLUDED.is_active,
		 expires_at=EXCLUDED.expires_at,
		 updated_at=NOW()`,
		state.OwnerUsername, state.ParentUsername, state.IsActive, expiresAt)
	if err == nil {
		resellerRuntimeStates.set(state)
	}
	return err
}

func (s *Store) DeleteResellerRuntimeState(ctx context.Context, owner string) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM reseller_runtime_state WHERE owner_username=$1`, owner); err != nil {
		return err
	}
	resellerRuntimeStates.delete(owner)
	return nil
}

func resellerRuntimeChainActive(username string) error {
	seen := make(map[string]bool)
	now := time.Now()
	for depth := 0; username != "" && depth < 128; depth++ {
		if seen[username] {
			return fmt.Errorf("reseller hierarchy cycle detected")
		}
		seen[username] = true
		state, ok := resellerRuntimeStates.get(username)
		if !ok {
			return fmt.Errorf("reseller runtime state not found")
		}
		if !state.IsActive {
			return fmt.Errorf("reseller account suspended")
		}
		if state.ExpiresAt != nil && now.After(*state.ExpiresAt) {
			return fmt.Errorf("reseller account expired")
		}
		username = strings.TrimSpace(state.ParentUsername)
	}
	if username != "" {
		return fmt.Errorf("reseller hierarchy is too deep")
	}
	return nil
}

func resellerRuntimeStateFor(owner string, effectiveActive bool) (ResellerRuntimeState, error) {
	u, ok := adminUsers.get(owner)
	if !ok || u.Role != RoleReseller {
		return ResellerRuntimeState{}, fmt.Errorf("reseller account not found")
	}
	return ResellerRuntimeState{
		OwnerUsername:  u.Username,
		ParentUsername: u.ParentUsername,
		IsActive:       effectiveActive,
		ExpiresAt:      u.ExpiresAt,
	}, nil
}

// syncOwnerChainToManagedServer makes account creation on a managed node safe:
// every parent is installed before the child, and no password/hash is sent.
func syncOwnerChainToManagedServer(ctx context.Context, ms *ManagedServer, owner string) error {
	var chain []*AdminUser
	seen := make(map[string]bool)
	for current := strings.TrimSpace(owner); current != ""; {
		if seen[current] {
			return fmt.Errorf("reseller hierarchy cycle detected")
		}
		seen[current] = true
		u, ok := adminUsers.get(current)
		if !ok || u.Role != RoleReseller {
			return fmt.Errorf("reseller account not found")
		}
		chain = append(chain, u)
		current = strings.TrimSpace(u.ParentUsername)
	}
	for i := len(chain) - 1; i >= 0; i-- {
		state, err := resellerRuntimeStateFor(chain[i].Username, adminAccountChainActive(chain[i].Username) == nil)
		if err != nil {
			return err
		}
		payload := resellerRuntimePayloadFromState(state, "sync")
		if err := sendResellerRuntimeToServer(ctx, ms, payload); err != nil {
			return err
		}
	}
	return nil
}

// syncAllResellerRuntimeStates repairs legacy managed nodes after an upgrade.
// It runs asynchronously and never prevents the local panel from starting.
func startManagedResellerStateSync(store *Store) {
	if store == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		servers, err := store.ListManagedServers(ctx)
		if err != nil {
			log.Printf("reseller state sync: %v", err)
			return
		}
		users := adminUsers.list()
		sort.SliceStable(users, func(i, j int) bool {
			return resellerHierarchyDepth(users[i].Username) < resellerHierarchyDepth(users[j].Username)
		})
		for _, ms := range servers {
			for _, u := range users {
				if u.Role != RoleReseller {
					continue
				}
				action := "suspend"
				active := adminAccountChainActive(u.Username) == nil
				if active {
					action = "reactivate"
				}
				state, stateErr := resellerRuntimeStateFor(u.Username, active)
				if stateErr != nil {
					continue
				}
				if sendErr := sendResellerRuntimeToServer(ctx, ms, resellerRuntimePayloadFromState(state, action)); sendErr != nil {
					log.Printf("reseller state sync to %s for %s: %v", ms.Name, u.Username, sendErr)
					break
				}
			}
		}
	}()
}

// reconcileLocalResellerRuntimeStates reapplies replicated ownership state
// after a managed node restarts.
func reconcileLocalResellerRuntimeStates(store *Store) {
	if store == nil {
		return
	}
	ctx := context.Background()
	for _, state := range resellerRuntimeStates.list() {
		action := "suspend"
		if resellerRuntimeChainActive(state.OwnerUsername) == nil {
			action = "reactivate"
		}
		if err := applyOwnerRuntimeLocal(ctx, store, state.OwnerUsername, action); err != nil {
			log.Printf("reconcile local reseller runtime for %s: %v", state.OwnerUsername, err)
		}
	}
}

func resellerHierarchyDepth(username string) int {
	seen := make(map[string]bool)
	depth := 0
	for username != "" && depth < 128 {
		if seen[username] {
			return 128
		}
		seen[username] = true
		u, ok := adminUsers.get(username)
		if !ok {
			break
		}
		depth++
		username = strings.TrimSpace(u.ParentUsername)
	}
	return depth
}
