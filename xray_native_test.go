package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

// startEchoServer starts a TCP server that echoes everything back and returns
// its port and a cleanup func.
func startEchoServer(t *testing.T) (int, func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("echo listen: %v", err)
	}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go io.Copy(c, c)
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port, func() { ln.Close() }
}

// newTestInbound builds a native VLESS inbound with one known client, listening
// on an ephemeral port. Returns the inbound, the listen port, the client uuid,
// and a cleanup func.
func newTestInbound(t *testing.T, transport, path string) (*nativeInbound, int, [16]byte, func()) {
	t.Helper()
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		t.Fatalf("rand: %v", err)
	}
	ib := &nativeInbound{
		tag:         "test",
		protocol:    "vless",
		transport:   transport,
		path:        path,
		clientsByID: map[[16]byte]*nativeXrayClient{id: {id: id, uuid: "test", email: "test@t"}},
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("inbound listen: %v", err)
	}
	go ib.acceptLoop(ln)
	port := ln.Addr().(*net.TCPAddr).Port
	return ib, port, id, func() { ln.Close() }
}

// vlessHeader builds a VLESS TCP request header targeting 127.0.0.1:targetPort.
func vlessHeader(id [16]byte, targetPort int) []byte {
	var b bytes.Buffer
	b.WriteByte(0)           // version
	b.Write(id[:])           // uuid
	b.WriteByte(0)           // addon length
	b.WriteByte(vlessCmdTCP) // command
	b.WriteByte(byte(targetPort >> 8))
	b.WriteByte(byte(targetPort))
	b.WriteByte(atypIPv4) // address type
	b.Write([]byte{127, 0, 0, 1})
	return b.Bytes()
}

func TestVLESSOverTCP(t *testing.T) {
	echoPort, stopEcho := startEchoServer(t)
	defer stopEcho()
	_, port, id, stop := newTestInbound(t, "tcp", "")
	defer stop()

	conn, err := net.Dial("tcp", net.JoinHostPort("127.0.0.1", itoa(port)))
	if err != nil {
		t.Fatalf("dial inbound: %v", err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))

	// Send header + payload.
	if _, err := conn.Write(vlessHeader(id, echoPort)); err != nil {
		t.Fatalf("write header: %v", err)
	}
	if _, err := conn.Write([]byte("ping-tcp")); err != nil {
		t.Fatalf("write payload: %v", err)
	}

	// Read 2-byte VLESS response header.
	resp := make([]byte, 2)
	if _, err := io.ReadFull(conn, resp); err != nil {
		t.Fatalf("read response header: %v", err)
	}
	if resp[0] != 0 {
		t.Fatalf("bad response version: %v", resp)
	}

	// Read the echoed payload.
	got := make([]byte, len("ping-tcp"))
	if _, err := io.ReadFull(conn, got); err != nil {
		t.Fatalf("read echo: %v", err)
	}
	if string(got) != "ping-tcp" {
		t.Fatalf("echo mismatch: got %q", got)
	}
}

func TestVLESSRejectsUnknownUUID(t *testing.T) {
	echoPort, stopEcho := startEchoServer(t)
	defer stopEcho()
	_, port, _, stop := newTestInbound(t, "tcp", "")
	defer stop()

	conn, err := net.Dial("tcp", net.JoinHostPort("127.0.0.1", itoa(port)))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(3 * time.Second))

	var bad [16]byte // all-zero uuid, not registered
	conn.Write(vlessHeader(bad, echoPort))
	conn.Write([]byte("should-not-echo"))

	// Server must reject: connection closed with no response bytes.
	if n, err := conn.Read(make([]byte, 1)); err == nil && n > 0 {
		t.Fatalf("expected rejection, but server responded with %d bytes", n)
	}
}

func TestVLESSOverWebSocket(t *testing.T) {
	echoPort, stopEcho := startEchoServer(t)
	defer stopEcho()
	_, port, id, stop := newTestInbound(t, "ws", "/vlws")
	defer stop()

	raw, err := net.Dial("tcp", net.JoinHostPort("127.0.0.1", itoa(port)))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer raw.Close()
	raw.SetDeadline(time.Now().Add(5 * time.Second))

	ws := wsClientHandshake(t, raw, "/vlws")

	// One frame carrying header + payload.
	payload := append(vlessHeader(id, echoPort), []byte("ping-ws")...)
	if _, err := ws.Write(payload); err != nil {
		t.Fatalf("ws write: %v", err)
	}

	// Read response header (2 bytes) + echo, possibly spanning frames.
	buf := make([]byte, 0, 32)
	want := 2 + len("ping-ws")
	for len(buf) < want {
		chunk := make([]byte, 64)
		n, err := ws.Read(chunk)
		if err != nil {
			t.Fatalf("ws read: %v (got %q)", err, buf)
		}
		buf = append(buf, chunk[:n]...)
	}
	if buf[0] != 0 {
		t.Fatalf("bad ws vless response: %v", buf[:2])
	}
	if string(buf[2:want]) != "ping-ws" {
		t.Fatalf("ws echo mismatch: got %q", buf[2:want])
	}
}

func TestVLESSOverXHTTPPacketUp(t *testing.T) {
	echoPort, stopEcho := startEchoServer(t)
	defer stopEcho()

	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		t.Fatalf("rand: %v", err)
	}
	ib := &nativeInbound{
		tag:                   "test-xhttp",
		protocol:              "vless",
		transport:             "xhttp",
		path:                  normalizeXHTTPPath("/xhttp"),
		xhttpMode:             "packet-up",
		xhttpMaxEachPostBytes: 1_000_000,
		xhttpMaxBufferedPosts: 30,
		xhttpSessions:         make(map[string]*nativeXHTTPSession),
		clientsByID:           map[[16]byte]*nativeXrayClient{id: {id: id, uuid: "test", email: "test@t"}},
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("xhttp listen: %v", err)
	}
	defer ln.Close()
	go ib.serveXHTTPListener(ln)
	port := ln.Addr().(*net.TCPAddr).Port

	client := &http.Client{Timeout: 5 * time.Second}
	session := "session-test"
	baseURL := "http://" + net.JoinHostPort("127.0.0.1", itoa(port)) + "/xhttp/" + session

	respCh := make(chan *http.Response, 1)
	errCh := make(chan error, 1)
	go func() {
		resp, err := client.Get(baseURL)
		if err != nil {
			errCh <- err
			return
		}
		respCh <- resp
	}()

	var resp *http.Response
	select {
	case resp = <-respCh:
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("xhttp GET status: %s", resp.Status)
		}
	case err := <-errCh:
		t.Fatalf("xhttp GET: %v", err)
	case <-time.After(2 * time.Second):
		t.Fatalf("xhttp GET did not open")
	}

	payload := append(vlessHeader(id, echoPort), []byte("ping-xhttp")...)
	postResp, err := client.Post(baseURL+"/0", "application/octet-stream", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("xhttp POST: %v", err)
	}
	postResp.Body.Close()
	if postResp.StatusCode != http.StatusOK {
		t.Fatalf("xhttp POST status: %s", postResp.Status)
	}

	got := make([]byte, 2+len("ping-xhttp"))
	if _, err := io.ReadFull(resp.Body, got); err != nil {
		t.Fatalf("xhttp read response: %v", err)
	}
	if got[0] != 0 {
		t.Fatalf("bad xhttp vless response: %v", got[:2])
	}
	if string(got[2:]) != "ping-xhttp" {
		t.Fatalf("xhttp echo mismatch: got %q", got[2:])
	}
}

func TestVLESSOverXHTTPPacketUpGET(t *testing.T) {
	echoPort, stopEcho := startEchoServer(t)
	defer stopEcho()

	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		t.Fatalf("rand: %v", err)
	}
	ib := &nativeInbound{
		tag:                   "test-xhttp-get-packet",
		protocol:              "vless",
		transport:             "xhttp",
		path:                  normalizeXHTTPPath("/xhttp"),
		xhttpMode:             "packet-up",
		xhttpMaxEachPostBytes: 1_000_000,
		xhttpMaxBufferedPosts: 30,
		xhttpSessions:         make(map[string]*nativeXHTTPSession),
		clientsByID:           map[[16]byte]*nativeXrayClient{id: {id: id, uuid: "test", email: "test@t"}},
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("xhttp listen: %v", err)
	}
	defer ln.Close()
	go ib.serveXHTTPListener(ln)
	port := ln.Addr().(*net.TCPAddr).Port

	client := &http.Client{Timeout: 5 * time.Second}
	session := "session-get-packet"
	baseURL := "http://" + net.JoinHostPort("127.0.0.1", itoa(port)) + "/xhttp/" + session

	respCh := make(chan *http.Response, 1)
	errCh := make(chan error, 1)
	go func() {
		resp, err := client.Get(baseURL)
		if err != nil {
			errCh <- err
			return
		}
		respCh <- resp
	}()

	var resp *http.Response
	select {
	case resp = <-respCh:
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("xhttp GET status: %s", resp.Status)
		}
	case err := <-errCh:
		t.Fatalf("xhttp GET: %v", err)
	case <-time.After(2 * time.Second):
		t.Fatalf("xhttp GET did not open")
	}

	payload := append(vlessHeader(id, echoPort), []byte("ping-xhttp-get")...)
	req, err := http.NewRequest(http.MethodGet, baseURL+"/0", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("xhttp GET packet req: %v", err)
	}
	req.ContentLength = int64(len(payload))
	packetResp, err := client.Do(req)
	if err != nil {
		t.Fatalf("xhttp GET packet: %v", err)
	}
	packetResp.Body.Close()
	if packetResp.StatusCode != http.StatusOK {
		t.Fatalf("xhttp GET packet status: %s", packetResp.Status)
	}

	got := make([]byte, 2+len("ping-xhttp-get"))
	if _, err := io.ReadFull(resp.Body, got); err != nil {
		t.Fatalf("xhttp read response: %v", err)
	}
	if got[0] != 0 {
		t.Fatalf("bad xhttp vless response: %v", got[:2])
	}
	if string(got[2:]) != "ping-xhttp-get" {
		t.Fatalf("xhttp echo mismatch: got %q", got[2:])
	}
}

func TestXHTTPRejectsBrowserGETWithoutSession(t *testing.T) {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		t.Fatalf("rand: %v", err)
	}
	ib := &nativeInbound{
		tag:                   "test-xhttp-browser",
		protocol:              "vless",
		transport:             "xhttp",
		path:                  normalizeXHTTPPath("/"),
		xhttpMode:             "packet-up",
		xhttpMaxEachPostBytes: 1_000_000,
		xhttpMaxBufferedPosts: 30,
		xhttpSessions:         make(map[string]*nativeXHTTPSession),
		clientsByID:           map[[16]byte]*nativeXrayClient{id: {id: id, uuid: "test", email: "test@t"}},
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("xhttp listen: %v", err)
	}
	defer ln.Close()
	go ib.serveXHTTPListener(ln)
	port := ln.Addr().(*net.TCPAddr).Port

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get("http://" + net.JoinHostPort("127.0.0.1", itoa(port)) + "/")
	if err != nil {
		t.Fatalf("browser GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("browser GET status = %d, want 400", resp.StatusCode)
	}
}

func TestParseUUID(t *testing.T) {
	got, err := parseUUID("b831381d-6324-4d53-ad4f-8cda48b30811")
	if err != nil {
		t.Fatalf("parseUUID: %v", err)
	}
	want := [16]byte{0xb8, 0x31, 0x38, 0x1d, 0x63, 0x24, 0x4d, 0x53, 0xad, 0x4f, 0x8c, 0xda, 0x48, 0xb3, 0x08, 0x11}
	if got != want {
		t.Fatalf("uuid mismatch: %x != %x", got, want)
	}
	if _, err := parseUUID("not-a-uuid"); err == nil {
		t.Fatalf("expected error for bad uuid")
	}
}

// --- minimal websocket client for the test ---

type testWSConn struct {
	net.Conn
	r       *bufio.Reader
	readBuf []byte
}

func wsClientHandshake(t *testing.T, conn net.Conn, path string) *testWSConn {
	t.Helper()
	var keyBytes [16]byte
	rand.Read(keyBytes[:])
	key := base64.StdEncoding.EncodeToString(keyBytes[:])
	req := "GET " + path + " HTTP/1.1\r\n" +
		"Host: test\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: " + key + "\r\n" +
		"Sec-WebSocket-Version: 13\r\n\r\n"
	if _, err := conn.Write([]byte(req)); err != nil {
		t.Fatalf("ws client write handshake: %v", err)
	}
	br := bufio.NewReader(conn)
	statusLine, err := br.ReadString('\n')
	if err != nil {
		t.Fatalf("ws client read status: %v", err)
	}
	if !strings.Contains(statusLine, "101") {
		t.Fatalf("ws handshake not 101: %q", statusLine)
	}
	// Verify accept header and consume the rest of the header block.
	sum := sha1.Sum([]byte(key + wsMagicGUID))
	wantAccept := base64.StdEncoding.EncodeToString(sum[:])
	sawAccept := false
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			t.Fatalf("ws client read headers: %v", err)
		}
		if strings.Contains(line, wantAccept) {
			sawAccept = true
		}
		if line == "\r\n" {
			break
		}
	}
	if !sawAccept {
		t.Fatalf("ws server did not return correct Sec-WebSocket-Accept")
	}
	return &testWSConn{Conn: conn, r: br}
}

func (c *testWSConn) Write(p []byte) (int, error) {
	// Masked client binary frame.
	var mask [4]byte
	rand.Read(mask[:])
	n := len(p)
	var hdr []byte
	switch {
	case n < 126:
		hdr = []byte{0x82, 0x80 | byte(n)}
	case n <= 0xffff:
		hdr = []byte{0x82, 0x80 | 126, byte(n >> 8), byte(n)}
	default:
		hdr = make([]byte, 4)
		hdr[0] = 0x82
		hdr[1] = 0x80 | 127
		// (8-byte length omitted; test payloads are small)
	}
	frame := append([]byte{}, hdr...)
	frame = append(frame, mask[:]...)
	masked := make([]byte, n)
	for i := range p {
		masked[i] = p[i] ^ mask[i&3]
	}
	frame = append(frame, masked...)
	if _, err := c.Conn.Write(frame); err != nil {
		return 0, err
	}
	return n, nil
}

func (c *testWSConn) Read(p []byte) (int, error) {
	for len(c.readBuf) == 0 {
		var h [2]byte
		if _, err := io.ReadFull(c.r, h[:]); err != nil {
			return 0, err
		}
		length := int64(h[1] & 0x7f)
		switch length {
		case 126:
			var ext [2]byte
			io.ReadFull(c.r, ext[:])
			length = int64(binary.BigEndian.Uint16(ext[:]))
		case 127:
			var ext [8]byte
			io.ReadFull(c.r, ext[:])
			length = int64(binary.BigEndian.Uint64(ext[:]))
		}
		payload := make([]byte, length)
		if _, err := io.ReadFull(c.r, payload); err != nil {
			return 0, err
		}
		c.readBuf = payload
	}
	n := copy(p, c.readBuf)
	c.readBuf = c.readBuf[n:]
	return n, nil
}

func itoa(n int) string { return strconv.Itoa(n) }

func TestVLESSUDPClassicDNSPacketFraming(t *testing.T) {
	// A normal DNS query commonly has bytes 2/3 == 0x01/0x00. The old native
	// auto-XUDP detector interpreted that as XUDP metadata and blocked waiting
	// for another payload, so DNS over VLESS UDP never returned.
	dnsQuery := []byte{
		0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x04, 'f', 'a', 's', 't',
		0x03, 'c', 'o', 'm', 0x00, 0x00, 0x01, 0x00, 0x01,
	}
	var framed bytes.Buffer
	if err := writeVLESSLengthPacket(&framed, dnsQuery); err != nil {
		t.Fatalf("write dns frame: %v", err)
	}
	got, err := readVLESSLengthPacket(&framed)
	if err != nil {
		t.Fatalf("read dns frame: %v", err)
	}
	if !bytes.Equal(got, dnsQuery) {
		t.Fatalf("dns payload changed: got %x want %x", got, dnsQuery)
	}
}

func TestNormalizeNativeListenHostIPv6(t *testing.T) {
	cases := map[string]string{
		"2804:10f8:ce00:520::7":       "2804:10f8:ce00:520::7",
		"[2804:10f8:ce00:520::7]":     "2804:10f8:ce00:520::7",
		"[[2804:10f8:ce00:520::7]]":   "2804:10f8:ce00:520::7",
		"[2804:10f8:ce00:520::7]:443": "2804:10f8:ce00:520::7",
		"0.0.0.0:443":                 "0.0.0.0",
		"127.0.0.1":                   "127.0.0.1",
		"":                            "0.0.0.0",
	}
	for in, want := range cases {
		if got := normalizeNativeListenHost(in); got != want {
			t.Fatalf("normalizeNativeListenHost(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNativeDialTargetKeepsIPv6Targets(t *testing.T) {
	if got := normalizeNativeTargetHost("[2606:4700:4700::1111]"); got != "2606:4700:4700::1111" {
		t.Fatalf("normalizeNativeTargetHost IPv6 bracket = %q", got)
	}
	if got := nativeDialNetwork("tcp", "2606:4700:4700::1111"); got != "tcp6" {
		t.Fatalf("IPv6 TCP target must use tcp6, got %q", got)
	}
	if got := nativeDialNetwork("udp", "2606:4700:4700::1111"); got != "udp6" {
		t.Fatalf("IPv6 UDP target must use udp6, got %q", got)
	}
	if got := nativeDialNetwork("tcp", "fast.com"); got != "tcp" {
		t.Fatalf("domain targets must stay dual-stack tcp, got %q", got)
	}
	if got := nativeDialNetwork("udp", "one.one.one.one"); got != "udp" {
		t.Fatalf("domain targets must stay dual-stack udp, got %q", got)
	}
}

func TestNativeLocalAddrForIPv6Tunnel(t *testing.T) {
	local := nativeLocalAddrForDial("tcp", "2606:4700:4700::1111", "[2804:10f8:ce00:520::7]")
	tcpAddr, ok := local.(*net.TCPAddr)
	if !ok {
		t.Fatalf("expected TCP local addr for IPv6 target, got %T", local)
	}
	if got := tcpAddr.IP.String(); got != "2804:10f8:ce00:520::7" {
		t.Fatalf("wrong TCP local IPv6 source: %q", got)
	}

	udpLocal := nativeLocalAddrForDial("udp", "2606:4700:4700::1111", "2804:10f8:ce00:520::7")
	udpAddr, ok := udpLocal.(*net.UDPAddr)
	if !ok {
		t.Fatalf("expected UDP local addr for IPv6 target, got %T", udpLocal)
	}
	if got := udpAddr.IP.String(); got != "2804:10f8:ce00:520::7" {
		t.Fatalf("wrong UDP local IPv6 source: %q", got)
	}

	if local := nativeLocalAddrForDial("tcp", "2606:4700:4700::1111", "0.0.0.0"); local != nil {
		t.Fatalf("must not bind IPv4 source to IPv6 target: %#v", local)
	}
}
