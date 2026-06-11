import { useCallback } from 'react';
import { Adb, AdbDaemonTransport } from '@yume-chan/adb';
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';
import { useAdbStore } from './useAdbStore';

export function useUsbConnection() {
  const store = useAdbStore();

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

      const connection = await device.connect();

      // 使用凭证管理器进行认证
      const credentialManager = new AdbWebCredentialStore('carweb-adb-key');

      const transport = await AdbDaemonTransport.authenticate({
        serial: device.serial,
        connection,
        credentialStore: credentialManager,
      });

      const adb = new Adb(transport);

      store.setAdb(adb);
      store.setDeviceInfo(device.name || '未知设备', device.serial);
      store.setConnectionStatus('connected');

      // 监听断开连接
      adb.disconnected.then(() => {
        store.setConnectionStatus('disconnected');
        store.setAdb(null);
        store.setUsbDevice(null);
        store.setDeviceInfo(null, null);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'USB 连接失败';
      store.setError(message);
      store.setConnectionStatus('error');
      console.error('USB 连接错误:', error);
    }
  }, [store]);

  const disconnect = useCallback(async () => {
    await store.disconnect();
  }, [store]);

  return {
    connectUsb,
    disconnect,
    isConnecting: store.connectionStatus === 'connecting',
    isConnected: store.connectionStatus === 'connected',
    error: store.error,
  };
}
