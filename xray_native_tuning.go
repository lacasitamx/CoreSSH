package main

import (
	"runtime"
	"sync/atomic"
	"time"
)

// XrayNativeTuning holds the few operator-facing knobs for the in-process native
// Xray. Transport-shaping parameters (HTTP/2 flow control, the XHTTP reorder
// buffer, mux/UDP socket buffers) are intentionally NOT exposed: they are pinned
// to xray-core / Go defaults so they cannot be misconfigured into breakage. Only
// safe operational controls remain here: CPU parallelism, a global mux-session
// DoS cap, and a packet-level trace toggle for debugging.
type XrayNativeTuning struct {
	// RuntimeGOMAXPROCS controls Go CPU parallelism. 0 or negative = all cores.
	RuntimeGOMAXPROCS int `json:"runtime_gomaxprocs,omitempty"`
	// MuxGlobalSessions caps total concurrent mux child sessions across every
	// client connection (a DoS guard for the multi-tenant panel). 0 = default.
	MuxGlobalSessions int `json:"mux_global_sessions,omitempty"`
	// TracePackets enables very verbose per-packet XHTTP/mux logging. Debug only.
	TracePackets bool `json:"trace_packets,omitempty"`
}

const (
	defaultNativeRuntimeGOMAXPROCS = 0
	defaultNativeMuxGlobalSessions = 32768

	// Fixed transport defaults, aligned with xray-core / Go's net/http2. These are
	// deliberately not operator-tunable: wrong values silently break data flow.
	fixedNativeMuxMaxSessions    = 128        // per-connection mux child-session guard
	fixedNativeMuxUDPIdleMS      = 120000     // mux UDP backend idle cleanup (ms)
	fixedNativeMuxUDPReadBuffer  = 256 * 1024 // mux UDP socket read buffer
	fixedNativeMuxUDPWriteBuffer = 256 * 1024 // mux UDP socket write buffer

	// XHTTP: max tracked sessions (DoS guard) and the packet-up reorder buffer.
	// defaultNativeXHTTPBufferedPosts matches xray-core's scMaxBufferedPosts
	// default; the per-inbound scMaxBufferedPosts from the config still overrides
	// it, exactly like upstream.
	defaultNativeXHTTPMaxSessions   = 16384
	defaultNativeXHTTPBufferedPosts = 30
)

var (
	nativeTuneRuntimeGOMAXPROCS atomic.Int64
	nativeTuneMuxGlobalSessions atomic.Int64
	nativeTuneTracePackets      atomic.Bool
)

func init() {
	applyNativeXrayTuning(nil)
}

func normalizeNativeXrayTuning(t *XrayNativeTuning) XrayNativeTuning {
	if t == nil {
		t = &XrayNativeTuning{}
	}
	out := *t
	if out.RuntimeGOMAXPROCS < 0 {
		out.RuntimeGOMAXPROCS = defaultNativeRuntimeGOMAXPROCS
	}
	if out.MuxGlobalSessions <= 0 {
		out.MuxGlobalSessions = defaultNativeMuxGlobalSessions
	}
	return out
}

func applyNativeXrayTuning(t *XrayNativeTuning) XrayNativeTuning {
	out := normalizeNativeXrayTuning(t)
	gomax := out.RuntimeGOMAXPROCS
	if gomax <= 0 {
		gomax = runtime.NumCPU()
	}
	if gomax < 1 {
		gomax = 1
	}
	runtime.GOMAXPROCS(gomax)
	nativeTuneRuntimeGOMAXPROCS.Store(int64(gomax))
	nativeTuneMuxGlobalSessions.Store(int64(out.MuxGlobalSessions))
	nativeTuneTracePackets.Store(out.TracePackets)
	return out
}

// Operator-tunable values.
func nativeRuntimeGOMAXPROCS() int     { return int(nativeTuneRuntimeGOMAXPROCS.Load()) }
func nativeMuxGlobalSessionLimit() int { return int(nativeTuneMuxGlobalSessions.Load()) }
func nativeTracePacketsEnabled() bool  { return nativeTuneTracePackets.Load() }

// Fixed transport limits (see the const block for rationale).
func nativeMuxMaxSessionLimit() int     { return fixedNativeMuxMaxSessions }
func nativeMuxUDPReadBufferSize() int   { return fixedNativeMuxUDPReadBuffer }
func nativeMuxUDPWriteBufferSize() int  { return fixedNativeMuxUDPWriteBuffer }
func nativeXHTTPMaxSessionLimit() int   { return defaultNativeXHTTPMaxSessions }
func nativeXHTTPBufferedPostLimit() int { return defaultNativeXHTTPBufferedPosts }
func nativeMuxUDPIdleTimeout() time.Duration {
	return fixedNativeMuxUDPIdleMS * time.Millisecond
}
