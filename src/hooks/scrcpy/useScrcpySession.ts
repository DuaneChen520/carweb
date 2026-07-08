import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdbScrcpyClient } from '@yume-chan/adb-scrcpy';
import { AdbScrcpyExitedError } from '@yume-chan/adb-scrcpy';
import type { ScrcpyControlMessageWriter } from '@yume-chan/scrcpy';
import { ScrcpyNewDisplay, ScrcpyCaptureOrientation } from '@yume-chan/scrcpy';
import { AdbScrcpyOptions4_0, FlexDisplayClient, serializeResizeDisplay, RESIZE_DISPLAY_TYPE, ControllerHealth } from '@/lib/scrcpy4';
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

  const [flexClient, setFlexClient] = useState<FlexDisplayClient | null>(null);

  // flexClientRef 是 state 的镜像，供闭包（pump 循环、sendResize）同步读取最新值
  useEffect(() => {
    flexClientRef.current = flexClient;
  }, [flexClient]);

const clientRef = useRef<AdbScrcpyClient<AdbScrcpyOptions4_0<true>> | null>(null);
const controllerRef = useRef<ScrcpyControlMessageWriter | null>(null);
const adbRef = useRef<Adb | null>(null);
const rotationStateRef = useRef<RotationState | null>(null);
const displayIdRef = useRef<number | null>(null);
const startingLockRef = useRef<boolean>(false);
const flexClientRef = useRef<FlexDisplayClient | null>(null);
const canvasRef = useRef<HTMLCanvasElement | null>(null);
const healthRef = useRef<ControllerHealth>(new ControllerHealth());
const reconnectAttemptRef = useRef(0);
const MAX_RECONNECT_ATTEMPTS = 3;

const videoDecoder = useVideoDecoder();
const audioDecoder = useAudioDecoder();
const inputInjector = useInputInjector(controllerRef, healthRef.current);
const appManager = useAppManager();

  const startScrcpy = useCallback(async (adb: Adb, canvas: HTMLCanvasElement, displayConfig?: DisplayConfig, setCanvasSize?: (w: number, h: number) => void) => {
    // 保存 canvas 供自动重连使用
    canvasRef.current = canvas;
    // 重置重连状态
    healthRef.current.reset();
    reconnectAttemptRef.current = 0;

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
              flexDisplay: true,
              keepActive: true,
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
        healthRef.current.markHealthy();
      }

      // RESIZE_DISPLAY 的 type 字节值 = 21（scrcpy 4.0 源码确认），直接用常量
      const resizeTypeByte = RESIZE_DISPLAY_TYPE;

      const flexClient = useVirtualDisplay ? new FlexDisplayClient({
        sendResize: async (w, h) => {
          const ctrl = healthRef.current.tryGetController(controllerRef);
          if (!ctrl) {
            console.warn(`[FlexResize] sendResize skipped: controller DEAD, pending=${w}x${h}`);
            return;
          }
          try {
            const bytes = serializeResizeDisplay(resizeTypeByte, w, h);
            console.log(`[FlexResize] requestResize: sent RESIZE_DISPLAY type=${resizeTypeByte} bytes=${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
            await ctrl.write(bytes);
            healthRef.current.markHealthy();
          } catch (error) {
            console.warn(`[FlexResize] sendResize failed: ${error instanceof Error ? error.message : String(error)}, controllerDead=${healthRef.current.isDead()}`);
            healthRef.current.reportError(error);
          }
        },
        setCanvasSize: setCanvasSize ?? ((w, h) => { canvas.width = w; canvas.height = h; }),
      }) : null;
      flexClientRef.current = flexClient;
      setFlexClient(flexClient); // 触发 re-render，Context 透传至 VirtualScreen

      const { width, height } = await videoDecoder.setupVideoStream(
        client,
        canvas,
        // videoStream.sizeChanged（从 configuration 包解析尺寸）：
        // 既更新 state（供 CSS letterbox），也通知 flex-client 更新 canvas backing store
        (w, h) => {
          setState(prev => ({ ...prev, videoWidth: w, videoHeight: h }));
          flexClient?.onDecoderSizeChanged(w, h);
        },
        // 4.0 session 包回调（反抖动状态机）
        flexClient ? (w, h, clientResized) => flexClient.onSessionPacket(w, h, clientResized) : undefined,
      );

      if (flexClient && displayConfig) {
        flexClient.setInitialDisplaySize(displayConfig.width, displayConfig.height);
      }

      audioDecoder.setupAudioStream(client, setAudioState);

      if (useVirtualDisplay) {
        const vid = await getVirtualDisplayId(adb);
        displayIdRef.current = vid;
      } else {
        displayIdRef.current = 0;
      }

setState(prev => ({
	        ...prev,
	        isStarting: false,
	        isRunning: true,
	        // videoWidth/videoHeight 已由 sizeChanged 回调维护，
	        // 这里不覆盖，避免被 setupVideoStream 返回的初始 0 冲掉
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

      if (flexClientRef.current) {
        flexClientRef.current.dispose();
        flexClientRef.current = null;
      }
      setFlexClient(null);

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
    // 已废弃：flex-client 接管了 resize（通过 RESIZE_DISPLAY 控制消息）。
    // 保留作为 flex-client 失败时的 ADB shell 降级路径。
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

  const reconnect = useCallback(async () => {
    const adb = adbRef.current;
    const canvas = canvasRef.current;
    if (!adb || !canvas) {
      console.warn('[Scrcpy] 无法重连：adb 或 canvas 不可用');
      return;
    }

    if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[Scrcpy] 重连次数已达上限，停止自动重连');
      setState(prev => ({ ...prev, isRunning: false, error: '连接已断开，请手动重连' }));
      return;
    }

    reconnectAttemptRef.current++;
    console.log(`[Scrcpy] 自动重连尝试 ${reconnectAttemptRef.current}/${MAX_RECONNECT_ATTEMPTS}`);

    try {
      // 清理旧会话
      await stopScrcpy();

      // 退避等待
      const delay = 500 * Math.pow(2, reconnectAttemptRef.current - 1);
      console.log(`[Scrcpy] 重连退避 ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));

      // 重新启动（使用当前容器尺寸，由外部 displayConfig 管理）
      await startScrcpy(adb, canvas);

      // 成功 → 重置计数
      reconnectAttemptRef.current = 0;
      console.log(`[Scrcpy] 自动重连成功`);
    } catch (error) {
      console.error(`[Scrcpy] 重连失败 (${reconnectAttemptRef.current}/${MAX_RECONNECT_ATTEMPTS}):`, error);
    }
  }, [startScrcpy, stopScrcpy]);

  // 自动重连守护：监听 ControllerHealth DEAD 态
  useEffect(() => {
    const health = healthRef.current;
    return health.onStateChange((state) => {
      if (state === 'DEAD') {
        console.log('[CtrlHealth] DEAD → 触发自动重连');
        setTimeout(() => {
          reconnect();
        }, 100);
      }
    });
  }, [reconnect]);

  return {
    ...state,
    startScrcpy,
    stopScrcpy,
    reconnect,
    flexClient,
    flexClientRef,
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
    clearDeviceAppCache: appManager.clearDeviceAppCache,
    clearDevicePreferences: appManager.clearDevicePreferences,
    getDeviceCacheInfo: appManager.getDeviceCacheInfo,
    getAllDeviceSerials: appManager.getAllDeviceSerials,
  };
}
