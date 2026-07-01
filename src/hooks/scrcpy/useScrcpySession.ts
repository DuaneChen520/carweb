import { useCallback, useRef, useState } from 'react';
import type { AdbScrcpyClient } from '@yume-chan/adb-scrcpy';
import { AdbScrcpyExitedError } from '@yume-chan/adb-scrcpy';
import type { ScrcpyControlMessageWriter } from '@yume-chan/scrcpy';
import { ScrcpyNewDisplay, ScrcpyCaptureOrientation } from '@yume-chan/scrcpy';
import { AdbScrcpyOptions4_0 } from '@/lib/scrcpy4';
import type { Adb } from '@yume-chan/adb';
import { useVideoDecoder } from './useVideoDecoder';
import { useAudioDecoder } from './useAudioDecoder';
import type { AudioState } from './audio/types';
import { useInputInjector } from './useInputInjector';
import { useAppManager } from './useAppManager';
import {
  runAdbCommand,
  getRotationState,
  setRotationLocked,
  restoreRotation,
  getDefaultIme,
  setIme,
  hideIme,
  turnOffScreen,
  turnOnScreen,
  resizeDisplay as adbResizeDisplay,
  getCurrentForegroundApp,
  getVirtualDisplayId,
  startAppOnDisplay,
  getDefaultHomePackage,
  forceStopPackage,
  killScrcpyServer,
} from '@/lib/adb-commands';
import type { RotationState } from '@/lib/adb-commands';

export interface DisplayConfig {
  width: number;
  height: number;
  dpi?: number;
  bitRate?: number;
}

export type ResolutionPresetKey = 'original' | 'ultra' | 'hd' | 'smooth';

export interface ResolutionPreset {
  key: ResolutionPresetKey;
  label: string;
  scale: number;
}

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { key: 'original', label: '原画', scale: 1.0 },
  { key: 'ultra',   label: '超清', scale: 0.75 },
  { key: 'hd',      label: '高清', scale: 0.5 },
  { key: 'smooth',  label: '流畅', scale: 0.25 },
];

export interface ScrcpyState {
  isStarting: boolean;
  isRunning: boolean;
  error: string | null;
  videoWidth: number;
  videoHeight: number;
  isVirtualDisplay: boolean;
}

export function useScrcpySession() {
  const [state, setState] = useState<ScrcpyState>({
    isStarting: false,
    isRunning: false,
    error: null,
    videoWidth: 0,
    videoHeight: 0,
    isVirtualDisplay: false,
  });

  const [audioState, setAudioState] = useState<AudioState>({
    status: 'idle', route: 'browser', muted: false
  });

  const clientRef = useRef<AdbScrcpyClient<AdbScrcpyOptions4_0<true>> | null>(null);
  const controllerRef = useRef<ScrcpyControlMessageWriter | null>(null);
  const adbRef = useRef<Adb | null>(null);
  const rotationStateRef = useRef<RotationState | null>(null);
  const displayIdRef = useRef<number | null>(null);
  const startingLockRef = useRef<boolean>(false);

  const videoDecoder = useVideoDecoder();
  const audioDecoder = useAudioDecoder();
  const inputInjector = useInputInjector(controllerRef);
  const appManager = useAppManager();

  const startScrcpy = useCallback(async (adb: Adb, canvas: HTMLCanvasElement, displayConfig?: DisplayConfig) => {
    // 防止并行调用
    if (startingLockRef.current) {
      console.warn('[Scrcpy] startScrcpy 被跳过：已有启动正在进行中');
      return;
    }
    startingLockRef.current = true;

    const startTime = Date.now();
    console.log(`[Scrcpy] startScrcpy 开始, displayConfig:`, displayConfig ? `${displayConfig.width}x${displayConfig.height}` : 'mirror');
    try {
      displayIdRef.current = null;
      setState(prev => ({ ...prev, isStarting: true, error: null, videoWidth: 0, videoHeight: 0 }));

      const { AdbScrcpyClient } = await import('@yume-chan/adb-scrcpy');
      const { AdbScrcpyOptions4_0 } = await import('@/lib/scrcpy4');
      const { ReadableStream } = await import('@yume-chan/stream-extra');

      const serverPath = '/data/local/tmp/scrcpy-server.jar';
      console.log(`[Scrcpy] ${Date.now() - startTime}ms - 开始获取 scrcpy-server.jar`);
      const response = await fetch(import.meta.env.BASE_URL + 'scrcpy-server.jar');
      if (!response.ok) {
        throw new Error(`获取 scrcpy-server.jar 失败: HTTP ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength === 0) {
        throw new Error('scrcpy-server.jar 文件为空');
      }
      console.log(`[Scrcpy] ${Date.now() - startTime}ms - 开始推送 scrcpy-server.jar (${arrayBuffer.byteLength} bytes)`);
      await AdbScrcpyClient.pushServer(
        adb,
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(arrayBuffer));
            controller.close();
          },
        }),
        serverPath,
      );
      console.log(`[Scrcpy] ${Date.now() - startTime}ms - 推送完成，开始验证`);
      // 验证文件已推送到设备
      const verifyOutput = await runAdbCommand(adb, `ls -la ${serverPath} 2>&1`);
      if (verifyOutput.includes('No such file') || verifyOutput.includes('not found')) {
        throw new Error('scrcpy-server.jar 推送验证失败：设备上未找到文件');
      }
      console.log(`[Scrcpy] ${Date.now() - startTime}ms - 验证通过: ${verifyOutput}`);

      const useVirtualDisplay = !!displayConfig;
      const options = new AdbScrcpyOptions4_0({
        video: true,
        videoCodec: 'h264',
        videoBitRate: displayConfig?.bitRate ?? 8000000,
        maxFps: 60,
        audio: true,
        control: true,
        stayAwake: true,
        showTouches: false,
        ...(useVirtualDisplay
          ? {
              newDisplay: new ScrcpyNewDisplay(displayConfig.width, displayConfig.height, displayConfig.dpi ?? 320),
              captureOrientation: ScrcpyCaptureOrientation.Unlocked,
              displayImePolicy: 'local' as const,
              // M2 阶段暂不开 flex，M3 接入
              flexDisplay: false,
            }
          : { displayId: 0 }
        ),
      });
      console.log(`[Scrcpy] ${Date.now() - startTime}ms - 开始 AdbScrcpyClient.start()`);
      const client = await AdbScrcpyClient.start(adb, serverPath, options);
      console.log(`[Scrcpy] ${Date.now() - startTime}ms - AdbScrcpyClient.start() 成功`);
      clientRef.current = client;
      adbRef.current = adb;
      appManager.setAdb(adb);

      if (useVirtualDisplay) {
        try {
          const prevRotation = await getRotationState(adb);
          rotationStateRef.current = prevRotation;
          await setRotationLocked(adb);
        } catch (e) {
          console.warn('锁定旋转方向失败:', e);
        }
      }

      const controller = client.controller;
      if (controller) {
        controllerRef.current = controller;
      }

      const { width, height } = await videoDecoder.setupVideoStream(client, canvas, (w, h) => {
        setState(prev => ({ ...prev, videoWidth: w, videoHeight: h }));
      });

      audioDecoder.setupAudioStream(client, setAudioState);

      if (useVirtualDisplay) {
        const vid = await getVirtualDisplayId(adb);
        displayIdRef.current = vid;

        try {
          const homePkg = await getDefaultHomePackage(adb);
          if (homePkg) await forceStopPackage(adb, homePkg);
        } catch (e) {
          console.warn('关闭虚拟屏 Launcher 失败:', e);
        }
      } else {
        displayIdRef.current = 0;
      }

      setState(prev => ({
        ...prev,
        isStarting: false,
        isRunning: true,
        videoWidth: width,
        videoHeight: height,
        isVirtualDisplay: useVirtualDisplay,
      }));

      // 后台自动同步应用列表
      appManager.syncWithDevice().then(async (syncResult) => {
        if (syncResult.toParse.length > 0) {
          console.log(`[ScrcpySession] 需要解析 ${syncResult.toParse.length} 个应用`);
          // 执行完整 dex 解析
          await appManager.parseAllApps();
        } else {
          console.log('[ScrcpySession] 缓存完全命中，跳过 dex 解析');
        }
      }).catch((err) => {
        console.warn('[ScrcpySession] 后台同步应用列表失败:', err);
      });
    } catch (error) {
      console.error(`[Scrcpy] ${Date.now() - startTime}ms - 启动失败:`, error);
      let message = '启动屏幕镜像失败';
      if (error instanceof AdbScrcpyExitedError) {
        message = 'scrcpy server exited prematurely';
        if (error.output.length > 0) {
          message += ': ' + error.output.join('; ');
        }
        console.error(`[Scrcpy] server 输出:`, error.output);
      } else if (error instanceof Error) {
        message = error.message;
      }
      setState(prev => ({ ...prev, isStarting: false, error: message }));
      console.error('Scrcpy 启动错误:', error);
    } finally {
      startingLockRef.current = false;
    }
  }, [videoDecoder, audioDecoder, appManager]);

  const stopScrcpy = useCallback(async () => {
    try {
      const adb = adbRef.current;
      if (adb && rotationStateRef.current) {
        try {
          await restoreRotation(adb, rotationStateRef.current);
        } catch (e) {
          console.warn('恢复旋转方向失败:', e);
        }
        rotationStateRef.current = null;
      }

      videoDecoder.dispose();
      audioDecoder.dispose();

      if (controllerRef.current) {
        controllerRef.current.close();
        controllerRef.current = null;
      }

      if (clientRef.current) {
        await clientRef.current.close();
        clientRef.current = null;
      }

      // 确保设备上的 scrcpy server 进程被杀掉，并清理 jar 文件
      if (adb) {
        await killScrcpyServer(adb, true).catch(() => {});
      }

      displayIdRef.current = null;

      // 立即更新状态，不等待虚拟屏销毁
      setState({
        isStarting: false,
        isRunning: false,
        error: null,
        videoWidth: 0,
        videoHeight: 0,
        isVirtualDisplay: false,
      });
    } catch (error) {
      console.error('停止 Scrcpy 错误:', error);
    }
  }, [videoDecoder, audioDecoder, rotationStateRef]);

  const showKeyboard = useCallback(async () => {
    const adb = adbRef.current;
    if (!adb) return;

    try {
      const ime = await getDefaultIme(adb);
      if (ime) {
        await setIme(adb, ime);
      }
      await inputInjector.goHome();
    } catch (error) {
      console.error('显示键盘错误:', error);
    }
  }, [inputInjector]);

  const hideKeyboard = useCallback(async () => {
    const adb = adbRef.current;
    if (!adb) return;

    try {
      await hideIme(adb);
    } catch (error) {
      console.error('隐藏键盘错误:', error);
    }
  }, []);

  const togglePhysicalScreen = useCallback(async () => {
    const adb = adbRef.current;
    if (!adb) return;

    try {
      const { toggleScreen } = await import('@/lib/adb-commands');
      await toggleScreen(adb);
    } catch (error) {
      console.error('切换物理屏幕状态错误:', error);
    }
  }, []);

  const turnOffPhysicalScreen = useCallback(async () => {
    const adb = adbRef.current;
    if (!adb) return;

    try {
      await turnOffScreen(adb);
    } catch (error) {
      console.error('关闭物理屏幕错误:', error);
    }
  }, []);

  const turnOnPhysicalScreen = useCallback(async () => {
    const adb = adbRef.current;
    if (!adb) return;

    try {
      await turnOnScreen(adb);
    } catch (error) {
      console.error('唤醒物理屏幕错误:', error);
    }
  }, []);

  const resizeDisplay = useCallback(async (width: number, height: number, dpi: number) => {
    const adb = adbRef.current;
    if (!adb) return;

    try {
      await adbResizeDisplay(adb, 0, width, height, dpi);
      controllerRef.current?.resetVideo();
    } catch (error) {
      console.error('调整虚拟屏尺寸错误:', error);
    }
  }, []);

  const ensureDisplayId = useCallback(async (): Promise<number | null> => {
    if (displayIdRef.current !== null) return displayIdRef.current;
    const adb = adbRef.current;
    if (!adb) return null;

    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 500));
      const vid = await getVirtualDisplayId(adb);
      if (vid !== null) {
        displayIdRef.current = vid;
        return vid;
      }
    }
    return null;
  }, []);

  const getForegroundApp = useCallback(async (): Promise<string | null> => {
    const adb = adbRef.current;
    if (!adb) return null;
    const displayId = await ensureDisplayId();
    return getCurrentForegroundApp(adb, displayId ?? 0);
  }, [ensureDisplayId]);

  const startAppOnDisplayFn = useCallback(async (packageName: string) => {
    const adb = adbRef.current;
    if (!adb) return;
    const displayId = await ensureDisplayId();
    if (displayId !== null) {
      await startAppOnDisplay(adb, packageName, displayId);
    }
  }, [ensureDisplayId]);

  return {
    ...state,
    startScrcpy,
    stopScrcpy,
    injectTouch: inputInjector.injectTouch,
    injectText: inputInjector.injectText,
    showKeyboard,
    hideKeyboard,
    startApp: inputInjector.startApp,
    goHome: inputInjector.goHome,
    goBack: inputInjector.goBack,
    showRecentApps: inputInjector.showRecentApps,
    getAppList: appManager.getAppList,
    getAppIcon: appManager.getAppIcon,
    getAppLabel: appManager.getAppLabel,
    batchGetAppLabels: appManager.batchGetAppLabels,
    parseAllApps: appManager.parseAllApps,
    abortParseApps: appManager.abortParseApps,
    getCachedAppLabels: appManager.getCachedAppLabels,
    getAllCachedPackages: appManager.getAllCachedPackages,
    clearAppInfoCache: appManager.clearAppInfoCache,
    getCacheInfo: appManager.getCacheInfo,
    togglePhysicalScreen,
    turnOffPhysicalScreen,
    turnOnPhysicalScreen,
    resizeDisplay,
    getForegroundApp,
    startAppOnDisplay: startAppOnDisplayFn,
    resumeAudio: audioDecoder.resume,
    audioRoute: audioState.route,
    setAudioRoute: audioDecoder.setRoute,
    isMuted: audioState.muted,
    setMuted: audioDecoder.setMuted,
    audioStatus: audioState.status,
    getAllDeviceApps: appManager.getAllDeviceApps,
    incrementLocalCount: appManager.incrementLocalCount,
    togglePin: appManager.togglePin,
    getPinnedApps: appManager.getPinnedApps,
    clearDeviceApps: appManager.clearDeviceApps,
    clearAll: appManager.clearAll,
    syncWithDevice: appManager.syncWithDevice,
  };
}
