import { useCallback, useEffect, useRef, useState } from 'react';
import type { Adb } from '@yume-chan/adb';
import { ScrcpySession, type SessionState } from '@/lib/scrcpy-session';
import { LinkSupervisor } from '@/lib/link-supervisor';
import { publishLinkState } from '@/lib/link-state-bus';
import { ControllerHealth, type FlexDisplayClient } from '@/lib/scrcpy4';
import { useAdbStore } from '../useAdbStore';
import { useAppManager } from './useAppManager';
import {
  getDefaultIme,
  setIme,
  hideIme,
  toggleScreen,
  turnOffScreen,
  turnOnScreen,
  resizeDisplay as adbResizeDisplay,
  getCurrentForegroundApp,
  getVirtualDisplayId,
} from '@/lib/adb-commands';
import type { AudioState } from './audio/types';

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

/**
 * useScrcpySession —— 薄适配器层。
 *
 * 会话的「传输核心」（启动/停止、视频/音频解码、flex 缩放、输入注入、旋转锁定、
 * 重连 PID 追踪、多实例 scid/互斥）全部委托给 ScrcpySession 类（与分屏桌面
 * DesktopScreen/SessionManager 共用同一实现），从而：
 *   - 消除与 ScrcpySession 类的重复实现；
 *   - 让镜像路径自动获得类已实现的能力（每会话独立 scid、启动互斥、15s 启动超时、
 *     以及虚拟屏 `vdSystemDecorations:false` 修复——修复「虚拟屏启动多次跳转」）。
 *
 * 本 hook 仅保留真正属于 React 层的关注点：
 *   - 应用管理（useAppManager：设备端解析、IndexedDB 缓存、置顶）；
 *   - IME 软键盘（showKeyboard/hideKeyboard，依赖 adb shell）；
 *   - 设备级屏控（togglePhysicalScreen 等，依赖 adb commands）；
 *   - 链路监督（LinkSupervisor，包裹共享的 ControllerHealth 并广播到 link-state bus）。
 */
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
    status: 'idle', route: 'browser', muted: false,
  });

  const [flexClient, setFlexClient] = useState<FlexDisplayClient | null>(null);

  // flexClientRef 是 state 的镜像，供闭包（如渲染层）同步读取最新值
  useEffect(() => {
    flexClientRef.current = flexClient;
  }, [flexClient]);

  const sessionRef = useRef<ScrcpySession | null>(null);
  const adbRef = useRef<Adb | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayConfigRef = useRef<DisplayConfig | undefined>(undefined);
  // 与 ScrcpySession 共享的单一健康实例：flex-client 输入、LinkSupervisor 都读它。
  const controlHealthRef = useRef<ControllerHealth>(new ControllerHealth());
  const supervisorRef = useRef<LinkSupervisor | null>(null);
  const flexClientRef = useRef<FlexDisplayClient | null>(null);

  const appManager = useAppManager();

  const startScrcpy = useCallback(async (adb: Adb, canvas: HTMLCanvasElement, displayConfig?: DisplayConfig) => {
    // 保存 canvas 与显示配置供自动重连使用（修复重连退回镜像模式）
    canvasRef.current = canvas;
    displayConfigRef.current = displayConfig;
    // 重置链路监督（control-socket + 重连计数）
    controlHealthRef.current.reset();
    supervisorRef.current?.reset();
    adbRef.current = adb;
    // 应用管理依赖 adb 实例（设备端包解析 / IndexedDB 缓存）。
    appManager.setAdb(adb);

    // 连接即后台同步应用列表（恢复 f7391bb，被 9afad53 误删）。
    // 此处紧接 setAdb，adbRef.current 已就位，增量校验（syncWithDevice 的
    // versionCode 比对）能真实计算 toParse；仅 toParse>0 才跑全量 dex。
    // 重连时 LinkSupervisor.reconnect 会重入 startScrcpy，故重连亦自动重校验。
    // fire-and-forget：不阻塞会话启动；失败仅记日志，不影响镜像/虚拟屏。
    const connectSerial = useAdbStore.getState().deviceSerial;
    console.log(`[ScrcpySession] 连接建立，触发后台同步应用列表（serial=${connectSerial ?? '未知'}）`);
    appManager.syncAndParseIfNeeded().catch((err) => {
      console.warn('[ScrcpySession] 后台同步应用列表失败:', err);
    });

    if (!sessionRef.current) {
      sessionRef.current = new ScrcpySession(
        `mirror-${Date.now()}`,
        {
          onStateChange: (s: SessionState) => {
            setState((prev) => ({
              ...prev,
              isStarting: s.isStarting,
              isRunning: s.isRunning,
              error: s.error,
              videoWidth: s.videoWidth,
              videoHeight: s.videoHeight,
              isVirtualDisplay: s.isVirtualDisplay,
            }));
          },
          onVideoSize: (w, h) => setState((prev) => ({ ...prev, videoWidth: w, videoHeight: h })),
          onAudioStateChange: (a) => setAudioState(a),
          onFlexClient: (fc) => { setFlexClient(fc); flexClientRef.current = fc; },
          // 健康变化由 LinkSupervisor 直接订阅 controlHealthRef，这里无需处理。
        },
        controlHealthRef.current,
      );
    }

    await sessionRef.current.start(adb, displayConfig, undefined, canvas);
  }, [appManager]);

  const stopScrcpy = useCallback(async () => {
    await sessionRef.current?.stop();
  }, []);

  const showKeyboard = useCallback(async () => {
    const adb = adbRef.current;
    if (!adb) return;
    try {
      const ime = await getDefaultIme(adb);
      if (ime) {
        await setIme(adb, ime);
      }
      await sessionRef.current?.goHome();
    } catch (error) {
      console.error('显示键盘错误:', error);
    }
  }, []);

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
    // flex-client 已接管运行时缩放；此处为 ADB shell 降级路径（改变设备端虚拟屏尺寸）。
    const adb = adbRef.current;
    const session = sessionRef.current;
    if (!adb || !session) return;
    try {
      await adbResizeDisplay(adb, session.displayId ?? 0, width, height, dpi);
    } catch (error) {
      console.error('调整虚拟屏尺寸错误:', error);
    }
  }, []);

  const getForegroundApp = useCallback(async (): Promise<string | null> => {
    const adb = adbRef.current;
    const session = sessionRef.current;
    if (!adb || !session) return null;
    let vid = session.displayId;
    if (vid == null) vid = await getVirtualDisplayId(adb);
    return getCurrentForegroundApp(adb, vid ?? 0);
  }, []);

  // 输入注入：全部委托给 ScrcpySession（类内部已封装 ControllerHealth 门控）。
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
    await sessionRef.current?.injectTouch(message);
  }, []);

  const injectText = useCallback(async (text: string) => {
    await sessionRef.current?.injectText(text);
  }, []);

  const startApp = useCallback(async (appName: string) => {
    await sessionRef.current?.startApp(appName);
  }, []);

  const goHome = useCallback(async () => {
    await sessionRef.current?.goHome();
  }, []);

  const goBack = useCallback(async () => {
    await sessionRef.current?.goBack();
  }, []);

  const showRecentApps = useCallback(async () => {
    await sessionRef.current?.showRecentApps();
  }, []);

  // 音频控制：委托给 ScrcpySession，并同步本地 audioState 以便 UI 展示。
  const resumeAudio = useCallback(() => {
    sessionRef.current?.resumeAudio();
  }, []);

  const setAudioRoute = useCallback((route: 'browser' | 'phone') => {
    sessionRef.current?.setAudioRoute(route);
    setAudioState((prev) => ({ ...prev, route }));
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    sessionRef.current?.setMuted(muted);
    setAudioState((prev) => ({ ...prev, muted }));
  }, []);

  // 链路监督（LinkSupervisor）：统一 control-socket 健康、ADB 链路存活与会话级重连。
  // 取代原先散落的 reconnectAttemptRef / MAX_RECONNECT_ATTEMPTS / DEAD→reconnect effect。
  useEffect(() => {
    const supervisor = new LinkSupervisor({
      reconnect: async () => {
        const adb = adbRef.current;
        const canvas = canvasRef.current;
        if (!adb || !canvas) throw new Error('reconnect: adb/canvas 不可用');
        await stopScrcpy();
        // 复用初始 displayConfig，避免虚拟屏会话重连后退回镜像模式
        await startScrcpy(adb, canvas, displayConfigRef.current);
      },
      maxReconnectAttempts: 3,
      backoffBaseMs: 500,
      controlHealth: controlHealthRef.current,
    });
    supervisorRef.current = supervisor;
    // 把统一链路状态广播到总线，供 App overlay（provider 的父组件）与
    // VirtualScreen 僵尸清理订阅，取代散落的 adb.disconnected 反应。
    const unsubBus = supervisor.onLinkStateChange(publishLinkState);
    const unsub = supervisor.attachAdbSignal({
      subscribe: (onChange) =>
        useAdbStore.subscribe((s) => onChange(s.connectionStatus !== 'disconnected')),
    });
    return () => {
      unsub();
      unsubBus();
      supervisor.dispose();
      supervisorRef.current = null;
    };
  }, []);

  return {
    ...state,
    startScrcpy,
    stopScrcpy,
    flexClient,
    flexClientRef,
    injectTouch,
    injectText,
    showKeyboard,
    hideKeyboard,
    startApp,
    goHome,
    goBack,
    showRecentApps,
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
    resumeAudio,
    audioRoute: audioState.route,
    setAudioRoute,
    isMuted: audioState.muted,
    setMuted,
    audioStatus: audioState.status,
    getAllDeviceApps: appManager.getAllDeviceApps,
    incrementLocalCount: appManager.incrementLocalCount,
    togglePin: appManager.togglePin,
    getPinnedApps: appManager.getPinnedApps,
    clearDeviceApps: appManager.clearDeviceApps,
    clearAll: appManager.clearAll,
    setAdb: appManager.setAdb,
    syncAndParseIfNeeded: appManager.syncAndParseIfNeeded,
    syncWithDevice: appManager.syncWithDevice,
    clearDeviceAppCache: appManager.clearDeviceAppCache,
    clearDevicePreferences: appManager.clearDevicePreferences,
    getDeviceCacheInfo: appManager.getDeviceCacheInfo,
    getAllDeviceSerials: appManager.getAllDeviceSerials,
  };
}
