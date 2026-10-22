import { useCallback, useState, useRef } from 'react';
import type { Adb } from '@yume-chan/adb';
import { useAdbStore, type AdbStore } from './useAdbStore';
import { killScrcpyServer } from '@/lib/adb-commands';
import { handleAdbDisconnected } from '@/lib/adb-disconnect';
import { parseAdbQrCode, isValidIpAddress } from '@/lib/adb-pairing';
import { AdbServerManager, type IAdbWirelessService } from '@/lib/adb-server-manager';

/** 网络拓扑类型 */
export type WifiTopology = 'phone-hotspot' | 'car-hotspot' | 'manual';

/** 扫描结果中的设备信息 */
export interface ScannedDevice {
  ip: string;
  port: number;
}

export interface WifiRetryProgress {
  attempt: number;
  maxAttempts: number;
  retrying: boolean;
}

export interface UseWifiConnectionOptions {
  /** 允许注入自定义 ADB 服务（用于单元测试与环境隔离） */
  service?: IAdbWirelessService;
}

export interface UseWifiConnectionResult {
  /** 连接到指定 IP / IP:端口的 ADB 设备 */
  connectWifi: (address: string) => Promise<void>;
  /** 自动重试连接已知无线设备（支持退避重试与取消） */
  tryAutoConnectWifi: (
    address: string,
    onProgress?: (p: WifiRetryProgress) => void,
  ) => Promise<{ success: boolean; cancelled: boolean }>;
  /** 取消自动重连 */
  cancelAutoConnect: () => void;
  /** 通过输入配对端口和 6 位配对码进行免线配对并连接 */
  pairAndConnect: (pairingAddress: string, code: string, connectAddress?: string) => Promise<void>;
  /** 通过扫码配对信息连接 */
  connectWithPairing: (qrCode: string) => Promise<void>;
  /** 扫描宿主或局域网中已连接/发现的无线设备 */
  scanDevices: () => Promise<void>;
  /** 断开连接 */
  disconnect: () => Promise<void>;
  /** 设置网络拓扑类型（保留向后兼容） */
  setTopology: (topology: WifiTopology) => void;
  /** 当前网络拓扑类型 */
  topology: WifiTopology;
  /** 是否正在扫描 */
  isScanning: boolean;
  /** 发现的设备列表 */
  discoveredDevices: ScannedDevice[];
  /** 是否正在连接 */
  isConnecting: boolean;
  /** 是否已连接 */
  isConnected: boolean;
  /** 错误信息 */
  error: string | null;
}

/** 规范化 ADB 网络地址 */
function normalizeAddress(address: string, defaultPort = 5555): { host: string; port: number; full: string } {
  const trimmed = address.trim();
  if (trimmed.includes(':')) {
    const [h, pStr] = trimmed.split(':');
    const p = parseInt(pStr, 10) || defaultPort;
    return { host: h, port: p, full: `${h}:${p}` };
  }
  return { host: trimmed, port: defaultPort, full: `${trimmed}:${defaultPort}` };
}

/** 统一的启动会话并登记 Store 逻辑 */
async function attachConnectedAdb(
  store: AdbStore,
  adb: Adb,
  host: string,
  fullAddress: string,
): Promise<void> {
  await killScrcpyServer(adb, true);

  store.setAdb(adb);
  store.setDeviceInfo(`WiFi-${host}`, fullAddress);
  store.setWifiAddress(host);
  store.setConnectionStatus('connected');

  adb.disconnected.then(
    () => handleAdbDisconnected(store, adb),
    (error) => handleAdbDisconnected(store, adb, error),
  );
}

// 全局默认管理器单例
let defaultManager: AdbServerManager | null = null;
function getDefaultManager(): AdbServerManager {
  if (!defaultManager) {
    defaultManager = new AdbServerManager();
  }
  return defaultManager;
}

export function useWifiConnection(options?: UseWifiConnectionOptions): UseWifiConnectionResult {
  const store = useAdbStore();
  const service = options?.service ?? getDefaultManager();
  const cancelRef = useRef(false);

  const [isScanning, setIsScanning] = useState(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<ScannedDevice[]>([]);
  const [topology, setTopologyState] = useState<WifiTopology>('phone-hotspot');

  const cancelAutoConnect = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const setTopology = useCallback((t: WifiTopology) => {
    setTopologyState(t);
  }, []);

  /**
   * 刷新/扫描宿主识别到的无线设备列表
   */
  const scanDevices = useCallback(async () => {
    setIsScanning(true);
    try {
      const devices = await service.getDevices();
      const scanned: ScannedDevice[] = [];
      for (const d of devices) {
        if (d.serial && d.serial.includes(':')) {
          const { host, port } = normalizeAddress(d.serial);
          scanned.push({ ip: host, port });
        }
      }
      setDiscoveredDevices(scanned);
    } catch (error) {
      console.warn('查询已知设备失败:', error);
    } finally {
      setIsScanning(false);
    }
  }, [service]);

  /**
   * 直接连接指定 IP 的设备（该设备须已在宿主中配对授权）
   */
  const connectWifi = useCallback(
    async (address: string) => {
      const { host, full } = normalizeAddress(address);
      if (!isValidIpAddress(host)) {
        store.setError('IP 地址格式无效');
        store.setConnectionStatus('error');
        return;
      }

      try {
        store.setConnectionStatus('connecting');
        store.setConnectionType('wifi');
        store.setError(null);

        // 调用标准 adb connect
        await service.connect(full);

        // 创建 Adb 实例
        const adb = await service.createAdb({ serial: full });
        await attachConnectedAdb(store, adb, host, full);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'WiFi 连接失败';
        store.setError(message);
        store.setConnectionStatus('error');
        console.warn('WiFi 连接错误:', error);
      }
    },
    [service, store],
  );

  /**
   * 免线 6 位配对码配对并连接
   */
  const pairAndConnect = useCallback(
    async (pairingAddress: string, code: string, connectAddress?: string) => {
      const pairing = normalizeAddress(pairingAddress, 37000);
      if (!isValidIpAddress(pairing.host)) {
        store.setError('手机配对 IP 地址格式无效');
        store.setConnectionStatus('error');
        return;
      }
      if (!code || code.trim().length === 0) {
        store.setError('请输入 6 位配对码');
        store.setConnectionStatus('error');
        return;
      }

      try {
        store.setConnectionStatus('connecting');
        store.setConnectionType('wifi');
        store.setError(null);

        // 1. 调用官方 ADB pair 指令
        await service.pair(pairing.full, code.trim());

        // 2. 配对成功后，连接主调试端口（默认为 5555）
        const target = connectAddress ? normalizeAddress(connectAddress) : normalizeAddress(pairing.host, 5555);
        await service.connect(target.full);

        // 3. 创建 Adb 实例并挂载
        const adb = await service.createAdb({ serial: target.full });
        await attachConnectedAdb(store, adb, target.host, target.full);
      } catch (error) {
        const message = error instanceof Error ? error.message : '无线配对失败';
        store.setError(message);
        store.setConnectionStatus('error');
        console.warn('无线配对错误:', error);
      }
    },
    [service, store],
  );

  /**
   * 扫码一键配对并连接
   */
  const connectWithPairing = useCallback(
    async (qrCode: string) => {
      const info = parseAdbQrCode(qrCode);
      if (!info) {
        store.setError('QR 码格式无效');
        store.setConnectionStatus('error');
        return;
      }

      const pairingAddress = `${info.host}:${info.pairingPort}`;
      const connectAddress = `${info.host}:5555`;
      await pairAndConnect(pairingAddress, info.pairingCode, connectAddress);
    },
    [pairAndConnect, store],
  );

  /**
   * 尝试自动重试连接无线设备（指数退避并支持取消）
   */
  const tryAutoConnectWifi = useCallback(
    async (
      address: string,
      onProgress?: (p: WifiRetryProgress) => void,
    ): Promise<{ success: boolean; cancelled: boolean }> => {
      cancelRef.current = false;
      await store.disconnect();

      store.setConnectionType('wifi');
      store.setError(null);
      store.setConnectionStatus('connecting');

      const { host, full } = normalizeAddress(address);
      if (!isValidIpAddress(host)) {
        store.setConnectionStatus('idle');
        return { success: false, cancelled: false };
      }

      const maxAttempts = 3;
      const backoffBase = 500;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (cancelRef.current) {
          store.setConnectionStatus('idle');
          return { success: false, cancelled: true };
        }

        onProgress?.({ attempt, maxAttempts, retrying: attempt > 1 });

        try {
          await service.connect(full);
          const adb = await service.createAdb({ serial: full });
          await attachConnectedAdb(store, adb, host, full);
          return { success: true, cancelled: false };
        } catch {
          if (attempt < maxAttempts) {
            const delay = backoffBase * Math.pow(2, attempt - 1);
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }

      store.setConnectionStatus('idle');
      return { success: false, cancelled: false };
    },
    [service, store],
  );

  const disconnect = useCallback(async () => {
    await store.disconnect();
  }, [store]);

  return {
    connectWifi,
    tryAutoConnectWifi,
    cancelAutoConnect,
    pairAndConnect,
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
