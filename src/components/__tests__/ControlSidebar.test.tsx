// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ControlSidebar } from '../ControlSidebar';

// 稳定 Mock 对象，避免每次 render 产生新引用导致 useEffect 无限死循环
const mockActions = {
  goBack: vi.fn(),
  goHome: vi.fn(),
  startApp: vi.fn(),
  getAppIcon: vi.fn().mockResolvedValue(null),
  getCachedAppLabels: vi.fn().mockResolvedValue(new Map()),
  parseAllApps: vi.fn(),
  turnOffPhysicalScreen: vi.fn(),
  turnOnPhysicalScreen: vi.fn(),
  getAllDeviceApps: vi.fn().mockResolvedValue([]),
  incrementLocalCount: vi.fn().mockResolvedValue(undefined),
  syncWithDevice: vi.fn(),
  getCacheInfo: vi.fn().mockResolvedValue({ count: 2, size: 2048 }),
  getAllDeviceSerials: vi.fn().mockResolvedValue([]),
  getDeviceCacheInfo: vi.fn().mockResolvedValue({ appCacheCount: 0, appCacheSize: 0, pinnedCount: 0, launchCount: 0 }),
  clearDeviceAppCache: vi.fn(),
  clearDevicePreferences: vi.fn(),
  clearAll: vi.fn(),
  setMuted: vi.fn(),
  setAudioRoute: vi.fn(),
};

const mockAudio = {
  audioStatus: 'idle' as const,
  isMuted: false,
  audioRoute: 'browser' as const,
};

vi.mock('@/contexts/ScrcpyContext', () => ({
  useScrcpyActions: () => mockActions,
  useScrcpyAudio: () => mockAudio,
}));

const mockAppPicker = {
  config: null,
  closeAppPicker: vi.fn(),
};

vi.mock('@/contexts/AppPickerContext', () => ({
  useAppPicker: () => mockAppPicker,
}));

const mockAdbState = {
  deviceSerial: 'test-device-1234',
  deviceName: 'Pixel 8',
  appListVersion: 1,
};

vi.mock('@/hooks/useAdbStore', () => ({
  useAdbStore: Object.assign(
    (selector?: (s: typeof mockAdbState) => unknown) => (selector ? selector(mockAdbState) : mockAdbState),
    {
      getState: () => mockAdbState,
    }
  ),
}));

const mockPin = {
  hasPin: vi.fn().mockReturnValue(false),
};

vi.mock('@/hooks/useDevicePin', () => ({
  useDevicePin: () => mockPin,
}));

const mockRemembered = {
  devices: [],
};

vi.mock('@/hooks/useRememberedDevices', () => ({
  useRememberedDevices: () => mockRemembered,
}));

describe('ControlSidebar 车机工效与视觉 Tokens 规范验收', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('侧栏根容器使用 surface 语义 Token，且无 text-[10px]', () => {
    const { container } = render(<ControlSidebar isRunning={true} />);
    const sidebarRoot = container.querySelector('.w-16');
    expect(sidebarRoot).toBeDefined();
    expect(sidebarRoot?.className).toContain('bg-surface-base');
    expect(sidebarRoot?.className).toContain('border-surface-card');

    // 全量断言无任何 10px 字体
    expect(container.innerHTML).not.toContain('text-[10px]');
  });

  it('展开设置二级弹窗拓宽至 w-64，且每个设置项均为 >= 48px List Row 整行触控', async () => {
    render(<ControlSidebar isRunning={true} />);

    // 点击设置按钮展开面板
    const settingsBtn = screen.getByRole('button', { name: '侧栏设置' });
    fireEvent.click(settingsBtn);

    // 断言设置面板宽度 w-64 与 surface.elevated 背景
    const settingsPanel = await screen.findByText('缓存大小');
    const panelContainer = settingsPanel.closest('.w-64');
    expect(panelContainer).toBeDefined();
    expect(panelContainer?.className).toContain('bg-surface-elevated/95');
    expect(panelContainer?.className).toContain('shadow-float');

    // 断言键盘模式整行按钮存在且最小高度 >= 48px
    const keyboardRow = screen.getByText('键盘模式').closest('button');
    expect(keyboardRow).toBeDefined();
    expect(keyboardRow?.className).toContain('min-h-[48px]');

    // 断言音频输出整行按钮存在且最小高度 >= 48px
    const audioRow = screen.getByText('音频输出').closest('button');
    expect(audioRow).toBeDefined();
    expect(audioRow?.className).toContain('min-h-[48px]');

    // 断言启动 PIN 整行按钮存在且最小高度 >= 48px
    const pinRow = screen.getByText('启动 PIN').closest('button');
    expect(pinRow).toBeDefined();
    expect(pinRow?.className).toContain('min-h-[48px]');

    // 断言缓存设置整行按钮存在且最小高度 >= 48px
    const cacheRow = screen.getByText('缓存设置').closest('button');
    expect(cacheRow).toBeDefined();
    expect(cacheRow?.className).toContain('min-h-[48px]');
  });
});
