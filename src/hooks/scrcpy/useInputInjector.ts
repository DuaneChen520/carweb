import { useCallback, useMemo } from 'react';
import type { ScrcpyControlMessageWriter } from '@yume-chan/scrcpy';
import { AndroidKeyCode, AndroidKeyEventAction } from '@yume-chan/scrcpy';
import type { ControllerHealth } from '@/lib/scrcpy4';

export function useInputInjector(
  controllerRef: React.RefObject<ScrcpyControlMessageWriter | null>,
  health: ControllerHealth,
) {
  const injectTouch = useCallback(async (message: {
    action: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
    pointerId: bigint;
    pointerX: number;
    pointerY: number;
    videoWidth: number;
    videoHeight: number;
    pressure: number;
    actionButton: number;
    buttons: number;
  }) => {
    const controller = health.tryGetController(controllerRef);
    if (!controller) return;

    try {
      await controller.injectTouch(message);
      health.markHealthy();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('Socket closed')) {
        console.log(`[touch] Socket closed，交 ControllerHealth 处理`);
      } else {
        console.error('[touch] 触摸事件转发错误:', error);
      }
      health.reportError(error);
    }
  }, [controllerRef, health]);

  const injectText = useCallback(async (text: string) => {
    const controller = health.tryGetController(controllerRef);
    if (!controller) return;

    try {
      await controller.injectText(text);
      health.markHealthy();
    } catch (error) {
      health.reportError(error);
    }
  }, [controllerRef, health]);

  const injectKeyCode = useCallback(async (keyCode: AndroidKeyCode) => {
    const controller = health.tryGetController(controllerRef);
    if (!controller) return;

    try {
      await controller.injectKeyCode({
        action: AndroidKeyEventAction.Down,
        keyCode,
        repeat: 0,
        metaState: 0,
      });
      await controller.injectKeyCode({
        action: AndroidKeyEventAction.Up,
        keyCode,
        repeat: 0,
        metaState: 0,
      });
      health.markHealthy();
    } catch (error) {
      health.reportError(error);
    }
  }, [controllerRef, health]);

  const goHome = useCallback(async () => {
    await injectKeyCode(AndroidKeyCode.AndroidHome);
  }, [injectKeyCode]);

  const goBack = useCallback(async () => {
    const controller = health.tryGetController(controllerRef);
    if (!controller) return;
    try {
      await controller.backOrScreenOn(0);
      health.markHealthy();
    } catch (error) {
      health.reportError(error);
    }
  }, [controllerRef, health]);

  const showRecentApps = useCallback(async () => {
    await injectKeyCode(AndroidKeyCode.AndroidAppSwitch);
  }, [injectKeyCode]);

  const startApp = useCallback(async (appName: string) => {
    const controller = health.tryGetController(controllerRef);
    if (!controller) return;
    try {
      await controller.startApp(appName);
      health.markHealthy();
    } catch (error) {
      health.reportError(error);
    }
  }, [controllerRef, health]);

  return useMemo(() => ({
    injectTouch,
    injectText,
    injectKeyCode,
    goHome,
    goBack,
    showRecentApps,
    startApp,
  }), [injectTouch, injectText, injectKeyCode, goHome, goBack, showRecentApps, startApp]);
}
