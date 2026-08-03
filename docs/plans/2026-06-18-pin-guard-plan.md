# PIN Guard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 6-digit PIN protection to virtual screen desktop launch.

**Architecture:** PIN data stored in localStorage with PBKDF2 salted hash. `App.tsx` inserts a `PinGuard` state between "connected" and "entering desktop". `PinDialog` handles both verify and setup modes. `ControlSidebar` settings panel provides PIN management entry.

**Tech Stack:** React (hooks), TypeScript, Web Crypto API (PBKDF2), Zustand (useAdbStore), localStorage

---

### Task 1: Create useDevicePin hook

**Files:**
- Create: `src/hooks/useDevicePin.ts`
- Note: No tests for this (localStorage + crypto, integration tested via components)

**Step 1: Implement the hook**

```typescript
import { useCallback } from 'react';

const STORAGE_KEY = 'carweb-device-pins';

interface PinEntry {
  hash: string; // base64
  salt: string; // base64
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
    {
      name: 'PBKDF2',
      salt,
      iterations: 1000,
      hash: 'SHA-256',
    },
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
```

**Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 2: Create PinDialog component

**Files:**
- Create: `src/components/PinDialog.tsx`

**Step 1: Implement PinDialog**

A modal overlay with two modes:

- `verify` mode: 6 digit holes, number pad, "Forgot PIN?" link
- `setup` mode: two-step (enter PIN → confirm PIN)

Props:
```typescript
interface PinDialogProps {
  mode: 'verify' | 'setup';
  deviceId: string;
  deviceName: string;
  hasExistingPin: boolean;
  onSuccess: () => void;
  onForgot?: () => void;
  onCancel?: () => void;
}
```

Key states:
- digits: `string[]` (max 6)
- step: `'input' | 'confirm'` (setup mode only)
- error: `string | null`
- attempts: `number` (verify mode only, max 3)

UI:
- Full screen overlay with `bg-black/60 backdrop-blur-sm`
- Centered card: `bg-slate-900/90 border border-slate-700 rounded-2xl`
- Title + subtitle
- 6 digit display holes (filled circles or empty circles)
- Number grid: 1-9, empty, 0, backspace
- Error shake animation
- "Forgot PIN?" button (verify mode only, bottom)

**Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 3: Modify App.tsx — PIN guard state and flow

**Files:**
- Modify: `src/App.tsx`

**Step 1: Add pinGuard state and imports**

```typescript
import { PinDialog } from './components/PinDialog';
import { useDevicePin } from './hooks/useDevicePin';

type PinGuardState =
  | { type: 'none' }
  | { type: 'required'; deviceId: string; deviceName: string };
```

**Step 2: Add state + hook in component**

```typescript
const [pinGuard, setPinGuard] = useState<PinGuardState>({ type: 'none' });
const { hasPin, verifyPin, removePin } = useDevicePin();
const store = useAdbStore();
```

**Step 3: Insert PIN guard in connection success path**

After the existing connection success callback (where it sets overlayState to 'hidden'), add PIN check:

```typescript
// Inside the connection success useEffect or callback
if (store.connectionStatus === 'connected' && hasPin(store.deviceSerial)) {
  setPinGuard({ type: 'required', deviceId: store.deviceSerial, deviceName: store.deviceName });
  return; // Don't enter desktop yet
}
```

**Step 4: Render PinDialog when pinGuard is active**

```tsx
{pinGuard.type === 'required' && (
  <PinDialog
    mode="verify"
    deviceId={pinGuard.deviceId}
    deviceName={pinGuard.deviceName}
    hasExistingPin={true}
    onSuccess={() => {
      setPinGuard({ type: 'none' });
      finishConnect();
    }}
    onForgot={() => {
      removePin(pinGuard.deviceId);
      forget(pinGuard.deviceId);
      store.disconnect?.();
      setPinGuard({ type: 'none' });
    }}
  />
)}
```

**Step 5: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 4: Modify ConnectionOverlay — remembered device click-to-connect

**Files:**
- Modify: `src/components/ConnectionOverlay.tsx`

**Step 1: Add `onAutoConnect` prop**

```typescript
interface ConnectionOverlayProps {
  // ... existing props
  onAutoConnect?: (device: RememberedDevice) => void;
}
```

**Step 2: Wire up remembered device card click**

When a remembered device is selected (already have `setSelectedDevice`), add a `useEffect` that triggers auto-connect:

```typescript
useEffect(() => {
  if (selectedDevice) {
    onAutoConnect?.(selectedDevice);
  }
}, [selectedDevice]);
```

Or simpler: make the card click directly call auto-connect instead of just selecting:

```typescript
onClick={() => onAutoConnect?.(device)}
```

Remove the "Connect & Launch" button when a remembered device is selected.

**Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 5: Modify ControlSidebar — PIN setting in sidebar

**Files:**
- Modify: `src/components/ControlSidebar.tsx`

**Step 1: Add PIN setting UI to settings panel**

In the settings popover, after "Keyboard Mode" section:

```tsx
<div className="border-t border-slate-700 pt-3 mt-3">
  <div className="text-xs text-slate-400 mb-2">启动 PIN</div>
  {isConnected ? (
    hasExistingPin ? (
      <button onClick={handleChangePin} className="...">
        已启用 · 更改
      </button>
    ) : (
      <button onClick={handleSetupPin} className="...">
        设置启动 PIN
      </button>
    )
  ) : (
    <div className="text-xs text-slate-500">需连接设备后设置</div>
  )}
</div>
```

**Step 2: Integrate PinDialog in setup mode**

When "设置启动 PIN" or "更改" is clicked, show `PinDialog` with `mode: 'setup'`.

This requires the sidebar to have access to `deviceId` (from useAdbStore) and the PIN hooks.

**Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 6: Final verification

**Step 1: TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Lint check**

Run: `npx eslint src/ --max-warnings 0`
Expected: No errors

**Step 3: Manual smoke test checklist**
- [ ] Open app with no remembered device → connection overlay shows normally
- [ ] Connect via USB → PIN not set → enters desktop directly
- [ ] Connect via USB → set PIN in sidebar → disconnect → reconnect → PIN dialog appears
- [ ] Correct PIN → enters desktop
- [ ] Wrong PIN 3 times → device forgotten + disconnected
- [ ] "Forgot PIN" → device forgotten + disconnected
- [ ] Set PIN → change PIN → verify new PIN works
- [ ] Close/reopen browser → PIN state reset (device needs reconnect)
