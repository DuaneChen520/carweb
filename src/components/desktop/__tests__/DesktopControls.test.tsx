// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Maximize2, X, ChevronDown } from 'lucide-react';
import { TopBarActionButton } from '../TopBarActionButton';
import { TopBarHandle } from '../TopBarHandle';
import { PaneSelector } from '../PaneSelector';
import { ActivityManagerPanel } from '../ActivityManagerPanel';
import { useSessionManager } from '@/lib/session-manager';
import type { AppInstance } from '@/lib/session-manager';

// 模拟 useAppDisplayName
vi.mock('@/lib/useAppDisplayName', () => ({
  useAppDisplayName: (pkg?: string) => (pkg === 'com.test.app' ? '测试应用' : pkg || '未知应用'),
  useAppLabels: (pkgs: string[]) => new Map(pkgs.map((p) => [p, p === 'com.test.app' ? '测试应用' : p])),
}));

describe('Wave 2 桌面流媒体悬浮控件工效与视觉 Tokens 规范验收', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('TopBarActionButton & TopBarHandle', () => {
    it('常规操作按钮保证 48x48px 靶区且应用 content-primary 文本色', () => {
      const handleClick = vi.fn();
      render(<TopBarActionButton icon={Maximize2} label="全屏" onClick={handleClick} />);

      const btn = screen.getByRole('button', { name: '全屏' });
      expect(btn.className).toContain('w-12');
      expect(btn.className).toContain('h-12');
      expect(btn.className).toContain('text-content-primary');

      fireEvent.click(btn);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('危险关闭操作按钮使用 feedback-danger 红色系', () => {
      render(<TopBarActionButton icon={X} label="关闭应用" danger onClick={vi.fn()} />);

      const btn = screen.getByRole('button', { name: '关闭应用' });
      expect(btn.className).toContain('w-12');
      expect(btn.className).toContain('h-12');
      expect(btn.className).toContain('text-red-400');
    });

    it('TopBarHandle 上下拉把手保证 48x48px 触控区与无障碍标记', () => {
      const handleClick = vi.fn();
      render(<TopBarHandle icon={ChevronDown} label="展开控件栏" expanded={false} onClick={handleClick} />);

      const handle = screen.getByRole('button', { name: '展开控件栏' });
      expect(handle.className).toContain('w-12');
      expect(handle.className).toContain('h-12');
      expect(handle.getAttribute('aria-expanded')).toBe('false');

      fireEvent.click(handle);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('PaneSelector', () => {
    const dummyApp: AppInstance = {
      sessionId: 's-1',
      displayId: 101,
      packageName: 'com.test.app',
      state: 'foreground-pane',
      pane: 'left',
    };

    it('分屏选项项与取消按钮均满足 >= 48px 触控靶区，且彻底杜绝亮色 Slate-100', () => {
      const handleSelect = vi.fn();
      const handleCancel = vi.fn();

      const { container } = render(
        <PaneSelector
          sourcePane="right"
          leftApp={dummyApp}
          rightApp={null}
          onSelect={handleSelect}
          onCancel={handleCancel}
        />
      );

      // 绝无亮色背景或亮色文字
      expect(container.innerHTML).not.toContain('bg-slate-100');
      expect(container.innerHTML).not.toContain('text-slate-700');

      // 选项项为 min-h-[48px]
      const buttons = screen.getAllByRole('button');
      buttons.forEach((btn) => {
        expect(btn.className).toContain('min-h-[48px]');
      });

      // 点击取消
      const cancelBtn = screen.getByRole('button', { name: '取消' });
      fireEvent.click(cancelBtn);
      expect(handleCancel).toHaveBeenCalledTimes(1);
    });

    it('覆盖确认状态下按钮均满足 >= 48px 车机触控底线', () => {
      const handleSelect = vi.fn();
      render(
        <PaneSelector
          sourcePane="right"
          leftApp={dummyApp}
          rightApp={null}
          onSelect={handleSelect}
          onCancel={vi.fn()}
        />
      );

      // 点击左分屏触发覆盖确认
      const leftOption = screen.getByText('左分屏').closest('button');
      expect(leftOption).toBeDefined();
      fireEvent.click(leftOption!);

      // 断言覆盖确认与取消按钮
      const confirmBtn = screen.getByRole('button', { name: '确认覆盖' });
      const cancelBtn = screen.getByRole('button', { name: '取消' });

      expect(confirmBtn.className).toContain('min-h-[48px]');
      expect(cancelBtn.className).toContain('min-h-[48px]');

      fireEvent.click(confirmBtn);
      expect(handleSelect).toHaveBeenCalledWith('left');
    });
  });

  describe('ActivityManagerPanel', () => {
    const dummyApp: AppInstance = {
      sessionId: 's-app-1',
      displayId: 101,
      packageName: 'com.test.app',
      state: 'foreground-pane',
      pane: 'left',
    };

    beforeEach(() => {
      useSessionManager.setState({
        apps: [dummyApp],
      });
    });

    it('操作按钮均满足 48x48px 触控靶区，底部全部关闭满足 >= 48px，无 10px 字体', () => {
      const { container } = render(
        <ActivityManagerPanel
          onClose={vi.fn()}
          getDisplayConfig={vi.fn().mockReturnValue({ width: 800, height: 600, dpi: 160, bitRate: 4000000 })}
        />
      );

      // 进入与关闭操作按钮
      const enterBtn = screen.getByRole('button', { name: '进入应用' });
      const closeBtn = screen.getByRole('button', { name: '关闭应用' });

      expect(enterBtn.className).toContain('w-12');
      expect(enterBtn.className).toContain('h-12');
      expect(closeBtn.className).toContain('w-12');
      expect(closeBtn.className).toContain('h-12');

      // 底部全部关闭按钮
      const closeAllBtn = screen.getByRole('button', { name: '全部关闭' });
      expect(closeAllBtn.className).toContain('min-h-[48px]');

      // 全量断言无任何 10px 字体
      expect(container.innerHTML).not.toContain('text-[10px]');
    });
  });
});
