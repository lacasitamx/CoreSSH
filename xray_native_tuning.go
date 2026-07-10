package main

import (
	"runtime"
	"sync/atomic"
	"time"
)

type XrayNativeTuning struct {
	RuntimeGOMAXPROCS int  `json:"runtime_gomaxprocs,omitempty"`
	MuxGlobalSessions int  `json:"mux_global_sessions,omitempty"`
	TracePackets      bool `json:"trace_packets,omitempty"`
}

const (
	defaultNativeRuntimeGOMAXPROCS = 0
	defaultNativeMuxGlobalSessions = 32768

	fixedNativeMuxMaxSessions    = 128
	fixedNativeMuxUDPIdleMS      = 120000
	fixedNativeMuxUDPReadBuffer  = 256 * 1024
	fixedNativeMuxUDPWriteBuffer = 256 * 1024

	defaultNativeXHTTPMaxSessions   = 16384
	defaultNativeXHTTPBufferedPosts = 512

	// Connected XHTTP sessions are torn down primarily by request-context
	// cancellation. This idle timeout is the backstop that reaps a connected
	// session whose client vanished without the transport ever reporting it
	// (common for XHTTP behind a CDN, where no TCP FIN reaches the origin).
	// Matches the SSH idle default so a genuinely idle-but-live tunnel is not
	// closed prematurely.
	fixedNativeXHTTPIdleMS = 300000
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

func nativeRuntimeGOMAXPROCS() int     { return int(nativeTuneRuntimeGOMAXPROCS.Load()) }
func nativeMuxGlobalSessionLimit() int { return int(nativeTuneMuxGlobalSessions.Load()) }
func nativeTracePacketsEnabled() bool  { return nativeTuneTracePackets.Load() }

func nativeMuxMaxSessionLimit() int     { return fixedNativeMuxMaxSessions }
func nativeMuxUDPReadBufferSize() int   { return fixedNativeMuxUDPReadBuffer }
func nativeMuxUDPWriteBufferSize() int  { return fixedNativeMuxUDPWriteBuffer }
func nativeXHTTPMaxSessionLimit() int   { return defaultNativeXHTTPMaxSessions }
func nativeXHTTPBufferedPostLimit() int { return defaultNativeXHTTPBufferedPosts }
func nativeMuxUDPIdleTimeout() time.Duration {
	return fixedNativeMuxUDPIdleMS * time.Millisecond
}
func nativeXHTTPIdleTimeout() time.Duration {
	return fixedNativeXHTTPIdleMS * time.Millisecond
}
