package main

import (
	"context"
	"database/sql"
	"log"
	"time"
)

// XrayClientMeta holds metadata stored in PostgreSQL for an Xray client.
// Xray's own config only stores uuid/email/level; expiry and display name live here.
type XrayClientMeta struct {
	UUID       string
	Name       string
	Email      string
	InboundTag string
	ExpiresAt  *time.Time
	MaxConns   int
	CreatedAt  time.Time
}

func (s *Store) EnsureXrayClientsSchema(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS xray_clients (
			uuid        TEXT PRIMARY KEY,
			name        TEXT NOT NULL DEFAULT '',
			email       TEXT NOT NULL DEFAULT '',
			inbound_tag TEXT NOT NULL DEFAULT '',
			expires_at  TIMESTAMPTZ,
			max_conns   INT NOT NULL DEFAULT 0,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`)
	return err
}

func (s *Store) UpsertXrayClientMeta(ctx context.Context, m XrayClientMeta) error {
	var expiresAt interface{}
	if m.ExpiresAt != nil {
		expiresAt = *m.ExpiresAt
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO xray_clients (uuid, name, email, inbound_tag, expires_at, max_conns)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (uuid) DO UPDATE SET
			name        = EXCLUDED.name,
			email       = EXCLUDED.email,
			inbound_tag = EXCLUDED.inbound_tag,
			expires_at  = EXCLUDED.expires_at,
			max_conns   = EXCLUDED.max_conns`,
		m.UUID, m.Name, m.Email, m.InboundTag, expiresAt, m.MaxConns)
	return err
}

func (s *Store) GetXrayClientMeta(ctx context.Context, uuid string) (*XrayClientMeta, error) {
	m := &XrayClientMeta{}
	var expiresAt sql.NullTime
	err := s.db.QueryRowContext(ctx, `
		SELECT uuid, name, email, inbound_tag, expires_at, max_conns, created_at
		FROM xray_clients WHERE uuid = $1`, uuid).
		Scan(&m.UUID, &m.Name, &m.Email, &m.InboundTag, &expiresAt, &m.MaxConns, &m.CreatedAt)
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
		SELECT uuid, name, email, inbound_tag, expires_at, max_conns, created_at
		FROM xray_clients ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*XrayClientMeta
	for rows.Next() {
		m := &XrayClientMeta{}
		var expiresAt sql.NullTime
		if err := rows.Scan(&m.UUID, &m.Name, &m.Email, &m.InboundTag, &expiresAt, &m.MaxConns, &m.CreatedAt); err != nil {
			return nil, err
		}
		if expiresAt.Valid {
			m.ExpiresAt = &expiresAt.Time
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) ListExpiredXrayClients(ctx context.Context) ([]*XrayClientMeta, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT uuid, name, email, inbound_tag, expires_at, max_conns, created_at
		FROM xray_clients WHERE expires_at IS NOT NULL AND expires_at <= NOW()`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*XrayClientMeta
	for rows.Next() {
		m := &XrayClientMeta{}
		var expiresAt sql.NullTime
		if err := rows.Scan(&m.UUID, &m.Name, &m.Email, &m.InboundTag, &expiresAt, &m.MaxConns, &m.CreatedAt); err != nil {
			return nil, err
		}
		if expiresAt.Valid {
			m.ExpiresAt = &expiresAt.Time
		}
		out = append(out, m)
	}
	return out, rows.Err()
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
