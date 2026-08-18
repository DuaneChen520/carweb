// carweb-bridge: WebSocket ↔ TCP 桥接代理
//
// 在车机端运行，监听 8080 端口，提供以下端点：
//   - /adb/{target}     WebSocket → TCP 双向桥接（用于 ADB 连接）
//   - /pair             ADB 配对协议处理（TLS + SPAKE2 + AES-128-GCM）
//   - /scan/{subnet}    扫描子网中开放的 ADB 端口（5555）
//
// 编译：go build -o tiny-bridge main.go
// 运行：./tiny-bridge

package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"flag"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/backkem/spake2-go"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
	ReadBufferSize:  64 * 1024,
	WriteBufferSize: 64 * 1024,
}

const adbDefaultPort = 5555

// 配对协议常量（与 Android 实现一致）
const (
	tlsExportLabel       = "adb-label"
	tlsExportKeySize     = 64
	spake2ClientName     = "adb pair client"
	spake2ServerName     = "adb pair server"
	aesGcmInfo           = "adb pairing_auth aes-128-gcm key"
	aesGcmKeySize        = 16
	pairingHeaderSize    = 6
	pairingVersion       = 1
	pairingTypeSpake2Msg = 0
	pairingTypePeerInfo  = 1
	maxSpake2MsgSize     = 256
	maxPeerInfoSize      = 4096
)

type pairRequest struct {
	Type      string `json:"type"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Code      string `json:"code"`
	PublicKey string `json:"publicKey"`
}

type pairResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

func main() {
	port := flag.Int("port", 8080, "监听端口")
	flag.Parse()

	http.HandleFunc("/adb/", handleAdbBridge)
	http.HandleFunc("/pair", handlePair)
	http.HandleFunc("/scan/", handleScan)

	addr := fmt.Sprintf(":%d", *port)
	log.Printf("carweb-bridge 启动，监听 %s", addr)
	log.Printf("  端点说明：")
	log.Printf("    /adb/{target}  WebSocket → TCP 桥接（如 /adb/192.168.1.100:5555）")
	log.Printf("    /pair          配对协议处理（TLS + SPAKE2 + AES-128-GCM）")
	log.Printf("    /scan/{subnet} 子网扫描（如 /scan/192.168.1）")

	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("启动失败: %v", err)
	}
}

func handleAdbBridge(w http.ResponseWriter, r *http.Request) {
	target := strings.TrimPrefix(r.URL.Path, "/adb/")
	if target == "" || target == r.URL.Path {
		http.Error(w, "缺少目标地址", http.StatusBadRequest)
		return
	}

	host, portStr, err := net.SplitHostPort(target)
	if err != nil {
		host = target
		portStr = strconv.Itoa(adbDefaultPort)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port <= 0 || port > 65535 {
		http.Error(w, "端口号无效", http.StatusBadRequest)
		return
	}

	wsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket 升级失败: %v", err)
		return
	}
	defer wsConn.Close()

	addr := net.JoinHostPort(host, strconv.Itoa(port))
	tcpConn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		log.Printf("TCP 连接失败 %s: %v", addr, err)
		wsConn.WriteMessage(websocket.CloseMessage, []byte("TCP 连接失败"))
		return
	}
	defer tcpConn.Close()

	log.Printf("桥接已建立: %s ↔ %s", r.RemoteAddr, addr)

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		for {
			_, message, err := wsConn.ReadMessage()
			if err != nil {
				tcpConn.Close()
				return
			}
			if _, err := tcpConn.Write(message); err != nil {
				return
			}
		}
	}()

	go func() {
		defer wg.Done()
		buf := make([]byte, 64*1024)
		for {
			n, err := tcpConn.Read(buf)
			if err != nil {
				wsConn.WriteMessage(websocket.CloseMessage, []byte("TCP 读取结束"))
				return
			}
			if err := wsConn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
				return
			}
		}
	}()

	wg.Wait()
	log.Printf("桥接已关闭: %s ↔ %s", r.RemoteAddr, addr)
}

func handlePair(w http.ResponseWriter, r *http.Request) {
	wsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("配对 WebSocket 升级失败: %v", err)
		return
	}
	defer wsConn.Close()

	_, msg, err := wsConn.ReadMessage()
	if err != nil {
		sendPairError(wsConn, "读取请求失败")
		return
	}

	var req pairRequest
	if err := json.Unmarshal(msg, &req); err != nil {
		sendPairError(wsConn, "请求格式无效")
		return
	}

	if req.Type != "pair" || req.Host == "" || req.Port <= 0 || req.Code == "" || req.PublicKey == "" {
		sendPairError(wsConn, "缺少必要参数")
		return
	}

	result := doPairing(req.Host, req.Port, req.Code, req.PublicKey)
	response, _ := json.Marshal(result)
	wsConn.WriteMessage(websocket.TextMessage, response)
}

func sendPairError(wsConn *websocket.Conn, msg string) {
	resp, _ := json.Marshal(pairResponse{Success: false, Error: msg})
	wsConn.WriteMessage(websocket.TextMessage, resp)
}

// doPairing 执行完整的 ADB 配对协议
//
// 协议流程（与 Android 实现一致）：
// 1. 生成 RSA 2048 密钥对 + X.509 自签名证书
// 2. TLS 1.3 连接到手机的配对端口
// 3. 导出 TLS 密钥材料（64 bytes, label "adb-label"）
// 4. SPAKE2 密钥交换（密码 = pairing_code + 导出的密钥材料）
// 5. 交换 SPAKE2 消息，派生共享密钥
// 6. 从共享密钥派生 AES-128-GCM 密钥
// 7. 加密 PeerInfo 并发送
// 8. 接收并解密对端 PeerInfo
// 9. 配对完成
func doPairing(host string, port int, code string, publicKeyHex string) pairResponse {
	addr := net.JoinHostPort(host, strconv.Itoa(port))

	// 1. 生成 RSA 密钥对 + X.509 自签名证书
	certPEM, keyPEM, err := generateCertAndKey()
	if err != nil {
		return pairResponse{Success: false, Error: fmt.Sprintf("生成证书失败: %v", err)}
	}

	// 2. 加载 TLS 证书
	tlsCert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return pairResponse{Success: false, Error: fmt.Sprintf("加载 TLS 证书失败: %v", err)}
	}

	// 3. TLS 1.3 连接到配对端口
	tlsConfig := &tls.Config{
		Certificates:       []tls.Certificate{tlsCert},
		InsecureSkipVerify: true,
		MinVersion:         tls.VersionTLS13,
		MaxVersion:         tls.VersionTLS13,
	}

	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 15 * time.Second}, "tcp", addr, tlsConfig)
	if err != nil {
		return pairResponse{Success: false, Error: fmt.Sprintf("TLS 连接失败: %v", err)}
	}
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(30 * time.Second))

	// 4. 导出 TLS 密钥材料（与 Android 实现一致）
	state := conn.ConnectionState()
	exportedKey, err := state.ExportKeyingMaterial(tlsExportLabel, nil, tlsExportKeySize)
	if err != nil {
		return pairResponse{Success: false, Error: fmt.Sprintf("导出密钥材料失败: %v", err)}
	}

	// 5. 构建 SPAKE2 密码 = pairing_code + 导出的密钥材料
	password := append([]byte(code), exportedKey...)

	// 6. 执行 SPAKE2 密钥交换
	sharedKey, err := doSpake2Exchange(conn, password)
	if err != nil {
		return pairResponse{Success: false, Error: fmt.Sprintf("SPAKE2 交换失败: %v", err)}
	}

	// 7. 派生 AES-128-GCM 密钥
	aesKey := deriveAesKey(sharedKey)

	// 8. 构建 PeerInfo（包含 ADB 公钥）
	peerInfo := buildPeerInfo(publicKeyHex)

	// 9. 加密并发送 PeerInfo（sequence=0，首次交换）
	encryptedPeerInfo, err := encryptAesGcm(aesKey, 0, peerInfo)
	if err != nil {
		return pairResponse{Success: false, Error: fmt.Sprintf("加密 PeerInfo 失败: %v", err)}
	}

	header := make([]byte, pairingHeaderSize)
	header[0] = pairingVersion
	header[1] = pairingTypePeerInfo
	binary.BigEndian.PutUint32(header[2:], uint32(len(encryptedPeerInfo)))
	if _, err := conn.Write(header); err != nil {
		return pairResponse{Success: false, Error: fmt.Sprintf("发送头部失败: %v", err)}
	}
	if _, err := conn.Write(encryptedPeerInfo); err != nil {
		return pairResponse{Success: false, Error: fmt.Sprintf("发送加密数据失败: %v", err)}
	}

	// 10. 读取对端响应（PeerInfo）
	responseHeader := make([]byte, pairingHeaderSize)
	if _, err := io.ReadFull(conn, responseHeader); err != nil {
		return pairResponse{Success: false, Error: fmt.Sprintf("读取响应头部失败: %v", err)}
	}

	if responseHeader[0] != pairingVersion {
		return pairResponse{Success: false, Error: fmt.Sprintf("不支持的协议版本: %d", responseHeader[0])}
	}

	payloadLen := binary.BigEndian.Uint32(responseHeader[2:])
	if payloadLen > maxPeerInfoSize {
		return pairResponse{Success: false, Error: fmt.Sprintf("响应数据过大: %d", payloadLen)}
	}

	encryptedResponse := make([]byte, payloadLen)
	if _, err := io.ReadFull(conn, encryptedResponse); err != nil {
		return pairResponse{Success: false, Error: fmt.Sprintf("读取响应数据失败: %v", err)}
	}

	// 11. 解密对端 PeerInfo（sequence=1，第二次交换）
	decryptedResponse, err := decryptAesGcm(aesKey, 1, encryptedResponse)
	if err != nil {
		return pairResponse{Success: false, Error: fmt.Sprintf("解密响应失败: %v", err)}
	}

	_ = decryptedResponse
	log.Printf("配对成功: %s (端口 %d)", host, port)
	return pairResponse{Success: true}
}

// doSpake2Exchange 执行 SPAKE2 密钥交换
func doSpake2Exchange(conn *tls.Conn, password []byte) ([]byte, error) {
	options := spake2.DefaultOptions()
	options.IdentityA = []byte(spake2ClientName)
	options.IdentityB = []byte(spake2ServerName)

	client := spake2.NewClient(password, options)

	clientMsg, err := client.Start()
	if err != nil {
		return nil, fmt.Errorf("SPAKE2 Start 失败: %v", err)
	}

	// 发送 PairingPacketHeader + SPAKE2_MSG
	header := make([]byte, pairingHeaderSize)
	header[0] = pairingVersion
	header[1] = pairingTypeSpake2Msg
	binary.BigEndian.PutUint32(header[2:], uint32(len(clientMsg)))
	if _, err := conn.Write(header); err != nil {
		return nil, fmt.Errorf("发送 SPAKE2 头部失败: %v", err)
	}
	if _, err := conn.Write(clientMsg); err != nil {
		return nil, fmt.Errorf("发送 SPAKE2 消息失败: %v", err)
	}

	// 读取服务端响应
	responseHeader := make([]byte, pairingHeaderSize)
	if _, err := io.ReadFull(conn, responseHeader); err != nil {
		return nil, fmt.Errorf("读取 SPAKE2 响应头部失败: %v", err)
	}
	if responseHeader[0] != pairingVersion {
		return nil, fmt.Errorf("不支持的协议版本: %d", responseHeader[0])
	}
	if responseHeader[1] != pairingTypeSpake2Msg {
		return nil, fmt.Errorf("意外的响应类型: %d", responseHeader[1])
	}

	payloadLen := binary.BigEndian.Uint32(responseHeader[2:])
	if payloadLen > maxSpake2MsgSize {
		return nil, fmt.Errorf("SPAKE2 响应数据过大: %d", payloadLen)
	}

	serverMsg := make([]byte, payloadLen)
	if _, err := io.ReadFull(conn, serverMsg); err != nil {
		return nil, fmt.Errorf("读取 SPAKE2 响应数据失败: %v", err)
	}

	sharedKey, err := client.Finish(serverMsg)
	if err != nil {
		return nil, fmt.Errorf("SPAKE2 Finish 失败: %v", err)
	}

	return sharedKey, nil
}

// deriveAesKey 从 SPAKE2 共享密钥派生 AES-128-GCM 密钥
// 使用 HKDF-SHA256（与 Android 实现一致）
func deriveAesKey(sharedKey []byte) []byte {
	prk := hmacSha256(sharedKey, nil)
	info := []byte(aesGcmInfo)
	return hkdfExpand(prk, info, aesGcmKeySize)
}

// hmacSha256 计算 HMAC-SHA256
func hmacSha256(key, data []byte) []byte {
	blockSize := 64
	if len(key) > blockSize {
		hash := sha256.Sum256(key)
		key = hash[:]
	}

	ipad := make([]byte, blockSize)
	opad := make([]byte, blockSize)
	for i := range key {
		ipad[i] = key[i] ^ 0x36
		opad[i] = key[i] ^ 0x5c
	}
	for i := len(key); i < blockSize; i++ {
		ipad[i] = 0x36
		opad[i] = 0x5c
	}

	inner := sha256.New()
	inner.Write(ipad)
	inner.Write(data)
	innerHash := inner.Sum(nil)

	outer := sha256.New()
	outer.Write(opad)
	outer.Write(innerHash)
	return outer.Sum(nil)
}

// hkdfExpand 实现 HKDF-Expand（SHA-256）
func hkdfExpand(prk, info []byte, length int) []byte {
	result := make([]byte, 0, length)
	t := make([]byte, 0)
	counter := byte(1)

	for len(result) < length {
		h := sha256.New()
		h.Write(t)
		h.Write(info)
		h.Write([]byte{counter})
		t = h.Sum(nil)
		result = append(result, t...)
		counter++
	}

	return result[:length]
}

// encryptAesGcm 使用 AES-128-GCM 加密数据
// nonce = 4 字节序列号（小端序）+ 8 字节零填充（与 Android 实现一致）
func encryptAesGcm(key []byte, sequence uint32, plaintext []byte) ([]byte, error) {
	nonce := make([]byte, 12)
	binary.LittleEndian.PutUint32(nonce, sequence)

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)
	return ciphertext, nil
}

// decryptAesGcm 使用 AES-128-GCM 解密数据
func decryptAesGcm(key []byte, sequence uint32, ciphertext []byte) ([]byte, error) {
	nonce := make([]byte, 12)
	binary.LittleEndian.PutUint32(nonce, sequence)

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, err
	}

	return plaintext, nil
}

// buildPeerInfo 构建 PeerInfo 数据
// 格式: type(1 byte) + publicKey
func buildPeerInfo(publicKeyHex string) []byte {
	pubKeyBytes, err := hex.DecodeString(publicKeyHex)
	if err != nil {
		pubKeyBytes = []byte(publicKeyHex)
	}

	info := make([]byte, 1+len(pubKeyBytes))
	info[0] = 1 // PeerInfo type = host
	copy(info[1:], pubKeyBytes)

	return info
}

// generateCertAndKey 生成 RSA 2048 密钥对 + X.509 自签名证书
func generateCertAndKey() (certPEM, keyPEM []byte, err error) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, nil, fmt.Errorf("生成 RSA 密钥失败: %v", err)
	}

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			Organization: []string{"CarWeb Bridge"},
			CommonName:   "adb pair client",
		},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth, x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, template, template, &privateKey.PublicKey, privateKey)
	if err != nil {
		return nil, nil, fmt.Errorf("创建证书失败: %v", err)
	}

	certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	keyPEM = pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	})

	return certPEM, keyPEM, nil
}

func handleScan(w http.ResponseWriter, r *http.Request) {
	subnet := strings.TrimPrefix(r.URL.Path, "/scan/")
	if subnet == "" || subnet == r.URL.Path {
		http.Error(w, "缺少子网地址", http.StatusBadRequest)
		return
	}

	parts := strings.Split(subnet, ".")
	if len(parts) != 3 {
		http.Error(w, "子网格式无效", http.StatusBadRequest)
		return
	}
	for _, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 || n > 255 {
			http.Error(w, "子网格式无效", http.StatusBadRequest)
			return
		}
	}

	wsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("扫描 WebSocket 升级失败: %v", err)
		return
	}
	defer wsConn.Close()

	log.Printf("开始扫描子网: %s.0/24", subnet)

	var mu sync.Mutex
	var found []string
	var wg sync.WaitGroup
	sem := make(chan struct{}, 15)

	for i := 1; i <= 254; i++ {
		wg.Add(1)
		sem <- struct{}{}

		go func(ip string) {
			defer wg.Done()
			defer func() { <-sem }()

			addr := net.JoinHostPort(ip, strconv.Itoa(adbDefaultPort))
			conn, err := net.DialTimeout("tcp", addr, 200*time.Millisecond)
			if err != nil {
				return
			}
			conn.Close()

			mu.Lock()
			found = append(found, ip)
			mu.Unlock()

			msg, _ := json.Marshal(map[string]string{"ip": ip})
			wsConn.WriteMessage(websocket.TextMessage, msg)
		}(fmt.Sprintf("%s.%d", subnet, i))
	}

	wg.Wait()

	done, _ := json.Marshal(map[string]interface{}{
		"done":  true,
		"total": len(found),
	})
	wsConn.WriteMessage(websocket.TextMessage, done)

	log.Printf("扫描完成，发现 %d 个设备", len(found))
}

var _ = io.Discard