package main

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/time/rate"
)

const (
	nativeMuxStatusNew       = 0x01
	nativeMuxStatusKeep      = 0x02
	nativeMuxStatusEnd       = 0x03
	nativeMuxStatusKeepAlive = 0x04

	nativeMuxOptionData  = 0x01
	nativeMuxOptionError = 0x02

	nativeMuxNetworkTCP = 0x01
	nativeMuxNetworkUDP = 0x02

	// Keep packet buffers below the kernel max. Mux packets are length-prefixed and
	// capped at nativeUDPMaxPacket, so larger buffers only increase memory pressure.
)

type nativeMuxMetadata struct {
	sessionID uint16
	status    byte
	option    byte
	network   byte
	host      string
	port      uint16
	globalID  [8]byte
}

type nativeMuxPacket struct {
	payload []byte
	host    string
	port    uint16
	discard bool
}

// nativeMuxUplinkItem is one client->backend datagram/segment handed from the
// shared mux read loop to a session's own uplink goroutine. The payload is a
// private copy because the read loop reuses its scratch buffer immediately.
type nativeMuxUplinkItem struct {
	payload []byte
	host    string
	port    uint16
}

// nativeMuxUplinkQueue bounds how many un-written uplink items a single mux
// session may buffer before the shared read loop applies backpressure. This
// isolates a slow/backpressured backend to its own session instead of stalling
// every other session multiplexed on the same client connection.
const nativeMuxUplinkQueue = 64

var nativeMuxFramePool = sync.Pool{
	New: func() any {
		b := make([]byte, 0, 2+512+2+nativeUDPMaxPacket)
		return &b
	},
}

type nativeMuxSession struct {
	id      uint16
	network byte
	xudp    bool

	tcp net.Conn
	udp net.PacketConn

	udpNetwork string
	udpTarget  net.Addr

	lastUDPHost string
	lastUDPPort uint16
	lastUDPAddr net.Addr

	writeMu *sync.Mutex
	client  io.Writer
	uuid    string
	email   string

	upLimiter   *rate.Limiter
	downLimiter *rate.Limiter
	upMeter     *trafficMeter
	downMeter   *trafficMeter

	uplink      chan nativeMuxUplinkItem
	closed      chan struct{}
	closeOnce   sync.Once
	ctx         context.Context
	cancel      context.CancelFunc
	onClose     func(*nativeMuxSession)
	releaseSlot func()
	globalID    [8]byte
}

var nativeMuxGlobalActive atomic.Int64

func acquireNativeMuxGlobalSlot() (func(), bool) {
	limit := int64(nativeMuxGlobalSessionLimit())
	if limit <= 0 {
		return func() {}, true
	}
	for {
		cur := nativeMuxGlobalActive.Load()
		if cur >= limit {
			return nil, false
		}
		if nativeMuxGlobalActive.CompareAndSwap(cur, cur+1) {
			var once sync.Once
			return func() { once.Do(func() { nativeMuxGlobalActive.Add(-1) }) }, true
		}
	}
}

// nativeVLESSMuxTunnel implements the server side of Xray's Mux.Cool framing
// for VLESS CommandMux. CommandMux does not carry a VLESS target address; every
// child TCP/UDP request is described by mux frame metadata. UDP is treated as a
// packet protocol, not as a byte stream, and XUDP-style GlobalID/endpoint
// metadata is accepted for full-cone friendly clients.
func (ib *nativeInbound) nativeVLESSMuxTunnel(stream io.ReadWriteCloser, uuid, email string) {
	defer xrayRecover(fmt.Sprintf("native xray VLESS mux user=%s", email))
	xrayMgr.recordNativeConnect(uuid, email)
	defer xrayMgr.recordNativeDisconnect(uuid, email)

	writeMu := &sync.Mutex{}
	sessions := make(map[uint16]*nativeMuxSession)
	xudpSessions := make(map[[8]byte]*nativeMuxSession)
	readScratch := make([]byte, 0, nativeUDPMaxPacket)
	var mu sync.Mutex

	removeSession := func(s *nativeMuxSession) {
		if s == nil {
			return
		}
		mu.Lock()
		if cur := sessions[s.id]; cur == s {
			delete(sessions, s.id)
		}
		if s.xudp && s.globalID != [8]byte{} {
			if cur := xudpSessions[s.globalID]; cur == s {
				delete(xudpSessions, s.globalID)
			}
		}
		mu.Unlock()
	}

	closeSession := func(id uint16) {
		mu.Lock()
		s := sessions[id]
		if s != nil {
			delete(sessions, id)
			if s.xudp && s.globalID != [8]byte{} {
				delete(xudpSessions, s.globalID)
			}
		}
		mu.Unlock()
		if s != nil {
			s.closeBackend()
		}
	}

	defer func() {
		mu.Lock()
		all := make([]*nativeMuxSession, 0, len(sessions))
		for _, s := range sessions {
			all = append(all, s)
		}
		sessions = make(map[uint16]*nativeMuxSession)
		xudpSessions = make(map[[8]byte]*nativeMuxSession)
		mu.Unlock()
		for _, s := range all {
			s.closeBackend()
		}
		_ = stream.Close()
	}()

	for {
		meta, err := readNativeMuxMetadata(stream)
		if err != nil {
			if err != io.EOF {
				xrayLogf("native xray: VLESS mux metadata read failed: %v", err)
			}
			return
		}

		switch meta.status {
		case nativeMuxStatusKeepAlive:
			if meta.option&nativeMuxOptionData != 0 {
				_, readScratch, _ = readNativeMuxDataBlockScratch(stream, readScratch)
			}

		case nativeMuxStatusEnd:
			if meta.option&nativeMuxOptionData != 0 {
				_, readScratch, _ = readNativeMuxDataBlockScratch(stream, readScratch)
			}
			closeSession(meta.sessionID)

		case nativeMuxStatusNew:
			if meta.network != nativeMuxNetworkTCP && meta.network != nativeMuxNetworkUDP {
				xrayLogf("native xray: VLESS mux session %d unsupported network %d", meta.sessionID, meta.network)
				if meta.option&nativeMuxOptionData != 0 {
					_, readScratch, _ = readNativeMuxDataBlockScratch(stream, readScratch)
				}
				continue
			}

			mu.Lock()
			tooManySessions := len(sessions) >= nativeMuxMaxSessionLimit()
			mu.Unlock()
			if tooManySessions {
				if meta.option&nativeMuxOptionData != 0 {
					_ = discardNativeMuxDataBlock(stream)
				}
				xrayTracef("native xray: VLESS mux rejected new session=%d over limit=%d user=%s", meta.sessionID, nativeMuxMaxSessionLimit(), email)
				writeMu.Lock()
				_ = writeNativeMuxEnd(stream, meta.sessionID, true)
				writeMu.Unlock()
				continue
			}

			isXUDP := meta.globalID != [8]byte{}
			pkt := nativeMuxPacket{}

			targetHost, targetPort := meta.host, meta.port
			if isNativeDNSSinkTarget(targetHost) {
				if meta.option&nativeMuxOptionData != 0 {
					_ = discardNativeMuxDataBlock(stream)
				}
				xrayTracef("native xray: VLESS mux fast-ignored DNS sink target session=%d network=%s host=%q port=%d xudp=%v", meta.sessionID, nativeMuxNetworkName(meta.network), targetHost, targetPort, isXUDP)
				writeMu.Lock()
				_ = writeNativeMuxEnd(stream, meta.sessionID, false)
				writeMu.Unlock()
				continue
			}
			if invalidNativeDestination(targetHost, targetPort) {
				if meta.option&nativeMuxOptionData != 0 {
					_ = discardNativeMuxDataBlock(stream)
				}
				xrayTracef("native xray: VLESS mux rejected invalid target session=%d network=%s host=%q port=%d xudp=%v", meta.sessionID, nativeMuxNetworkName(meta.network), targetHost, targetPort, isXUDP)
				writeMu.Lock()
				_ = writeNativeMuxEnd(stream, meta.sessionID, true)
				writeMu.Unlock()
				continue
			}

			if meta.option&nativeMuxOptionData != 0 {
				pkt.payload, readScratch, err = readNativeMuxDataBlockScratch(stream, readScratch)
				if err != nil {
					xrayLogf("native xray: VLESS mux first packet read failed session=%d: %v", meta.sessionID, err)
					continue
				}
			}

			s, target, err := ib.newNativeMuxSession(meta.sessionID, meta.network, targetHost, targetPort, isXUDP, meta.globalID, stream, writeMu, uuid, email, removeSession)
			if err != nil {
				xrayLogf("native xray: VLESS mux session %s setup failed: %v", target, err)
				writeMu.Lock()
				_ = writeNativeMuxEnd(stream, meta.sessionID, true)
				writeMu.Unlock()
				continue
			}

			mu.Lock()
			if old := sessions[meta.sessionID]; old != nil {
				old.closeBackend()
			}
			sessions[meta.sessionID] = s
			if isXUDP {
				if old := xudpSessions[meta.globalID]; old != nil && old != s {
					old.closeBackend()
				}
				xudpSessions[meta.globalID] = s
			}
			mu.Unlock()

			xrayTracef("native xray: vless/mux %s user=%s -> %s session=%d xudp=%v", nativeMuxNetworkName(meta.network), email, target, meta.sessionID, isXUDP)
			// Dial and pump this session on its own goroutine so a slow-connecting
			// target or a backpressured/rate-limited backend never blocks the shared
			// read loop and therefore never stalls the other multiplexed sessions.
			// The first payload is enqueued (a copy) before run() finishes dialing;
			// the session's uplink loop writes it first once the backend is up.
			ib2, host2, port2 := ib, targetHost, targetPort
			xrayGo(fmt.Sprintf("native xray mux session=%d", s.id), func() { s.run(ib2, host2, port2) })
			if len(pkt.payload) > 0 {
				s.enqueueUplink(pkt.payload, pkt.host, pkt.port)
			}

		case nativeMuxStatusKeep:
			mu.Lock()
			s := sessions[meta.sessionID]
			if s == nil && meta.globalID != [8]byte{} {
				s = xudpSessions[meta.globalID]
			}
			mu.Unlock()
			if meta.option&nativeMuxOptionData == 0 {
				continue
			}
			pkt := nativeMuxPacket{}
			pkt.payload, readScratch, err = readNativeMuxDataBlockScratch(stream, readScratch)
			if err != nil {
				xrayLogf("native xray: VLESS mux keep packet read failed session=%d: %v", meta.sessionID, err)
				if s != nil {
					closeSession(s.id)
				}
				continue
			}
			if s == nil {
				writeMu.Lock()
				_ = writeNativeMuxEnd(stream, meta.sessionID, false)
				writeMu.Unlock()
				continue
			}
			// Official Mux.Cool packet sessions read exactly one packet block here.
			// XUDP is represented by GlobalID on the New frame and optional UDP
			// endpoint metadata on Keep frames, not by auto-detecting metadata inside
			// the UDP payload. Auto-detecting inside payload can block QUIC if a real
			// datagram happens to look like XUDP control bytes.
			if meta.host != "" {
				pkt.host = meta.host
				pkt.port = meta.port
			}
			if len(pkt.payload) > 0 {
				s.enqueueUplink(pkt.payload, pkt.host, pkt.port)
			}

		default:
			xrayLogf("native xray: VLESS mux unknown status %d", meta.status)
			if meta.option&nativeMuxOptionData != 0 {
				_, readScratch, _ = readNativeMuxDataBlockScratch(stream, readScratch)
			}
		}
	}
}

// newNativeMuxSession allocates a session and reserves a global slot but does
// NOT dial the backend. Dialing happens later in run() on the session's own
// goroutine, so the shared mux read loop is never blocked by a slow connect.
func (ib *nativeInbound) newNativeMuxSession(id uint16, network byte, host string, port uint16, xudp bool, globalID [8]byte, client io.Writer, writeMu *sync.Mutex, uuid, email string, onClose func(*nativeMuxSession)) (*nativeMuxSession, string, error) {
	target := net.JoinHostPort(normalizeNativeTargetHost(host), strconv.Itoa(int(port)))
	if invalidNativeDestination(host, port) {
		return nil, target, fmt.Errorf("invalid destination")
	}
	releaseSlot, ok := acquireNativeMuxGlobalSlot()
	if !ok {
		return nil, target, fmt.Errorf("global mux session limit reached")
	}
	s := &nativeMuxSession{
		id:          id,
		network:     network,
		xudp:        xudp,
		writeMu:     writeMu,
		client:      client,
		uuid:        uuid,
		email:       email,
		upLimiter:   ib.upLimiter(),
		downLimiter: ib.downLimiter(),
		upMeter:     &trafficMeter{uuid: uuid, email: email, uplink: true},
		downMeter:   &trafficMeter{uuid: uuid, email: email, uplink: false},
		uplink:      make(chan nativeMuxUplinkItem, nativeMuxUplinkQueue),
		closed:      make(chan struct{}),
		onClose:     onClose,
		releaseSlot: releaseSlot,
		globalID:    globalID,
	}
	s.ctx, s.cancel = context.WithCancel(context.Background())
	return s, target, nil
}

// run dials/opens the backend for a mux session, then pumps client->backend
// data from the session's uplink channel. It owns the backend reader goroutine.
// Because this runs off the shared read loop, a slow dial or a congested backend
// only ever affects this one session.
func (s *nativeMuxSession) run(ib *nativeInbound, host string, port uint16) {
	defer xrayRecover(fmt.Sprintf("native xray mux run session=%d", s.id))

	// Abort early if the session was torn down (client sent End, connection
	// closed, or a duplicate New replaced it) before we even dialed.
	select {
	case <-s.closed:
		s.failInit(false)
		return
	default:
	}

	if s.network == nativeMuxNetworkTCP {
		backend, target, err := ib.nativeDialTCP(host, port)
		if err != nil {
			xrayLogf("native xray: VLESS mux TCP dial %s failed session=%d: %v", target, s.id, err)
			s.failInit(true)
			return
		}
		s.tcp = backend
	} else {
		pc, udpNetwork, udpTarget, target, err := ib.nativeOpenMuxUDP(host, port)
		if err != nil {
			xrayLogf("native xray: VLESS mux UDP open %s failed session=%d: %v", target, s.id, err)
			s.failInit(true)
			return
		}
		s.udp = pc
		s.udpNetwork = udpNetwork
		s.udpTarget = udpTarget
	}

	// If the session was closed while dialing, tear the backend down now.
	select {
	case <-s.closed:
		s.closeBackend()
		return
	default:
	}

	xrayGo(fmt.Sprintf("native xray mux backend session=%d", s.id), func() { s.readBackendLoop() })
	s.uplinkLoop()
}

// failInit reports a session that never came up: optionally notify the client
// with an End(error) frame, remove it from the parent maps, and release the
// slot. It must not be used once a backend reader is running (readBackendLoop's
// deferred cleanup owns that path).
func (s *nativeMuxSession) failInit(notifyClient bool) {
	if notifyClient {
		s.writeMu.Lock()
		_ = writeNativeMuxEnd(s.client, s.id, true)
		s.writeMu.Unlock()
	}
	if s.onClose != nil {
		s.onClose(s)
	}
	s.closeBackend()
}

// enqueueUplink hands one client->backend datagram/segment to the session's
// uplink goroutine. The payload is copied because the caller (the shared read
// loop) reuses its scratch buffer on the next iteration. A send blocks only when
// this one session's queue is full (per-session backpressure) or once closed.
func (s *nativeMuxSession) enqueueUplink(payload []byte, host string, port uint16) {
	if len(payload) == 0 {
		return
	}
	cp := make([]byte, len(payload))
	copy(cp, payload)
	select {
	case s.uplink <- nativeMuxUplinkItem{payload: cp, host: host, port: port}:
	case <-s.closed:
	}
}

// uplinkLoop drains queued client->backend items until the session closes or a
// backend write fails. Rate limiting and the blocking socket write now happen
// here instead of in the shared read loop.
func (s *nativeMuxSession) uplinkLoop() {
	// upMeter is owned exclusively by this goroutine (writeBackendItem adds to it
	// here), so it is flushed here too. readBackendLoop must not touch upMeter.
	defer s.upMeter.flush()
	for {
		select {
		case <-s.closed:
			return
		case item := <-s.uplink:
			if !s.writeBackendItem(item) {
				s.closeBackend()
				return
			}
		}
	}
}

func (ib *nativeInbound) nativeOpenMuxUDP(host string, port uint16) (net.PacketConn, string, net.Addr, string, error) {
	targetHost := normalizeNativeTargetHost(host)
	target := net.JoinHostPort(targetHost, strconv.Itoa(int(port)))
	udpNetwork := nativeDialNetwork("udp", targetHost)
	udpTarget, err := net.ResolveUDPAddr(udpNetwork, target)
	if err != nil {
		return nil, udpNetwork, nil, target, err
	}

	var local *net.UDPAddr
	if addr := nativeLocalAddrForDial(udpNetwork, targetHost, ib.listen); addr != nil {
		if udpAddr, ok := addr.(*net.UDPAddr); ok {
			local = udpAddr
		}
	}
	pc, err := net.ListenUDP(udpNetwork, local)
	if err != nil {
		return nil, udpNetwork, nil, target, err
	}
	if nativeMuxUDPReadBufferSize() > 0 {
		_ = pc.SetReadBuffer(nativeMuxUDPReadBufferSize())
	}
	if nativeMuxUDPWriteBufferSize() > 0 {
		_ = pc.SetWriteBuffer(nativeMuxUDPWriteBufferSize())
	}
	return pc, udpNetwork, udpTarget, target, nil
}

// writeBackendItem writes one uplink item to the backend. It returns false when
// the session should be torn down (rate wait cancelled or a fatal write error).
// A per-packet UDP sink/override-resolve failure is a soft skip and returns true
// so the session keeps serving other datagrams.
func (s *nativeMuxSession) writeBackendItem(item nativeMuxUplinkItem) bool {
	payload := item.payload
	if len(payload) == 0 {
		return true
	}
	if s.upLimiter != nil {
		if err := s.upLimiter.WaitN(s.ctx, len(payload)); err != nil {
			return false
		}
	}

	var n int
	var err error
	if s.network == nativeMuxNetworkTCP {
		n, err = s.tcp.Write(payload)
	} else {
		target := s.udpTarget
		if item.host != "" && item.port != 0 {
			if isNativeDNSSinkTarget(item.host) || invalidNativeDestination(item.host, item.port) {
				// AdGuard/blocked endpoints must be ignored at the cheapest possible
				// point. Do not resolve, dial, log loudly, or keep the mux child busy.
				xrayTracef("native xray: VLESS mux UDP fast-ignored override sink session=%d target=%s:%d", s.id, item.host, item.port)
				return true
			}
			if s.lastUDPAddr != nil && s.lastUDPHost == item.host && s.lastUDPPort == item.port {
				target = s.lastUDPAddr
			} else if addr, rerr := resolveNativeMuxUDPAddr(s.udpNetwork, item.host, item.port); rerr == nil {
				target = addr
				s.lastUDPHost = item.host
				s.lastUDPPort = item.port
				s.lastUDPAddr = addr
			} else {
				xrayTracef("native xray: VLESS mux UDP override resolve failed session=%d target=%s:%d: %v", s.id, item.host, item.port, rerr)
				return true
			}
		}
		n, err = s.udp.WriteTo(payload, target)
	}
	if n > 0 {
		s.upMeter.add(n)
	}
	if err != nil {
		xrayLogf("native xray: VLESS mux backend write failed session=%d: %v", s.id, err)
		return false
	}
	return true
}

func (s *nativeMuxSession) readBackendLoop() {
	defer xrayRecover(fmt.Sprintf("native xray mux backend loop session=%d", s.id))
	sendEnd := true
	defer func() {
		// downMeter is owned by this goroutine; upMeter is flushed by uplinkLoop.
		s.downMeter.flush()
		if sendEnd {
			s.writeMu.Lock()
			_ = writeNativeMuxEnd(s.client, s.id, false)
			s.writeMu.Unlock()
		}
		if s.onClose != nil {
			s.onClose(s)
		}
		s.closeBackend()
	}()

	if s.network == nativeMuxNetworkTCP {
		s.readTCPBackendLoop()
		return
	}
	// For UDP/QUIC, an idle backend timeout is only local cleanup. Sending an
	// End frame on idle makes some clients close the whole video/QUIC flow after
	// a short quiet period. Real errors still return true and notify the client.
	sendEnd = s.readUDPBackendLoop()
}

func (s *nativeMuxSession) waitDownRate(n int) error {
	if s.downLimiter == nil || n <= 0 {
		return nil
	}
	return s.downLimiter.WaitN(s.ctx, n)
}

func (s *nativeMuxSession) readTCPBackendLoop() {
	buf := make([]byte, 16*1024)
	for {
		n, err := s.tcp.Read(buf)
		if err != nil {
			if err != io.EOF {
				xrayLogf("native xray: VLESS mux TCP backend read failed session=%d: %v", s.id, err)
			}
			return
		}
		if n <= 0 {
			continue
		}
		if err := s.waitDownRate(n); err != nil {
			return
		}
		s.downMeter.add(n)
		s.writeMu.Lock()
		werr := writeNativeMuxData(s.client, s.id, nativeMuxStatusKeep, buf[:n])
		s.writeMu.Unlock()
		if werr != nil {
			xrayLogf("native xray: VLESS mux TCP client write failed session=%d: %v", s.id, werr)
			return
		}
	}
}

func (s *nativeMuxSession) readUDPBackendLoop() bool {
	buf := make([]byte, nativeUDPBufferSize)
	for {
		_ = s.udp.SetReadDeadline(time.Now().Add(nativeMuxUDPIdleTimeout()))
		n, addr, err := s.udp.ReadFrom(buf)
		if err != nil {
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				return false
			}
			if err != io.EOF {
				xrayLogf("native xray: VLESS mux UDP backend read failed session=%d: %v", s.id, err)
			}
			return true
		}
		if n <= 0 {
			continue
		}
		if err := s.waitDownRate(n); err != nil {
			return true
		}
		s.downMeter.add(n)
		s.writeMu.Lock()
		// Include the UDP source endpoint on XUDP responses so clients that rely on
		// full-cone packet addressing can associate the datagram with the correct
		// origin. Classic mux UDP also accepts this optional metadata in Xray.
		werr := writeNativeMuxPacketData(s.client, s.id, nativeMuxStatusKeep, buf[:n], addr, s.xudp)
		s.writeMu.Unlock()
		if werr != nil {
			xrayLogf("native xray: VLESS mux UDP client write failed session=%d: %v", s.id, werr)
			return true
		}
	}
}

// closeBackend tears the session down exactly once. It is safe to call
// concurrently from the read loop, the uplink loop and the backend reader; the
// previous select/default form could double-close s.closed and panic.
func (s *nativeMuxSession) closeBackend() {
	s.closeOnce.Do(func() {
		close(s.closed)
		if s.cancel != nil {
			s.cancel()
		}
		if s.releaseSlot != nil {
			s.releaseSlot()
		}
		if s.tcp != nil {
			_ = s.tcp.Close()
		}
		if s.udp != nil {
			_ = s.udp.Close()
		}
	})
}

func nativeMuxNetworkName(network byte) string {
	if network == nativeMuxNetworkUDP {
		return "udp"
	}
	return "tcp"
}

func readNativeMuxMetadata(r io.Reader) (nativeMuxMetadata, error) {
	var meta nativeMuxMetadata
	var lenBuf [2]byte
	if _, err := io.ReadFull(r, lenBuf[:]); err != nil {
		return meta, err
	}
	metaLen := int(binary.BigEndian.Uint16(lenBuf[:]))
	if metaLen < 4 || metaLen > 512 {
		return meta, fmt.Errorf("invalid mux metadata length %d", metaLen)
	}
	var stack [512]byte
	b := stack[:metaLen]
	if _, err := io.ReadFull(r, b); err != nil {
		return meta, err
	}
	meta.sessionID = binary.BigEndian.Uint16(b[0:2])
	meta.status = b[2]
	meta.option = b[3]
	off := 4
	if meta.status == nativeMuxStatusNew {
		if off >= len(b) {
			return meta, fmt.Errorf("mux new frame missing network")
		}
		meta.network = b[off]
		off++
		host, port, next, err := parseNativeMuxAddressPort(b, off)
		if err != nil {
			return meta, err
		}
		meta.host, meta.port, off = host, port, next
	} else if meta.status == nativeMuxStatusKeep && off < len(b) && b[off] == nativeMuxNetworkUDP {
		meta.network = b[off]
		off++
		host, port, next, err := parseNativeMuxAddressPort(b, off)
		if err == nil {
			meta.host, meta.port, off = host, port, next
		}
	}
	if meta.status == nativeMuxStatusNew && meta.network == nativeMuxNetworkUDP && meta.option&nativeMuxOptionData != 0 && len(b)-off >= 8 {
		copy(meta.globalID[:], b[len(b)-8:])
	}
	return meta, nil
}

func parseNativeMuxAddressPort(b []byte, off int) (string, uint16, int, error) {
	if off+3 > len(b) {
		return "", 0, off, io.ErrUnexpectedEOF
	}
	port := binary.BigEndian.Uint16(b[off : off+2])
	off += 2
	atyp := b[off]
	off++
	switch atyp {
	case atypIPv4:
		if off+4 > len(b) {
			return "", 0, off, io.ErrUnexpectedEOF
		}
		host := net.IP(b[off : off+4]).String()
		return host, port, off + 4, nil
	case atypIPv6:
		if off+16 > len(b) {
			return "", 0, off, io.ErrUnexpectedEOF
		}
		host := net.IP(b[off : off+16]).String()
		return host, port, off + 16, nil
	case atypDomain:
		if off >= len(b) {
			return "", 0, off, io.ErrUnexpectedEOF
		}
		l := int(b[off])
		off++
		if off+l > len(b) {
			return "", 0, off, io.ErrUnexpectedEOF
		}
		return string(b[off : off+l]), port, off + l, nil
	default:
		return "", 0, off, fmt.Errorf("unknown mux address type %d", atyp)
	}
}

func appendNativeMuxAddressPort(dst []byte, host string, port uint16) []byte {
	var p [2]byte
	binary.BigEndian.PutUint16(p[:], port)
	dst = append(dst, p[:]...)
	ip := net.ParseIP(stripNativeIPZone(normalizeNativeTargetHost(host)))
	if ip4 := ip.To4(); ip4 != nil {
		dst = append(dst, atypIPv4)
		dst = append(dst, ip4...)
		return dst
	}
	if ip16 := ip.To16(); ip16 != nil {
		dst = append(dst, atypIPv6)
		dst = append(dst, ip16...)
		return dst
	}
	if len(host) > 255 {
		host = host[:255]
	}
	dst = append(dst, atypDomain, byte(len(host)))
	dst = append(dst, []byte(host)...)
	return dst
}

func readNativeMuxDataBlock(r io.Reader) ([]byte, error) {
	payload, _, err := readNativeMuxDataBlockScratch(r, nil)
	return payload, err
}

func readNativeMuxDataBlockScratch(r io.Reader, scratch []byte) ([]byte, []byte, error) {
	var lenBuf [2]byte
	if _, err := io.ReadFull(r, lenBuf[:]); err != nil {
		return nil, scratch, err
	}
	n := int(binary.BigEndian.Uint16(lenBuf[:]))
	if n > nativeUDPMaxPacket {
		return nil, scratch, fmt.Errorf("mux payload too large: %d", n)
	}
	if cap(scratch) < n {
		scratch = make([]byte, n)
	}
	payload := scratch[:n]
	_, err := io.ReadFull(r, payload)
	return payload, scratch, err
}

func discardNativeMuxDataBlock(r io.Reader) error {
	var lenBuf [2]byte
	if _, err := io.ReadFull(r, lenBuf[:]); err != nil {
		return err
	}
	n := int(binary.BigEndian.Uint16(lenBuf[:]))
	if n > nativeUDPMaxPacket {
		return fmt.Errorf("mux payload too large: %d", n)
	}
	_, err := io.CopyN(io.Discard, r, int64(n))
	return err
}

func readNativeMuxPacket(r io.Reader, allowXUDP bool) (nativeMuxPacket, error) {
	var pkt nativeMuxPacket
	for {
		block, err := readNativeMuxDataBlock(r)
		if err != nil {
			return pkt, err
		}
		if !allowXUDP || !isNativeXUDPMetadata(block) {
			pkt.payload = block
			return pkt, nil
		}
		inner, err := parseNativeXUDPMetadata(block)
		if err != nil {
			return pkt, err
		}
		if inner.discard {
			return inner, nil
		}
		if block[3]&1 == 0 {
			continue
		}
		inner.payload, err = readNativeMuxDataBlock(r)
		if err != nil {
			return pkt, err
		}
		return inner, nil
	}
}

func appendUint16(dst []byte, v uint16) []byte {
	return append(dst, byte(v>>8), byte(v))
}

func writeNativeMuxData(w io.Writer, sessionID uint16, status byte, payload []byte) error {
	return writeNativeMuxPacketData(w, sessionID, status, payload, nil, false)
}

func writeNativeMuxPacketData(w io.Writer, sessionID uint16, status byte, payload []byte, udpAddr net.Addr, includeUDPAddr bool) error {
	if len(payload) > nativeUDPMaxPacket {
		return fmt.Errorf("mux payload too large: %d", len(payload))
	}
	bufp := nativeMuxFramePool.Get().(*[]byte)
	frame := (*bufp)[:0]
	frame = append(frame, 0, 0) // metadata length placeholder
	metaStart := len(frame)
	frame = append(frame, byte(sessionID>>8), byte(sessionID), status, nativeMuxOptionData)
	if includeUDPAddr && udpAddr != nil {
		if host, port, ok := nativeMuxAddrHostPort(udpAddr); ok {
			frame = append(frame, nativeMuxNetworkUDP)
			frame = appendNativeMuxAddressPort(frame, host, port)
		}
	}
	metaLen := len(frame) - metaStart
	binary.BigEndian.PutUint16(frame[:2], uint16(metaLen))
	frame = appendUint16(frame, uint16(len(payload)))
	frame = append(frame, payload...)
	_, err := w.Write(frame)
	*bufp = frame[:0]
	nativeMuxFramePool.Put(bufp)
	return err
}

func writeNativeMuxEnd(w io.Writer, sessionID uint16, hasError bool) error {
	opt := byte(0)
	if hasError {
		opt = nativeMuxOptionError
	}
	var frame [6]byte
	binary.BigEndian.PutUint16(frame[0:2], 4)
	binary.BigEndian.PutUint16(frame[2:4], sessionID)
	frame[4] = nativeMuxStatusEnd
	frame[5] = opt
	_, err := w.Write(frame[:])
	return err
}

func isNativeXUDPMetadata(meta []byte) bool {
	if len(meta) < 4 || len(meta) > 512 {
		return false
	}
	// Xray's xudp.PacketWriter stores a two-byte mux session id at the start of
	// the inner metadata. For client-generated packets this is normally zero.
	if meta[0] != 0 || meta[1] != 0 {
		return false
	}
	cmd := meta[2]
	opt := meta[3]
	if cmd != 1 && cmd != 2 && cmd != 4 {
		return false
	}
	if opt != 0 && opt != 1 {
		return false
	}
	if len(meta) == 4 {
		return true
	}
	return meta[4] == nativeMuxNetworkUDP
}

func parseNativeXUDPMetadata(meta []byte) (nativeMuxPacket, error) {
	var pkt nativeMuxPacket
	if !isNativeXUDPMetadata(meta) {
		return pkt, fmt.Errorf("invalid xudp metadata")
	}
	cmd := meta[2]
	opt := meta[3]
	if cmd == 4 {
		pkt.discard = true
		return pkt, nil
	}
	if len(meta) > 4 && meta[4] == nativeMuxNetworkUDP {
		host, port, _, err := parseNativeMuxAddressPort(meta, 5)
		if err != nil {
			return pkt, err
		}
		pkt.host = host
		pkt.port = port
	}
	if opt&1 == 0 {
		return pkt, nil
	}
	// Payload length and bytes follow in the outer stream, so the caller must
	// fill pkt.payload. This path is only used by readNativeXUDPPacket below.
	return pkt, nil
}

func readNativeXUDPPacket(r io.Reader) (nativeMuxPacket, error) {
	var pkt nativeMuxPacket
	for {
		meta, err := readNativeMuxDataBlock(r)
		if err != nil {
			return pkt, err
		}
		pkt, err = parseNativeXUDPMetadata(meta)
		if err != nil {
			return pkt, err
		}
		if pkt.discard {
			return pkt, nil
		}
		if meta[3]&1 == 0 {
			continue
		}
		payload, err := readNativeMuxDataBlock(r)
		if err != nil {
			return pkt, err
		}
		pkt.payload = payload
		return pkt, nil
	}
}

func resolveNativeMuxUDPAddr(network, host string, port uint16) (net.Addr, error) {
	targetHost := normalizeNativeTargetHost(host)
	if network == "" {
		network = nativeDialNetwork("udp", targetHost)
	}
	return net.ResolveUDPAddr(network, net.JoinHostPort(targetHost, strconv.Itoa(int(port))))
}

func nativeMuxAddrHostPort(addr net.Addr) (string, uint16, bool) {
	switch a := addr.(type) {
	case *net.UDPAddr:
		if a == nil {
			return "", 0, false
		}
		return a.IP.String(), uint16(a.Port), true
	case *net.TCPAddr:
		if a == nil {
			return "", 0, false
		}
		return a.IP.String(), uint16(a.Port), true
	}
	host, portStr, err := net.SplitHostPort(addr.String())
	if err != nil {
		return "", 0, false
	}
	port64, err := strconv.ParseUint(portStr, 10, 16)
	if err != nil {
		return "", 0, false
	}
	return stripNativeIPZone(host), uint16(port64), true
}

func stripNativeIPZone(host string) string {
	if i := strings.LastIndexByte(host, '%'); i >= 0 {
		return host[:i]
	}
	return host
}
