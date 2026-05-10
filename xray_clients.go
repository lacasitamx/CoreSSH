package main

import (
	"context"
	"database/sql"
	"log"
	"time"
)

// XrayClientMeta holds metadata stored in PostgreSQL for an Xray client.
// Xray's own config only stores uuid/email/level; expiry, display name,
// reseller owner, and connection policy live here.
type XrayClientMeta struct {
	UUID          string
	Name          string
	Email         string
	InboundTag    string
	OwnerUsername string
	ExpiresAt     *time.Time
	MaxConns      int
	CreatedAt     time.Time
}

func (s *Store) EnsureXrayClientsSchema(ctx context.Context) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS xray_clients (
			uuid           TEXT PRIMARY KEY,
			name           TEXT NOT NULL DEFAULT '',
			email          TEXT NOT NULL DEFAULT '',
			inbound_tag    TEXT NOT NULL DEFAULT '',
			owner_username TEXT NOT NULL DEFAULT '',
			expires_at     TIMESTAMPTZ,
			max_conns      INT NOT NULL DEFAULT 0,
			created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`ALTER TABLE xray_clients ADD COLUMN IF NOT EXISTS owner_username TEXT NOT NULL DEFAULT ''`,
	}
	for _, stmt := range stmts {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) UpsertXrayClientMeta(ctx context.Context, m XrayClientMeta) error {
	var expiresAt interface{}
	if m.ExpiresAt != nil {
		expiresAt = *m.ExpiresAt
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO xray_clients (uuid, name, email, inbound_tag, owner_username, expires_at, max_conns)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (uuid) DO UPDATE SET
			name           = EXCLUDED.name,
			email          = EXCLUDED.email,
			inbound_tag    = CASE WHEN EXCLUDED.inbound_tag <> '' THEN EXCLUDED.inbound_tag ELSE xray_clients.inbound_tag END,
			owner_username = CASE WHEN EXCLUDED.owner_username <> '' THEN EXCLUDED.owner_username ELSE xray_clients.owner_username END,
			expires_at     = EXCLUDED.expires_at,
			max_conns      = EXCLUDED.max_conns`,
		m.UUID, m.Name, m.Email, m.InboundTag, m.OwnerUsername, expiresAt, m.MaxConns)
	return err
}

func (s *Store) GetXrayClientMeta(ctx context.Context, uuid string) (*XrayClientMeta, error) {
	m := &XrayClientMeta{}
	var expiresAt sql.NullTime
	err := s.db.QueryRowContext(ctx, `
		SELECT uuid, name, email, inbound_tag, COALESCE(owner_username, ''), expires_at, max_conns, created_at
		FROM xray_clients WHERE uuid = $1`, uuid).
		Scan(&m.UUID, &m.Name, &m.Email, &m.InboundTag, &m.OwnerUsername, &expiresAt, &m.MaxConns, &m.CreatedAt)
	if err != nil {
		return nil, err
	}
	if expiresAt.Valid {
		m.ExpiresAt = &expiresAt.Time
	}
	return m, nil
}

func (s *Store) DeleteXrayClientMeta(ctx context.Context, uuid string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM xray_clients WHERE uuid = $1`, uuid)
	return err
}

func (s *Store) ListAllXrayClients(ctx context.Context) ([]*XrayClientMeta, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT uuid, name, email, inbound_tag, COALESCE(owner_username, ''), expires_at, max_conns, created_at
		FROM xray_clients ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanXrayClientMetaRows(rows)
}

func (s *Store) ListXrayClientsByOwner(ctx context.Context, ownerUsername string) ([]*XrayClientMeta, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT uuid, name, email, inbound_tag, COALESCE(owner_username, ''), expires_at, max_conns, created_at
		FROM xray_clients WHERE owner_username = $1 ORDER BY created_at DESC`, ownerUsername)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanXrayClientMetaRows(rows)
}

func (s *Store) CountXrayClientsByOwner(ctx context.Context, ownerUsername string) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM xray_clients WHERE owner_username = $1`, ownerUsername).Scan(&n)
	return n, err
}

func (s *Store) ListExpiredXrayClients(ctx context.Context) ([]*XrayClientMeta, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT uuid, name, email, inbound_tag, COALESCE(owner_username, ''), expires_at, max_conns, created_at
		FROM xray_clients WHERE expires_at IS NOT NULL AND expires_at <= NOW()`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanXrayClientMetaRows(rows)
}

func scanXrayClientMetaRows(rows *sql.Rows) ([]*XrayClientMeta, error) {
	var out []*XrayClientMeta
	for rows.Next() {
		m := &XrayClientMeta{}
		var expiresAt sql.NullTime
		if err := rows.Scan(&m.UUID, &m.Name, &m.Email, &m.InboundTag, &m.OwnerUsername, &expiresAt, &m.MaxConns, &m.CreatedAt); err != nil {
			return nil, err
		}
		if expiresAt.Valid {
			m.ExpiresAt = &expiresAt.Time
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func countOwnedXrayClients(ctx context.Context, store *Store, ownerUsername string) int {
	if store == nil || ownerUsername == "" {
		return 0
	}
	n, err := store.CountXrayClientsByOwner(ctx, ownerUsername)
	if err != nil {
		log.Printf("count xray clients for %s: %v", ownerUsername, err)
		return 0
	}
	return n
}

func countOwnedQuota(ctx context.Context, store *Store, ownerUsername string) int {
	return countOwnedUsers(ownerUsername) + countOwnedXrayClients(ctx, store, ownerUsername)
}

func removeOwnerXrayClients(ctx context.Context, store *Store, ownerUsername string) {
	if store == nil || ownerUsername == "" {
		return
	}
	clients, err := store.ListXrayClientsByOwner(ctx, ownerUsername)
	if err != nil {
		log.Printf("xray owner cleanup: list %s: %v", ownerUsername, err)
		return
	}
	needRestart := false
	for _, m := range clients {
		if m.InboundTag != "" {
			if err := xrayMgr.RemoveXrayClient(m.InboundTag, m.UUID); err != nil {
				log.Printf("xray owner cleanup: remove %s from %s: %v", m.UUID, m.InboundTag, err)
			} else {
				needRestart = true
			}
		}
		if err := store.DeleteXrayClientMeta(ctx, m.UUID); err != nil {
			log.Printf("xray owner cleanup: delete meta %s: %v", m.UUID, err)
		}
	}
	if needRestart {
		if err := xrayMgr.Restart(); err != nil {
			log.Printf("xray owner cleanup: restart: %v", err)
		}
	}
}

// startXrayClientExpiryChecker runs a background goroutine that removes expired
// Xray clients from both the config file and the database every 5 minutes.
func startXrayClientExpiryChecker(store *Store) {
	if store == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			ctx := context.Background()
			expired, err := store.ListExpiredXrayClients(ctx)
			if err != nil {
				log.Printf("xray expiry checker: list error: %v", err)
				continue
			}
			if len(expired) == 0 {
				continue
			}
			needRestart := false
			for _, m := range expired {
				tag := m.InboundTag
				if tag == "" {
					_ = store.DeleteXrayClientMeta(ctx, m.UUID)
					continue
				}
				if err := xrayMgr.RemoveXrayClient(tag, m.UUID); err != nil {
					log.Printf("xray expiry: remove %s from %s: %v", m.UUID, tag, err)
				} else {
					needRestart = true
				}
				if err := store.DeleteXrayClientMeta(ctx, m.UUID); err != nil {
					log.Printf("xray expiry: delete meta %s: %v", m.UUID, err)
				}
				log.Printf("xray expiry: removed expired client %q (%s) from inbound %s", m.Name, m.UUID, tag)
			}
			if needRestart {
				if err := xrayMgr.Restart(); err != nil {
					log.Printf("xray expiry: restart error: %v", err)
				}
			}
		}
	}()
}
