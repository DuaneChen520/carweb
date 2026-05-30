import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Maximize2, Minimize2, RotateCcw, Power, Monitor, ArrowLeftRight, Keyboard, ChevronDown } from 'lucide-react';
import { AndroidMotionEventAction } from '@yume-chan/scrcpy';
import { useScrcpy, RESOLUTION_PRESETS } from '../hooks/useScrcpy';
import type { ResolutionPresetKey } from '../hooks/useScrcpy';
import { useAdbStore } from '../hooks/useAdbStore';
import { ControlSidebar } from './ControlSidebar';

interface VirtualScreenProps {
  onStop: () => void;
}

export function VirtualScreen({ onStop }: VirtualScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [restartCount, setRestartCount] = useState(0);
  const [useMirrorMode, setUseMirrorMode] = useState(false);
  const [resolutionPreset, setResolutionPreset] = useState<ResolutionPresetKey>('original');
  const [showResMenu, setShowResMenu] = useState(false);
  const [showVirtualKeyboard, setShowVirtualKeyboard] = useState(false);
  const [keyboardInput, setKeyboardInput] = useState('');
  const [isKeyboardInputFocused, setIsKeyboardInputFocused] = useState(false);
  const hasStartedRef = useRef(false);

  const { startScrcpy, stopScrcpy, injectTouch, injectText, showKeyboard, hideKeyboard, startApp, goHome, goBack, showRecentApps, getAppList, getAppIcon, getAppLabel, togglePhysicalScreen, turnOffPhysicalScreen, turnOnPhysicalScreen, resumeAudio, isStarting, isRunning, error, videoWidth, videoHeight, isVirtualDisplay } = useScrcpy();
  const store = useAdbStore();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setContainerSize({ width, height });
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

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
      dpi: Math.round(320 * currentPreset.dpiMultiplier * dpr),
      bitRate: Math.max(1000000, Math.min(40000000, Math.round(8000000 * pixelRatio))),
    };
  }, [containerSize.width, containerSize.height, useMirrorMode, currentPreset, dpr]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const adb = store.adb;
    if (!canvas || !adb || isRunning || isStarting) return;

    hasStartedRef.current = true;

    if (useMirrorMode || containerSize.width === 0 || containerSize.height === 0) {
      startScrcpy(adb, canvas);
    } else {
      startScrcpy(adb, canvas, displayConfig);
    }
  }, [store.adb, isRunning, isStarting, containerSize.width, containerSize.height, restartCount, useMirrorMode, startScrcpy, resolutionPreset, displayConfig]);

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

  const handleApplyNewSize = useCallback(async () => {
    if (isStarting || !store.adb) return;
    await stopScrcpy();
    hasStartedRef.current = false;
    setRestartCount(c => c + 1);
  }, [isStarting, store.adb, stopScrcpy]);

  const toggleDisplayMode = useCallback(async () => {
    if (isStarting || !store.adb) return;
    await stopScrcpy();
    hasStartedRef.current = false;
    setUseMirrorMode(m => !m);
    setRestartCount(c => c + 1);
  }, [isStarting, store.adb, stopScrcpy]);

  const changeResolutionPreset = useCallback(async (preset: ResolutionPresetKey) => {
    if (preset === resolutionPreset) return;
    setResolutionPreset(preset);
    setShowResMenu(false);
    if (isRunning || isStarting) {
      await stopScrcpy();
      hasStartedRef.current = false;
      setRestartCount(c => c + 1);
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

    resumeAudio();

    const coords = screenToVideoCoords(e.clientX, e.clientY);
    if (!coords || !videoWidth || !videoHeight) return;

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

  const handleSendText = useCallback(async () => {
    if (keyboardInput.trim()) {
      await injectText(keyboardInput);
      setKeyboardInput('');
    }
  }, [keyboardInput, injectText]);

  const handleKeyPress = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      await handleSendText();
    }
  }, [handleSendText]);

  const toggleVirtualKeyboard = useCallback(async () => {
    if (showVirtualKeyboard) {
      await hideKeyboard();
      setShowVirtualKeyboard(false);
      setIsKeyboardInputFocused(false);
    } else {
      await showKeyboard();
      setShowVirtualKeyboard(true);
    }
  }, [showVirtualKeyboard, showKeyboard, hideKeyboard]);

  const separator = displayConfig?.width ? `${displayConfig.width}x${displayConfig.height}` : '';

  return (
    <div ref={outerRef} className="flex w-full h-screen bg-black">
      <ControlSidebar
        goBack={goBack}
        goHome={goHome}
        showRecentApps={showRecentApps}
        startApp={startApp}
        getAppList={getAppList}
        getAppIcon={getAppIcon}
        getAppLabel={getAppLabel}
        injectText={injectText}
        isVirtualDisplay={isVirtualDisplay}
        togglePhysicalScreen={togglePhysicalScreen}
        turnOffPhysicalScreen={turnOffPhysicalScreen}
        turnOnPhysicalScreen={turnOnPhysicalScreen}
        isRunning={isRunning}
        useMirrorMode={useMirrorMode}
        isFullscreen={isFullscreen}
        toggleFullscreen={toggleFullscreen}
        toggleDisplayMode={toggleDisplayMode}
        handleApplyNewSize={handleApplyNewSize}
        handleStop={handleStop}
        toggleVirtualKeyboard={toggleVirtualKeyboard}
        showVirtualKeyboard={showVirtualKeyboard}
        currentPreset={currentPreset}
        resolutionPreset={resolutionPreset}
        changeResolutionPreset={changeResolutionPreset}
        showResMenu={showResMenu}
        setShowResMenu={setShowResMenu}
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

        {showVirtualKeyboard && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-96">
            <div className="bg-black/90 backdrop-blur-md border border-white/10 rounded-xl p-4 shadow-2xl">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={keyboardInput}
                  onChange={(e) => setKeyboardInput(e.target.value)}
                  onKeyDown={handleKeyPress}
                  onFocus={() => setIsKeyboardInputFocused(true)}
                  onBlur={() => setIsKeyboardInputFocused(false)}
                  placeholder="输入文字..."
                  className="flex-1 px-3 py-2 bg-white/10 rounded-lg text-white text-sm placeholder-white/30 outline-none focus:ring-2 focus:ring-blue-500/50"
                  autoFocus
                />
                <button
                  onClick={handleSendText}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg text-white text-sm transition-colors"
                >
                  发送
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
