package main

import (
	"net"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"
)

const nativeOverloadBackoff = 10 * time.Millisecond

// xrayRecover prevents a bad client packet, closed HTTP stream, or mux/session
// race from taking down the whole sshpanel process. A panic should only kill the
// current native Xray connection/session and must always leave a visible stack
// trace in /api/xray/logs and journald.
func xrayRecover(where string) {
	if r := recover(); r != nil {
		xrayLogf("native xray: panic recovered in %s: %v\n%s", where, r, debug.Stack())
	}
}

func xrayGo(where string, fn func()) {
	go func() {
		defer xrayRecover(where)
		fn()
	}()
}

func init() {
	// Direct native-inbound tests and embedders may run an accept loop without
	// the singleton server start method. Production stop() flips this to false.
	nativeTransportAccepting.Store(true)
}

var (
	nativeTransportConnections  atomic.Int64
	nativeTransportRejected     atomic.Int64
	nativeXHTTPRequests         atomic.Int64
	nativeXHTTPRequestsRejected atomic.Int64
	nativeXHTTPSessions         atomic.Int64
	nativeXHTTPSessionsRejected atomic.Int64
	nativeClientConnsRejected   atomic.Int64
	nativePreAuthRejected       atomic.Int64

	nativeTransportAccepting atomic.Bool
	nativeTransportRegistry  = struct {
		sync.Mutex
		conns map[*nativeCountedConn]struct{}
	}{conns: make(map[*nativeCountedConn]struct{})}
)

// acquireNativeCounter reserves one slot without blocking. Blocking the accept
// loop or an HTTP handler when the process is already at its safety ceiling
// would retain yet more sockets/goroutines, so overload is rejected promptly.
func acquireNativeCounter(active *atomic.Int64, limit int) (func(), bool) {
	for {
		current := active.Load()
		if limit > 0 && current >= int64(limit) {
			return nil, false
		}
		if active.CompareAndSwap(current, current+1) {
			var once sync.Once
			return func() {
				once.Do(func() {
					if active.Add(-1) < 0 {
						active.Store(0)
					}
				})
			}, true
		}
	}
}

func shouldLogNativeSample(counter *atomic.Int64) (n int64, ok bool) {
	n = counter.Add(1)
	// Keep attacks visible without allowing logging itself to become a CPU/disk
	// amplifier. The first event and one event per 1024 repetitions are logged.
	return n, n == 1 || n%1024 == 0
}

func logNativeLimitRejection(kind string, rejected *atomic.Int64, limit int) {
	n, ok := shouldLogNativeSample(rejected)
	if ok {
		xrayLogf("native xray: rejected %s at safety limit=%d (rejected=%d)", kind, limit, n)
	}
}

func logNativeClientLimitRejection(email string, limit int) {
	n, ok := shouldLogNativeSample(&nativeClientConnsRejected)
	if ok {
		xrayLogf("native xray: rejected authenticated user %s at max_conns=%d (rejected=%d)", email, limit, n)
	}
}

func logNativePreAuthRejection(format string, args ...interface{}) {
	if _, ok := shouldLogNativeSample(&nativePreAuthRejected); ok {
		xrayLogf(format, args...)
	}
}

func acquireNativeTransportConnection() (func(), bool) {
	limit := nativeMaxConnectionLimit()
	release, ok := acquireNativeCounter(&nativeTransportConnections, limit)
	if !ok {
		logNativeLimitRejection("transport connection", &nativeTransportRejected, limit)
	}
	return release, ok
}

func acquireNativeXHTTPRequest() (func(), bool) {
	limit := nativeMaxXHTTPRequestLimit()
	release, ok := acquireNativeCounter(&nativeXHTTPRequests, limit)
	if !ok {
		logNativeLimitRejection("XHTTP request", &nativeXHTTPRequestsRejected, limit)
	}
	return release, ok
}

func acquireNativeXHTTPSession() (func(), bool) {
	limit := nativeXHTTPMaxSessionLimit()
	release, ok := acquireNativeCounter(&nativeXHTTPSessions, limit)
	if !ok {
		logNativeLimitRejection("XHTTP session", &nativeXHTTPSessionsRejected, limit)
	}
	return release, ok
}

func configureNativeTransportSocket(c net.Conn) {
	if tc, ok := c.(*net.TCPConn); ok {
		_ = tc.SetKeepAlive(true)
		_ = tc.SetKeepAlivePeriod(30 * time.Second)
		_ = tc.SetNoDelay(true)
	}
}

// nativeCountedConn releases its global transport slot and unregisters itself
// exactly once, even when several tunnel paths race to close the same socket.
type nativeCountedConn struct {
	net.Conn
	release   func()
	onClose   func()
	closeOnce sync.Once
	closeErr  error
}

func (c *nativeCountedConn) Close() error {
	c.closeOnce.Do(func() {
		c.closeErr = c.Conn.Close()
		if c.release != nil {
			c.release()
		}
		if c.onClose != nil {
			c.onClose()
		}
	})
	return c.closeErr
}

// wrapNativeTransportConn applies only the global counter. It is useful for
// focused tests and for callers that own connection lifetime themselves.
func wrapNativeTransportConn(c net.Conn) (net.Conn, bool) {
	if c == nil {
		return nil, false
	}
	configureNativeTransportSocket(c)
	release, ok := acquireNativeTransportConnection()
	if !ok {
		_ = c.Close()
		return nil, false
	}
	return &nativeCountedConn{Conn: c, release: release}, true
}

// wrapTrackedNativeTransportConn additionally registers the accepted socket so
// stopping/restarting native Xray closes established raw, WebSocket, TLS, HTTP/1
// and HTTP/2 transports instead of leaving tunnel goroutines alive.
func wrapTrackedNativeTransportConn(c net.Conn) (net.Conn, bool) {
	if c == nil {
		return nil, false
	}
	configureNativeTransportSocket(c)
	if !nativeTransportAccepting.Load() {
		_ = c.Close()
		return nil, false
	}
	release, ok := acquireNativeTransportConnection()
	if !ok {
		_ = c.Close()
		return nil, false
	}

	counted := &nativeCountedConn{Conn: c, release: release}
	counted.onClose = func() {
		nativeTransportRegistry.Lock()
		delete(nativeTransportRegistry.conns, counted)
		nativeTransportRegistry.Unlock()
	}

	nativeTransportRegistry.Lock()
	if !nativeTransportAccepting.Load() {
		nativeTransportRegistry.Unlock()
		_ = counted.Close()
		return nil, false
	}
	nativeTransportRegistry.conns[counted] = struct{}{}
	nativeTransportRegistry.Unlock()
	return counted, true
}

func beginNativeTransportAccepting() {
	nativeTransportAccepting.Store(true)
}

func stopNativeTransportAccepting() {
	nativeTransportAccepting.Store(false)
}

func closeAllNativeTransportConnections() {
	nativeTransportRegistry.Lock()
	conns := make([]*nativeCountedConn, 0, len(nativeTransportRegistry.conns))
	for c := range nativeTransportRegistry.conns {
		conns = append(conns, c)
	}
	nativeTransportRegistry.Unlock()
	for _, c := range conns {
		_ = c.Close()
	}
}

// nativeLimitedListener applies the same pre-authentication ceiling to XHTTP
// listeners. net/http receives only sockets that own a slot; rejected sockets
// are closed before it can allocate a per-connection goroutine or perform TLS.
type nativeLimitedListener struct {
	net.Listener
}

func (l nativeLimitedListener) Accept() (net.Conn, error) {
	for {
		c, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}
		if counted, ok := wrapTrackedNativeTransportConn(c); ok {
			return counted, nil
		}
		// At the ceiling, a hot accept/close loop can itself consume a CPU core.
		// A short fixed backoff also lets the kernel backlog absorb brief spikes.
		time.Sleep(nativeOverloadBackoff)
	}
}

func limitNativeListener(ln net.Listener) net.Listener {
	if ln == nil {
		return nil
	}
	return nativeLimitedListener{Listener: ln}
}
