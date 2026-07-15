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
  // 用 `click` 而非 `mousedown` + setTimeout(0) 延迟挂载，确保触发按钮自身的 onClick 先执行，
  // 避免侧栏 toggle 逻辑被外部点击干扰（`mousedown` 总在 `click` 前触发，会抢先关闭面板）。
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
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
      className="fixed z-40 bg-slate-800/95 backdrop-blur-xl rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-scale-in"
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
        maxHeight: rect.maxHeight,
      }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
        <h2 className="text-sm font-medium text-slate-100">
          {title}
          {count > 0 && <span className="ml-1.5 text-slate-400">({count})</span>}
        </h2>
        <div className="flex items-center gap-1">
          {/* 搜索框 */}
          <div className="relative mr-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜索应用..."
              className="w-40 pl-8 pr-2 py-1 text-xs bg-slate-700 rounded-lg border border-slate-600 text-slate-100 placeholder-slate-400 outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-400/30 transition-colors"
            />
          </div>
          {/* 置顶模式 */}
          <button
            onClick={() => setPinMode((v) => !v)}
            className={`p-1 rounded-lg transition-colors ${pinMode ? 'text-accent-400 bg-accent-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-white/10'}`}
            title={pinMode ? '退出置顶模式' : '置顶模式'}
          >
            <Pin className="w-4 h-4" />
          </button>
          {/* 刷新 */}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className={`p-1 rounded-lg transition-colors ${loading ? 'text-slate-500' : 'text-slate-400 hover:text-slate-200 hover:bg-white/10'}`}
            title="更新应用列表"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          {/* 关闭 */}
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors text-slate-400"
          >
            <X size={16} />
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