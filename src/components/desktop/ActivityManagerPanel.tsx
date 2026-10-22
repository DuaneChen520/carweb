/**
 * ActivityManagerPanel —— 活动进程管理浮窗。
 *
 * 设计文档 §7：
 * - 侧边栏底部新增「活动进程」按钮触发
 * - 列表内容：所有非 closed 状态的 app，按状态排序
 *   1. foreground-fullscreen —— 标注"全屏中"，info 蓝边框
 *   2. foreground-pane —— 标注"小窗中 · 左/右分屏"，info 蓝边框
 *   3. background —— 标注"后台"，普通样式
 * - 每条进程的操作：进入 / 关闭
 * - 全部关闭按钮
 *
 * background → 前台恢复落点规则（§7.4）：
 * 1. 当前有全屏覆盖层 → 该全屏 app 进 background，覆盖层承接新 app
 * 2. 否则有空 pane → 放进空 pane
 * 3. 否则两 pane 都占 → 覆盖左 pane
 *
 * 浮窗层级（§12.4）：fixed 定位，可覆盖整个区域（含侧边栏），
 * 但侧边栏按钮仍可点击触发。点击侧边栏其他按钮会关闭当前浮窗。
 */

import { useMemo } from 'react';
import { X, LogIn, Trash2, Monitor, SplitSquareHorizontal, Moon } from 'lucide-react';
import { useSessionManager, type AppInstance, type PaneSlot } from '@/lib/session-manager';
import { useAppLabels } from '@/lib/useAppDisplayName';
import type { DisplayConfig } from '@/lib/scrcpy-session';

interface ActivityManagerPanelProps {
  /** 关闭浮窗回调 */
  onClose: () => void;
  /** 显示配置构建函数（按 app 落点 pane 从真实容器尺寸推导，用于 resumeBackground） */
  getDisplayConfig: (pane: PaneSlot) => DisplayConfig;
}

// 状态排序权重（§7.2）
const STATE_ORDER: Record<string, number> = {
  'foreground-fullscreen': 0,
  'foreground-pane': 1,
  'background': 2,
};

function getStateLabel(app: AppInstance): { text: string; color: string; icon: React.ReactNode } {
  switch (app.state) {
    case 'foreground-fullscreen':
      return {
        text: '全屏中',
        color: 'text-accent-400 border-accent-500/30 bg-accent-500/10',
        icon: <Monitor size={12} />,
      };
    case 'foreground-pane':
      return {
        text: `小窗中 · ${app.pane === 'left' ? '左' : '右'}分屏`,
        color: 'text-accent-400 border-accent-500/30 bg-accent-500/10',
        icon: <SplitSquareHorizontal size={12} />,
      };
    case 'background':
      return {
        text: '后台',
        color: 'text-content-muted border-surface-card bg-surface-base/40',
        icon: <Moon size={12} />,
      };
    default:
      return { text: '', color: '', icon: null };
  }
}

export function ActivityManagerPanel({ onClose, getDisplayConfig }: ActivityManagerPanelProps) {
  const apps = useSessionManager((s) => s.apps);
  const resumeBackground = useSessionManager((s) => s.resumeBackground);
  const closeApp = useSessionManager((s) => s.closeApp);
  const closeAll = useSessionManager((s) => s.closeAll);

  // 按状态排序（§7.2）
  const sortedApps = useMemo(() => {
    return [...apps].sort((a, b) => {
      const orderA = STATE_ORDER[a.state] ?? 99;
      const orderB = STATE_ORDER[b.state] ?? 99;
      return orderA - orderB;
    });
  }, [apps]);

  // ADR-0012：按包名批量解析显示名（渲染时查设备缓存，兜底完整包名）
  const labels = useAppLabels(sortedApps.map((a) => a.packageName));

  const handleEnter = (app: AppInstance) => {
    if (app.state === 'background') {
      void resumeBackground(app.sessionId, getDisplayConfig(app.pane ?? 'left'));
    }
    // foreground-fullscreen / foreground-pane 已在前台，进入操作仅关闭浮窗
    onClose();
  };

  const handleClose = (app: AppInstance) => {
    void closeApp(app.sessionId);
  };

  const handleCloseAll = async () => {
    await closeAll();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-surface-elevated/95 backdrop-blur-xl rounded-2xl shadow-float border border-surface-card w-[420px] max-h-[80vh] flex flex-col overflow-hidden animate-scale-in">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-card/60 shrink-0">
          <h2 className="text-sm font-semibold text-content-primary">活动进程</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-surface-hover/80 text-content-muted hover:text-content-primary transition-all active:scale-95 cursor-pointer"
            title="关闭面板"
            aria-label="关闭面板"
          >
            <X size={18} />
          </button>
        </div>

        {/* 进程列表 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {sortedApps.length === 0 ? (
            <div className="py-12 text-center text-sm font-medium text-content-muted">
              暂无活动进程
            </div>
          ) : (
            sortedApps.map((app) => {
              const stateInfo = getStateLabel(app);
              const displayName = labels.get(app.packageName) || app.packageName;

              return (
                <div
                  key={app.sessionId}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl border bg-surface-card/40 ${stateInfo.color}`}
                >
                  {/* 应用图标占位 */}
                  <div className="w-10 h-10 rounded-xl bg-surface-elevated flex items-center justify-center text-content-primary text-sm font-medium shrink-0 shadow-sm">
                    {displayName.charAt(0).toUpperCase()}
                  </div>

                  {/* 应用信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-content-primary truncate">
                      {displayName}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-content-muted mt-0.5">
                      {stateInfo.icon}
                      {stateInfo.text}
                    </div>
                  </div>

                  {/* 操作按钮区 (每个均为 48x48 触控靶区) */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleEnter(app)}
                      className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-surface-hover/80 text-content-secondary hover:text-content-primary transition-all active:scale-95 cursor-pointer"
                      title="进入应用"
                      aria-label="进入应用"
                    >
                      <LogIn size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleClose(app)}
                      className="w-12 h-12 flex items-center justify-center rounded-xl hover:bg-feedback-danger/20 text-content-muted hover:text-red-400 transition-all active:scale-95 cursor-pointer"
                      title="关闭应用"
                      aria-label="关闭应用"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 底部：全部关闭 */}
        {sortedApps.length > 0 && (
          <div className="px-4 py-3 border-t border-surface-card/60 shrink-0">
            <button
              type="button"
              onClick={handleCloseAll}
              className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-xl bg-feedback-danger/10 text-red-400 hover:bg-feedback-danger/20 border border-feedback-danger/20 transition-all active:scale-[0.98] text-sm font-medium cursor-pointer"
            >
              <Trash2 size={16} />
              全部关闭
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
