// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CacheSettingsDialog, type DeviceCacheInfo } from '../CacheSettingsDialog';
import { PinDialog } from '../PinDialog';

const mockDevicePin = {
  verifyPin: vi.fn().mockResolvedValue(true),
  setPin: vi.fn().mockResolvedValue(undefined),
  removePin: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../hooks/useDevicePin', () => ({
  useDevicePin: () => mockDevicePin,
}));

describe('Wave 3 Modal Dialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('CacheSettingsDialog', () => {
    const mockDevices: DeviceCacheInfo[] = [
      {
        deviceSerial: 'serial-abc-12345678',
        deviceName: 'Pixel 8 Pro',
        appCacheCount: 15,
        appCacheSize: 1024 * 1024 * 3.5,
        pinnedCount: 4,
        launchCount: 42,
      },
    ];

    it('渲染微毛玻璃材质与符合规范的触控靶区', () => {
      const onClose = vi.fn();
      const onClearAppCache = vi.fn();
      const onClearPrefs = vi.fn();
      const onClearAll = vi.fn();

      const { container } = render(
        <CacheSettingsDialog
          open={true}
          onClose={onClose}
          devices={mockDevices}
          onClearDeviceAppCache={onClearAppCache}
          onClearDevicePreferences={onClearPrefs}
          onClearAll={onClearAll}
        />,
      );

      // 验证外层微毛玻璃样式
      const dialogPanel = container.querySelector('.shadow-float') as HTMLElement;
      expect(dialogPanel.className).toContain('bg-surface-elevated/95');
      expect(dialogPanel.className).toContain('backdrop-blur-xl');

      // 验证顶栏关闭按钮 48x48px (w-12 h-12)
      const closeTopBtn = screen.getByLabelText('关闭弹窗');
      expect(closeTopBtn.className).toContain('w-12');
      expect(closeTopBtn.className).toContain('h-12');

      // 验证清除按钮具有 min-h-[44px]
      const clearIconBtn = screen.getByRole('button', { name: /清除图标/i });
      expect(clearIconBtn.className).toContain('min-h-[44px]');

      const clearPrefsBtn = screen.getByRole('button', { name: /清除偏好/i });
      expect(clearPrefsBtn.className).toContain('min-h-[44px]');

      // 验证底部全量清除与关闭按钮具有 min-h-[48px]
      const clearAllBtn = screen.getByRole('button', { name: /清理所有设备数据/i });
      expect(clearAllBtn.className).toContain('min-h-[48px]');

      const bottomCloseBtn = screen.getByRole('button', { name: '关闭' });
      expect(bottomCloseBtn.className).toContain('min-h-[48px]');
    });

    it('支持清除确认交互流程', async () => {
      const onClearAppCache = vi.fn().mockResolvedValue(undefined);
      render(
        <CacheSettingsDialog
          open={true}
          onClose={vi.fn()}
          devices={mockDevices}
          onClearDeviceAppCache={onClearAppCache}
          onClearDevicePreferences={vi.fn()}
          onClearAll={vi.fn()}
        />,
      );

      // 点击清除图标进入二次确认
      const clearIconBtn = screen.getByRole('button', { name: /清除图标/i });
      fireEvent.click(clearIconBtn);

      const confirmBtn = screen.getByRole('button', { name: '确定清除' });
      expect(confirmBtn).toBeDefined();
      expect(confirmBtn.className).toContain('min-h-[44px]');

      fireEvent.click(confirmBtn);
      expect(onClearAppCache).toHaveBeenCalledWith('serial-abc-12345678');
    });
  });

  describe('PinDialog', () => {
    it('渲染 6 位数字槽位与 48px 触控数字键盘', () => {
      render(
        <PinDialog
          mode="verify"
          deviceId="test-device"
          deviceName="我的手机"
          hasExistingPin={true}
          onSuccess={vi.fn()}
          onForgot={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText('启动 PIN')).toBeDefined();
      expect(screen.getByText('我的手机')).toBeDefined();

      // 数字按键 48px 高度 (h-12)
      const digitBtn = screen.getByRole('button', { name: '5' });
      expect(digitBtn.className).toContain('h-12');

      // 删除按键 48px 高度
      const delBtn = screen.getByRole('button', { name: '删除' });
      expect(delBtn.className).toContain('h-12');

      // 忘记 PIN 按钮与取消按钮 min-h-[48px]
      const forgotBtn = screen.getByRole('button', { name: '忘记 PIN？' });
      expect(forgotBtn.className).toContain('min-h-[48px]');

      const cancelBtn = screen.getByRole('button', { name: '取消' });
      expect(cancelBtn.className).toContain('min-h-[48px]');
    });
  });
});
