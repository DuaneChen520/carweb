import { useState, useEffect, useCallback, useRef } from 'react';
import { VirtualScreen } from './components/VirtualScreen';
import { DesktopScreen } from './components/DesktopScreen';
import { ConnectionOverlay } from './components/ConnectionOverlay';
import { PinDialog } from './components/PinDialog';
import { ScrcpyProvider } from './contexts/ScrcpyContext';
import { AppPickerProvider } from './contexts/AppPickerContext';
import { useAdbStore } from './hooks/useAdbStore';
import { useRememberedDevices, type DisplayMode } from './hooks/useRememberedDevices';
import { useDevicePin } from './hooks/useDevicePin';
import { useUsbConnection } from './hooks/useUsbConnection';
import { useWifiConnection } from './hooks/useWifiConnection';
import { subscribeLinkState } from './lib/link-state-bus';
import { markIntentionalClose } from '@/lib/adb-intent';
import { forgetDeviceCache } from '@/lib/forget-device-cache';

type OverlayState =
  | 'auto-connecting'      // 首次尝试中
  | 'auto-reconnecting'    // 进入重试阶段
  | 'auto-failed'          // 重试用尽，温和降级
  | 'manual'
  | 'reconnecting'         // 使用中断开，提示重连
  | 'hidden';

type PinGuardState =
  | { type: 'none' }
  | { type: 'required'; deviceId: string; deviceName: string };

function App() {
  const [overlayState, setOverlayState] = useState<OverlayState>('manual');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('virtual');
  const [isFading, setIsFading] = useState(false);
  const [pinGuard, setPinGuard] = useState<PinGuardState>({ type: 'none' });
  const { devices, remember, forget, getLastDevice } = useRememberedDevices();
  const { hasPin, removePin } = useDevicePin();
  const store = useAdbStore();
  const usb = useUsbConnection();
  const wifi = useWifiConnection();
  // StrictMode 下挂载 effect 会双调用，导致两次并发 tryAutoConnectUsb；
  // 用 ref 守卫确保自动连接在组件实例生命周期内只发起一次（见 docs/adr/0007 关联修复）。
  const autoConnectRanRef = useRef(false);

  // 页面刷新/关闭时清理 ADB 连接和 scrcpy session
  useEffect(() => {
    const handleBeforeUnload = () => {
      const adb = useAdbStore.getState().adb;
      if (adb) {
        markIntentionalClose(adb); // 页面卸载属有意关闭，避免残留 handler 误判
        void adb.close(); // 尽力发送关闭包，不等完成
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const finishConnect = useCallback(() => {
    setIsFading(true);
    setTimeout(() => {
      setOverlayState('hidden');
      setIsFading(false);
    }, 300);
  }, []);

  // 自动连接已记忆设备
  useEffect(() => {
    if (autoConnectRanRef.current) return; // 守卫：StrictMode 双调用时跳过第二次
    autoConnectRanRef.current = true;

    const lastDevice = getLastDevice();
    if (!lastDevice) {
      setOverlayState('manual');
      return;
    }

    setOverlayState('auto-connecting');
    setDisplayMode(lastDevice.mode);

    if (lastDevice.type === 'usb') {
      usb.tryAutoConnectUsb(
        lastDevice.id,
        (p) => {
          // 进入第二次及以后尝试 → 切到「重试中」态
          if (p.retrying) setOverlayState((prev) => (prev === 'auto-connecting' ? 'auto-reconnecting' : prev));
        },
      ).then(({ success, cancelled }) => {
        if (cancelled) {
          setOverlayState('manual');
        } else if (!success) {
          setOverlayState('auto-failed');
        }
        // success 时由下面的「连接成功」effect 接管进入 hidden
      });
    } else {
      // WiFi 自动连接：通过 WebSocket 桥接代理尝试连接已记忆的设备
      wifi.connectWifi(lastDevice.address).then(() => {
        // 成功时由下面的「连接成功」effect 接管进入 hidden
      }).catch(() => {
        setOverlayState('manual');
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 自动连接成功后进入桌面
  useEffect(() => {
    const autoConnecting =
      overlayState === 'auto-connecting' || overlayState === 'auto-reconnecting';
    if (autoConnecting && store.connectionStatus === 'connected' && store.deviceSerial) {
      if (hasPin(store.deviceSerial)) {
        setPinGuard({ type: 'required', deviceId: store.deviceSerial, deviceName: store.deviceName || '未知设备' });
      } else {
        finishConnect();
      }
    }
  }, [store.connectionStatus, store.deviceSerial, store.deviceName, overlayState, hasPin, finishConnect]);

  // USB 异常断开（ADB 传输层）：从桌面切到重连提示。
  // 这是路径无关的 ADB-down 信号，覆盖 virtual（DesktopScreen）与 mirror 两条路径。
  useEffect(() => {
    if (store.connectionStatus === 'disconnected' && overlayState === 'hidden') {
      setOverlayState('reconnecting');
    }
  }, [store.connectionStatus, overlayState]);

  // 统一链路状态（仅镜像路径由 LinkSupervisor 监督）：disconnected / failed
  // 触发重连提示。覆盖 ADB 层未暴露的 scrcpy 级状态（重连用尽 failed）。
  // virtual 路径由上面的 connectionStatus 处理，避免重复订阅无监督方的总线。
  useEffect(() => {
    if (displayMode !== 'mirror') return;
    return subscribeLinkState((s) => {
      if ((s === 'disconnected' || s === 'failed') && overlayState === 'hidden') {
        setOverlayState('reconnecting');
      }
    });
  }, [displayMode, overlayState]);

  // 重连
  const handleReconnect = useCallback(() => {
    const lastDevice = getLastDevice();
    if (!lastDevice) {
      setOverlayState('manual');
      return;
    }
    setOverlayState('auto-connecting');

    if (lastDevice.type === 'usb') {
      usb.tryAutoConnectUsb(lastDevice.id, (p) => {
        if (p.retrying) setOverlayState((prev) => (prev === 'auto-connecting' ? 'auto-reconnecting' : prev));
      }).then(({ success, cancelled }) => {
        if (cancelled) {
          setOverlayState('manual');
        } else if (!success) {
          setOverlayState('manual');
        }
        // success 时由「连接成功」effect 接管进入 hidden
      });
    } else {
      wifi.connectWifi(lastDevice.address).then(() => {
        // 成功时由「连接成功」effect 接管进入 hidden
      }).catch(() => {
        setOverlayState('manual');
      });
    }
  }, [getLastDevice, usb, wifi]);

  const handleConnect = useCallback(async (
    device: { id: string; name: string; type: 'usb' | 'wifi'; address: string },
    mode: DisplayMode,
    shouldRemember: boolean
  ) => {
    setDisplayMode(mode);

    if (shouldRemember) {
      remember({
        id: device.id,
        serial: device.id,
        name: device.name,
        type: device.type,
        address: device.address,
        mode,
        lastConnected: Date.now(),
      });
    }

    if (hasPin(device.id)) {
      setPinGuard({ type: 'required', deviceId: device.id, deviceName: device.name });
      return;
    }

    finishConnect();
  }, [remember, hasPin, finishConnect]);

  const handleStop = useCallback(() => {
    setPinGuard({ type: 'none' });
    store.disconnect();
    setOverlayState('manual');
  }, [store]);

  const handleCancelAutoConnect = useCallback(() => {
    usb.cancelAutoConnect();
    setOverlayState('manual');
  }, [usb]);

  return (
    <ScrcpyProvider>
      <AppPickerProvider>
        <div className="w-full h-dvh bg-slate-900">
        {displayMode === 'mirror' ? (
          // mirror 模式仍使用 VirtualScreen（向后兼容）
          <VirtualScreen
            active={overlayState === 'hidden'}
            displayMode={displayMode}
            onStop={handleStop}
          />
        ) : (
          // virtual 模式使用分屏桌面（Task 10 集成）
          overlayState === 'hidden' && (
            <DesktopScreen onStop={handleStop} />
          )
        )}
        {(overlayState !== 'hidden' || isFading) && (
          <ConnectionOverlay
            overlayState={
              overlayState === 'hidden'
                ? 'manual'
                : (overlayState as 'auto-connecting' | 'auto-reconnecting' | 'auto-failed' | 'manual' | 'reconnecting')
            }
            displayMode={displayMode}
            rememberedDevices={devices}
            onSelectMode={setDisplayMode}
            onConnect={handleConnect}
            onForget={forget}
            onCancelAutoConnect={handleCancelAutoConnect}
            onReconnect={handleReconnect}
            fading={isFading}
          />
        )}

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
              console.log(`[App] 用户忘记设备（PIN 找回）：deviceId=${pinGuard.deviceId}`);
              removePin(pinGuard.deviceId);
              forgetDeviceCache(pinGuard.deviceId);
              forget(pinGuard.deviceId);
              store.disconnect();
              setPinGuard({ type: 'none' });
            }}
          />
        )}
      </div>
      </AppPickerProvider>
    </ScrcpyProvider>
  );
}

export default App;
