import { useEffect, useRef, useCallback, useState } from 'react';
import { Maximize2, Minimize2, RotateCcw, Power, Smartphone, Monitor, ArrowLeftRight, Keyboard } from 'lucide-react';
import { AndroidMotionEventAction } from '@yume-chan/scrcpy';
import { useScrcpy } from '../hooks/useScrcpy';
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
  const [showVirtualKeyboard, setShowVirtualKeyboard] = useState(false);
  const [keyboardInput, setKeyboardInput] = useState('');
  const [isKeyboardInputFocused, setIsKeyboardInputFocused] = useState(false);
  const hasStartedRef = useRef(false);

  const { startScrcpy, stopScrcpy, injectTouch, injectText, showKeyboard, hideKeyboard, startApp, goHome, goBack, showRecentApps, getAppList, getAppIcon, getAppLabel, isStarting, isRunning, error, videoWidth, videoHeight, isVirtualDisplay } = useScrcpy();
  const store = useAdbStore();

  // 监听容器尺寸变化
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

  // 启动 scrcpy
  useEffect(() => {
    const canvas = canvasRef.current;
    const adb = store.adb;
    if (!canvas || !adb || isRunning || isStarting) return;

    hasStartedRef.current = true;

    if (useMirrorMode || containerSize.width === 0 || containerSize.height === 0) {
      startScrcpy(adb, canvas);
    } else {
      startScrcpy(adb, canvas, {
        width: Math.round(containerSize.width),
        height: Math.round(containerSize.height),
      });
    }
  }, [store.adb, isRunning, isStarting, containerSize.width, containerSize.height, restartCount, useMirrorMode, startScrcpy]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (hasStartedRef.current) {
        stopScrcpy();
      }
    };
  }, [stopScrcpy]);

  // 计算自适应尺寸
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

  // 全屏切换
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!isFullscreen) {
        await containerRef.current?.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (error) {
      console.error('全屏切换失败:', error);
    }
  }, [isFullscreen]);

  // 监听全屏变化
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // 重新应用当前窗口尺寸
  const handleApplyNewSize = useCallback(async () => {
    if (isStarting || !store.adb) return;
    await stopScrcpy();
    hasStartedRef.current = false;
    setRestartCount(c => c + 1);
  }, [isStarting, store.adb, stopScrcpy]);

  // 切换镜像/虚拟屏模式
  const toggleDisplayMode = useCallback(async () => {
    if (isStarting || !store.adb) return;
    await stopScrcpy();
    hasStartedRef.current = false;
    setUseMirrorMode(m => !m);
    setRestartCount(c => c + 1);
  }, [isStarting, store.adb, stopScrcpy]);

  // 将屏幕坐标转换为视频坐标
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

  // 处理触摸/鼠标事件转发
  const handlePointerEvent = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();

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
  }, [screenToVideoCoords, videoWidth, videoHeight, injectTouch]);

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

  const displayLabel = isVirtualDisplay ? '虚拟屏' : '镜像';
  const dpiLabel = isVirtualDisplay ? ' @ 320dpi' : '';

  return (
    <div className="flex w-full h-screen bg-black">
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
      />

      <div
        ref={containerRef}
        className="flex-1 relative flex flex-col min-w-0"
      >
        {/* 顶部工具栏 */}
        <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/80 to-transparent p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Smartphone className="w-5 h-5 text-white" />
              <div>
                <div className="text-white text-sm font-medium">
                  {store.deviceName || '未知设备'}
                </div>
                <div className="text-white/60 text-xs space-x-2">
                  {videoWidth && videoHeight ? (
                    <>
                      <span>{displayLabel} {videoWidth}x{videoHeight}{dpiLabel}</span>
                      {!useMirrorMode && (
                        <>
                          <span>|</span>
                          <span>窗口 {Math.round(containerSize.width)}x{Math.round(containerSize.height)}</span>
                        </>
                      )}
                    </>
                  ) : (
                    '连接中...'
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isRunning && (
                <button
                  onClick={toggleDisplayMode}
                  className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                  title={useMirrorMode ? '切换到虚拟屏模式' : '切换到镜像模式'}
                >
                  <ArrowLeftRight className="w-4 h-4 text-white" />
                </button>
              )}
              {isRunning && !useMirrorMode && (
                <button
                  onClick={handleApplyNewSize}
                  className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                  title="重新应用窗口尺寸"
                >
                  <Monitor className="w-4 h-4 text-white" />
                </button>
              )}
              <button
                onClick={toggleFullscreen}
                className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                title={isFullscreen ? '退出全屏' : '全屏'}
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4 text-white" />
                ) : (
                  <Maximize2 className="w-4 h-4 text-white" />
                )}
              </button>
              <button
                onClick={handleStop}
                className="p-2 bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors"
                title="断开连接"
              >
                <Power className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
        </div>

        {/* 视频渲染区域 */}
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
                    ? `目标分辨率 ${Math.round(containerSize.width)}x${Math.round(containerSize.height)} @ 320dpi`
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

          {isRunning && !error && videoWidth > 0 && videoHeight > 0 && isVirtualDisplay && (
            <div className="absolute top-16 left-4 z-20">
              <div className="px-3 py-1.5 bg-yellow-500/20 border border-yellow-500/40 rounded-lg">
                <p className="text-yellow-300 text-xs">
                  虚拟屏默认无桌面内容，需通过触摸操作启动应用
                </p>
                <p className="text-yellow-400/60 text-xs mt-0.5">
                  如显示黑屏属于正常现象，请在虚拟屏上滑动打开应用列表
                </p>
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

        {/* 底部状态栏 */}
        <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/80 to-transparent p-4">
          <div className="flex items-center justify-between text-white/60 text-xs">
            <div>
              {store.connectionType === 'usb' ? 'USB 有线' : 'WiFi 无线'}
              <span className="ml-2 text-white/40">scrcpy v3.3.3</span>
            </div>
            <div className="flex items-center gap-2">
              {isRunning && (
                <button
                  onClick={toggleVirtualKeyboard}
                  className={`p-1.5 rounded-lg transition-colors ${showVirtualKeyboard ? 'bg-blue-500/30 text-blue-400' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
                  title="虚拟键盘"
                >
                  <Keyboard className="w-4 h-4" />
                </button>
              )}
              {isRunning && videoWidth > 0 && (
                <span>{displayLabel} {videoWidth}x{videoHeight}{dpiLabel}</span>
              )}
            </div>
          </div>
        </div>

        {/* 虚拟键盘 */}
        {showVirtualKeyboard && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 w-96">
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