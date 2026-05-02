package main

// This file integrates a minimal DNS‑tunnel server (dnstt) into the main
// application.  It is adapted from the public‑domain dnstt-server project
// (see https://www.bamsoftware.com/software/dnstt/) but modified to
// terminate streams into the existing SSH handler (handleConn) rather than
// forwarding them to an upstream TCP service.  Each stream accepted via
// dnstt is wrapped as a net.Conn and passed to handleConn.  The DNS
// transport itself uses KCP over UDP, Noise encryption and smux
// multiplexing as in the original dnstt.

import (
	"bytes"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/xtaci/kcp-go/v5"
	"github.com/xtaci/smux"
	"golang.org/x/crypto/ssh"
	"www.bamsoftware.com/git/dnstt.git/dns"
	"www.bamsoftware.com/git/dnstt.git/noise"
	"www.bamsoftware.com/git/dnstt.git/turbotunnel"
)

// ---------- Hot-reload stop mechanism ----------

var (
	dnsttConnMu sync.Mutex
	dnsttConn   net.PacketConn // active UDP socket; closing it stops runDNSTT
)

// stopDNSTT closes the active DNSTT UDP listener, causing runDNSTT to exit.
// It is a no-op if DNSTT is not running.
func stopDNSTT() {
	dnsttConnMu.Lock()
	defer dnsttConnMu.Unlock()
	if dnsttConn != nil {
		_ = dnsttConn.Close()
		dnsttConn = nil
	}
}

// Constants mirrored from dnstt-server.  See dnstt-server/main.go for
// commentary.
const (
	// smux streams will be closed after this much time without receiving data.
	idleTimeout = 2 * time.Minute
	// How to set the TTL field in Answer resource records.
	responseTTL = 60
	// How long we may wait for downstream data before sending an empty
	// response.  This number should be less than 2 seconds (Quad9 DNS
	// timeout as of 2019).
	maxResponseDelay = 1 * time.Second
)

// We don't send UDP payloads larger than this, in an attempt to avoid
// network-layer fragmentation. 1280 is the minimum IPv6 MTU, 40 bytes is
// the size of an IPv6 header (without extension headers), and 8 bytes is
// the size of a UDP header【561853413345496†L97-L109】.
// Control this value with the -mtu command-line option in the standalone
// dnstt-server.  Here we use the default.
// maxUDPPayload defines the maximum UDP payload we ever send in a DNS
// response.  It defaults to the IPv6 minimum MTU minus the IPv6 and UDP
// header sizes (1232 octets) but is clamped per‑query in responseFor and
// sendLoop based on the EDNS UDP payload advertised by the client.  See
// startDNSTT for how this may be overridden via configuration.
var maxUDPPayload = 1280 - 40 - 8

// noEDNSFallbackPayload is the assumed UDP payload capability for resolver
// paths that do not include an EDNS(0) OPT RR (or that clamp it to 512) but
// still reliably carry larger UDP DNS messages. Many DNSTT deployments rely
// on this behaviour in the wild. This value is used as a *floor* for the
// inferred payload limit and is still clamped by maxUDPPayload.
//
// If you want strict RFC behaviour, set this to 512.
const noEDNSFallbackPayload = 932

// dnsttPrintStats controls whether periodic statistics are printed to stderr.
// It is set based on the DNSTT configuration provided by the main program.
// When false, the periodic stats will still be collected and made available
// via the admin API, but no log lines will be emitted.  The default is
// true to preserve existing behaviour.
var dnsttPrintStats = true

// DnsttStatsSnapshot holds a recent snapshot of DNSTT counters over the
// previous 5‑second window.  It is updated every 5 seconds by the
// runDNSTT goroutine.  The Timestamp field records when the snapshot was
// taken.  These values are surfaced via the admin API so that the web
// panel can display tunnel health without reading stderr logs.
type DnsttStatsSnapshot struct {
	Timestamp    time.Time `json:"timestamp"`
	DNSRx        uint64    `json:"dns_rx"`
	ParseErr     uint64    `json:"parse_err"`
	NoEDNS       uint64    `json:"no_edns"`
	Limit512     uint64    `json:"limit512"`
	RecQueued    uint64    `json:"rec_queued"`
	RecDropped   uint64    `json:"rec_dropped"`
	RespSent     uint64    `json:"resp_sent"`
	RespBytes    uint64    `json:"resp_bytes"`
	RespEmpty    uint64    `json:"resp_empty"`
	RespData     uint64    `json:"resp_data"`
	RespOversize uint64    `json:"resp_oversize"`
	KCPNew       uint64    `json:"kcp_new"`
	KCPEnd       uint64    `json:"kcp_end"`
	SmuxNew      uint64    `json:"smux_new"`
	SmuxEnd      uint64    `json:"smux_end"`
	ChLen        int       `json:"ch_len"`
}

var (
	dnsttStatsMu   sync.Mutex
	lastDnsttStats DnsttStatsSnapshot
)

// GetDNSTTStatsSnapshot returns the most recent DNSTT stats snapshot.
// It is safe for concurrent use by HTTP handlers and always returns a
// defensive copy of the snapshot.
func GetDNSTTStatsSnapshot() DnsttStatsSnapshot {
	dnsttStatsMu.Lock()
	defer dnsttStatsMu.Unlock()
	return lastDnsttStats
}

// dnsttCounters holds aggregated counters used to debug tunnel instability.
// All fields are updated via sync/atomic.
type dnsttCounters struct {
	// StreamSeq is a monotonically increasing identifier used to tag smux
	// streams as they are handed off to the SSH handler.
	StreamSeq   uint64
	DNSRx       uint64
	DNSParseErr uint64
	// NoEDNS counts DNS queries without an EDNS(0) OPT RR. In many real-world
	// deployments (especially mobile / carrier resolvers), EDNS may be stripped
	// even though the path can carry UDP responses larger than 512 bytes.
	NoEDNS uint64
	// SmallEDNS counts queries where the inferred/advertised UDP payload limit
	// is at the classic DNS size (512 bytes). Kept for backward-compatible
	// stats output.
	SmallEDNS      uint64
	RecQueued      uint64
	RecDropped     uint64
	RespSent       uint64
	RespSentBytes  uint64
	RespEmpty      uint64
	RespWithData   uint64
	RespOversize   uint64
	KCPSessionsNew uint64
	KCPSessionsEnd uint64
	SmuxStreamsNew uint64
	SmuxStreamsEnd uint64
}

var dnsttStats dnsttCounters

var maxEncodedPayloadCache sync.Map // map[int]int

// dnsttClientPayloadCap tracks an inferred per-client UDP payload capability.
// Keyed by the turbotunnel "remote address" string (a hex ClientID). We use
// this to set a per-session KCP MTU so the tunnel can function on paths that
// do not send EDNS(0) but still support UDP payloads > 512.
// dnsttClientPayloadCap stores per-client capability with a last-seen timestamp.
// This needs periodic cleanup to avoid unbounded growth when many unique client
// IDs are observed over time.
type clientCapEntry struct {
	Cap      int
	LastSeen int64 // unix nano
}

var dnsttClientPayloadCap sync.Map // map[string]clientCapEntry

var dnsttCapReaperOnce sync.Once

func startDNSTTCapReaper() {
	// Reap old client capability entries so the map can't grow forever.
	// Defaults chosen to be conservative: keep "active" client IDs for 6 hours.
	const (
		reapEvery = 10 * time.Minute
		maxAge    = 6 * time.Hour
	)
	dnsttCapReaperOnce.Do(func() {
		go func() {
			t := time.NewTicker(reapEvery)
			defer t.Stop()
			for range t.C {
				cutoff := time.Now().Add(-maxAge).UnixNano()
				dnsttClientPayloadCap.Range(func(k, v any) bool {
					e, ok := v.(clientCapEntry)
					if ok && e.LastSeen > 0 && e.LastSeen < cutoff {
						dnsttClientPayloadCap.Delete(k)
					}
					return true
				})
			}
		}()
	})
}

func dnsttClientKey(clientID turbotunnel.ClientID) string {
	return fmt.Sprintf("%x", clientID[:])
}

func updateClientPayloadCap(clientID turbotunnel.ClientID, cap int) {
	if cap <= 0 {
		return
	}
	key := dnsttClientKey(clientID)
	now := time.Now().UnixNano()
	if v, ok := dnsttClientPayloadCap.Load(key); ok {
		e := v.(clientCapEntry)
		if cap > e.Cap {
			e.Cap = cap
		}
		e.LastSeen = now
		dnsttClientPayloadCap.Store(key, e)
		return
	}
	dnsttClientPayloadCap.Store(key, clientCapEntry{Cap: cap, LastSeen: now})
}

func cachedMaxEncodedPayload(limit int) int {
	if limit <= 0 {
		return 0
	}
	if v, ok := maxEncodedPayloadCache.Load(limit); ok {
		return v.(int)
	}
	m := computeMaxEncodedPayload(limit)
	maxEncodedPayloadCache.Store(limit, m)
	return m
}

// base32Encoding is a base32 encoding without padding, as used by dnstt.
var base32Encoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// dnsttSSHConfig holds the SSH server configuration used by the DNS tunnel.
// It is set by startDNSTT before any dnstt sessions are accepted.
var dnsttSSHConfig *ssh.ServerConfig

// dnsttLog is a dedicated logger for the integrated DNSTT server.  It writes
// to stderr and uses a per-log prefix and microsecond precision.  Unlike the
// global log.Logger used by the rest of the application, this logger is not
// affected by calls to log.SetOutput in main.go (e.g. when quiet mode is
// enabled).  All log lines emitted by DNSTT should go through dnsttLog so
// that debugging output remains visible even when other logs are suppressed.
var dnsttLog = log.New(os.Stderr, "dnstt: ", log.LstdFlags|log.Lmicroseconds)

// dnsttLogBuf stores recent DNSTT log lines for the web panel.  It acts as a
// circular buffer retaining the last N log lines.  The capacity is set when
// the DNSTT server is started, typically around 100 lines to stay well
// within the configured memory budget.  Lines are stored without the
// trailing newline.  Access to the buffer is synchronized by an internal
// mutex.
type dnsttLogBuffer struct {
	mu       sync.Mutex
	lines    []string
	maxLines int
}

// newDNSTTLogBuffer constructs a new ring buffer with the given capacity.
// The capacity must be positive.
func newDNSTTLogBuffer(maxLines int) *dnsttLogBuffer {
	if maxLines <= 0 {
		maxLines = 100
	}
	return &dnsttLogBuffer{
		lines:    make([]string, 0, maxLines),
		maxLines: maxLines,
	}
}

// Write implements io.Writer and appends complete lines from p to the
// buffer.  It splits on '\n' and discards empty segments.  When the
// buffer reaches its maximum length, the oldest lines are removed to make
// room for new ones.
func (b *dnsttLogBuffer) Write(p []byte) (n int, err error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	s := string(p)
	// Split incoming data by newline.  We intentionally discard empty
	// strings to avoid blank lines from being stored.
	parts := strings.Split(s, "\n")
	for _, part := range parts {
		if part == "" {
			continue
		}
		if len(b.lines) < b.maxLines {
			b.lines = append(b.lines, part)
		} else {
			// Shift left by one and append new line at end.
			copy(b.lines, b.lines[1:])
			b.lines[len(b.lines)-1] = part
		}
	}
	return len(p), nil
}

// GetLines returns a copy of the current log lines.  The lines are
// returned in chronological order from oldest to newest.
func (b *dnsttLogBuffer) GetLines() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]string, len(b.lines))
	copy(out, b.lines)
	return out
}

// global log buffer for DNSTT logs.  It is initialised when the server
// starts.  Access via getDNSTTLogLines for concurrency safety.
var dnsttLogBuf *dnsttLogBuffer

// getDNSTTLogLines returns the current DNSTT log lines in order.  If the
// buffer has not been initialised, it returns an empty slice.
func getDNSTTLogLines() []string {
	if dnsttLogBuf == nil {
		return nil
	}
	return dnsttLogBuf.GetLines()
}

// startDNSTT starts the integrated dnstt server if cfg is non-nil.  It reads
// the Noise private key from cfg.PrivKeyFile, parses cfg.Domain into a dns.Name,
// and then launches runDNSTT in a goroutine.  Any errors during start are
// logged.  The SSH server configuration is used when handling streams.
func startDNSTT(cfg *DNSTTConfig, sshConf *ssh.ServerConfig) {
	if cfg == nil {
		return
	}
	startDNSTTCapReaper()
	dnsttSSHConfig = sshConf
	// Configure whether periodic DNSTT statistics should be emitted to stderr.
	// When DisableStatsLog is true, stats will be collected but log lines are suppressed.
	if cfg != nil {
		dnsttPrintStats = !cfg.DisableStatsLog
		// Initialise the log buffer once.  Use a capacity of 100 lines (~few KB).
		if dnsttLogBuf == nil {
			dnsttLogBuf = newDNSTTLogBuffer(100)
		}
		// Configure the DNSTT logger output.  If DisableConsoleLog is set,
		// write only to the buffer; otherwise tee to both the buffer and stderr.
		if cfg.DisableConsoleLog {
			dnsttLog.SetOutput(dnsttLogBuf)
		} else {
			dnsttLog.SetOutput(io.MultiWriter(dnsttLogBuf, os.Stderr))
		}
	}
	// Read the private key from file.
	f, err := os.Open(cfg.PrivKeyFile)
	if err != nil {
		dnsttLog.Printf("cannot open privkey file %s: %v", cfg.PrivKeyFile, err)
		return
	}
	privkey, err := noise.ReadKey(f)
	f.Close()
	if err != nil {
		dnsttLog.Printf("cannot read privkey from file: %v", err)
		return
	}
	// Parse the domain name.  dns.ParseName accepts a domain with a trailing
	// dot or without.  Any error here will abort the dnstt server.
	domain, err := dns.ParseName(cfg.Domain)
	if err != nil {
		dnsttLog.Printf("invalid domain %q: %v", cfg.Domain, err)
		return
	}
	// Log initialisation parameters so DNSTT startup is visible even when
	// quiet logging is enabled.  This helps with debugging.
	dnsttLog.Printf("starting: domain=%q udp_listen=%q privkey=%q", cfg.Domain, cfg.UDPListen, cfg.PrivKeyFile)
	go func() {
		if err := runDNSTT(privkey, domain, cfg.UDPListen); err != nil {
			dnsttLog.Printf("server exited with error: %v", err)
		}
	}()
}

// handleDNSTTStream accepts a smux.Stream from a client and hands it off to
// handleConn.  The stream is wrapped as a net.Conn by streamConn so that
// handleConn sees a minimal net.Conn interface.  This function blocks until
// handleConn returns, then returns nil.  Any errors from handleConn are
// ignored; they are logged by handleConn itself.
func handleDNSTTStream(stream *smux.Stream, conv uint32) error {
	// Assign a per-stream sequence number to help correlate open/close events.
	sid := atomic.AddUint64(&dnsttStats.StreamSeq, 1)
	start := time.Now()
	dnsttLog.Printf("ssh stream begin: conv=%d sid=%d", conv, sid)
	sc := &streamConn{Stream: stream}
	// Delegate to the existing SSH connection handler.  This call blocks
	// until the SSH connection terminates.  The smux stream will be closed
	// by handleConn when it returns.
	handleConn(sc, dnsttSSHConfig)
	dnsttLog.Printf("ssh stream end: conv=%d sid=%d duration=%s", conv, sid, time.Since(start))
	return nil
}

// streamConn adapts a smux.Stream to the net.Conn interface expected by
// handleConn.  smux.Stream already implements Read and Write, but does not
// satisfy net.Conn because it lacks methods for deadlines and addresses.  We
// implement those methods with no‑ops and placeholder addresses.
type streamConn struct {
	*smux.Stream
}

func (s *streamConn) LocalAddr() net.Addr                { return dummyAddr{} }
func (s *streamConn) RemoteAddr() net.Addr               { return dummyAddr{} }
func (s *streamConn) SetDeadline(t time.Time) error      { return nil }
func (s *streamConn) SetReadDeadline(t time.Time) error  { return nil }
func (s *streamConn) SetWriteDeadline(t time.Time) error { return nil }

// dummyAddr is a stand‑in net.Addr implementation for dnstt streams.  It
// reports a generic network and address; this satisfies the net.Conn
// interface.  handleConn logs the remote address, but here we provide
// "dnstt" as both network and address to indicate a tunnelled connection.
type dummyAddr struct{}

func (d dummyAddr) Network() string { return "dnstt" }
func (d dummyAddr) String() string  { return "dnstt" }

// acceptDNSTTStreams wraps a KCP session in a Noise channel and an smux
// Session, then waits for smux streams.  Each stream is passed to
// handleDNSTTStream.  Any errors from the Noise or smux layers are returned.
func acceptDNSTTStreams(conn *kcp.UDPSession, privkey []byte) error {
	// Put a Noise channel on top of the KCP conn.
	rw, err := noise.NewServer(conn, privkey)
	if err != nil {
		return err
	}

	// Put an smux session on top of the encrypted Noise channel.
	smuxConfig := smux.DefaultConfig()
	smuxConfig.Version = 2
	smuxConfig.KeepAliveTimeout = idleTimeout
	smuxConfig.MaxStreamBuffer = 1 * 1024 * 1024
	sess, err := smux.Server(rw, smuxConfig)
	if err != nil {
		return err
	}
	defer sess.Close()

	for {
		stream, err := sess.AcceptStream()
		if err != nil {
			if err, ok := err.(net.Error); ok && err.Temporary() {
				continue
			}
			return err
		}
		// Log the creation of each new smux stream.  Reporting the conv helps
		// to correlate streams with their parent KCP session.
		atomic.AddUint64(&dnsttStats.SmuxStreamsNew, 1)
		dnsttLog.Printf("new smux stream: conv=%d", conn.GetConv())
		// For each new smux stream, hand it off to our SSH handler.
		go func(s *smux.Stream, conv uint32) {
			defer s.Close()
			_ = handleDNSTTStream(s, conv)
			atomic.AddUint64(&dnsttStats.SmuxStreamsEnd, 1)
			dnsttLog.Printf("smux stream closed: conv=%d", conv)
		}(stream, conn.GetConv())
	}
}

// acceptDNSTTSessions listens for incoming KCP connections and passes them to
// acceptDNSTTStreams.  It configures window sizes and MTU on each accepted
// session as in the original dnstt-server.
func acceptDNSTTSessions(ln *kcp.Listener, privkey []byte, mtu int) error {
	for {
		conn, err := ln.AcceptKCP()
		if err != nil {
			if err, ok := err.(net.Error); ok && err.Temporary() {
				continue
			}
			return err
		}
		from := conn.RemoteAddr().String()
		// Choose a per-session MTU derived from the inferred/advertised UDP payload
		// capability for this client. This is essential on paths that clamp UDP
		// payloads below our global cap (e.g. ~930), because KCP packets larger than
		// what can fit in a single DNS response will cause the tunnel to stall.
		effectiveLimit := maxUDPPayload
		if v, ok := dnsttClientPayloadCap.Load(from); ok {
			effectiveLimit = v.(clientCapEntry).Cap
			if effectiveLimit < 512 {
				effectiveLimit = 512
			}
			if effectiveLimit > maxUDPPayload {
				effectiveLimit = maxUDPPayload
			}
		}
		maxEnc := cachedMaxEncodedPayload(effectiveLimit)
		mtuSession := mtu
		if maxEnc > 0 {
			if m := maxEnc - 2; m >= 80 {
				mtuSession = m
			}
		}
		// Log each newly accepted KCP session. Include conversation ID, remote address
		// (ClientID), and the chosen MTU.
		atomic.AddUint64(&dnsttStats.KCPSessionsNew, 1)
		dnsttLog.Printf("new KCP session: conv=%d from=%s mtu=%d limit=%d", conn.GetConv(), from, mtuSession, effectiveLimit)
		// Permit coalescing the payloads of consecutive sends.
		conn.SetStreamMode(true)
		// Disable the dynamic congestion window (limit only by the maximum of
		// local and remote static windows).
		conn.SetNoDelay(0, 0, 0, 1)
		conn.SetWindowSize(turbotunnel.QueueSize/2, turbotunnel.QueueSize/2)
		if rc := conn.SetMtu(mtuSession); !rc {
			panic(rc)
		}
		go func(c *kcp.UDPSession, conv uint32, from string) {
			defer c.Close()
			err := acceptDNSTTStreams(c, privkey)
			atomic.AddUint64(&dnsttStats.KCPSessionsEnd, 1)
			if err != nil && err != io.ErrClosedPipe {
				dnsttLog.Printf("kcp session closed: conv=%d from=%s err=%v", conv, from, err)
			} else {
				dnsttLog.Printf("kcp session closed: conv=%d from=%s", conv, from)
			}
		}(conn, conn.GetConv(), conn.RemoteAddr().String())
	}
}

// record represents a DNS message appropriate for a response to a previously
// received query, along with metadata necessary for sending the response.
// recvLoop sends instances of record to sendLoop via a channel. sendLoop
// receives instances of record and may fill in the message's Answer section
// before sending it.
type record struct {
	Resp     *dns.Message
	Addr     net.Addr
	ClientID turbotunnel.ClientID
	// PayloadLimit holds the maximum UDP payload size advertised by the
	// client via EDNS(0).  sendLoop uses this to clamp outgoing DNS
	// responses so they never exceed what the client claims it will
	// accept.  A zero value means no per‑client limit and defaults to
	// maxUDPPayload.
	PayloadLimit int
}

// nextPacket reads the next length‑prefixed packet from r, ignoring padding.
// It returns a nil error only when a packet was read successfully.  It
// returns io.EOF only when there were 0 bytes remaining to read from r.  It
// returns io.ErrUnexpectedEOF when EOF occurs in the middle of an encoded
// packet.  See dnstt-server/main.go for details.
func nextPacket(r *bytes.Reader) ([]byte, error) {
	eof := func(err error) error {
		if err == io.EOF {
			err = io.ErrUnexpectedEOF
		}
		return err
	}
	for {
		prefix, err := r.ReadByte()
		if err != nil {
			// We may return a real io.EOF only here.
			return nil, err
		}
		if prefix >= 224 {
			paddingLen := prefix - 224
			_, err := io.CopyN(io.Discard, r, int64(paddingLen))
			if err != nil {
				return nil, eof(err)
			}
		} else {
			p := make([]byte, int(prefix))
			_, err = io.ReadFull(r, p)
			return p, eof(err)
		}
	}
}

// responseFor constructs a response dns.Message that is appropriate for query.
// Along with the dns.Message, it returns the query's decoded data payload. If
// the returned dns.Message is nil, it means that there should be no response
// to this query. If the returned dns.Message has an Rcode() of
// dns.RcodeNoError, the message is a candidate for carrying downstream data
// in a TXT record.  This function is adapted from dnstt-server/main.go.
func responseFor(query *dns.Message, domain dns.Name) (*dns.Message, []byte) {
	resp := &dns.Message{
		ID:       query.ID,
		Flags:    0x8000, // QR = 1, RCODE = no error
		Question: query.Question,
	}
	if query.Flags&0x8000 != 0 {
		// QR != 0, this is not a query. Don't even send a response.
		return nil, nil
	}
	// Check for EDNS(0) support. Include our own OPT RR only if we receive
	// one from the requester.
	payloadSize := 0
	for _, rr := range query.Additional {
		if rr.Type != dns.RRTypeOPT {
			continue
		}
		version := (rr.TTL >> 16) & 0xff
		if version != 0 {
			resp.Flags |= dns.ExtendedRcodeBadVers & 0xf
			additional := dns.RR{
				Name:  dns.Name{},
				Type:  dns.RRTypeOPT,
				Class: 0,
				TTL:   (dns.ExtendedRcodeBadVers >> 4) << 24,
				Data:  []byte{},
			}
			resp.Additional = append(resp.Additional, additional)
			return resp, nil
		}
		payloadSize = int(rr.Class)
	}
	if payloadSize < 512 {
		payloadSize = 512
	}
	// There must be exactly one question.
	if len(query.Question) != 1 {
		resp.Flags |= dns.RcodeFormatError
		dnsttLog.Printf("FORMERR: too few or too many questions (%d)", len(query.Question))
		return resp, nil
	}
	question := query.Question[0]
	// Check the name to see if it ends in our chosen domain, and extract
	// all that comes before the domain if it does. If it does not, we
	// return RcodeNameError.
	prefix, ok := question.Name.TrimSuffix(domain)
	if !ok {
		resp.Flags |= dns.RcodeNameError
		// NXDOMAIN: not authoritative for this name
		return resp, nil
	}
	resp.Flags |= 0x0400 // AA = 1
	if query.Opcode() != 0 {
		resp.Flags |= dns.RcodeNotImplemented
		return resp, nil
	}
	if question.Type != dns.RRTypeTXT {
		// We only support QTYPE == TXT.
		resp.Flags |= dns.RcodeNameError
		return resp, nil
	}
	encoded := bytes.ToUpper(bytes.Join(prefix, nil))
	payload := make([]byte, base32Encoding.DecodedLen(len(encoded)))
	n, err := base32Encoding.Decode(payload, encoded)
	if err != nil {
		resp.Flags |= dns.RcodeNameError
		return resp, nil
	}
	payload = payload[:n]
	// Do not reject queries advertising a smaller EDNS UDP payload than
	// maxUDPPayload.  We clamp responses to the client‑advertised size
	// later in sendLoop.
	return resp, payload
}

// recvLoop repeatedly calls dnsConn.ReadFrom, extracts the packets contained in
// the incoming DNS queries, and puts them on ttConn's incoming queue.
// Whenever a query calls for a response, constructs a partial response and
// passes it to sendLoop over ch.
func recvLoop(domain dns.Name, dnsConn net.PacketConn, ttConn *turbotunnel.QueuePacketConn, ch chan<- *record) error {
	for {
		var buf [4096]byte
		n, addr, err := dnsConn.ReadFrom(buf[:])
		if err != nil {
			if err, ok := err.(net.Error); ok && err.Temporary() {
				dnsttLog.Printf("ReadFrom temporary error: %v", err)
				continue
			}
			return err
		}
		atomic.AddUint64(&dnsttStats.DNSRx, 1)
		// Parse DNS query.
		query, err := dns.MessageFromWireFormat(buf[:n])
		if err != nil {
			atomic.AddUint64(&dnsttStats.DNSParseErr, 1)
			dnsttLog.Printf("cannot parse DNS query: %v", err)
			continue
		}
		// Determine an effective UDP payload limit for this query.
		//
		// Prefer EDNS(0) if present. However, many resolver paths strip EDNS while
		// still allowing UDP responses larger than 512. For those paths, infer a
		// practical limit from the observed query size (if we received a ~900-byte
		// query, the path clearly supports >512 UDP). Clamp to our global cap.
		payloadLimit := 0
		hasEDNS := false
		for _, rr := range query.Additional {
			if rr.Type != dns.RRTypeOPT {
				continue
			}
			hasEDNS = true
			// The lower 16 bits of the Class field of the OPT RR specify the
			// requestor's maximum UDP payload size (RFC 6891).
			sz := int(rr.Class)
			if sz < 512 {
				sz = 512
			}
			payloadLimit = sz
			break
		}
		if !hasEDNS {
			atomic.AddUint64(&dnsttStats.NoEDNS, 1)
			payloadLimit = n
			if payloadLimit < 512 {
				payloadLimit = 512
			}
		} else {
			// If EDNS is present but appears to under-advertise the true path MTU,
			// treat the observed query size as a lower bound. Some resolvers clamp or
			// rewrite EDNS values even though they can carry larger UDP payloads.
			if n > payloadLimit {
				payloadLimit = n
			}
		}
		// Many resolver paths do not include EDNS (or clamp it to 512) but still
		// reliably carry larger UDP DNS messages (commonly ~900 bytes). For DNSTT
		// this matters because downstream data rides in responses; treating such
		// paths as strictly 512-byte causes the tunnel to stall.
		//
		// noEDNSFallbackPayload acts as a floor for these cases; if you want strict
		// RFC 1035 behaviour, set it to 512.
		if payloadLimit < noEDNSFallbackPayload {
			payloadLimit = noEDNSFallbackPayload
		}
		if payloadLimit > maxUDPPayload {
			payloadLimit = maxUDPPayload
		}
		if payloadLimit == 512 {
			atomic.AddUint64(&dnsttStats.SmallEDNS, 1)
		}
		resp, payload := responseFor(&query, domain)
		// Extract ClientID
		var clientID turbotunnel.ClientID
		n = copy(clientID[:], payload)
		payload = payload[n:]
		if n == len(clientID) {
			// Update our per-client capability estimate so we can choose a suitable
			// per-session KCP MTU even when EDNS is stripped.
			updateClientPayloadCap(clientID, payloadLimit)
			// Feed packets into KCP.
			r := bytes.NewReader(payload)
			for {
				p, err := nextPacket(r)
				if err != nil {
					break
				}
				ttConn.QueueIncoming(p, clientID)
			}
		} else {
			if resp != nil && resp.Rcode() == dns.RcodeNoError {
				resp.Flags |= dns.RcodeNameError
			}
		}
		if resp != nil {
			// Push this record along with the per‑client payload limit to the sender.
			rec := &record{
				Resp:         resp,
				Addr:         addr,
				ClientID:     clientID,
				PayloadLimit: payloadLimit,
			}
			select {
			case ch <- rec:
				atomic.AddUint64(&dnsttStats.RecQueued, 1)
			default:
				d := atomic.AddUint64(&dnsttStats.RecDropped, 1)
				// Log occasionally to avoid flooding logs under sustained overload.
				if d == 1 || d%1000 == 0 {
					dnsttLog.Printf("dropping response record: ch_len=%d ch_cap=%d dropped=%d", len(ch), cap(ch), d)
				}
			}
		}
	}
}

// sendLoop repeatedly receives records from ch.  Those that represent an
// error response are sent immediately.  Those that represent a response
// capable of carrying data are packed full of as many packets as will fit
// while keeping the total size under maxEncodedPayload, then sent.
func sendLoop(dnsConn net.PacketConn, ttConn *turbotunnel.QueuePacketConn, ch <-chan *record, maxEncodedPayload int) error {
	var nextRec *record
	for {
		rec := nextRec
		nextRec = nil
		if rec == nil {
			var ok bool
			rec, ok = <-ch
			if !ok {
				break
			}
		}
		// Determine the effective per-query UDP payload limit.
		//
		// rec.PayloadLimit comes from EDNS(0) and our heuristic floor/observations.
		// Additionally, we maintain a per-client learned capability (dnsttClientPayloadCap)
		// that can be promoted when we observe that larger downstream responses are
		// needed and appear to be supported. Use the larger of the two, then clamp
		// to our global cap.
		effectivePayloadLimit := rec.PayloadLimit
		if v, ok := dnsttClientPayloadCap.Load(dnsttClientKey(rec.ClientID)); ok {
			if cap := v.(clientCapEntry).Cap; cap > effectivePayloadLimit {
				effectivePayloadLimit = cap
			}
		}
		if effectivePayloadLimit <= 0 {
			effectivePayloadLimit = maxUDPPayload
		}
		if effectivePayloadLimit > maxUDPPayload {
			effectivePayloadLimit = maxUDPPayload
		}
		// Compute a per-limit "max encoded payload" so we avoid generating a DNS
		// response that would need truncation (TC). Truncation breaks DNSTT because
		// resolvers retry over TCP, which we don't support here.
		maxEnc := cachedMaxEncodedPayload(effectivePayloadLimit)
		if maxEnc < 0 {
			maxEnc = 0
		}
		// Note: KCP MTU is set per session in acceptDNSTTSessions based on inferred
		// per-client capability, so we do not warn here about MTU mismatches.

		if rec.Resp.Rcode() == dns.RcodeNoError && len(rec.Resp.Question) == 1 {
			// It's a non-error response, so we can fill the Answer section.
			rec.Resp.Answer = []dns.RR{{
				Name:  rec.Resp.Question[0].Name,
				Type:  rec.Resp.Question[0].Type,
				Class: rec.Resp.Question[0].Class,
				TTL:   responseTTL,
				Data:  nil,
			}}
			var payload bytes.Buffer
			limit := maxEnc
			timer := time.NewTimer(maxResponseDelay)
			packets := 0
			for {
				var p []byte
				unstash := ttConn.Unstash(rec.ClientID)
				outgoing := ttConn.OutgoingQueue(rec.ClientID)
				select {
				case p = <-unstash:
				default:
					select {
					case p = <-unstash:
					case p = <-outgoing:
					default:
						select {
						case p = <-unstash:
						case p = <-outgoing:
						case <-timer.C:
						case nextRec = <-ch:
						}
					}
				}
				timer.Reset(0)
				if len(p) == 0 {
					break
				}
				limit -= 2 + len(p)
				// Never exceed the per-query maximum encoded payload. If the next packet
				// would overflow, stash it for the next response (even if this would have
				// been the first packet).
				if limit < 0 {
					ttConn.Stash(p, rec.ClientID)
					break
				}
				binary.Write(&payload, binary.BigEndian, uint16(len(p)))
				payload.Write(p)
				packets++
			}
			timer.Stop()
			rec.Resp.Answer[0].Data = dns.EncodeRDataTXT(payload.Bytes())
			if packets == 0 {
				atomic.AddUint64(&dnsttStats.RespEmpty, 1)
			} else {
				atomic.AddUint64(&dnsttStats.RespWithData, 1)
			}
		}
		buf, err := rec.Resp.WireFormat()
		if err != nil {
			dnsttLog.Printf("resp WireFormat: %v", err)
			continue
		}
		if len(buf) > effectivePayloadLimit {
			// The resolver may under-advertise (or omit) its UDP payload limit while
			// still accepting larger UDP responses. Rather than dropping downstream
			// data (which can stall DNSTT), treat this as a hint and promote the
			// per-client inferred payload capability.
			atomic.AddUint64(&dnsttStats.RespOversize, 1)
			promoteTo := len(buf)
			if promoteTo > maxUDPPayload {
				dnsttLog.Printf("oversize DNS response: size=%d limit=%d cap=%d (dropping)", len(buf), effectivePayloadLimit, maxUDPPayload)
				continue
			}
			updateClientPayloadCap(rec.ClientID, promoteTo)
			dnsttLog.Printf("oversize DNS response: size=%d limit=%d -> promote client to %d", len(buf), effectivePayloadLimit, promoteTo)
			// After promotion, allow this response to be sent.
			effectivePayloadLimit = promoteTo
		}
		_, err = dnsConn.WriteTo(buf, rec.Addr)
		if err != nil {
			if err, ok := err.(net.Error); ok && err.Temporary() {
				dnsttLog.Printf("WriteTo temporary error: %v", err)
				continue
			}
			return err
		}
		atomic.AddUint64(&dnsttStats.RespSent, 1)
		atomic.AddUint64(&dnsttStats.RespSentBytes, uint64(len(buf)))
	}
	return nil
}

// computeMaxEncodedPayload computes the maximum amount of downstream TXT RR
// data that keep the overall response size less than maxUDPPayload, in the
// worst case when the response answers a query that has a maximum-length name
// in its Question section.  Returns 0 in the case that no amount of data
// makes the overall response size small enough.
func computeMaxEncodedPayload(limit int) int {
	maxLengthName, err := dns.NewName([][]byte{
		[]byte("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
		[]byte("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
		[]byte("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
		[]byte("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
	})
	if err != nil {
		panic(err)
	}
	{
		n := 0
		for _, label := range maxLengthName {
			n += len(label) + 1
		}
		n += 1
		if n != 255 {
			panic(fmt.Sprintf("dnstt: max-length name is %d octets, should be %d", n, 255))
		}
	}
	queryLimit := uint16(limit)
	if int(queryLimit) != limit {
		queryLimit = 0xffff
	}
	query := &dns.Message{
		Question: []dns.Question{{
			Name:  maxLengthName,
			Type:  dns.RRTypeTXT,
			Class: dns.RRTypeTXT,
		}},
		Additional: []dns.RR{{
			Name:  dns.Name{},
			Type:  dns.RRTypeOPT,
			Class: uint16(queryLimit),
			TTL:   0,
			Data:  []byte{},
		}},
	}
	resp, _ := responseFor(query, dns.Name([][]byte{}))
	resp.Answer = []dns.RR{{
		Name:  query.Question[0].Name,
		Type:  query.Question[0].Type,
		Class: query.Question[0].Class,
		TTL:   responseTTL,
		Data:  nil,
	}}
	low := 0
	high := 32768
	for low+1 < high {
		mid := (low + high) / 2
		resp.Answer[0].Data = dns.EncodeRDataTXT(make([]byte, mid))
		buf, err := resp.WireFormat()
		if err != nil {
			panic(err)
		}
		if len(buf) <= limit {
			low = mid
		} else {
			high = mid
		}
	}
	return low
}

// runDNSTT starts a dnstt server on udpListen.  It computes the effective
// MTU based on the configured maxUDPPayload, then accepts KCP sessions and
// handles DNS queries.  Errors are returned only for fatal conditions.
func runDNSTT(privkey []byte, domain dns.Name, udpListen string) error {
	dnsConn, err := net.ListenPacket("udp", udpListen)
	if err != nil {
		return fmt.Errorf("dnstt: opening UDP listener on %s: %v", udpListen, err)
	}
	if udp, ok := dnsConn.(*net.UDPConn); ok {
		_ = udp.SetReadBuffer(4 * 1024 * 1024)
		_ = udp.SetWriteBuffer(4 * 1024 * 1024)
	}

	// Register so stopDNSTT() can close this socket and unblock the read loop.
	dnsttConnMu.Lock()
	if dnsttConn != nil {
		_ = dnsttConn.Close()
	}
	dnsttConn = dnsConn
	dnsttConnMu.Unlock()
	// Log readiness of the UDP listener.
	dnsttLog.Printf("udp listener ready on %s", udpListen)
	// compute maximum encoded payload and resulting MTU
	maxEncodedPayload := computeMaxEncodedPayload(maxUDPPayload)
	mtu := maxEncodedPayload - 2
	if mtu < 80 {
		if mtu < 0 {
			mtu = 0
		}
		return fmt.Errorf("dnstt: computed MTU %d too small", mtu)
	}
	// set up turbotunnel and KCP listener
	ttConn := turbotunnel.NewQueuePacketConn(turbotunnel.DummyAddr{}, idleTimeout*2)
	ln, err := kcp.ServeConn(nil, 0, 0, ttConn)
	if err != nil {
		return fmt.Errorf("dnstt: opening KCP listener: %v", err)
	}
	go func() {
		if err := acceptDNSTTSessions(ln, privkey, mtu); err != nil {
			dnsttLog.Printf("acceptSessions error: %v", err)
		}
	}()
	// NOTE: This channel buffers pending DNS response records. Keeping this
	// extremely large can look like a "memory leak" under bursty load because
	// records (and their associated allocations) are retained until drained.
	// A moderate size provides smoothing while still applying backpressure.
	ch := make(chan *record, 20000)
	// Periodically aggregate DNSTT counters.  This goroutine runs every 5 seconds,
	// resetting the atomic counters, storing them in lastDnsttStats and optionally
	// emitting a log line.  Even when dnsttPrintStats is false, statistics will
	// still be collected and made available via the admin API.
	go func() {
		t := time.NewTicker(5 * time.Second)
		defer t.Stop()
		for range t.C {
			dnsRx := atomic.SwapUint64(&dnsttStats.DNSRx, 0)
			parseErr := atomic.SwapUint64(&dnsttStats.DNSParseErr, 0)
			noEDNS := atomic.SwapUint64(&dnsttStats.NoEDNS, 0)
			limit512 := atomic.SwapUint64(&dnsttStats.SmallEDNS, 0)
			queued := atomic.SwapUint64(&dnsttStats.RecQueued, 0)
			dropped := atomic.SwapUint64(&dnsttStats.RecDropped, 0)
			respSent := atomic.SwapUint64(&dnsttStats.RespSent, 0)
			respBytes := atomic.SwapUint64(&dnsttStats.RespSentBytes, 0)
			respEmpty := atomic.SwapUint64(&dnsttStats.RespEmpty, 0)
			respData := atomic.SwapUint64(&dnsttStats.RespWithData, 0)
			over := atomic.SwapUint64(&dnsttStats.RespOversize, 0)
			kcpNew := atomic.SwapUint64(&dnsttStats.KCPSessionsNew, 0)
			kcpEnd := atomic.SwapUint64(&dnsttStats.KCPSessionsEnd, 0)
			smuxNew := atomic.SwapUint64(&dnsttStats.SmuxStreamsNew, 0)
			smuxEnd := atomic.SwapUint64(&dnsttStats.SmuxStreamsEnd, 0)
			// Update the snapshot
			dnsttStatsMu.Lock()
			lastDnsttStats = DnsttStatsSnapshot{
				Timestamp:    time.Now(),
				DNSRx:        dnsRx,
				ParseErr:     parseErr,
				NoEDNS:       noEDNS,
				Limit512:     limit512,
				RecQueued:    queued,
				RecDropped:   dropped,
				RespSent:     respSent,
				RespBytes:    respBytes,
				RespEmpty:    respEmpty,
				RespData:     respData,
				RespOversize: over,
				KCPNew:       kcpNew,
				KCPEnd:       kcpEnd,
				SmuxNew:      smuxNew,
				SmuxEnd:      smuxEnd,
				ChLen:        len(ch),
			}
			dnsttStatsMu.Unlock()
			// Optionally log the snapshot to stderr
			if dnsttPrintStats {
				dnsttLog.Printf(
					"stats 5s: dns_rx=%d parse_err=%d no_edns=%d limit512=%d rec_queued=%d rec_dropped=%d resp_sent=%d resp_bytes=%d resp_empty=%d resp_data=%d resp_oversize=%d kcp_new=%d kcp_end=%d smux_new=%d smux_end=%d ch_len=%d",
					dnsRx, parseErr, noEDNS, limit512, queued, dropped, respSent, respBytes, respEmpty, respData, over, kcpNew, kcpEnd, smuxNew, smuxEnd, len(ch),
				)
			}
		}
	}()
	go func() {
		if err := sendLoop(dnsConn, ttConn, ch, maxEncodedPayload); err != nil {
			dnsttLog.Printf("sendLoop error: %v", err)
		}
	}()
	return recvLoop(domain, dnsConn, ttConn, ch)
}

// ---- Key management API handlers ----

const dnsttKeyFile = "/opt/sshpanel/dnstt.key"

// handleDnsttGenKey generates a new Noise keypair, saves the private key to
// dnsttKeyFile, and returns the hex-encoded public key.
func handleDnsttGenKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	privkey, err := noise.GeneratePrivkey()
	if err != nil {
		http.Error(w, "keygen: "+err.Error(), http.StatusInternalServerError)
		return
	}
	f, err := os.OpenFile(dnsttKeyFile, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		http.Error(w, "write key: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := noise.WriteKey(f, privkey); err != nil {
		f.Close()
		http.Error(w, "write key: "+err.Error(), http.StatusInternalServerError)
		return
	}
	f.Close()
	pubkey := noise.PubkeyFromPrivkey(privkey)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"privkey_file": dnsttKeyFile,
		"pubkey":       noise.EncodeKey(pubkey),
	})
}

// handleDnsttGetPubKey reads the configured private key and returns the
// corresponding public key so the admin can share it with dnstt clients.
func handleDnsttGetPubKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	cfg := getGlobalCfg()
	keyPath := dnsttKeyFile
	if cfg != nil && cfg.DNSTT != nil && cfg.DNSTT.PrivKeyFile != "" {
		keyPath = cfg.DNSTT.PrivKeyFile
	}
	f, err := os.Open(keyPath)
	if err != nil {
		http.Error(w, "open key: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer f.Close()
	privkey, err := noise.ReadKey(f)
	if err != nil {
		http.Error(w, "read key: "+err.Error(), http.StatusInternalServerError)
		return
	}
	pubkey := noise.PubkeyFromPrivkey(privkey)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"pubkey": noise.EncodeKey(pubkey),
	})
}
