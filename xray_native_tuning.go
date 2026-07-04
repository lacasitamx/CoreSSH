package main

import (
	"sync/atomic"
	"time"
)

// XrayNativeTuning contains native-emulator performance limits that are edited
// from the admin panel and saved in config.json under xray.native_tuning.
// Values are process/runtime settings, not generated Xray JSON settings.
type XrayNativeTuning struct {
	MuxMaxSessions         int  `json:"mux_max_sessions,omitempty"`
	MuxGlobalSessions      int  `json:"mux_global_sessions,omitempty"`
	MuxUDPIdleMS           int  `json:"mux_udp_idle_ms,omitempty"`
	MuxUDPReadBuffer       int  `json:"mux_udp_read_buffer,omitempty"`
	MuxUDPWriteBuffer      int  `json:"mux_udp_write_buffer,omitempty"`
	XHTTPMaxSessions       int  `json:"xhttp_max_sessions,omitempty"`
	XHTTPBufferedPosts     int  `json:"xhttp_buffered_posts,omitempty"`
	XHTTPQueueTimeoutMS    int  `json:"xhttp_queue_timeout_ms,omitempty"`
	XHTTPFlushMS           int  `json:"xhttp_flush_ms,omitempty"`
	XHTTPFlushBytes        int  `json:"xhttp_flush_bytes,omitempty"`
	H2MaxConcurrentStreams int  `json:"h2_max_concurrent_streams,omitempty"`
	H2UploadBufferConn     int  `json:"h2_upload_buffer_conn,omitempty"`
	H2UploadBufferStream   int  `json:"h2_upload_buffer_stream,omitempty"`
	TracePackets           bool `json:"trace_packets,omitempty"`
}

const (
	defaultNativeMuxMaxSessions         = 128
	defaultNativeMuxGlobalSessions      = 32768
	defaultNativeMuxUDPIdleMS           = 15000
	defaultNativeMuxUDPReadBuffer       = 256 * 1024
	defaultNativeMuxUDPWriteBuffer      = 256 * 1024
	defaultNativeXHTTPMaxSessions       = 16384
	defaultNativeXHTTPBufferedPosts     = 64
	defaultNativeXHTTPQueueTimeoutMS    = 250
	defaultNativeXHTTPFlushMS           = 5
	defaultNativeXHTTPFlushBytes        = 128 * 1024
	defaultNativeH2MaxConcurrentStreams = 1024
	defaultNativeH2UploadBufferConn     = 1 * 1024 * 1024
	defaultNativeH2UploadBufferStream   = 256 * 1024
)

var (
	nativeTuneMuxMaxSessions         atomic.Int64
	nativeTuneMuxGlobalSessions      atomic.Int64
	nativeTuneMuxUDPIdleMS           atomic.Int64
	nativeTuneMuxUDPReadBuffer       atomic.Int64
	nativeTuneMuxUDPWriteBuffer      atomic.Int64
	nativeTuneXHTTPMaxSessions       atomic.Int64
	nativeTuneXHTTPBufferedPosts     atomic.Int64
	nativeTuneXHTTPQueueTimeoutMS    atomic.Int64
	nativeTuneXHTTPFlushMS           atomic.Int64
	nativeTuneXHTTPFlushBytes        atomic.Int64
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
	if out.XHTTPQueueTimeoutMS <= 0 {
		out.XHTTPQueueTimeoutMS = defaultNativeXHTTPQueueTimeoutMS
	}
	if out.XHTTPFlushMS <= 0 {
		out.XHTTPFlushMS = defaultNativeXHTTPFlushMS
	}
	if out.XHTTPFlushBytes <= 0 {
		out.XHTTPFlushBytes = defaultNativeXHTTPFlushBytes
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
	nativeTuneMuxMaxSessions.Store(int64(out.MuxMaxSessions))
	nativeTuneMuxGlobalSessions.Store(int64(out.MuxGlobalSessions))
	nativeTuneMuxUDPIdleMS.Store(int64(out.MuxUDPIdleMS))
	nativeTuneMuxUDPReadBuffer.Store(int64(out.MuxUDPReadBuffer))
	nativeTuneMuxUDPWriteBuffer.Store(int64(out.MuxUDPWriteBuffer))
	nativeTuneXHTTPMaxSessions.Store(int64(out.XHTTPMaxSessions))
	nativeTuneXHTTPBufferedPosts.Store(int64(out.XHTTPBufferedPosts))
	nativeTuneXHTTPQueueTimeoutMS.Store(int64(out.XHTTPQueueTimeoutMS))
	nativeTuneXHTTPFlushMS.Store(int64(out.XHTTPFlushMS))
	nativeTuneXHTTPFlushBytes.Store(int64(out.XHTTPFlushBytes))
	nativeTuneH2MaxConcurrentStreams.Store(int64(out.H2MaxConcurrentStreams))
	nativeTuneH2UploadBufferConn.Store(int64(out.H2UploadBufferConn))
	nativeTuneH2UploadBufferStream.Store(int64(out.H2UploadBufferStream))
	nativeTuneTracePackets.Store(out.TracePackets)
	return out
}

func nativeMuxMaxSessionLimit() int    { return int(nativeTuneMuxMaxSessions.Load()) }
func nativeMuxGlobalSessionLimit() int { return int(nativeTuneMuxGlobalSessions.Load()) }
func nativeMuxUDPIdleTimeout() time.Duration {
	return time.Duration(nativeTuneMuxUDPIdleMS.Load()) * time.Millisecond
}
func nativeMuxUDPReadBufferSize() int   { return int(nativeTuneMuxUDPReadBuffer.Load()) }
func nativeMuxUDPWriteBufferSize() int  { return int(nativeTuneMuxUDPWriteBuffer.Load()) }
func nativeXHTTPMaxSessionLimit() int   { return int(nativeTuneXHTTPMaxSessions.Load()) }
func nativeXHTTPBufferedPostLimit() int { return int(nativeTuneXHTTPBufferedPosts.Load()) }
func nativeXHTTPQueuePushTimeoutDuration() time.Duration {
	return time.Duration(nativeTuneXHTTPQueueTimeoutMS.Load()) * time.Millisecond
}
func nativeXHTTPFlushIntervalDuration() time.Duration {
	return time.Duration(nativeTuneXHTTPFlushMS.Load()) * time.Millisecond
}
func nativeXHTTPFlushByteLimit() int    { return int(nativeTuneXHTTPFlushBytes.Load()) }
func nativeH2MaxConcurrentStreams() int { return int(nativeTuneH2MaxConcurrentStreams.Load()) }
func nativeH2UploadBufferConn() int     { return int(nativeTuneH2UploadBufferConn.Load()) }
func nativeH2UploadBufferStream() int   { return int(nativeTuneH2UploadBufferStream.Load()) }
func nativeTracePacketsEnabled() bool   { return nativeTuneTracePackets.Load() }
