// carweb-bridge: WebSocket ↔ ADB Server (TCP 5037) 极简透传网桥
//
// 在车机宿主端运行，将本地官方 ADB 守护程序（127.0.0.1:5037）以 WebSocket 形式暴露给前端浏览器。
//
// 端点说明：
//   - /adb            WebSocket ↔ 127.0.0.1:5037 双向字节流透传
//   - /adb/{target}   WebSocket ↔ 指定 TCP 目标（如 127.0.0.1:5037）
//   - /health         健康检查，探测网桥与本地 ADB 守护进程联通状态
//
// 编译：go build -o tiny-bridge main.go
// 运行：./tiny-bridge -port 8080 -adb 127.0.0.1:5037

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // 允许本地前端连接
	},
	ReadBufferSize:  64 * 1024,
	WriteBufferSize: 64 * 1024,
}

var defaultAdbAddr = "127.0.0.1:5037"

func main() {
	port := flag.Int("port", 8080, "网桥监听端口")
	adbAddr := flag.String("adb", defaultAdbAddr, "本地 ADB 守护进程地址 (host:port)")
	flag.Parse()

	defaultAdbAddr = *adbAddr

	http.HandleFunc("/adb", handleAdbBridge)
	http.HandleFunc("/adb/", handleAdbBridge)
	http.HandleFunc("/health", handleHealth)

	addr := fmt.Sprintf(":%d", *port)
	log.Printf("carweb-bridge 启动，监听 %s，目标 ADB 宿主：%s", addr, defaultAdbAddr)
	log.Printf("  端点说明：")
	log.Printf("    /adb          WebSocket ↔ %s 双向透传", defaultAdbAddr)
	log.Printf("    /adb/{target} WebSocket ↔ 自定义 TCP 目标双向透传")
	log.Printf("    /health       宿主与 ADB 状态检查")

	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("启动失败: %v", err)
	}
}

func handleAdbBridge(w http.ResponseWriter, r *http.Request) {
	target := strings.TrimPrefix(r.URL.Path, "/adb")
	target = strings.TrimPrefix(target, "/")

	targetAddr := defaultAdbAddr
	if target != "" {
		if strings.Contains(target, ":") {
			targetAddr = target
		} else {
			// 如果只传入端口号
			if p, err := strconv.Atoi(target); err == nil && p > 0 && p <= 65535 {
				targetAddr = fmt.Sprintf("127.0.0.1:%d", p)
			} else {
				targetAddr = net.JoinHostPort(target, "5037")
			}
		}
	}

	wsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket 升级失败: %v", err)
		return
	}
	defer wsConn.Close()

	tcpConn, err := net.DialTimeout("tcp", targetAddr, 3*time.Second)
	if err != nil {
		log.Printf("连接 ADB 宿主失败 %s: %v", targetAddr, err)
		wsConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "ADB 宿主不可达"))
		return
	}
	defer tcpConn.Close()

	var wg sync.WaitGroup
	wg.Add(2)

	// WebSocket -> TCP
	go func() {
		defer wg.Done()
		defer tcpConn.Close()
		for {
			messageType, message, err := wsConn.ReadMessage()
			if err != nil {
				return
			}
			if messageType == websocket.BinaryMessage || messageType == websocket.TextMessage {
				if _, err := tcpConn.Write(message); err != nil {
					return
				}
			}
		}
	}()

	// TCP -> WebSocket
	go func() {
		defer wg.Done()
		defer wsConn.Close()
		buf := make([]byte, 64*1024)
		for {
			n, err := tcpConn.Read(buf)
			if err != nil {
				return
			}
			if err := wsConn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
				return
			}
		}
	}()

	wg.Wait()
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	conn, err := net.DialTimeout("tcp", defaultAdbAddr, 1*time.Second)
	adbOk := err == nil
	if adbOk {
		conn.Close()
	}

	status := map[string]interface{}{
		"status":   "ok",
		"bridge":   true,
		"adbHost":  defaultAdbAddr,
		"adbAlive": adbOk,
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(status)
}
