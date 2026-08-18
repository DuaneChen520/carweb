import { useCallback, useRef, useState } from 'react';
import { Adb, adbDaemonAuthenticate } from '@yume-chan/adb';
import { AdbWebCryptoCredentialManager, TangoIndexedDbStorage } from '@yume-chan/adb-credential-web';
import { useAdbStore, type AdbStore } from './useAdbStore';
import { killScrcpyServer } from '@/lib/adb-commands';
import { handleAdbDisconnected } from '@/lib/adb-disconnect';
import { AdbDaemonWebSocketDevice } from '@/lib/websocket-device';
import { parseAdbQrCode, pairWithDevice, isValidIpAddress } from '@/lib/adb-pairing';

/** 桥接代理默认地址 */
const BRIDGE_HOST = 'localhost';
const BRIDGE_PORT = 8080;

/** 扫描超时（毫秒） */
const SCAN_TIMEOUT = 10000;

/** 网络拓扑类型 */
export type WifiTopology = 'phone-hotspot' | 'car-hotspot' | 'manual';

/** 扫描结果中的设备信息 */
export interface ScannedDevice {
  ip: string;
  port: number;
}

/**
 * 执行一次完整的 WebSocket 连接 → 认证 → ADB 建立。
 */
async function connectOnce(
  store: AdbStore,
  device: AdbDaemonWebSocketDevice,
): Promise<void> {
  let conn: Awaited<ReturnType<typeof device.connect>> | null = null;
  try {
    conn = await device.connect();

    const credentialManager = new AdbWebCryptoCredentialManager(
      new TangoIndexedDbStorage(),
      'carweb-adb-key',
    );
    const transport = await adbDaemonAuthenticate({
      serial: device.serial,
      connection: conn,
      credentialManager,
    });
    const adb = new Adb(transport);
    await killScrcpyServer(adb, true);

    store.setAdb(adb);
    store.setDeviceInfo(device.name, device.serial);
    store.setWifiAddress(device.targetHost);
    store.setConnectionStatus('connected');

    adb.disconnected.then(
      () => handleAdbDisconnected(store, adb),
      (error) => handleAdbDisconnected(store, adb, error),
    );
  } catch (error) {
    throw error;
  }
}

export interface UseWifiConnectionResult {
  /** 连接到指定 IP 的 ADB 设备 */
  connectWifi: (address: string) => Promise<void>;
  /** 通过扫码配对信息连接 */
  connectWithPairing: (qrCode: string) => Promise<void>;
  /** 扫描局域网中的 ADB 设备 */
  scanDevices: () => Promise<void>;
  /** 断开连接 */
  disconnect: () => Promise<void>;
  /** 设置网络拓扑类型 */
  setTopology: (topology: WifiTopology) => void;
  /** 当前网络拓扑类型 */
  topology: WifiTopology;
  /** 是否正在扫描 */
  isScanning: boolean;
  /** 扫描发现的设备 */
  discoveredDevices: ScannedDevice[];
  /** 是否正在连接 */
  isConnecting: boolean;
  /** 是否已连接 */
  isConnected: boolean;
  /** 错误信息 */
  error: string | null;
}

export function useWifiConnection(): UseWifiConnectionResult {
  const store = useAdbStore();
  const [isScanning, setIsScanning] = useState(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<ScannedDevice[]>([]);
  const [topology, setTopologyState] = useState<WifiTopology>('phone-hotspot');
  const cancelRef = useRef(false);

  const setTopology = useCallback((t: WifiTopology) => {
    setTopologyState(t);
  }, []);

  /**
   * 扫描局域网中的 ADB 设备。
   *
   * 通过 WebSocket 桥接代理的 /scan/{subnet} 端点执行扫描，
   * 桥接代理在车机本地运行，可以直接进行 TCP 连接探测。
   */
  const scanDevices = useCallback(async () => {
    setIsScanning(true);
    setDiscoveredDevices([]);
    cancelRef.current = false;

    try {
      // 1. 获取本机 IP 网段（通过 WebRTC）
      const subnet = await getLocalSubnet();
      if (!subnet) {
        throw new Error('无法获取本机 IP 网段');
      }

      // 2. 通过 WebSocket 连接到桥接代理的扫描端点
      const ws = new WebSocket(`ws://${BRIDGE_HOST}:${BRIDGE_PORT}/scan/${subnet}`);
      ws.binaryType = 'arraybuffer';

      const devices: ScannedDevice[] = [];

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('扫描超时'));
        }, SCAN_TIMEOUT);

        ws.onmessage = (event) => {
          let data: string;
          if (event.data instanceof ArrayBuffer) {
            data = new TextDecoder().decode(event.data);
          } else {
            data = event.data as string;
          }

          try {
            const result = JSON.parse(data);
            if (result.done) {
              clearTimeout(timeout);
              resolve();
            } else if (result.ip) {
              devices.push({ ip: result.ip, port: 5555 });
              setDiscoveredDevices([...devices]); // 实时更新 UI
            }
          } catch {
            // 非 JSON 消息，忽略
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('扫描连接失败'));
        };

        ws.onclose = () => {
          clearTimeout(timeout);
          resolve();
        };
      });

      setDiscoveredDevices(devices);
    } catch (error) {
      console.error('扫描设备错误:', error);
      // 扫描失败时不阻塞连接流程
    } finally {
      setIsScanning(false);
    }
  }, []);

  /**
   * 连接到指定 IP 的 ADB 设备。
   *
   * 通过 WebSocket 桥接代理转发 ADB 流量。
   * 假设已通过 USB 或扫码配对完成过认证。
   */
  const connectWifi = useCallback(async (address: string) => {
    // 解析地址: 支持 "192.168.1.100" 或 "192.168.1.100:5555" 格式
    let ip = address;
    let port = 5555;

    if (address.includes(':')) {
      const parts = address.split(':');
      ip = parts[0];
      port = parseInt(parts[1], 10) || 5555;
    }

    if (!isValidIpAddress(ip)) {
      store.setError('IP 地址格式无效');
      store.setConnectionStatus('error');
      return;
    }

    try {
      store.setConnectionStatus('connecting');
      store.setConnectionType('wifi');
      store.setError(null);

      const device = new AdbDaemonWebSocketDevice(ip, port, BRIDGE_HOST, BRIDGE_PORT);
      await connectOnce(store, device);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'WiFi 连接失败';
      store.setError(message);
      store.setConnectionStatus('error');
      console.warn('WiFi 连接错误:', error);
    }
  }, [store]);

  /**
   * 通过扫码配对信息连接。
   *
   * 1. 解析 QR 码
   * 2. 执行 ADB 配对（通过桥接代理）
   * 3. 配对成功后连接 ADB 端口
   */
  const connectWithPairing = useCallback(async (qrCode: string) => {
    const pairingInfo = parseAdbQrCode(qrCode);
    if (!pairingInfo) {
      store.setError('QR 码格式无效');
      store.setConnectionStatus('error');
      return;
    }

    try {
      store.setConnectionStatus('connecting');
      store.setConnectionType('wifi');
      store.setError(null);

      // 获取或生成 RSA 密钥
      const credentialManager = new AdbWebCryptoCredentialManager(
        new TangoIndexedDbStorage(),
        'carweb-adb-key',
      );

      // 获取已有的密钥，如果没有则生成一个
      let publicKeyHex = '';
      for await (const key of credentialManager.iterateKeys()) {
        if (key instanceof Error) continue;
        publicKeyHex = exportPublicKeyHex(key);
        break;
      }

      if (!publicKeyHex) {
        // 生成新密钥
        const key = await credentialManager.generateKey();
        publicKeyHex = exportPublicKeyHex(key);
      }

      // 执行配对
      const bridgeUrl = `ws://${BRIDGE_HOST}:${BRIDGE_PORT}`;
      const result = await pairWithDevice(bridgeUrl, pairingInfo, publicKeyHex);

      if (!result.success) {
        throw new Error(result.error || '配对失败');
      }

      // 配对成功后，连接 ADB 端口（5555）
      const device = new AdbDaemonWebSocketDevice(
        pairingInfo.host,
        5555,
        BRIDGE_HOST,
        BRIDGE_PORT,
      );
      await connectOnce(store, device);
    } catch (error) {
      const message = error instanceof Error ? error.message : '配对连接失败';
      store.setError(message);
      store.setConnectionStatus('error');
      console.warn('配对连接错误:', error);
    }
  }, [store]);

  const disconnect = useCallback(async () => {
    await store.disconnect();
  }, [store]);

  return {
    connectWifi,
    connectWithPairing,
    scanDevices,
    disconnect,
    setTopology,
    topology,
    isScanning,
    discoveredDevices,
    isConnecting: store.connectionStatus === 'connecting',
    isConnected: store.connectionStatus === 'connected',
    error: store.error,
  };
}

/**
 * 通过 WebRTC 获取本机 IP 网段。
 */
async function getLocalSubnet(): Promise<string | null> {
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    const sdp = pc.localDescription?.sdp;
    pc.close();

    if (sdp) {
      const ipMatches = sdp.match(/(\d+\.\d+\.\d+)\.\d+/g);
      if (ipMatches && ipMatches.length > 0) {
        // 排除 127.x.x.x
        for (const match of ipMatches) {
          if (!match.startsWith('127.')) {
            // 提取前三个段作为子网
            return match.split('.').slice(0, 3).join('.');
          }
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 将 AdbPrivateKey 的公钥（n）导出为十六进制字符串。
 * 桥接代理接收 RSA 模数 n 的十六进制表示。
 * 输出为固定长度（256 字节 = 512 十六进制字符，因为 RSA-2048）。
 */
function exportPublicKeyHex(key: { n: bigint }): string {
  let hex = key.n.toString(16);
  // 补齐到 512 字符（256 字节）
  return hex.padStart(512, '0');
}