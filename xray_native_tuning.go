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
	// Transport sockets, XHTTP requests, and XHTTP sessions are VPN traffic, not
	// website requests. Keep the legacy JSON fields for config compatibility, but
	// always normalize them to unlimited. Actual resource protection is provided by
	// socket/HTTP flow control and the bounded byte queues in xray_xhttp.go.
	defaultNativeMaxConnections   = -1
	defaultNativeMaxXHTTPRequests = -1

	fixedNativeMuxMaxSessions    = 64
	fixedNativeMuxUDPIdleMS      = 120000
	fixedNativeMuxUDPReadBuffer  = 256 * 1024
	fixedNativeMuxUDPWriteBuffer = 256 * 1024

	defaultNativeXHTTPMaxSessions = -1
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
	// Ignore every old positive/zero admission ceiling. This migration is
	// deliberately unconditional so upgrading an existing server immediately
	// removes the old 4K/8K/32K web-style caps without requiring a panel save.
	out.MaxConcurrentConnections = defaultNativeMaxConnections
	out.MaxConcurrentXHTTPRequests = defaultNativeMaxXHTTPRequests
	out.XHTTPMaxSessions = defaultNativeXHTTPMaxSessions
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

func nativeRuntimeGOMAXPROCS() int     { return int(nativeTuneRuntimeGOMAXPROCS.Load()) }
func nativeMuxGlobalSessionLimit() int { return int(nativeTuneMuxGlobalSessions.Load()) }
func nativeTracePacketsEnabled() bool  { return nativeTuneTracePackets.Load() }

func nativeMuxMaxSessionLimit() int     { return fixedNativeMuxMaxSessions }
func nativeMuxUDPReadBufferSize() int   { return fixedNativeMuxUDPReadBuffer }
func nativeMuxUDPWriteBufferSize() int  { return fixedNativeMuxUDPWriteBuffer }
func nativeXHTTPBufferedPostLimit() int { return defaultNativeXHTTPBufferedPosts }
func nativeHTTP2MaxConcurrentStreams() uint32 {
	// x/net/http2 otherwise installs its own finite default when this is zero.
	// Advertise the protocol's full uint32 range so ordinary packet-up bursts can
	// never be refused by a website-style concurrent-stream setting.
	return ^uint32(0)
}
func nativeMuxUDPIdleTimeout() time.Duration {
	return fixedNativeMuxUDPIdleMS * time.Millisecond
}
func nativeXHTTPIdleTimeout() time.Duration {
	return fixedNativeXHTTPIdleMS * time.Millisecond
}
