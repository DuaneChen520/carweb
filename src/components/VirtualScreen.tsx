import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { RotateCcw, Monitor } from 'lucide-react';
import { AndroidMotionEventAction } from '@yume-chan/scrcpy';
import { RESOLUTION_PRESETS } from '../hooks/scrcpy';
import type { ResolutionPresetKey } from '../hooks/scrcpy';
import { calculateDpi } from '../utils/display';
import { useAdbStore } from '../hooks/useAdbStore';
import { useScrcpyContext } from '../contexts/ScrcpyContext';
import { ControlSidebar } from './ControlSidebar';

interface VirtualScreenProps {
  active?: boolean;
  displayMode?: 'virtual' | 'mirror';
  onStop: () => void;
}

export function VirtualScreen({ active = false, displayMode = 'virtual', onStop }: VirtualScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [useMirrorMode, setUseMirrorMode] = useState(displayMode === 'mirror');

  useEffect(() => {
    setUseMirrorMode(displayMode === 'mirror');
  }, [displayMode]);
  const [resolutionPreset, setResolutionPreset] = useState<ResolutionPresetKey>('original');
  const [showResMenu, setShowResMenu] = useState(false);
  const [showVirtualKeyboard] = useState(false);
  const [keyboardMode, setKeyboardMode] = useState<'phone' | 'browser'>(() => {
    return (localStorage.getItem('carweb-keyboard-mode') as 'phone' | 'browser') || 'phone';
  });
  const browserInputRef = useRef<HTMLInputElement>(null);
  const hasStartedRef = useRef(false);
  const initialStartTimerRef = useRef<NodeJS.Timeout | null>(null);
  const initialStartDoneRef = useRef(false);

  const { startScrcpy, stopScrcpy, injectTouch, injectText, resumeAudio, isStarting, isRunning, error, videoWidth, videoHeight, isVirtualDisplay, flexClient } = useScrcpyContext();
  const store = useAdbStore();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 注意：flexClient 初始为 null，异步创建后 effect re-run
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setContainerSize({ width, height });
        // 每次回调读取组件 scope 最新值（非闭包快照）
        if (flexClient && !useMirrorMode) {
          flexClient.onContainerResize(width, height, currentPreset.scale, dpr);
        }
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [flexClient, useMirrorMode, resolutionPreset]);

  const currentPreset = RESOLUTION_PRESETS.find(p => p.key === resolutionPreset)!;
  const dpr = window.devicePixelRatio || 1;

  const displayConfig = useMemo(() => {
    if (useMirrorMode || containerSize.width === 0 || containerSize.height === 0) return undefined;
    const w = Math.round(containerSize.width * currentPreset.scale * dpr);
    const h = Math.round(containerSize.height * currentPreset.scale * dpr);
    const pixelRatio = (w * h) / (1920 * 1080);
    return {
      width: w,
      height: h,
      dpi: calculateDpi(w, h),
      bitRate: Math.max(1000000, Math.min(40000000, Math.round(8000000 * pixelRatio))),
    };
  }, [containerSize.width, containerSize.height, useMirrorMode, currentPreset, dpr]);

  // 首次启动 scrcpy
  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    const adb = store.adb;
    if (!canvas || !adb) return;

    // 虚拟屏模式下，必须等容器尺寸测量完成才能启动
    if (!useMirrorMode && (containerSize.width === 0 || containerSize.height === 0)) return;

    if (!isRunning && !isStarting && !hasStartedRef.current) {
      if (initialStartTimerRef.current) clearTimeout(initialStartTimerRef.current);

      initialStartTimerRef.current = setTimeout(() => {
        if (hasStartedRef.current) return;
        hasStartedRef.current = true;
        console.log('[VirtualScreen] 首次启动 scrcpy');

        // setCanvasSize 回调：将解码帧尺寸设置到 canvas
        const setCanvasSize = (w: number, h: number) => {
          if (canvasRef.current) {
            canvasRef.current.width = w;
            canvasRef.current.height = h;
          }
        };

        if (useMirrorMode) {
          startScrcpy(adb, canvas, undefined, setCanvasSize);
        } else {
          startScrcpy(adb, canvas, displayConfig, setCanvasSize);
        }
        initialStartDoneRef.current = true;
      }, 200);

      return () => {
        if (initialStartTimerRef.current) {
          clearTimeout(initialStartTimerRef.current);
          initialStartTimerRef.current = null;
        }
      };
    }
  }, [active, store.adb, isRunning, isStarting, useMirrorMode, containerSize.width, containerSize.height, displayConfig, startScrcpy]);

  // 组件卸载时停止 scrcpy
  useEffect(() => {
    return () => {
      if (hasStartedRef.current) {
        stopScrcpy();
      }
    };
  }, [stopScrcpy]);

  useEffect(() => {
    if (!showResMenu) return;
    const handleClick = () => setShowResMenu(false);
    const timer = setTimeout(() => document.addEventListener('click', handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick);
    };
  }, [showResMenu]);

  const calculateAdaptiveSize = useCallback(() => {
    if (!videoWidth || !videoHeight || !containerSize.width || !containerSize.height) {
      return { width: '100%', height: '100%' };
    }

    const videoAspect = videoWidth / videoHeight;
    const containerAspect = containerSize.width / containerSize.height;

    let renderWidth: number;
    let renderHeight: number;

    if (containerAspect > videoAspect) {
      renderHeight = containerSize.height;
      renderWidth = renderHeight * videoAspect;
    } else {
      renderWidth = containerSize.width;
      renderHeight = renderWidth / videoAspect;
    }

    return {
      width: `${renderWidth}px`,
      height: `${renderHeight}px`,
    };
  }, [videoWidth, videoHeight, containerSize]);

  const adaptiveSize = calculateAdaptiveSize();

  const outerRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!isFullscreen) {
        await outerRef.current?.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (error) {
      console.error('全屏切换失败:', error);
    }
  }, [isFullscreen]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleDisplayMode = useCallback(async () => {
    if (isStarting || !store.adb) return;
    console.log('[VirtualScreen] toggleDisplayMode: 切换显示模式');
    await stopScrcpy();
    hasStartedRef.current = false;
    setUseMirrorMode(m => !m);
  }, [isStarting, store.adb, stopScrcpy]);

  const changeResolutionPreset = useCallback(async (preset: ResolutionPresetKey) => {
    if (preset === resolutionPreset) return;
    setResolutionPreset(preset);
    setShowResMenu(false);
    if (isRunning || isStarting) {
      console.log('[VirtualScreen] changeResolutionPreset: 切换分辨率预设');
      await stopScrcpy();
      hasStartedRef.current = false;
    }
  }, [resolutionPreset, isRunning, isStarting, stopScrcpy]);

  const screenToVideoCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !videoWidth || !videoHeight) return null;

    const rect = canvas.getBoundingClientRect();

    const renderWidth = rect.width;
    const renderHeight = rect.height;
    const renderLeft = rect.left;
    const renderTop = rect.top;

    const relativeX = (clientX - renderLeft) / renderWidth;
    const relativeY = (clientY - renderTop) / renderHeight;

    const pointerX = Math.max(0, Math.min(1, relativeX)) * videoWidth;
    const pointerY = Math.max(0, Math.min(1, relativeY)) * videoHeight;

    return { pointerX, pointerY };
  }, [videoWidth, videoHeight]);

  const handlePointerEvent = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    console.log('[VirtualScreen] pointer event:', e.type, 'videoSize:', videoWidth, videoHeight, 'coords:', e.clientX, e.clientY);

    resumeAudio();

    const coords = screenToVideoCoords(e.clientX, e.clientY);
    if (!coords || !videoWidth || !videoHeight) {
      console.warn('[VirtualScreen] 跳过触控: coords or videoSize invalid', { coords, videoWidth, videoHeight });
      return;
    }

    let action: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
    switch (e.type) {
      case 'pointerdown':
        action = AndroidMotionEventAction.Down;
        break;
      case 'pointermove':
        action = e.buttons > 0 ? AndroidMotionEventAction.Move : AndroidMotionEventAction.HoverMove;
        break;
      case 'pointerup':
        action = AndroidMotionEventAction.Up;
        break;
      case 'pointercancel':
        action = AndroidMotionEventAction.Cancel;
        break;
      default:
        return;
    }

    const pointerId = e.pointerType === 'mouse' ? -1n : BigInt(e.pointerId);
    const pressure = e.pressure !== undefined && e.pressure > 0 ? e.pressure : (e.buttons > 0 ? 1 : 0);
    const buttons = e.buttons;
    const actionButton = e.button === 0 ? 1 : e.button === 2 ? 2 : 0;

    injectTouch({
      action,
      pointerId,
      pointerX: coords.pointerX,
      pointerY: coords.pointerY,
      videoWidth,
      videoHeight,
      pressure,
      actionButton,
      buttons,
    });
  }, [screenToVideoCoords, videoWidth, videoHeight, injectTouch, resumeAudio]);

  const handleStop = useCallback(async () => {
    await stopScrcpy();
    onStop();
  }, [stopScrcpy, onStop]);

  // Auto-focus browser input when keyboard mode is browser
  useEffect(() => {
    if (showVirtualKeyboard && keyboardMode === 'browser' && browserInputRef.current) {
      browserInputRef.current.focus();
    }
  }, [showVirtualKeyboard, keyboardMode]);

  const separator = displayConfig?.width ? `${displayConfig.width}x${displayConfig.height}` : '';

  return (
    <div ref={outerRef} className="flex w-full h-screen bg-black">
      <ControlSidebar
        isVirtualDisplay={isVirtualDisplay}
        isRunning={isRunning}
        useMirrorMode={useMirrorMode}
        isFullscreen={isFullscreen}
        toggleFullscreen={toggleFullscreen}
        toggleDisplayMode={toggleDisplayMode}
        handleStop={handleStop}
        keyboardMode={keyboardMode}
        setKeyboardMode={setKeyboardMode}
        currentPreset={currentPreset}
        resolutionPreset={resolutionPreset}
        changeResolutionPreset={changeResolutionPreset}
      />

      <div
        ref={containerRef}
        className="flex-1 relative flex flex-col min-w-0"
      >
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          {isStarting && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
              <div className="text-center">
                <RotateCcw className="w-8 h-8 text-white animate-spin mx-auto mb-4" />
                <div className="text-white text-lg">
                  {useMirrorMode ? '正在启动屏幕镜像...' : '正在创建虚拟显示屏...'}
                </div>
                <div className="text-white/60 text-sm mt-2">
                  {!useMirrorMode && containerSize.width > 0 && containerSize.height > 0
                    ? `目标 ${separator} @ ${displayConfig?.dpi ?? 320}dpi（${currentPreset.label}）`
                    : '请稍候'}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
              <div className="text-center max-w-md px-6">
                <div className="text-red-400 text-lg mb-2">启动失败</div>
                <div className="text-white/60 text-sm mb-4">{error}</div>
                {!useMirrorMode && (
                  <button
                    onClick={toggleDisplayMode}
                    className="px-4 py-2 bg-blue-500/80 hover:bg-blue-500 rounded-lg text-white text-sm transition-colors"
                  >
                    尝试切换到镜像模式
                  </button>
                )}
              </div>
            </div>
          )}

          {!active && !isStarting && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-slate-700">
                <Monitor className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">车机虚拟屏</p>
                <p className="text-sm mt-1">连接设备后启动</p>
              </div>
            </div>
          )}

          <canvas
            ref={canvasRef}
            style={{
              width: adaptiveSize.width,
              height: adaptiveSize.height,
              maxWidth: '100%',
              maxHeight: '100%',
            }}
            className="object-contain"
            onPointerDown={handlePointerEvent}
            onPointerMove={handlePointerEvent}
            onPointerUp={handlePointerEvent}
          />
        </div>

        {showVirtualKeyboard && keyboardMode === 'browser' && (
          <input
            ref={browserInputRef}
            type="text"
            className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-default"
            style={{ caretColor: 'transparent' }}
            onCompositionEnd={(e) => {
              const text = e.data;
              if (text) {
                injectText(text);
              }
              // Clear the input for next composition
              if (browserInputRef.current) {
                browserInputRef.current.value = '';
              }
            }}
            onKeyDown={(e) => {
              // Handle non-composition keys
              if (e.key === 'Enter') {
                e.preventDefault();
                injectText('\n');
              } else if (e.key === 'Backspace') {
                e.preventDefault();
                // injectText handles empty string gracefully
              }
              // For regular characters, let them go through composition
            }}
          />
        )}
      </div>
    </div>
  );
}
