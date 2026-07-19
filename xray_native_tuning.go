package main

import (
	"runtime"
	"sync/atomic"
	"time"
)

type XrayNativeTuning struct {
	RuntimeGOMAXPROCS          int  `json:"runtime_gomaxprocs,omitempty"`
	MuxGlobalSessions          int  `json:"mux_global_sessions,omitempty"`
	MaxConcurrentConnections   int  `json:"max_concurrent_connections,omitempty"`
	MaxConcurrentXHTTPRequests int  `json:"max_concurrent_xhttp_requests,omitempty"`
	XHTTPMaxSessions           int  `json:"xhttp_max_sessions,omitempty"`
	TracePackets               bool `json:"trace_packets,omitempty"`
}

const (
	defaultNativeRuntimeGOMAXPROCS = 0
	defaultNativeMuxGlobalSessions = 32768
	defaultNativeMaxConnections    = 32768
	// XHTTP packet handlers are governed by HTTP/2 flow control and bounded byte
	// queues, not a website-style request ceiling. A negative configured value is
	// normalized to the internal unlimited representation.
	defaultNativeMaxXHTTPRequests = -1

	fixedNativeMuxMaxSessions    = 64
	fixedNativeMuxUDPIdleMS      = 120000
	fixedNativeMuxUDPReadBuffer  = 256 * 1024
	fixedNativeMuxUDPWriteBuffer = 256 * 1024

	defaultNativeXHTTPMaxSessions = 32768
	defaultNativeHTTP2MaxStreams  = 1024
	// Packet-up posts are also protected by byte budgets in xray_xhttp.go. Keep
	// the default reorder queue modest so thousands of unauthenticated sessions
	// cannot consume large amounts of memory merely by allocating empty channel
	// buffers. Operators may request more, up to the hard cap enforced there.
	defaultNativeXHTTPBufferedPosts = 64

	// Do not impose an application-level lifetime on a connected XHTTP VPN
	// session. The official Xray server keeps a connected session for the
	// lifetime of its stream-down GET; request cancellation and I/O errors own
	// cleanup. A fixed five-minute sweeper incorrectly killed healthy but idle
	// VPNs. Zero disables the connected-session sweeper.
	fixedNativeXHTTPIdleMS = 0
)

var (
	nativeTuneRuntimeGOMAXPROCS atomic.Int64
	nativeTuneMuxGlobalSessions atomic.Int64
	nativeTuneMaxConnections    atomic.Int64
	nativeTuneMaxXHTTPRequests  atomic.Int64
	nativeTuneXHTTPMaxSessions  atomic.Int64
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
	// Migrate the two profiles written by older panel builds. Those defaults were
	// sized like a web service (4K/8K sessions and a global request cap) and cause
	// valid high-volume XHTTP VPN traffic to be rejected after an upgrade unless
	// the persisted values are translated here.
	legacySafe := out.MaxConcurrentConnections == 4096 && out.MaxConcurrentXHTTPRequests == 8192 && out.XHTTPMaxSessions == 4096
	legacy2K := out.MaxConcurrentConnections == 8192 && out.MaxConcurrentXHTTPRequests == 16384 && out.XHTTPMaxSessions == 8192
	if legacySafe || legacy2K {
		out.MuxGlobalSessions = defaultNativeMuxGlobalSessions
		out.MaxConcurrentConnections = defaultNativeMaxConnections
		out.MaxConcurrentXHTTPRequests = defaultNativeMaxXHTTPRequests
		out.XHTTPMaxSessions = defaultNativeXHTTPMaxSessions
	}
	if out.RuntimeGOMAXPROCS < 0 {
		out.RuntimeGOMAXPROCS = defaultNativeRuntimeGOMAXPROCS
	}
	if out.MuxGlobalSessions <= 0 {
		out.MuxGlobalSessions = defaultNativeMuxGlobalSessions
	}
	if out.MaxConcurrentConnections == 0 {
		out.MaxConcurrentConnections = defaultNativeMaxConnections
	}
	if out.MaxConcurrentXHTTPRequests == 0 {
		out.MaxConcurrentXHTTPRequests = defaultNativeMaxXHTTPRequests
	}
	if out.XHTTPMaxSessions == 0 {
		out.XHTTPMaxSessions = defaultNativeXHTTPMaxSessions
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
	nativeTuneMaxConnections.Store(nativeLimitValue(out.MaxConcurrentConnections))
	nativeTuneMaxXHTTPRequests.Store(nativeLimitValue(out.MaxConcurrentXHTTPRequests))
	nativeTuneXHTTPMaxSessions.Store(nativeLimitValue(out.XHTTPMaxSessions))
	nativeTuneTracePackets.Store(out.TracePackets)
	return out
}

// Native tuning limits use zero internally for unlimited. In configuration,
// zero means "use the safe default" and any negative value disables the cap.
func nativeLimitValue(v int) int64 {
	if v < 0 {
		return 0
	}
	return int64(v)
}

func nativeRuntimeGOMAXPROCS() int     { return int(nativeTuneRuntimeGOMAXPROCS.Load()) }
func nativeMuxGlobalSessionLimit() int { return int(nativeTuneMuxGlobalSessions.Load()) }
func nativeMaxConnectionLimit() int    { return int(nativeTuneMaxConnections.Load()) }
func nativeMaxXHTTPRequestLimit() int  { return int(nativeTuneMaxXHTTPRequests.Load()) }
func nativeXHTTPMaxSessionLimit() int  { return int(nativeTuneXHTTPMaxSessions.Load()) }
func nativeTracePacketsEnabled() bool  { return nativeTuneTracePackets.Load() }

func nativeMuxMaxSessionLimit() int     { return fixedNativeMuxMaxSessions }
func nativeMuxUDPReadBufferSize() int   { return fixedNativeMuxUDPReadBuffer }
func nativeMuxUDPWriteBufferSize() int  { return fixedNativeMuxUDPWriteBuffer }
func nativeXHTTPBufferedPostLimit() int { return defaultNativeXHTTPBufferedPosts }
func nativeHTTP2MaxConcurrentStreams() uint32 {
	limit := nativeMaxXHTTPRequestLimit()
	if limit <= 0 || limit > defaultNativeHTTP2MaxStreams {
		return defaultNativeHTTP2MaxStreams
	}
	return uint32(limit)
}
func nativeMuxUDPIdleTimeout() time.Duration {
	return fixedNativeMuxUDPIdleMS * time.Millisecond
}
func nativeXHTTPIdleTimeout() time.Duration {
	return fixedNativeXHTTPIdleMS * time.Millisecond
}
