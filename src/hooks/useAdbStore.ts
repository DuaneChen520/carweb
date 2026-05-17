import { create } from 'zustand';
import type { Adb } from '@yume-chan/adb';
import type { AdbDaemonWebUsbDevice } from '@yume-chan/adb-daemon-webusb';

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

export const useAdbStore = create<AdbStore>((set) => ({
  ...initialState,

  setConnectionType: (type) => set({ connectionType: type }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setAdb: (adb) => set({ adb }),
  setUsbDevice: (device) => set({ usbDevice: device }),
  setWifiAddress: (address) => set({ wifiAddress: address }),
  setError: (error) => set({ error }),
  setDeviceInfo: (name, serial) => set({ deviceName: name, deviceSerial: serial }),
  reset: () => set(initialState),
}));
