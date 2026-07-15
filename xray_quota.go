package main

import (
	"context"
	"io"
	"strings"
	"sync"

	"golang.org/x/time/rate"
)

type xrayNativeQuotaState struct {
	mu           sync.Mutex
	usedBytes    int64
	quotaBytes   int64
	action       string
	throttleMbps int
	limiter      *rate.Limiter
	generation   uint64
}

func (m *XrayManager) reloadNativeQuotaPolicies() {
	if statsStore == nil {
		return
	}
	metas, err := statsStore.ListAllXrayClients(context.Background())
	if err != nil {
		xrayLogf("xray native quota: load policies failed: %v", err)
		return
	}
	next := make(map[string]*xrayNativeQuotaState, len(metas))
	for _, meta := range metas {
		if meta == nil || strings.TrimSpace(meta.UUID) == "" {
			continue
		}
		next[meta.UUID] = newXrayNativeQuotaState(meta)
	}
	m.nativeQuotaMu.Lock()
	m.nativeQuotaByUUID = next
	m.nativeQuotaMu.Unlock()
}

func newXrayNativeQuotaState(meta *XrayClientMeta) *xrayNativeQuotaState {
	used := meta.TotalUplinkBytes + meta.TotalDownlinkBytes
	if used < 0 {
		used = 0
	}
	return &xrayNativeQuotaState{
		usedBytes:    used,
		quotaBytes:   meta.DataQuotaBytes,
		action:       normalizeQuotaAction(meta.QuotaAction),
		throttleMbps: quotaThrottleMbpsOrDefault(meta.QuotaThrottleMbps),
		generation:   1,
	}
}

func (m *XrayManager) setNativeQuotaPolicy(meta *XrayClientMeta) {
	if meta == nil || strings.TrimSpace(meta.UUID) == "" {
		return
	}
	uuid := strings.TrimSpace(meta.UUID)
	m.nativeQuotaMu.Lock()
	if m.nativeQuotaByUUID == nil {
		m.nativeQuotaByUUID = make(map[string]*xrayNativeQuotaState)
	}
	existing := m.nativeQuotaByUUID[uuid]
	if existing == nil {
		m.nativeQuotaByUUID[uuid] = newXrayNativeQuotaState(meta)
		m.nativeQuotaMu.Unlock()
		return
	}
	m.nativeQuotaMu.Unlock()

	existing.mu.Lock()
	existing.quotaBytes = meta.DataQuotaBytes
	existing.action = normalizeQuotaAction(meta.QuotaAction)
	existing.throttleMbps = quotaThrottleMbpsOrDefault(meta.QuotaThrottleMbps)
	existing.limiter = nil
	existing.mu.Unlock()
}

func (m *XrayManager) removeNativeQuotaPolicy(uuid string) {
	uuid = strings.TrimSpace(uuid)
	if uuid == "" {
		return
	}
	m.nativeQuotaMu.Lock()
	delete(m.nativeQuotaByUUID, uuid)
	m.nativeQuotaMu.Unlock()
}

func (m *XrayManager) resetNativeQuotaUsage(uuid string) {
	uuid = strings.TrimSpace(uuid)
	m.nativeQuotaMu.RLock()
	state := m.nativeQuotaByUUID[uuid]
	m.nativeQuotaMu.RUnlock()
	if state == nil {
		return
	}
	state.mu.Lock()
	state.usedBytes = 0
	state.limiter = nil
	state.generation++
	if state.generation == 0 {
		state.generation = 1
	}
	state.mu.Unlock()
}

func (m *XrayManager) nativeQuotaGeneration(uuid string) uint64 {
	state := m.nativeQuotaState(uuid)
	if state == nil {
		return 0
	}
	state.mu.Lock()
	generation := state.generation
	state.mu.Unlock()
	return generation
}

func (m *XrayManager) resetNativeTrafficAccounting(ctx context.Context, store *Store, uuid, email string) error {
	state := m.nativeQuotaState(uuid)
	if state != nil {
		state.mu.Lock()
		defer state.mu.Unlock()
	}

	m.nativeTrafficPersistMu.Lock()
	defer m.nativeTrafficPersistMu.Unlock()
	m.nativeDBMu.Lock()
	key := strings.TrimSpace(uuid)
	var pending xrayPendingTraffic
	hadPending := false
	if m.nativeTrafficPending != nil {
		pending, hadPending = m.nativeTrafficPending[key]
		delete(m.nativeTrafficPending, key)
	}
	err := store.ResetXrayClientTraffic(ctx, uuid)
	if err != nil && hadPending {
		if m.nativeTrafficPending == nil {
			m.nativeTrafficPending = make(map[string]xrayPendingTraffic)
		}
		m.nativeTrafficPending[key] = pending
	}
	m.nativeDBMu.Unlock()
	if err != nil {
		return err
	}
	if state != nil {
		state.usedBytes = 0
		state.limiter = nil
		state.generation++
		if state.generation == 0 {
			state.generation = 1
		}
	}

	m.statsMu.Lock()
	for _, key := range []string{strings.TrimSpace(email), strings.TrimSpace(uuid)} {
		if key == "" {
			continue
		}
		if runtime, ok := m.statsByEmail[key]; ok {
			runtime.Uplink = 0
			runtime.Downlink = 0
			m.statsByEmail[key] = runtime
		}
	}
	m.statsMu.Unlock()
	return nil
}

func (m *XrayManager) nativeQuotaState(uuid string) *xrayNativeQuotaState {
	m.nativeQuotaMu.RLock()
	state := m.nativeQuotaByUUID[strings.TrimSpace(uuid)]
	m.nativeQuotaMu.RUnlock()
	return state
}

func (m *XrayManager) nativeQuotaBlocked(uuid string) bool {
	state := m.nativeQuotaState(uuid)
	if state == nil {
		return false
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	return state.quotaBytes > 0 && normalizeQuotaAction(state.action) == quotaActionBlock && state.usedBytes >= state.quotaBytes
}

func (m *XrayManager) reserveNativeQuota(uuid string, requested int) (allowed int, limiter *rate.Limiter, stopAfter bool) {
	if requested <= 0 {
		return 0, nil, false
	}
	state := m.nativeQuotaState(uuid)
	if state == nil {
		return requested, nil, false
	}
	state.mu.Lock()
	defer state.mu.Unlock()

	n := int64(requested)
	if state.quotaBytes <= 0 {
		state.usedBytes += n
		return requested, nil, false
	}
	if normalizeQuotaAction(state.action) == quotaActionThrottle {
		previous := state.usedBytes
		state.usedBytes += n
		if previous+n > state.quotaBytes {
			if state.limiter == nil {
				bps := mbpsToBytesPerSec(quotaThrottleMbpsOrDefault(state.throttleMbps))
				burst := int(bps)
				if burst < copyBufSize {
					burst = copyBufSize
				}
				state.limiter = rate.NewLimiter(rate.Limit(bps), burst)
			}
			return requested, state.limiter, false
		}
		return requested, nil, false
	}

	remaining := state.quotaBytes - state.usedBytes
	if remaining <= 0 {
		return 0, nil, true
	}
	take := n
	if take > remaining {
		take = remaining
	}
	state.usedBytes += take
	return int(take), nil, take < n
}

func (m *XrayManager) finishNativeQuotaReservation(uuid string, reserved, written int) {
	if reserved <= 0 || written >= reserved {
		return
	}
	if written < 0 {
		written = 0
	}
	state := m.nativeQuotaState(uuid)
	if state == nil {
		return
	}
	state.mu.Lock()
	state.usedBytes -= int64(reserved - written)
	if state.usedBytes < 0 {
		state.usedBytes = 0
	}
	state.mu.Unlock()
}

type xrayQuotaMeteredWriter struct {
	w     io.Writer
	meter *trafficMeter
}

func (mw xrayQuotaMeteredWriter) Write(p []byte) (int, error) {
	if mw.meter == nil {
		return mw.w.Write(p)
	}
	allowed, limiter, stopAfter := xrayMgr.reserveNativeQuota(mw.meter.uuid, len(p))
	if allowed <= 0 {
		return 0, errDataQuotaExceeded
	}
	if limiter != nil {
		if err := limiter.WaitN(context.Background(), allowed); err != nil {
			xrayMgr.finishNativeQuotaReservation(mw.meter.uuid, allowed, 0)
			return 0, err
		}
	}
	n, err := mw.w.Write(p[:allowed])
	xrayMgr.finishNativeQuotaReservation(mw.meter.uuid, allowed, n)
	if n > 0 {
		mw.meter.add(n)
	}
	if err != nil {
		return n, err
	}
	if stopAfter || allowed < len(p) || xrayMgr.nativeQuotaBlocked(mw.meter.uuid) {
		return n, errDataQuotaExceeded
	}
	return n, nil
}

func reserveNativePacketQuota(meter *trafficMeter, n int) (*rate.Limiter, error) {
	if meter == nil || n <= 0 {
		return nil, nil
	}
	allowed, limiter, stopAfter := xrayMgr.reserveNativeQuota(meter.uuid, n)
	if allowed != n || stopAfter {
		if allowed > 0 {
			xrayMgr.finishNativeQuotaReservation(meter.uuid, allowed, 0)
		}
		return nil, errDataQuotaExceeded
	}
	return limiter, nil
}

func finishNativePacketQuota(meter *trafficMeter, reserved, written int) {
	if meter == nil || reserved <= 0 {
		return
	}
	xrayMgr.finishNativeQuotaReservation(meter.uuid, reserved, written)
	if written > 0 {
		meter.add(written)
	}
}
