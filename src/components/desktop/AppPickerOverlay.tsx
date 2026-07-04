/**
 * AppPickerOverlay —— 全部应用浮窗（双模式）。
 *
 * 设计文档 §10：
 * 现有 AppGrid / AppGridIcon 触发的"全部应用"浮窗支持两种启动模式：
 *
 * 模式 A：pane 模式（来自空 pane 中央点击）
 * - 用户选中 app → 在该 pane 启动（foreground-pane）
 * - 调用 onLaunchOnPane(pkg, pane)
 *
 * 模式 B：全屏模式（来自侧边栏按钮，无论是否在覆盖层内）
 * - 用户选中 app → 当前全屏 app（如有）进 background → 新 app 以 foreground-fullscreen 启动
 * - 调用 onLaunchFullscreen(pkg)
 *
 * 实现说明：
 * AppGrid 组件本身已通过 onLaunchApp 回调解耦，无需修改。
 * 本组件作为浮窗容器，根据 mode 决定调用哪个启动回调。
 */

import { useCallback, useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { AppGrid, type AppGridHandle } from '@/components/AppGrid';
import type { PaneSlot } from '@/lib/session-manager';

interface AppPickerOverlayProps {
  /** 模式：pane 模式（来自空 pane）或全屏模式（来自侧边栏） */
  mode: 'pane' | 'fullscreen';
  /** pane 模式下，目标 pane */
  targetPane?: PaneSlot;
  /** pane 模式启动回调 */
  onLaunchOnPane?: (pkg: string, pane: PaneSlot) => void;
  /** 全屏模式启动回调 */
  onLaunchFullscreen?: (pkg: string) => void;
  /** 关闭浮窗 */
  onClose: () => void;
}

export function AppPickerOverlay({
  mode,
  targetPane,
  onLaunchOnPane,
  onLaunchFullscreen,
  onClose,
}: AppPickerOverlayProps) {
  const gridRef = useRef<AppGridHandle>(null);
  const [title, setTitle] = useState('全部应用');

  useEffect(() => {
    if (mode === 'pane' && targetPane) {
      setTitle(`选择应用 · ${targetPane === 'left' ? '左' : '右'}分屏`);
    } else {
      setTitle('全部应用');
    }
  }, [mode, targetPane]);

  const handleLaunch = useCallback((pkg: string) => {
    if (mode === 'pane' && targetPane && onLaunchOnPane) {
      onLaunchOnPane(pkg, targetPane);
    } else if (mode === 'fullscreen' && onLaunchFullscreen) {
      onLaunchFullscreen(pkg);
    }
    onClose();
  }, [mode, targetPane, onLaunchOnPane, onLaunchFullscreen, onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[680px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-medium text-slate-800">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 transition-colors text-slate-500"
          >
            <X size={16} />
          </button>
        </div>

        {/* 应用列表 */}
        <div className="flex-1 overflow-hidden">
          <AppGrid
            ref={gridRef}
            onLaunchApp={handleLaunch}
          />
        </div>
      </div>
    </div>
  );
}
