package main

import (
	"runtime"
	"sync/atomic"
	"time"
)

// XrayNativeTuning contains native-emulator performance limits that are edited
// from the admin panel and saved in config.json under xray.native_tuning.
// Values are process/runtime settings, not generated Xray JSON settings.
type XrayNativeTuning struct {
	// RuntimeGOMAXPROCS controls Go CPU parallelism for the in-process native Xray.
	// 0 or negative means use all detected CPU cores.
	RuntimeGOMAXPROCS      int  `json:"runtime_gomaxprocs,omitempty"`
	MuxMaxSessions         int  `json:"mux_max_sessions,omitempty"`
	MuxGlobalSessions      int  `json:"mux_global_sessions,omitempty"`
	MuxUDPIdleMS           int  `json:"mux_udp_idle_ms,omitempty"`
	MuxUDPReadBuffer       int  `json:"mux_udp_read_buffer,omitempty"`
	MuxUDPWriteBuffer      int  `json:"mux_udp_write_buffer,omitempty"`
	XHTTPMaxSessions       int  `json:"xhttp_max_sessions,omitempty"`
	XHTTPBufferedPosts     int  `json:"xhttp_buffered_posts,omitempty"`
	H2MaxConcurrentStreams int  `json:"h2_max_concurrent_streams,omitempty"`
	H2UploadBufferConn     int  `json:"h2_upload_buffer_conn,omitempty"`
	H2UploadBufferStream   int  `json:"h2_upload_buffer_stream,omitempty"`
	TracePackets           bool `json:"trace_packets,omitempty"`
}

const (
	defaultNativeRuntimeGOMAXPROCS      = 0
	defaultNativeMuxMaxSessions         = 128
	defaultNativeMuxGlobalSessions      = 32768
	defaultNativeMuxUDPIdleMS           = 120000
	defaultNativeMuxUDPReadBuffer       = 256 * 1024
	defaultNativeMuxUDPWriteBuffer      = 256 * 1024
	defaultNativeXHTTPMaxSessions       = 16384
	defaultNativeXHTTPBufferedPosts     = 256
	defaultNativeH2MaxConcurrentStreams = 1024
	defaultNativeH2UploadBufferConn     = 1 * 1024 * 1024
	defaultNativeH2UploadBufferStream   = 256 * 1024
)

var (
	nativeTuneRuntimeGOMAXPROCS      atomic.Int64
	nativeTuneMuxMaxSessions         atomic.Int64
	nativeTuneMuxGlobalSessions      atomic.Int64
	nativeTuneMuxUDPIdleMS           atomic.Int64
	nativeTuneMuxUDPReadBuffer       atomic.Int64
	nativeTuneMuxUDPWriteBuffer      atomic.Int64
	nativeTuneXHTTPMaxSessions       atomic.Int64
	nativeTuneXHTTPBufferedPosts     atomic.Int64
	nativeTuneH2MaxConcurrentStreams atomic.Int64
	nativeTuneH2UploadBufferConn     atomic.Int64
	nativeTuneH2UploadBufferStream   atomic.Int64
	nativeTuneTracePackets           atomic.Bool
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
	if out.MuxMaxSessions <= 0 {
		out.MuxMaxSessions = defaultNativeMuxMaxSessions
	}
	if out.MuxGlobalSessions <= 0 {
		out.MuxGlobalSessions = defaultNativeMuxGlobalSessions
	}
	if out.MuxUDPIdleMS <= 0 {
		out.MuxUDPIdleMS = defaultNativeMuxUDPIdleMS
	}
	if out.MuxUDPReadBuffer <= 0 {
		out.MuxUDPReadBuffer = defaultNativeMuxUDPReadBuffer
	}
	if out.MuxUDPWriteBuffer <= 0 {
		out.MuxUDPWriteBuffer = defaultNativeMuxUDPWriteBuffer
	}
	if out.XHTTPMaxSessions <= 0 {
		out.XHTTPMaxSessions = defaultNativeXHTTPMaxSessions
	}
	if out.XHTTPBufferedPosts <= 0 {
		out.XHTTPBufferedPosts = defaultNativeXHTTPBufferedPosts
	}
	if out.H2MaxConcurrentStreams <= 0 {
		out.H2MaxConcurrentStreams = defaultNativeH2MaxConcurrentStreams
	}
	if out.H2UploadBufferConn <= 0 {
		out.H2UploadBufferConn = defaultNativeH2UploadBufferConn
	}
	if out.H2UploadBufferStream <= 0 {
		out.H2UploadBufferStream = defaultNativeH2UploadBufferStream
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
	nativeTuneMuxMaxSessions.Store(int64(out.MuxMaxSessions))
	nativeTuneMuxGlobalSessions.Store(int64(out.MuxGlobalSessions))
	nativeTuneMuxUDPIdleMS.Store(int64(out.MuxUDPIdleMS))
	nativeTuneMuxUDPReadBuffer.Store(int64(out.MuxUDPReadBuffer))
	nativeTuneMuxUDPWriteBuffer.Store(int64(out.MuxUDPWriteBuffer))
	nativeTuneXHTTPMaxSessions.Store(int64(out.XHTTPMaxSessions))
	nativeTuneXHTTPBufferedPosts.Store(int64(out.XHTTPBufferedPosts))
	nativeTuneH2MaxConcurrentStreams.Store(int64(out.H2MaxConcurrentStreams))
	nativeTuneH2UploadBufferConn.Store(int64(out.H2UploadBufferConn))
	nativeTuneH2UploadBufferStream.Store(int64(out.H2UploadBufferStream))
	nativeTuneTracePackets.Store(out.TracePackets)
	return out
}

func nativeRuntimeGOMAXPROCS() int     { return int(nativeTuneRuntimeGOMAXPROCS.Load()) }
func nativeMuxMaxSessionLimit() int    { return int(nativeTuneMuxMaxSessions.Load()) }
func nativeMuxGlobalSessionLimit() int { return int(nativeTuneMuxGlobalSessions.Load()) }
func nativeMuxUDPIdleTimeout() time.Duration {
	return time.Duration(nativeTuneMuxUDPIdleMS.Load()) * time.Millisecond
}
func nativeMuxUDPReadBufferSize() int   { return int(nativeTuneMuxUDPReadBuffer.Load()) }
func nativeMuxUDPWriteBufferSize() int  { return int(nativeTuneMuxUDPWriteBuffer.Load()) }
func nativeXHTTPMaxSessionLimit() int   { return int(nativeTuneXHTTPMaxSessions.Load()) }
func nativeXHTTPBufferedPostLimit() int { return int(nativeTuneXHTTPBufferedPosts.Load()) }
func nativeH2MaxConcurrentStreams() int { return int(nativeTuneH2MaxConcurrentStreams.Load()) }
func nativeH2UploadBufferConn() int     { return int(nativeTuneH2UploadBufferConn.Load()) }
func nativeH2UploadBufferStream() int   { return int(nativeTuneH2UploadBufferStream.Load()) }
func nativeTracePacketsEnabled() bool   { return nativeTuneTracePackets.Load() }
