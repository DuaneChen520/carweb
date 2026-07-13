import { useState, useCallback } from 'react';

export type DisplayMode = 'virtual' | 'mirror';

export interface RememberedDevice {
  id: string;
  /** adb serial；forget 时据此失效按 serial 索引的 dex 缓存（见 ADR-0009 D2）。旧记录可能缺失，调用处应回退到 id。 */
  serial: string;
  name: string;
  type: 'usb' | 'wifi';
  address: string;
  mode: DisplayMode;
  lastConnected: number;
}

const STORAGE_KEY = 'carweb-devices';

function loadDevices(): RememberedDevice[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveDevices(devices: RememberedDevice[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(devices));
}

export function useRememberedDevices() {
  const [devices, setDevices] = useState<RememberedDevice[]>(loadDevices);

  const remember = useCallback((device: RememberedDevice) => {
    setDevices(prev => {
      const filtered = prev.filter(d => d.id !== device.id);
      const updated = [device, ...filtered];
      saveDevices(updated);
      return updated;
    });
  }, []);

  const forget = useCallback((id: string) => {
    setDevices(prev => {
      const updated = prev.filter(d => d.id !== id);
      saveDevices(updated);
      return updated;
    });
  }, []);

  const getLastDevice = useCallback((): RememberedDevice | undefined => {
    if (devices.length === 0) return undefined;
    return devices.reduce((a, b) => a.lastConnected > b.lastConnected ? a : b);
  }, [devices]);

  return { devices, remember, forget, getLastDevice };
}
