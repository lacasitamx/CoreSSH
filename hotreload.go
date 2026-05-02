package main

import (
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"sync"

	"golang.org/x/crypto/ssh"
)

// ---------- Global SSH config ----------

var (
	sshCfgMu      sync.RWMutex
	currentSSHCfg *ssh.ServerConfig
)

func setSSHConfig(c *ssh.ServerConfig) {
	sshCfgMu.Lock()
	currentSSHCfg = c
	sshCfgMu.Unlock()
}

func getSSHConfig() *ssh.ServerConfig {
	sshCfgMu.RLock()
	defer sshCfgMu.RUnlock()
	return currentSSHCfg
}

// ---------- Dynamic TCP listener pool ----------

// listenerPool manages a set of net.Listener instances by address.
// Calling Sync() opens new addresses and closes removed ones; unchanged
// addresses are left untouched so existing connections are not disrupted.
type listenerPool struct {
	mu      sync.Mutex
	entries map[string]net.Listener
	serve   func(net.Listener) // goroutine launched for each new listener
}

func newListenerPool(serve func(net.Listener)) *listenerPool {
	return &listenerPool{entries: make(map[string]net.Listener), serve: serve}
}

// Sync ensures exactly addrs are listening. Returns errors for addresses
// that could not be opened.
func (p *listenerPool) Sync(addrs []string) []error {
	p.mu.Lock()
	defer p.mu.Unlock()

	want := make(map[string]bool, len(addrs))
	for _, a := range addrs {
		if a != "" {
			want[a] = true
		}
	}

	for addr, ln := range p.entries {
		if !want[addr] {
			_ = ln.Close() // causes the serve goroutine to exit
			delete(p.entries, addr)
			log.Printf("hotreload: stopped %s", addr)
		}
	}

	var errs []error
	for addr := range want {
		if _, ok := p.entries[addr]; ok {
			continue
		}
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			errs = append(errs, fmt.Errorf("listen %s: %w", addr, err))
			continue
		}
		p.entries[addr] = ln
		log.Printf("hotreload: listening on %s", addr)
		go p.serve(ln)
	}
	return errs
}

// ---------- Dynamic TLS listener pool ----------

type tlsListenerPool struct {
	mu      sync.Mutex
	entries map[string]net.Listener
}

func newTLSListenerPool() *tlsListenerPool {
	return &tlsListenerPool{entries: make(map[string]net.Listener)}
}

// Sync ensures exactly forwarders are listening (matched by listen address).
func (p *tlsListenerPool) Sync(forwarders []TLSForwarderConfig) []error {
	p.mu.Lock()
	defer p.mu.Unlock()

	want := make(map[string]TLSForwarderConfig, len(forwarders))
	for _, f := range forwarders {
		if f.Listen != "" {
			want[f.Listen] = f
		}
	}

	for addr, ln := range p.entries {
		if _, ok := want[addr]; !ok {
			_ = ln.Close()
			delete(p.entries, addr)
			log.Printf("hotreload: stopped TLS %s", addr)
		}
	}

	var errs []error
	for addr, fwd := range want {
		if _, ok := p.entries[addr]; ok {
			continue
		}
		cert, err := tls.LoadX509KeyPair(fwd.CertFile, fwd.KeyFile)
		if err != nil {
			errs = append(errs, fmt.Errorf("TLS cert/key %s: %w", addr, err))
			continue
		}
		ln, err := tls.Listen("tcp", addr, &tls.Config{
			Certificates: []tls.Certificate{cert},
			MinVersion:   tls.VersionTLS12,
		})
		if err != nil {
			errs = append(errs, fmt.Errorf("TLS listen %s: %w", addr, err))
			continue
		}
		p.entries[addr] = ln
		log.Printf("hotreload: TLS+SSH listening on %s", addr)
		go serveTLSSSH(ln)
	}
	return errs
}

// ---------- Global pool instances (initialised in main) ----------

var (
	publicPool *listenerPool    // HTTP+SSH: listen + extra_listen
	localPool  *listenerPool    // raw SSH: local_ssh_listen
	tlsPool    *tlsListenerPool // TLS forwarders
)

// isListenerClosed reports whether err came from using a closed listener.
func isListenerClosed(err error) bool {
	return errors.Is(err, net.ErrClosed)
}

// ---------- Runtime settings ----------

var (
	defaultLimitsMu      sync.RWMutex
	runtimeLimitMbpsUp   int
	runtimeLimitMbpsDown int

	adminHandlerMu sync.RWMutex
	adminHandler   http.Handler
)

func setDefaultLimits(up, down int) {
	defaultLimitsMu.Lock()
	runtimeLimitMbpsUp = up
	runtimeLimitMbpsDown = down
	defaultLimitsMu.Unlock()
}

func getDefaultLimits() (up, down int) {
	defaultLimitsMu.RLock()
	defer defaultLimitsMu.RUnlock()
	return runtimeLimitMbpsUp, runtimeLimitMbpsDown
}

func setAdminHandler(h http.Handler) {
	adminHandlerMu.Lock()
	adminHandler = h
	adminHandlerMu.Unlock()
}

func getAdminHandler() http.Handler {
	adminHandlerMu.RLock()
	defer adminHandlerMu.RUnlock()
	return adminHandler
}

// ---------- Full live reload ----------

// applyFullConfigReload applies every field in newCfg to the running server
// without a process restart. Port changes, DNSTT/UDPGW changes, Xray changes,
// and bandwidth defaults all take effect immediately.
// The only field that still requires a restart is host_key_file.
func applyFullConfigReload(newCfg *Config) {
	// Banner
	bt := newCfg.Banner
	if bt == "" && newCfg.BannerFile != "" {
		if data, err := os.ReadFile(newCfg.BannerFile); err == nil {
			bt = string(data)
		}
	}
	setBannerText(bt)

	// Default per-connection bandwidth limits (picked up by new connections)
	setDefaultLimits(newCfg.DefaultLimitMbpsUp, newCfg.DefaultLimitMbpsDown)

	// Quiet logging / user count display
	if newCfg.Quiet {
		log.SetOutput(io.Discard)
	} else if !newCfg.UserCount {
		log.SetOutput(os.Stderr)
	}
	userCountEnabled = newCfg.UserCount

	// Admin panel directory (hot-swaps the file server on the next request)
	if newCfg.AdminDir != "" {
		setAdminHandler(http.FileServer(http.Dir(newCfg.AdminDir)))
	}

	// Public SSH listeners (main listen + extra_listen)
	publicAddrs := append([]string{newCfg.Listen}, newCfg.ExtraListen...)
	for _, e := range publicPool.Sync(publicAddrs) {
		log.Printf("hotreload: %v", e)
	}

	// Local raw SSH listener
	var localAddrs []string
	if newCfg.LocalSSHListen != "" {
		localAddrs = []string{newCfg.LocalSSHListen}
	}
	for _, e := range localPool.Sync(localAddrs) {
		log.Printf("hotreload: %v", e)
	}

	// TLS forwarders
	for _, e := range tlsPool.Sync(newCfg.TLSForwarders) {
		log.Printf("hotreload: %v", e)
	}

	// DNSTT — stop current instance (no-op if not running) then start new one
	stopDNSTT()
	startDNSTT(newCfg.DNSTT, getSSHConfig())

	// UDPGW — same pattern
	stopUDPGW()
	startUDPGW(newCfg.UDPGW)

	// Xray — update stored config then restart/stop as needed
	if newCfg.Xray != nil {
		xrayMgr.mu.Lock()
		xrayMgr.cfg = newCfg.Xray
		xrayMgr.mu.Unlock()
		if newCfg.Xray.Enabled {
			_ = xrayMgr.Restart()
		} else {
			_ = xrayMgr.Stop()
		}
	} else {
		_ = xrayMgr.Stop()
	}

	setGlobalCfg(newCfg)
}
