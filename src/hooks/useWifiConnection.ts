import { useCallback, useState } from 'react';
import { useAdbStore } from './useAdbStore';

export function useWifiConnection() {
  const store = useAdbStore();
  const [isScanning, setIsScanning] = useState(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<string[]>([]);

  // 扫描局域网中的 ADB 设备
  const scanDevices = useCallback(async () => {
    setIsScanning(true);
    setDiscoveredDevices([]);

    try {
      // 获取本机 IP 网段
      const ips: string[] = [];

      // 使用 WebRTC 获取本地 IP
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1000);
      });

      const candidates: string[] = [];
      const sdp = pc.localDescription?.sdp;
      if (sdp) {
        const ipMatches = sdp.match(/(\d+\.\d+\.\d+\.\d+)/g);
        if (ipMatches) {
          candidates.push(...ipMatches);
        }
      }

      pc.close();

      // 提取网段并扫描常见端口
      const scannedIps = new Set<string>();
      for (const ip of candidates) {
        if (ip.startsWith('127.') || ip.startsWith('0.')) continue;

        const parts = ip.split('.');
        if (parts.length !== 4) continue;

        const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;

        // 扫描该网段的常见设备
        for (let i = 1; i <= 254; i++) {
          const targetIp = `${subnet}.${i}`;
          if (scannedIps.has(targetIp)) continue;
          scannedIps.add(targetIp);

          // 只扫描少量 IP 避免超时
          if (i > 10 && i < 240) continue;

          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 500);

            const response = await fetch(`http://${targetIp}:5555`, {
              method: 'HEAD',
              signal: controller.signal,
            }).catch(() => null);

            clearTimeout(timeout);

            if (response !== null) {
              ips.push(targetIp);
            }
          } catch {
            // 忽略连接失败
          }
        }
      }

      setDiscoveredDevices(ips);
    } catch (error) {
      console.error('扫描设备错误:', error);
    } finally {
      setIsScanning(false);
    }
  }, []);

  // 连接到指定 IP 的 ADB 设备
  const connectWifi = useCallback(async (_address: string) => {
    try {
      store.setConnectionStatus('connecting');
      store.setConnectionType('wifi');
      store.setError(null);

      // WiFi 连接需要 ADB 服务器支持
      // 这里简化处理，实际使用时需要通过 USB 先启用 ADB over WiFi
      throw new Error('WiFi 连接功能需要预先通过 USB 启用 ADB over WiFi');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'WiFi 连接失败';
      store.setError(message);
      store.setConnectionStatus('error');
      console.error('WiFi 连接错误:', error);
    }
  }, [store]);

  const disconnect = useCallback(async () => {
    await store.disconnect();
  }, [store]);

  return {
    connectWifi,
    disconnect,
    scanDevices,
    isScanning,
    discoveredDevices,
    isConnecting: store.connectionStatus === 'connecting',
    isConnected: store.connectionStatus === 'connected',
    error: store.error,
  };
}
