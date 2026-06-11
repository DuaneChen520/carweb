import { useCallback, useMemo } from 'react';
import type { ScrcpyControlMessageWriter } from '@yume-chan/scrcpy';
import { AndroidKeyCode, AndroidKeyEventAction } from '@yume-chan/scrcpy';

export function useInputInjector(controllerRef: React.RefObject<ScrcpyControlMessageWriter | null>) {
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
    const controller = controllerRef.current;
    if (!controller) return;

    try {
      await controller.injectTouch(message);
    } catch (error) {
      console.error('触摸事件转发错误:', error);
    }
  }, [controllerRef]);

  const injectText = useCallback(async (text: string) => {
    const controller = controllerRef.current;
    if (!controller) return;

    try {
      await controller.injectText(text);
    } catch (error) {
      console.error('文本输入错误:', error);
    }
  }, [controllerRef]);

  const injectKeyCode = useCallback(async (keyCode: AndroidKeyCode) => {
    const controller = controllerRef.current;
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
    } catch (error) {
      console.error('按键注入错误:', error);
    }
  }, [controllerRef]);

  const goHome = useCallback(async () => {
    await injectKeyCode(AndroidKeyCode.AndroidHome);
  }, [injectKeyCode]);

  const goBack = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller) return;
    try {
      await controller.backOrScreenOn(0);
    } catch (error) {
      console.error('返回错误:', error);
    }
  }, [controllerRef]);

  const showRecentApps = useCallback(async () => {
    await injectKeyCode(AndroidKeyCode.AndroidAppSwitch);
  }, [injectKeyCode]);

  const startApp = useCallback(async (appName: string) => {
    const controller = controllerRef.current;
    if (!controller) return;

    try {
      await controller.startApp(appName);
    } catch (error) {
      console.error('启动应用错误:', error);
    }
  }, [controllerRef]);

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
