// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AppPicker } from '../AppPicker';

// 稳定 Mock 对象，避免触发 useEffect 重复执行
const mockActions = {
  togglePin: vi.fn().mockResolvedValue(undefined),
  getAllDeviceApps: vi.fn().mockResolvedValue([
    { packageName: 'com.example.app1', label: 'App 1', pinned: false, pinOrder: 0, localCount: 0, launchCount: 0 },
    { packageName: 'com.example.app2', label: 'App 2', pinned: true, pinOrder: 1, localCount: 2, launchCount: 1 },
  ]),
  getAppIcon: vi.fn().mockResolvedValue(null),
  getCachedAppLabels: vi.fn().mockResolvedValue(new Map([['com.example.app1', 'App 1'], ['com.example.app2', 'App 2']])),
  incrementLocalCount: vi.fn().mockResolvedValue(undefined),
  parseAllApps: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/contexts/ScrcpyContext', () => ({
  useScrcpyActions: () => mockActions,
}));

const mockAdbState = {
  appListVersion: 1,
};

vi.mock('@/hooks/useAdbStore', () => ({
  useAdbStore: Object.assign(
    (selector?: (s: typeof mockAdbState) => unknown) => (selector ? selector(mockAdbState) : mockAdbState),
    {
      getState: () => mockAdbState,
    },
  ),
}));

describe('AppPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('渲染微毛玻璃材质容器与触控工效按钮', async () => {
    const onClose = vi.fn();
    const onLaunch = vi.fn();

    const { container } = render(
      <AppPicker
        config={{
          mode: 'single',
          onLaunch,
        }}
        onClose={onClose}
      />,
    );

    // 验证面板微毛玻璃容器样式
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain('bg-surface-elevated/95');
    expect(panel.className).toContain('backdrop-blur-xl');
    expect(panel.className).toContain('shadow-float');

    // 验证标题
    expect(screen.getByText('全部应用')).toBeDefined();

    // 验证置顶模式按钮为 48x48px (w-12 h-12)
    const pinBtn = screen.getByLabelText('置顶模式');
    expect(pinBtn.className).toContain('w-12');
    expect(pinBtn.className).toContain('h-12');

    // 验证更新列表刷新按钮为 48x48px (w-12 h-12)
    const refreshBtn = screen.getByLabelText('更新应用列表');
    expect(refreshBtn.className).toContain('w-12');
    expect(refreshBtn.className).toContain('h-12');

    // 验证关闭按钮为 48x48px (w-12 h-12)
    const closeBtn = screen.getByLabelText('关闭面板');
    expect(closeBtn.className).toContain('w-12');
    expect(closeBtn.className).toContain('h-12');

    // 点击关闭按钮触发 onClose
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('支持切换置顶模式并具有视觉高亮', async () => {
    render(
      <AppPicker
        config={{
          mode: 'pane',
          targetPane: 'left',
          onLaunch: vi.fn(),
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('选择应用 · 左分屏')).toBeDefined();

    const pinBtn = screen.getByLabelText('置顶模式');
    fireEvent.click(pinBtn);

    // 切换为退出置顶模式态
    const exitPinBtn = screen.getByLabelText('退出置顶模式');
    expect(exitPinBtn.className).toContain('text-accent-400');
    expect(exitPinBtn.className).toContain('bg-accent-500/20');
  });
});
