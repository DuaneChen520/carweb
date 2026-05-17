import { useEffect, useRef, useCallback, useState } from 'react';
import { Maximize2, Minimize2, RotateCcw, Power, Smartphone } from 'lucide-react';
import { AndroidMotionEventAction } from '@yume-chan/scrcpy';
import { useScrcpy } from '../hooks/useScrcpy';
import { useAdbStore } from '../hooks/useAdbStore';

interface VirtualScreenProps {
  onStop: () => void;
}

export function VirtualScreen({ onStop }: VirtualScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const { startScrcpy, stopScrcpy, injectTouch, isStarting, isRunning, error, videoWidth, videoHeight } = useScrcpy();
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

  // 启动屏幕镜像
  useEffect(() => {
    const canvas = canvasRef.current;
    const adb = store.adb;

    if (canvas && adb && !isRunning && !isStarting) {
      startScrcpy(adb, canvas);
    }

    return () => {
      if (isRunning) {
        stopScrcpy();
      }
    };
  }, [store.adb]);

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
      // 容器更宽，以高度为基准
      renderHeight = containerSize.height;
      renderWidth = renderHeight * videoAspect;
    } else {
      // 容器更高，以宽度为基准
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

  // 将屏幕坐标转换为视频坐标
  const screenToVideoCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !videoWidth || !videoHeight) return null;

    const rect = canvas.getBoundingClientRect();

    // 计算 canvas 在容器中的实际渲染尺寸和位置
    const renderWidth = rect.width;
    const renderHeight = rect.height;
    const renderLeft = rect.left;
    const renderTop = rect.top;

    // 将屏幕坐标转换为相对于 canvas 的坐标 (0-1)
    const relativeX = (clientX - renderLeft) / renderWidth;
    const relativeY = (clientY - renderTop) / renderHeight;

    // 转换为视频坐标
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

    // 获取指针 ID（使用 pointerId，对于鼠标固定为 -1n）
    const pointerId = e.pointerType === 'mouse' ? -1n : BigInt(e.pointerId);

    // 计算压力值
    const pressure = e.pressure !== undefined && e.pressure > 0 ? e.pressure : (e.buttons > 0 ? 1 : 0);

    // 按钮状态
    const buttons = e.buttons;

    // actionButton 表示触发当前动作的按钮
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

  return (
    <div
      ref={containerRef}
      className="relative w-full h-screen bg-black flex flex-col"
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
              <div className="text-white/60 text-xs">
                {videoWidth && videoHeight ? `${videoWidth}x${videoHeight}` : '连接中...'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
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
              <div className="text-white text-lg">正在启动虚拟屏...</div>
              <div className="text-white/60 text-sm mt-2">请稍候</div>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
            <div className="text-center">
              <div className="text-red-400 text-lg mb-2">启动失败</div>
              <div className="text-white/60 text-sm">{error}</div>
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
            连接方式: {store.connectionType === 'usb' ? 'USB 有线' : 'WiFi 无线'}
          </div>
          <div>
            窗口: {Math.round(containerSize.width)}x{Math.round(containerSize.height)}
          </div>
        </div>
      </div>
    </div>
  );
}
