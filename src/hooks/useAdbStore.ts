import { create } from 'zustand';
import type { Adb } from '@yume-chan/adb';
import type { AdbDaemonWebUsbDevice } from '@yume-chan/adb-daemon-webusb';
import { markIntentionalClose } from '@/lib/adb-intent';

export type ConnectionType = 'usb' | 'wifi' | null;
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface AdbStore {
  // 连接状态
  connectionType: ConnectionType;
  connectionStatus: ConnectionStatus;
  adb: Adb | null;
  usbDevice: AdbDaemonWebUsbDevice | null;
  wifiAddress: string | null;
  error: string | null;

  // 设备信息
  deviceName: string | null;
  deviceSerial: string | null;

  // 操作
  setConnectionType: (type: ConnectionType) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setAdb: (adb: Adb | null) => void;
  setUsbDevice: (device: AdbDaemonWebUsbDevice | null) => void;
  setWifiAddress: (address: string | null) => void;
  setError: (error: string | null) => void;
  setDeviceInfo: (name: string | null, serial: string | null) => void;
  reset: () => void;
  disconnect: () => Promise<void>;
}

const initialState = {
  connectionType: null as ConnectionType,
  connectionStatus: 'idle' as ConnectionStatus,
  adb: null as Adb | null,
  usbDevice: null as AdbDaemonWebUsbDevice | null,
  wifiAddress: null as string | null,
  error: null as string | null,
  deviceName: null as string | null,
  deviceSerial: null as string | null,
};

export const useAdbStore = create<AdbStore>((set, get) => ({
  ...initialState,

  setConnectionType: (type) => set({ connectionType: type }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setAdb: (adb) => set({ adb }),
  setUsbDevice: (device) => set({ usbDevice: device }),
  setWifiAddress: (address) => set({ wifiAddress: address }),
  setError: (error) => set({ error }),
  setDeviceInfo: (name, serial) => set({ deviceName: name, deviceSerial: serial }),
  reset: () => set(initialState),
  disconnect: async () => {
    try {
      const adb = get().adb;
      if (adb) {
        // 同步打标：声明本次关闭是应用层有意发起（须先于异步的 adb.close()），
        // 使 adb.disconnected 回调降级为 idle 而非 disconnected，避免误弹断线 overlay。
        // 见 docs/adr/0007。
        markIntentionalClose(adb);
        await adb.close();
      }
    } catch (error) {
      console.error('断开连接错误:', error);
    } finally {
      set(initialState);
    }
  },
}));
