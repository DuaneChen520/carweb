/**
 * AppPicker —— 统一「全部应用」浮动面板。
 *
 * ADR-0010 改造：
 * 从全屏居中模态框改为跟随触发器的浮动面板。
 * - 无遮罩，不阻塞下层交互
 * - 侧栏触发 → 悬浮于按钮右侧
 * - 分屏触发 → 悬浮于分屏内（宽度自适应分屏宽度）
 * - 点击面板外部自动关闭
 *
 * 统一后支持三模式启动落点 + search + 置顶(pin)模式 + 计数角标：
 *  - single：镜像/单虚拟屏 → startApp
 *  - pane：桌面左/右半屏 → onLaunchOnPane
 *  - fullscreen：桌面全屏受管会话 → onLaunchFullscreen
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, RefreshCw, Search, Pin } from 'lucide-react';
import { AppGrid, type AppGridHandle } from '@/components/AppGrid';
import { useScrcpyActions } from '@/contexts/ScrcpyContext';
import { useAdbStore } from '@/hooks/useAdbStore';
import type { AppPickerConfig } from '@/contexts/AppPickerContext';

interface AppPickerProps {
  config: AppPickerConfig;
  onClose: () => void;
}

/** 根据触发模式计算浮动面板的定位与尺寸 */
function computeFloatingRect(config: AppPickerConfig) {
  const { mode, targetPane } = config;

  // pane 模式：悬浮于分屏容器内，宽度自适应分屏宽度
  if (mode === 'pane' && targetPane) {
    const paneEl = document.querySelector(`[data-pane="${targetPane}"]`);
    if (paneEl) {
      const rect = paneEl.getBoundingClientRect();
      const pad = 8;
      return {
        top: rect.top + pad,
        left: rect.left + pad,
        width: Math.max(240, rect.width - pad * 2),
        maxHeight: Math.max(200, rect.height - pad * 2),
      };
    }
  }

  // fullscreen 模式：悬浮于侧栏右侧
  if (mode === 'fullscreen') {
    const sidebarEl = document.querySelector('.flex-shrink-0');
    if (sidebarEl) {
      const sidebarRect = sidebarEl.getBoundingClientRect();
      const gap = 8;
      const topPad = 72;
      return {
        top: topPad,
        left: sidebarRect.right + gap,
        width: Math.min(600, Math.max(400, window.innerWidth - sidebarRect.right - gap * 2)),
        maxHeight: window.innerHeight - topPad - 16,
      };
    }
  }

  // single 模式 / 兜底：居中于视口
  const w = Math.min(680, window.innerWidth - 32);
  const h = Math.min(window.innerHeight - 32, 600);
  return {
    top: (window.innerHeight - h) / 2,
    left: (window.innerWidth - w) / 2,
    width: w,
    maxHeight: h,
  };
}

export function AppPicker({ config, onClose }: AppPickerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { togglePin, getAllDeviceApps } = useScrcpyActions();
  const appListVersion = useAdbStore((s) => s.appListVersion);
  const gridRef = useRef<AppGridHandle>(null);
  const [pinMode, setPinMode] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(0);
  const [rect, setRect] = useState(() => computeFloatingRect(config));

  const { mode, targetPane, onLaunch, title: titleOverride } = config;

  // 标题：优先 config.title，否则按模式生成（ADR-0010 D1）
  const title = titleOverride
    ?? (mode === 'pane' && targetPane
      ? `选择应用 · ${targetPane === 'left' ? '左' : '右'}分屏`
      : '全部应用');

  // 窗口尺寸变化时重新计算定位
  useEffect(() => {
    const recompute = () => setRect(computeFloatingRect(config));
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [config]);

  // 已装应用总数角标（随 appListVersion 刷新，ADR-0010 D2）
  useEffect(() => {
    let cancelled = false;
    getAllDeviceApps().then((list) => {
      if (!cancelled) setCount(list.length);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [getAllDeviceApps, appListVersion]);

  // 点击面板外部 → 关闭（无遮罩时自然行为）。
  // 通过 `data-sidebar-trigger` 属性排除侧栏触发按钮，
  // 避免按钮的 toggle 逻辑与外部点击监听器冲突。
  useEffect(() => {
    const handlePointerOutside = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // 点击侧栏触发按钮时不关闭 —— 由按钮自身的 toggle 逻辑全权管理
      if (target.closest('[data-sidebar-trigger]')) return;
      if (panelRef.current && !panelRef.current.contains(target)) {
        onClose();
      }
    };
    // 用 pointerdown 而非 mousedown：canvas 投屏画面的 onPointerDown(e.preventDefault())
    // 会阻止兼容鼠标事件（mousedown/click）派发，但不阻止 pointerdown 冒泡。
    document.addEventListener('pointerdown', handlePointerOutside);
    return () => document.removeEventListener('pointerdown', handlePointerOutside);
  }, [onClose]);

  const handleLaunch = useCallback((pkg: string) => {
    onLaunch(pkg);
    onClose();
  }, [onLaunch, onClose]);

  // pin 模式：点击应用 = 切换置顶，而非启动（ADR-0010 D2）
  const handleTogglePin = useCallback(async (pkg: string) => {
    try {
      await togglePin(pkg);
      await gridRef.current?.refresh();
    } catch (e) {
      console.warn('[AppPicker] 切换置顶失败:', e);
    }
  }, [togglePin]);

  // 手动刷新：全量重解析设备端应用元数据（清空数据/缓存失效后的恢复路径，见 ADR-0009 D1）
  const handleRefresh = useCallback(() => {
    if (loading) return;
    setLoading(true);
    (gridRef.current?.refresh({ force: true }) ?? Promise.resolve())
      .then(() => gridRef.current?.goToFirstPage())
      .catch((e) => console.warn('[AppPicker] 刷新失败:', e))
      .finally(() => setLoading(false));
  }, [loading]);

  return (
    <div
      ref={panelRef}
      className="fixed z-40 bg-surface-elevated/95 backdrop-blur-xl rounded-2xl border border-surface-card shadow-float flex flex-col overflow-hidden animate-scale-in"
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
        maxHeight: rect.maxHeight,
      }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-card shrink-0 gap-2">
        <h2 className="text-sm font-medium text-content-primary flex items-center min-w-0">
          <span className="truncate">{title}</span>
          {count > 0 && <span className="ml-1.5 text-content-muted text-xs shrink-0">({count})</span>}
        </h2>
        <div className="flex items-center gap-2">
          {/* 搜索框 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-secondary pointer-events-none" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜索应用..."
              className="w-36 sm:w-44 pl-9 pr-3 py-2 text-xs bg-surface-base rounded-xl border border-surface-card text-content-primary placeholder:text-content-muted outline-none focus:border-accent-400 focus:ring-1 focus:ring-accent-400 min-h-[44px] transition-colors"
            />
          </div>
          {/* 置顶模式 */}
          <button
            onClick={() => setPinMode((v) => !v)}
            className={`w-12 h-12 flex items-center justify-center rounded-xl transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 ${
              pinMode
                ? 'text-accent-400 bg-accent-500/20 border border-accent-400/40'
                : 'text-content-secondary hover:text-content-primary hover:bg-surface-card border border-transparent'
            }`}
            title={pinMode ? '退出置顶模式' : '置顶模式'}
            aria-label={pinMode ? '退出置顶模式' : '置顶模式'}
          >
            <Pin className="w-5 h-5" />
          </button>
          {/* 刷新 */}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className={`w-12 h-12 flex items-center justify-center rounded-xl transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 border border-transparent hover:border-surface-card ${
              loading
                ? 'text-content-muted opacity-50 cursor-not-allowed'
                : 'text-content-secondary hover:text-content-primary hover:bg-surface-card'
            }`}
            title="更新应用列表"
            aria-label="更新应用列表"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {/* 关闭 */}
          <button
            onClick={onClose}
            className="w-12 h-12 flex items-center justify-center rounded-xl transition-all active:scale-95 text-content-secondary hover:text-content-primary hover:bg-surface-card border border-transparent hover:border-surface-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            title="关闭面板"
            aria-label="关闭面板"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 应用列表 */}
      <div className="flex-1 overflow-hidden min-h-0">
        <AppGrid
          ref={gridRef}
          onLaunchApp={handleLaunch}
          searchText={searchText}
          pinMode={pinMode}
          onTogglePin={handleTogglePin}
        />
      </div>
    </div>
  );
}
