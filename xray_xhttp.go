package main

import (
	"container/heap"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
)

const (
	xhttpPlacementPath   = "path"
	xhttpPlacementQuery  = "query"
	xhttpPlacementHeader = "header"
	xhttpPlacementCookie = "cookie"
	xhttpPlacementBody   = "body"
	xhttpPlacementAuto   = "auto"
)

// isXHTTP reports whether this inbound uses XHTTP/SplitHTTP. Xray historically
// uses both names; the panel uses "xhttp" while upstream registers "splithttp".
func (ib *nativeInbound) isXHTTP() bool {
	switch strings.ToLower(ib.transport) {
	case "xhttp", "splithttp":
		return true
	default:
		return false
	}
}

func normalizeXHTTPPath(path string) string {
	path = strings.TrimSpace(path)
	if i := strings.Index(path, "?"); i >= 0 {
		path = path[:i]
	}
	if path == "" || path[0] != '/' {
		path = "/" + path
	}
	if !strings.HasSuffix(path, "/") {
		path += "/"
	}
	return path
}

func mergeNativeXHTTPSettings(primary, fallback nativeXHTTPSettingsJSON) nativeXHTTPSettingsJSON {
	out := primary
	if out.Host == "" {
		out.Host = fallback.Host
	}
	if out.Path == "" {
		out.Path = fallback.Path
	}
	if out.Mode == "" {
		out.Mode = fallback.Mode
	}
	if !out.NoSSEHeader {
		out.NoSSEHeader = fallback.NoSSEHeader
	}
	if out.SessionIDPlacement == "" {
		out.SessionIDPlacement = fallback.SessionIDPlacement
	}
	if out.SessionIDKey == "" {
		out.SessionIDKey = fallback.SessionIDKey
	}
	if out.SeqPlacement == "" {
		out.SeqPlacement = fallback.SeqPlacement
	}
	if out.SeqKey == "" {
		out.SeqKey = fallback.SeqKey
	}
	if out.UplinkDataPlacement == "" {
		out.UplinkDataPlacement = fallback.UplinkDataPlacement
	}
	if out.UplinkDataKey == "" {
		out.UplinkDataKey = fallback.UplinkDataKey
	}
	if out.ScMaxEachPostBytes == nil {
		out.ScMaxEachPostBytes = fallback.ScMaxEachPostBytes
	}
	if out.ScMaxBufferedPosts == 0 {
		out.ScMaxBufferedPosts = fallback.ScMaxBufferedPosts
	}
	if out.ServerMaxHeaderBytes == 0 {
		out.ServerMaxHeaderBytes = fallback.ServerMaxHeaderBytes
	}
	return out
}

func (ib *nativeInbound) serveXHTTPListener(ln net.Listener) {
	defer xrayRecover(fmt.Sprintf("native xray XHTTP listener inbound=%q addr=%s", ib.tag, ln.Addr()))
	h2s := &http2.Server{}
	handler := http.Handler(ib)
	// Official Xray accepts plaintext HTTP/1.1 and h2c on non-TLS XHTTP
	// listeners, and negotiates h2/http1 through ALPN on TLS listeners. Without
	// h2c, some clients/CDNs can reach the port but the request never reaches the
	// XHTTP handler, which makes the proxy look dead with no useful target logs.
	if ib.security != "tls" {
		handler = h2c.NewHandler(ib, h2s)
	}
	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 4 * time.Second,
		MaxHeaderBytes:    ib.xhttpServerMaxHeaderBytes(),
	}
	if ib.security == "tls" && ib.tlsConfig != nil {
		srv.TLSConfig = ib.tlsConfig
		_ = http2.ConfigureServer(srv, h2s)
	}
	// Backstop reaper for connected sessions whose client vanished without the
	// request context ever firing. Lives for the lifetime of this listener.
	stopSweep := make(chan struct{})
	defer close(stopSweep)
	xrayGo(fmt.Sprintf("native xray XHTTP idle sweeper inbound=%q", ib.tag), func() { ib.sweepXHTTPSessions(stopSweep) })
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) && !isListenerClosed(err) {
		xrayLogf("native xray: XHTTP server for inbound %q stopped: %v", ib.tag, err)
	}
}

// sweepXHTTPSessions periodically evicts connected XHTTP sessions that have seen
// no traffic (in either direction) within the idle timeout. This is the safety
// net behind the per-request context watch in handleXHTTPDownload; it only ever
// touches sessions whose lastSeen has genuinely gone stale, so an active tunnel
// (which refreshes lastSeen via nativeXHTTPConn.onActivity) is never reaped.
func (ib *nativeInbound) sweepXHTTPSessions(stop <-chan struct{}) {
	defer xrayRecover(fmt.Sprintf("native xray XHTTP idle sweeper inbound=%q", ib.tag))
	idle := nativeXHTTPIdleTimeout()
	if idle <= 0 {
		return
	}
	interval := idle / 4
	if interval < 15*time.Second {
		interval = 15 * time.Second
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			ib.reapStaleXHTTPSessions(idle)
		}
	}
}

func (ib *nativeInbound) reapStaleXHTTPSessions(idle time.Duration) {
	now := time.Now()
	var stale []*nativeXHTTPSession
	ib.xhttpMu.Lock()
	for id, s := range ib.xhttpSessions {
		s.mu.Lock()
		connected := s.connected
		last := s.lastSeen
		s.mu.Unlock()
		// Unconnected sessions have their own 30s reaper; only reap connected
		// ones that have gone idle past the timeout.
		if connected && now.Sub(last) >= idle {
			delete(ib.xhttpSessions, id)
			stale = append(stale, s)
		}
	}
	ib.xhttpMu.Unlock()
	for _, s := range stale {
		xrayTracef("native xray: xhttp idle sweep closing session=%q inbound=%q", s.id, ib.tag)
		s.close()
	}
}

func (ib *nativeInbound) xhttpServerMaxHeaderBytes() int {
	if ib.xhttpMaxHeaderBytes > 0 {
		return ib.xhttpMaxHeaderBytes
	}
	// Xray defaults to 8192. Keep a little room for custom headers/cookies used
	// by packet-up mode while still preventing unbounded memory use.
	return 64 * 1024
}

// ServeHTTP terminates the XHTTP/SplitHTTP transport and exposes the decoded
// byte stream to the VLESS/VMess handlers as a net.Conn.
func (ib *nativeInbound) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer xrayRecover(fmt.Sprintf("native xray XHTTP request inbound=%q method=%s path=%q remote=%s", ib.tag, r.Method, r.URL.RequestURI(), r.RemoteAddr))
	if !ib.isXHTTP() {
		xrayLogf("native xray: xhttp reject inbound=%q reason=not-xhttp method=%s path=%q host=%q remote=%s", ib.tag, r.Method, r.URL.RequestURI(), r.Host, r.RemoteAddr)
		xhttpBadRequest(w)
		return
	}
	if !ib.xhttpHostAllowed(r.Host) {
		xrayLogf("native xray: xhttp reject inbound=%q reason=host method=%s path=%q host=%q want=%q remote=%s", ib.tag, r.Method, r.URL.RequestURI(), r.Host, ib.xhttpHost, r.RemoteAddr)
		w.WriteHeader(http.StatusNotFound)
		return
	}
	base, ok := ib.matchXHTTPPath(r.URL.Path)
	if !ok {
		xrayLogf("native xray: xhttp reject inbound=%q reason=path method=%s path=%q want=%q host=%q remote=%s", ib.tag, r.Method, r.URL.RequestURI(), ib.path, r.Host, r.RemoteAddr)
		w.WriteHeader(http.StatusNotFound)
		return
	}

	ib.writeXHTTPCommonHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	sessionID, seqStr := ib.extractXHTTPMeta(r, base)
	mode := ib.normalizedXHTTPMode()
	xrayTracef("native xray: xhttp request inbound=%q method=%s proto=%s path=%q host=%q session=%q seq=%q len=%d mode=%s remote=%s", ib.tag, r.Method, r.Proto, r.URL.RequestURI(), r.Host, sessionID, seqStr, r.ContentLength, mode, r.RemoteAddr)

	if sessionID == "" && mode != "" && mode != "auto" && mode != "stream-one" && mode != "stream-up" {
		http.Error(w, "stream-one mode is not allowed", http.StatusBadRequest)
		return
	}

	isUplinkRequest := true
	if r.Method == http.MethodGet {
		isUplinkRequest = seqStr != ""
	}

	if isUplinkRequest && sessionID != "" { // stream-up, packet-up
		sess := ib.upsertXHTTPSession(w, sessionID)
		if sess == nil {
			return
		}
		if seqStr == "" {
			ib.handleXHTTPStreamUpload(w, r, sess)
			return
		}
		ib.handleXHTTPPacketUpload(w, r, sess, seqStr)
		return
	}

	if r.Method == http.MethodGet || sessionID == "" { // stream-down, stream-one
		if sessionID != "" {
			sess := ib.upsertXHTTPSession(w, sessionID)
			if sess == nil {
				return
			}
			ib.handleXHTTPDownload(w, r, sess, sessionID)
			return
		}
		if r.Body == nil || (r.ContentLength == 0 && len(r.TransferEncoding) == 0) {
			xhttpBadRequest(w)
			return
		}
		ib.handleXHTTPStreamOne(w, r)
		return
	}

	w.Header().Set("Allow", "GET, POST, PUT, PATCH, OPTIONS")
	w.WriteHeader(http.StatusMethodNotAllowed)
}

func xhttpBadRequest(w http.ResponseWriter) {
	http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
}

func (ib *nativeInbound) normalizedXHTTPMode() string {
	mode := strings.ToLower(strings.TrimSpace(ib.xhttpMode))
	if mode == "" {
		return "auto"
	}
	return mode
}

func isXHTTPUploadMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch:
		return true
	default:
		return false
	}
}

func (ib *nativeInbound) xhttpHostAllowed(reqHost string) bool {
	want := strings.TrimSpace(ib.xhttpHost)
	if want == "" {
		return true
	}
	for _, h := range strings.Split(want, ",") {
		h = strings.TrimSpace(h)
		if h == "" {
			continue
		}
		if strings.EqualFold(reqHost, h) {
			return true
		}
		reqBare := stripHostPort(reqHost)
		wantBare := stripHostPort(h)
		if strings.EqualFold(reqBare, wantBare) {
			return true
		}
	}
	return false
}

func stripHostPort(h string) string {
	h = strings.TrimSpace(h)
	if h == "" {
		return ""
	}
	if strings.HasPrefix(h, "[") {
		if end := strings.Index(h, "]"); end >= 0 {
			return strings.Trim(h[1:end], "[]")
		}
	}
	if host, _, err := net.SplitHostPort(h); err == nil {
		return strings.Trim(host, "[]")
	}
	if i := strings.LastIndex(h, ":"); i > -1 && strings.Count(h, ":") == 1 {
		return h[:i]
	}
	return strings.Trim(h, "[]")
}

func (ib *nativeInbound) matchXHTTPPath(reqPath string) (base string, ok bool) {
	base = ib.path
	if base == "" {
		base = "/"
	}
	base = normalizeXHTTPPath(base)
	if strings.HasPrefix(reqPath, base) {
		return base, true
	}
	trimmed := strings.TrimSuffix(base, "/")
	if trimmed == "" {
		trimmed = "/"
	}
	if reqPath == trimmed {
		return base, true
	}
	return base, false
}

func (ib *nativeInbound) writeXHTTPCommonHeaders(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		w.Header().Set("Access-Control-Allow-Origin", "*")
	} else {
		w.Header().Set("Access-Control-Allow-Origin", origin)
	}
	if r.Method == http.MethodOptions {
		if m := r.Header.Get("Access-Control-Request-Method"); m != "" {
			w.Header().Set("Access-Control-Allow-Methods", m)
		} else {
			w.Header().Set("Access-Control-Allow-Methods", "*")
		}
		if h := r.Header.Get("Access-Control-Request-Headers"); h != "" {
			w.Header().Set("Access-Control-Allow-Headers", h)
		} else {
			w.Header().Set("Access-Control-Allow-Headers", "*")
		}
	}
}

func (ib *nativeInbound) extractXHTTPMeta(r *http.Request, base string) (sessionID, seqStr string) {
	sessionPlacement := firstNonEmpty(ib.xhttpSessionPlacement, xhttpPlacementPath)
	seqPlacement := firstNonEmpty(ib.xhttpSeqPlacement, xhttpPlacementPath)
	sessionKey := firstNonEmpty(ib.xhttpSessionKey, defaultXHTTPMetaKey(sessionPlacement, true))
	seqKey := firstNonEmpty(ib.xhttpSeqKey, defaultXHTTPMetaKey(seqPlacement, false))

	var parts []string
	pathPart := 0
	if sessionPlacement == xhttpPlacementPath || seqPlacement == xhttpPlacementPath {
		if strings.HasPrefix(r.URL.Path, base) {
			parts = strings.Split(r.URL.Path[len(base):], "/")
		}
	}

	if sessionPlacement == xhttpPlacementPath {
		if len(parts) > pathPart {
			sessionID = parts[pathPart]
			pathPart++
		}
	} else {
		sessionID = extractXHTTPValue(r, sessionPlacement, sessionKey)
	}

	if seqPlacement == xhttpPlacementPath {
		if len(parts) > pathPart {
			seqStr = parts[pathPart]
		}
	} else {
		seqStr = extractXHTTPValue(r, seqPlacement, seqKey)
	}
	return sessionID, seqStr
}

func defaultXHTTPMetaKey(placement string, session bool) string {
	switch placement {
	case xhttpPlacementHeader:
		if session {
			return "X-Session"
		}
		return "X-Seq"
	case xhttpPlacementCookie, xhttpPlacementQuery:
		if session {
			return "x_session"
		}
		return "x_seq"
	default:
		return ""
	}
}

func extractXHTTPValue(r *http.Request, placement, key string) string {
	if key == "" {
		return ""
	}
	switch placement {
	case xhttpPlacementQuery:
		return r.URL.Query().Get(key)
	case xhttpPlacementHeader:
		return r.Header.Get(key)
	case xhttpPlacementCookie:
		if c, err := r.Cookie(key); err == nil {
			return c.Value
		}
	}
	return ""
}

func (ib *nativeInbound) upsertXHTTPSession(w http.ResponseWriter, id string) *nativeXHTTPSession {
	ib.xhttpMu.Lock()
	defer ib.xhttpMu.Unlock()
	if ib.xhttpSessions == nil {
		ib.xhttpSessions = make(map[string]*nativeXHTTPSession)
	}
	if s := ib.xhttpSessions[id]; s != nil {
		s.touch()
		return s
	}
	if max := ib.xhttpMaxActiveSessions(); max > 0 && len(ib.xhttpSessions) >= max {
		// XHTTP uses many HTTP requests/sessions by design. Returning HTTP 429
		// makes Xray clients tear down active tunnels, which is worse than allowing
		// a short soft-limit overflow and relying on stale-session cleanup.
		xrayTracef("native xray: xhttp session soft limit exceeded inbound=%q active=%d limit=%d", ib.tag, len(ib.xhttpSessions), max)
	}
	s := &nativeXHTTPSession{
		id:          id,
		queue:       newNativeXHTTPUploadQueue(ib.xhttpMaxBufferedPosts),
		done:        make(chan struct{}),
		connectedCh: make(chan struct{}),
		lastSeen:    time.Now(),
	}
	ib.xhttpSessions[id] = s
	xrayTracef("native xray: xhttp session created inbound=%q session=%q active=%d", ib.tag, id, len(ib.xhttpSessions))
	xrayGo(fmt.Sprintf("native xray XHTTP session reaper inbound=%q session=%q", ib.tag, id), func() { ib.reapUnconnectedXHTTPSession(id, s) })
	return s
}

func (ib *nativeInbound) xhttpMaxActiveSessions() int {
	if nativeXHTTPMaxSessionLimit() > 0 {
		return nativeXHTTPMaxSessionLimit()
	}
	return defaultNativeXHTTPMaxSessions
}

func (ib *nativeInbound) reapUnconnectedXHTTPSession(id string, s *nativeXHTTPSession) {
	timer := time.NewTimer(30 * time.Second)
	defer timer.Stop()
	select {
	case <-timer.C:
		s.mu.Lock()
		connected := s.connected
		s.mu.Unlock()
		if !connected {
			ib.deleteXHTTPSession(id, s)
			s.close()
		}
	case <-s.connectedCh:
	case <-s.done:
	}
}

func (ib *nativeInbound) deleteXHTTPSession(id string, s *nativeXHTTPSession) {
	ib.xhttpMu.Lock()
	defer ib.xhttpMu.Unlock()
	if ib.xhttpSessions[id] == s {
		delete(ib.xhttpSessions, id)
	}
}

func (ib *nativeInbound) handleXHTTPStreamUpload(w http.ResponseWriter, r *http.Request, sess *nativeXHTTPSession) {
	sess.touch()
	xrayTracef("native xray: xhttp stream-up inbound=%q session=%q len=%d remote=%s", ib.tag, sess.id, r.ContentLength, r.RemoteAddr)
	if ib.xhttpMode != "" && ib.xhttpMode != "auto" && ib.xhttpMode != "stream-up" && ib.xhttpMode != "stream-down" {
		http.Error(w, "xhttp stream-up mode is not allowed", http.StatusBadRequest)
		return
	}
	if err := sess.queue.push(r.Context(), nativeXHTTPPacket{Reader: r.Body}); err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return
		}
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	flushHTTP(w)
	select {
	case <-r.Context().Done():
	case <-sess.done:
	}
}

func (ib *nativeInbound) handleXHTTPPacketUpload(w http.ResponseWriter, r *http.Request, sess *nativeXHTTPSession, seqStr string) {
	sess.touch()
	if ib.xhttpMode != "" && ib.xhttpMode != "auto" && ib.xhttpMode != "packet-up" && ib.xhttpMode != "stream-down" {
		http.Error(w, "xhttp packet-up mode is not allowed", http.StatusBadRequest)
		return
	}
	seq, err := strconv.ParseUint(seqStr, 10, 64)
	if err != nil {
		http.Error(w, "bad xhttp sequence", http.StatusBadRequest)
		return
	}
	payload, err := ib.readXHTTPPayload(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	xrayTracef("native xray: xhttp packet-up inbound=%q session=%q seq=%d payload=%d remote=%s", ib.tag, sess.id, seq, len(payload), r.RemoteAddr)
	if err := sess.queue.push(r.Context(), nativeXHTTPPacket{Payload: payload, Seq: seq}); err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return
		}
		xrayTracef("native xray: xhttp packet-up push failed inbound=%q session=%q seq=%d: %v", ib.tag, sess.id, seq, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if len(payload) == 0 {
		w.Header().Set("Cache-Control", "no-store")
	}
	w.WriteHeader(http.StatusOK)
}

func (ib *nativeInbound) readXHTTPPayload(r *http.Request) ([]byte, error) {
	placement := firstNonEmpty(ib.xhttpUplinkDataPlacement, xhttpPlacementBody)
	key := firstNonEmpty(ib.xhttpUplinkDataKey, "X-Data")

	var headerPayload, cookiePayload, bodyPayload []byte
	var err error
	if placement == xhttpPlacementAuto || placement == xhttpPlacementHeader {
		headerPayload, err = readXHTTPHeaderPayload(r, key)
		if err != nil {
			return nil, err
		}
	}
	if placement == xhttpPlacementAuto || placement == xhttpPlacementCookie {
		cookiePayload, err = readXHTTPCookiePayload(r, key)
		if err != nil {
			return nil, err
		}
	}
	if placement == xhttpPlacementAuto || placement == xhttpPlacementBody {
		bodyPayload, err = ib.readXHTTPBodyPayload(r)
		if err != nil {
			return nil, err
		}
	}

	var payload []byte
	switch placement {
	case xhttpPlacementHeader:
		payload = headerPayload
	case xhttpPlacementCookie:
		payload = cookiePayload
	case xhttpPlacementBody:
		payload = bodyPayload
	case xhttpPlacementAuto:
		payload = append(payload, headerPayload...)
		payload = append(payload, cookiePayload...)
		payload = append(payload, bodyPayload...)
	default:
		return nil, fmt.Errorf("unsupported xhttp uplink data placement %q", placement)
	}
	if int64(len(payload)) > ib.xhttpMaxPostBytes() {
		return nil, fmt.Errorf("xhttp upload too large")
	}
	return payload, nil
}

func readXHTTPHeaderPayload(r *http.Request, key string) ([]byte, error) {
	chunks := make([]string, 0, 4)
	for i := 0; ; i++ {
		chunk := r.Header.Get(fmt.Sprintf("%s-%d", key, i))
		if chunk == "" {
			break
		}
		chunks = append(chunks, chunk)
	}
	if len(chunks) == 0 {
		return nil, nil
	}
	return base64.RawURLEncoding.DecodeString(strings.Join(chunks, ""))
}

func readXHTTPCookiePayload(r *http.Request, key string) ([]byte, error) {
	chunks := make([]string, 0, 4)
	for i := 0; ; i++ {
		cookieName := fmt.Sprintf("%s_%d", key, i)
		c, err := r.Cookie(cookieName)
		if err != nil {
			break
		}
		chunks = append(chunks, c.Value)
	}
	if len(chunks) == 0 {
		return nil, nil
	}
	return base64.RawURLEncoding.DecodeString(strings.Join(chunks, ""))
}

func (ib *nativeInbound) readXHTTPBodyPayload(r *http.Request) ([]byte, error) {
	maxBytes := ib.xhttpMaxPostBytes()
	if r.ContentLength > maxBytes {
		return nil, fmt.Errorf("xhttp upload too large")
	}
	payload, err := io.ReadAll(io.LimitReader(r.Body, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(payload)) > maxBytes {
		return nil, fmt.Errorf("xhttp upload too large")
	}
	return payload, nil
}

func (ib *nativeInbound) xhttpMaxPostBytes() int64 {
	if ib.xhttpMaxEachPostBytes > 0 {
		return ib.xhttpMaxEachPostBytes
	}
	return 1_000_000
}

func (ib *nativeInbound) handleXHTTPStreamOne(w http.ResponseWriter, r *http.Request) {
	defer xrayRecover(fmt.Sprintf("native xray XHTTP stream-one inbound=%q remote=%s", ib.tag, r.RemoteAddr))
	xrayTracef("native xray: xhttp stream-one inbound=%q len=%d remote=%s", ib.tag, r.ContentLength, r.RemoteAddr)
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Cache-Control", "no-store")
	if !ib.xhttpNoSSEHeader {
		w.Header().Set("Content-Type", "text/event-stream")
	}
	w.WriteHeader(http.StatusOK)
	flushHTTP(w)

	remote := remoteAddrFromHTTPRequest(r)
	resp := newNativeXHTTPResponseWriter(w)
	xc := &nativeXHTTPConn{
		reader: r.Body,
		writer: resp,
		remote: remote,
		local:  dummyLocalAddr(r),
		onClose: func() {
			resp.close()
			_ = r.Body.Close()
		},
	}
	ib.dispatchXHTTPConn(xc, remote)
	_ = xc.Close()
}

func (ib *nativeInbound) handleXHTTPDownload(w http.ResponseWriter, r *http.Request, sess *nativeXHTTPSession, sessionID string) {
	sess.touch()
	defer xrayRecover(fmt.Sprintf("native xray XHTTP download inbound=%q session=%q remote=%s", ib.tag, sessionID, r.RemoteAddr))
	xrayTracef("native xray: xhttp stream-down inbound=%q session=%q proto=%s remote=%s", ib.tag, sessionID, r.Proto, r.RemoteAddr)
	sess.markConnected()
	defer ib.deleteXHTTPSession(sessionID, sess)

	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Cache-Control", "no-store")
	if !ib.xhttpNoSSEHeader {
		w.Header().Set("Content-Type", "text/event-stream")
	}
	w.WriteHeader(http.StatusOK)
	flushHTTP(w)

	remote := remoteAddrFromHTTPRequest(r)
	var reader io.Reader = sess.queue
	resp := newNativeXHTTPResponseWriter(w)
	xc := &nativeXHTTPConn{
		reader:     reader,
		writer:     resp,
		remote:     remote,
		local:      dummyLocalAddr(r),
		onActivity: sess.touch,
	}
	xc.onClose = func() {
		resp.close()
		sess.close()
	}

	// When the download GET is cancelled (client gone, or a CDN closes the
	// origin stream after its own idle timeout) the HTTP request context fires.
	// Closing xc unblocks the tunnel's uplink reader (via sess.close -> queue
	// close) and closes the backend, so handleXHTTPDownload returns and its
	// deferred deleteXHTTPSession runs. Without this watch an idle tunnel whose
	// client vanished silently would never be torn down. The goroutine exits on
	// sess.done once the session closes for any reason.
	go func() {
		select {
		case <-r.Context().Done():
			_ = xc.Close()
		case <-sess.done:
		}
	}()

	ib.dispatchXHTTPConn(xc, remote)
	_ = xc.Close()
}

func (ib *nativeInbound) dispatchXHTTPConn(xc net.Conn, remote net.Addr) {
	xrayTracef("native xray: xhttp dispatch inbound=%q protocol=%s remote=%s", ib.tag, ib.protocol, remote)
	switch ib.protocol {
	case "vless":
		ib.handleVLESS(xc, remote)
	case "vmess":
		ib.handleVMess(xc, remote)
	case "ssh":
		// XHTTP->SSH tunnel: the decoded stream is a raw SSH transport. Hand it to
		// the same SSH handler the TLS/DNSTT listeners use so tunneled clients
		// authenticate with ordinary SSH accounts. getSSHConfig() is the live,
		// hot-reloadable config; it can be nil only before the SSH server is set up.
		cfg := getSSHConfig()
		if cfg == nil {
			xrayLogf("native xray: inbound %q XHTTP->SSH has no SSH config available yet", ib.tag)
			return
		}
		handleConn(xc, cfg)
	default:
		xrayLogf("native xray: inbound %q XHTTP protocol %q not supported", ib.tag, ib.protocol)
	}
}

func remoteAddrFromHTTPRequest(r *http.Request) net.Addr {
	addr, err := net.ResolveTCPAddr("tcp", r.RemoteAddr)
	if err == nil {
		return addr
	}
	return &net.TCPAddr{IP: net.IPv4zero, Port: 0}
}

func dummyLocalAddr(r *http.Request) net.Addr {
	if r.TLS != nil && r.Host != "" {
		return &net.TCPAddr{IP: net.IPv4zero, Port: 443}
	}
	return &net.TCPAddr{IP: net.IPv4zero, Port: 80}
}

func flushHTTP(w http.ResponseWriter) {
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

type nativeXHTTPSession struct {
	id          string
	queue       *nativeXHTTPUploadQueue
	done        chan struct{}
	closeOnce   sync.Once
	connectedCh chan struct{} // closed once the download GET attaches
	connectOnce sync.Once
	mu          sync.Mutex
	connected   bool
	lastSeen    time.Time
}

func (s *nativeXHTTPSession) touch() {
	s.mu.Lock()
	s.lastSeen = time.Now()
	s.mu.Unlock()
}

func (s *nativeXHTTPSession) markConnected() {
	s.mu.Lock()
	s.connected = true
	s.lastSeen = time.Now()
	s.mu.Unlock()
	s.connectOnce.Do(func() { close(s.connectedCh) })
}

func (s *nativeXHTTPSession) close() {
	s.closeOnce.Do(func() {
		close(s.done)
		s.queue.close()
	})
}

type nativeXHTTPConn struct {
	reader io.Reader
	writer io.Writer
	remote net.Addr
	local  net.Addr

	deadlineMu   sync.Mutex
	readDeadline time.Time

	closeOnce sync.Once
	onClose   func()
	// onActivity, when set, is called after any successful read or write so the
	// owning session's lastSeen reflects real bidirectional traffic (not just
	// HTTP request arrivals). The idle sweeper relies on this to avoid reaping a
	// tunnel that is actively streaming in only one direction.
	onActivity func()
}

func (c *nativeXHTTPConn) Read(p []byte) (int, error) {
	if dr, ok := c.reader.(interface{ SetReadDeadline(time.Time) error }); ok {
		c.deadlineMu.Lock()
		d := c.readDeadline
		c.deadlineMu.Unlock()
		_ = dr.SetReadDeadline(d)
	}
	n, err := c.reader.Read(p)
	if n > 0 && c.onActivity != nil {
		c.onActivity()
	}
	return n, err
}

func (c *nativeXHTTPConn) Write(p []byte) (int, error) {
	n, err := c.writer.Write(p)
	if n > 0 && c.onActivity != nil {
		c.onActivity()
	}
	return n, err
}

func (c *nativeXHTTPConn) Close() error {
	c.closeOnce.Do(func() {
		if c.onClose != nil {
			c.onClose()
		}
	})
	return nil
}

func (c *nativeXHTTPConn) LocalAddr() net.Addr  { return c.local }
func (c *nativeXHTTPConn) RemoteAddr() net.Addr { return c.remote }

func (c *nativeXHTTPConn) SetDeadline(t time.Time) error {
	_ = c.SetReadDeadline(t)
	return c.SetWriteDeadline(t)
}

func (c *nativeXHTTPConn) SetReadDeadline(t time.Time) error {
	c.deadlineMu.Lock()
	c.readDeadline = t
	c.deadlineMu.Unlock()
	if dr, ok := c.reader.(interface{ SetReadDeadline(time.Time) error }); ok {
		return dr.SetReadDeadline(t)
	}
	return nil
}

func (c *nativeXHTTPConn) SetWriteDeadline(time.Time) error { return nil }

type nativeXHTTPResponseWriter struct {
	mu     sync.Mutex
	w      http.ResponseWriter
	closed bool
}

func newNativeXHTTPResponseWriter(w http.ResponseWriter) *nativeXHTTPResponseWriter {
	return &nativeXHTTPResponseWriter{w: w}
}

func (w *nativeXHTTPResponseWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return 0, io.ErrClosedPipe
	}
	n, err := w.w.Write(p)
	if err == nil {
		flushHTTP(w.w)
	}
	return n, err
}

func (w *nativeXHTTPResponseWriter) close() {
	w.mu.Lock()
	w.closed = true
	w.mu.Unlock()
}

type nativeXHTTPPacket struct {
	Reader  io.ReadCloser
	Payload []byte
	Seq     uint64
}

type nativeXHTTPUploadQueue struct {
	pushedPackets chan nativeXHTTPPacket
	maxPackets    int

	mu           sync.Mutex
	reader       io.ReadCloser
	heap         nativeXHTTPHeap
	nextSeq      uint64
	readDeadline time.Time

	closed    chan struct{}
	closeOnce sync.Once
}

func newNativeXHTTPUploadQueue(maxPackets int) *nativeXHTTPUploadQueue {
	if maxPackets <= 0 {
		maxPackets = defaultNativeXHTTPBufferedPosts
	}
	return &nativeXHTTPUploadQueue{
		pushedPackets: make(chan nativeXHTTPPacket, maxPackets),
		maxPackets:    maxPackets,
		closed:        make(chan struct{}),
	}
}

func (q *nativeXHTTPUploadQueue) push(ctx context.Context, p nativeXHTTPPacket) error {
	if p.Reader != nil {
		q.mu.Lock()
		if q.reader != nil {
			q.mu.Unlock()
			return errors.New("xhttp upload reader already exists")
		}
		q.mu.Unlock()
	}
	select {
	case q.pushedPackets <- p:
		select {
		case <-q.closed:
			return io.ErrClosedPipe
		default:
		}
		return nil
	case <-q.closed:
		return io.ErrClosedPipe
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (q *nativeXHTTPUploadQueue) close() {
	q.closeOnce.Do(func() {
		close(q.closed)
		q.mu.Lock()
		reader := q.reader
		q.mu.Unlock()
		if reader != nil {
			_ = reader.Close()
		}
	})
}

func (q *nativeXHTTPUploadQueue) SetReadDeadline(t time.Time) error {
	q.mu.Lock()
	q.readDeadline = t
	q.mu.Unlock()
	return nil
}

func (q *nativeXHTTPUploadQueue) recv() (nativeXHTTPPacket, error) {
	q.mu.Lock()
	d := q.readDeadline
	q.mu.Unlock()

	if d.IsZero() {
		select {
		case p := <-q.pushedPackets:
			return p, nil
		case <-q.closed:
			return nativeXHTTPPacket{}, io.EOF
		}
	}

	wait := time.Until(d)
	if wait <= 0 {
		return nativeXHTTPPacket{}, os.ErrDeadlineExceeded
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case p := <-q.pushedPackets:
		return p, nil
	case <-q.closed:
		return nativeXHTTPPacket{}, io.EOF
	case <-timer.C:
		return nativeXHTTPPacket{}, os.ErrDeadlineExceeded
	}
}

func (q *nativeXHTTPUploadQueue) Read(b []byte) (int, error) {
	if reader := q.loadReader(); reader != nil {
		return reader.Read(b)
	}

	select {
	case <-q.closed:
		return 0, io.EOF
	default:
	}

	if len(q.heap) == 0 {
		p, err := q.recv()
		if err != nil {
			return 0, err
		}
		if p.Reader != nil {
			q.setReader(p.Reader)
			return p.Reader.Read(b)
		}
		heap.Push(&q.heap, p)
	}

	for len(q.heap) > 0 {
		packet := heap.Pop(&q.heap).(nativeXHTTPPacket)

		if packet.Seq == q.nextSeq {
			n := copy(b, packet.Payload)
			if n < len(packet.Payload) {
				packet.Payload = packet.Payload[n:]
				heap.Push(&q.heap, packet)
			} else {
				q.nextSeq = packet.Seq + 1
			}
			return n, nil
		}

		if packet.Seq > q.nextSeq {
			if len(q.heap) > q.maxPackets {
				return 0, errors.New("xhttp upload reassembly buffer too large")
			}
			heap.Push(&q.heap, packet)
			p, err := q.recv()
			if err != nil {
				return 0, err
			}
			if p.Reader != nil {
				return 0, errors.New("xhttp mixed stream-up and packet-up upload")
			}
			heap.Push(&q.heap, p)
		}
	}

	return 0, nil
}

func (q *nativeXHTTPUploadQueue) loadReader() io.ReadCloser {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.reader
}

func (q *nativeXHTTPUploadQueue) setReader(r io.ReadCloser) {
	q.mu.Lock()
	q.reader = r
	q.mu.Unlock()
}

type nativeXHTTPHeap []nativeXHTTPPacket

func (h nativeXHTTPHeap) Len() int           { return len(h) }
func (h nativeXHTTPHeap) Less(i, j int) bool { return h[i].Seq < h[j].Seq }
func (h nativeXHTTPHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *nativeXHTTPHeap) Push(x any)        { *h = append(*h, x.(nativeXHTTPPacket)) }
func (h *nativeXHTTPHeap) Pop() any {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}
