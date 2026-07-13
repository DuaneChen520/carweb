import { useCallback, useRef } from 'react';
import { Adb, AdbDaemonTransport } from '@yume-chan/adb';
import { AdbDaemonWebUsbDevice, AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';
import { useAdbStore, type AdbStore } from './useAdbStore';
import { killScrcpyServer } from '@/lib/adb-commands';
import { retryConnectUsb, type RetryProgress } from '@/lib/usb-connect';
import { restoreDevice } from '@/lib/usb-device-restore';
import { handleAdbDisconnected } from '@/lib/adb-disconnect';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 执行一次完整的 device.connect → authenticate → adb 建立。失败则 reject。 */
async function connectOnce(store: AdbStore, device: AdbDaemonWebUsbDevice): Promise<void> {
  let conn: Awaited<ReturnType<(typeof device)['connect']>> | null = null;
  try {
    conn = await device.connect();
    const credentialManager = new AdbWebCredentialStore('carweb-adb-key');
    const transport = await AdbDaemonTransport.authenticate({
      serial: device.serial,
      connection: conn,
      credentialStore: credentialManager,
    });
    const adb = new Adb(transport);
    await killScrcpyServer(adb, true);

    store.setAdb(adb);
    store.setDeviceInfo(device.name || '未知设备', device.serial);
    store.setConnectionStatus('connected');

    // 真实掉线 / 有意断开的统一入口：标记区分两者（见 docs/adr/0007）。
    adb.disconnected.then(
      () => handleAdbDisconnected(store, adb),
      (error) => handleAdbDisconnected(store, adb, error),
    );
  } catch (error) {
    // authenticate 失败后 USB 接口可能被占用，尝试释放以便下一轮重试
    try { await restoreDevice({ reset: () => device.raw.reset(), close: () => device.raw.close() }); } catch {}
    throw error;
  }
}

export interface UseUsbConnectionResult {
  connectUsb: () => Promise<void>;
  tryAutoConnectUsb: (
    serial: string,
    onProgress?: (p: RetryProgress) => void,
  ) => Promise<{ success: boolean; cancelled: boolean }>;
  /** 取消正在进行的自动重连重试循环。 */
  cancelAutoConnect: () => void;
  disconnect: () => Promise<void>;
  isConnecting: boolean;
  isConnected: boolean;
  error: string | null;
}

export function useUsbConnection(): UseUsbConnectionResult {
  const store = useAdbStore();
  const cancelRef = useRef(false);

  const cancelAutoConnect = useCallback(() => {
    cancelRef.current = true;
  }, []);

const tryAutoConnectUsb = useCallback(async (
	    serial: string,
	    onProgress?: (p: RetryProgress) => void,
	  ): Promise<{ success: boolean; cancelled: boolean }> => {
	    cancelRef.current = false;

	    // 断开既有连接，防止后续 prepareDevice (reset) 触发残留 adb.disconnected handler
	    await store.disconnect();

	    store.setConnectionType('usb');
    store.setError(null);
    store.setConnectionStatus('connecting');

    const manager = AdbDaemonWebUsbDeviceManager.BROWSER;

    const result = await retryConnectUsb(serial, {
      findDevice: async (s) => {
        if (!manager) return null;
        const devices = await manager.getDevices();
        return devices.find((d) => d.serial === s) ?? null;
      },
      prepareDevice: (device) =>
        restoreDevice({
          reset: () => (device as AdbDaemonWebUsbDevice).raw.reset(),
          close: () => (device as AdbDaemonWebUsbDevice).raw.close(),
        }),
      connectOnce: (device) => connectOnce(store, device as AdbDaemonWebUsbDevice),
      sleep,
      isCancelled: () => cancelRef.current,
      onProgress,
    });

    if (result.success) {
      // connectOnce 内部已置 connected；补记设备引用
      const matched = manager ? (await manager.getDevices()).find((d) => d.serial === serial) : null;
      if (matched) store.setUsbDevice(matched);
      return { success: true, cancelled: false };
    }

    if (result.cancelled) {
      store.setConnectionStatus('idle');
      return { success: false, cancelled: true };
    }

    // 重试用尽：温和降级，不写 error（避免 UI 显示红色错误），仅置 idle。
    store.setConnectionStatus('idle');
    return { success: false, cancelled: false };
  }, [store]);

  const connectUsb = useCallback(async () => {
    try {
      store.setConnectionStatus('connecting');
      store.setConnectionType('usb');
      store.setError(null);

      const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
      if (!manager) {
        throw new Error('浏览器不支持 WebUSB API');
      }

      const device = await manager.requestDevice();
      if (!device) {
        store.setConnectionStatus('idle');
        store.setConnectionType(null);
        return;
      }

      store.setUsbDevice(device);
      await restoreDevice({ reset: () => device.raw.reset(), close: () => device.raw.close() });
      await connectOnce(store, device);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'USB 连接失败';
      store.setError(message);
      store.setConnectionStatus('error');
      // 手动连接路径保留 warn（便于排查），但不刷屏
      console.warn('USB 连接错误:', error);
    }
  }, [store]);

  const disconnect = useCallback(async () => {
    await store.disconnect();
  }, [store]);

  return {
    connectUsb,
    tryAutoConnectUsb,
    cancelAutoConnect,
    disconnect,
    isConnecting: store.connectionStatus === 'connecting',
    isConnected: store.connectionStatus === 'connected',
    error: store.error,
  };
}
