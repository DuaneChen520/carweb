import { useCallback } from 'react';

const STORAGE_KEY = 'carweb-device-pins';

interface PinEntry {
  hash: string;
  salt: string;
}

function loadPins(): Record<string, PinEntry> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function savePins(pins: Record<string, PinEntry>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
}

async function pbkdf2Hash(pin: string, salt: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

export function useDevicePin() {
  const hasPin = useCallback((deviceId: string): boolean => {
    return deviceId in loadPins();
  }, []);

  const setPin = useCallback(async (deviceId: string, pin: string): Promise<void> => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await pbkdf2Hash(pin, salt);
    const pins = loadPins();
    pins[deviceId] = { hash, salt: btoa(String.fromCharCode(...salt)) };
    savePins(pins);
  }, []);

  const verifyPin = useCallback(async (deviceId: string, pin: string): Promise<boolean> => {
    const pins = loadPins();
    const entry = pins[deviceId];
    if (!entry) return false;
    const salt = Uint8Array.from(atob(entry.salt), c => c.charCodeAt(0));
    const hash = await pbkdf2Hash(pin, salt);
    return hash === entry.hash;
  }, []);

  const removePin = useCallback((deviceId: string): void => {
    const pins = loadPins();
    delete pins[deviceId];
    savePins(pins);
  }, []);

  return { hasPin, setPin, verifyPin, removePin };
}
