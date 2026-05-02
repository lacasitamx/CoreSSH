package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const tlsCertsDir = "/opt/sshpanel/certs"

// handleTLSGenerateSelfSigned generates a self-signed TLS certificate for the
// given domain, writes it to /opt/sshpanel/certs/<domain>/, and returns the paths.
func handleTLSGenerateSelfSigned(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Domain string `json:"domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Domain == "" {
		http.Error(w, "domain required", http.StatusBadRequest)
		return
	}

	certDir := filepath.Join(tlsCertsDir, req.Domain)
	if err := os.MkdirAll(certDir, 0o700); err != nil {
		http.Error(w, "mkdir: "+err.Error(), http.StatusInternalServerError)
		return
	}
	certFile := filepath.Join(certDir, "cert.pem")
	keyFile := filepath.Join(certDir, "key.pem")

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		http.Error(w, "keygen: "+err.Error(), http.StatusInternalServerError)
		return
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: req.Domain},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(10 * 365 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     []string{req.Domain},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	if err != nil {
		http.Error(w, "certgen: "+err.Error(), http.StatusInternalServerError)
		return
	}
	cf, err := os.OpenFile(certFile, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		http.Error(w, "write cert: "+err.Error(), http.StatusInternalServerError)
		return
	}
	_ = pem.Encode(cf, &pem.Block{Type: "CERTIFICATE", Bytes: der})
	cf.Close()

	privDER, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		http.Error(w, "marshal key: "+err.Error(), http.StatusInternalServerError)
		return
	}
	kf, err := os.OpenFile(keyFile, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		http.Error(w, "write key: "+err.Error(), http.StatusInternalServerError)
		return
	}
	_ = pem.Encode(kf, &pem.Block{Type: "EC PRIVATE KEY", Bytes: privDER})
	kf.Close()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"cert_file": certFile,
		"key_file":  keyFile,
	})
}

// handleTLSLetsEncrypt runs certbot to obtain a certificate via Let's Encrypt.
// Requires certbot installed on the server and port 80 available.
func handleTLSLetsEncrypt(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Domain string `json:"domain"`
		Email  string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Domain == "" || req.Email == "" {
		http.Error(w, "domain and email required", http.StatusBadRequest)
		return
	}

	cmd := exec.Command("certbot", "certonly", "--standalone", "--non-interactive",
		"--agree-tos", "-m", req.Email, "-d", req.Domain)
	out, err := cmd.CombinedOutput()
	if err != nil {
		http.Error(w, fmt.Sprintf("certbot failed: %v\n%s", err, string(out)), http.StatusInternalServerError)
		return
	}

	certFile := "/etc/letsencrypt/live/" + req.Domain + "/fullchain.pem"
	keyFile := "/etc/letsencrypt/live/" + req.Domain + "/privkey.pem"

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"cert_file": certFile,
		"key_file":  keyFile,
		"output":    string(out),
	})
}

// handleTLSUploadPEM accepts PEM text for cert and key, saves them to disk under
// /opt/sshpanel/certs/<name>/, and returns the file paths.
func handleTLSUploadPEM(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Name string `json:"name"`
		Cert string `json:"cert"`
		Key  string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" || req.Cert == "" || req.Key == "" {
		http.Error(w, "name, cert, and key required", http.StatusBadRequest)
		return
	}
	name := filepath.Base(req.Name)
	if name == "." || name == "/" || name == "" {
		http.Error(w, "invalid name", http.StatusBadRequest)
		return
	}
	certDir := filepath.Join(tlsCertsDir, name)
	if err := os.MkdirAll(certDir, 0o700); err != nil {
		http.Error(w, "mkdir: "+err.Error(), http.StatusInternalServerError)
		return
	}
	certFile := filepath.Join(certDir, "cert.pem")
	keyFile := filepath.Join(certDir, "key.pem")
	if err := os.WriteFile(certFile, []byte(req.Cert), 0o600); err != nil {
		http.Error(w, "write cert: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := os.WriteFile(keyFile, []byte(req.Key), 0o600); err != nil {
		http.Error(w, "write key: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"cert_file": certFile,
		"key_file":  keyFile,
	})
}
