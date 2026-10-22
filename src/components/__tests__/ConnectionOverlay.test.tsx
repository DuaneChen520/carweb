// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConnectionOverlay } from '../ConnectionOverlay';
import { useAdbStore } from '@/hooks/useAdbStore';

// Mock 相关 hooks
const mockPairAndConnect = vi.fn().mockResolvedValue(undefined);
const mockConnectWifi = vi.fn().mockResolvedValue(undefined);
const mockConnectWithPairing = vi.fn().mockResolvedValue(undefined);
const mockScanDevices = vi.fn().mockResolvedValue(undefined);

vi.mock('@/hooks/useWifiConnection', () => ({
  useWifiConnection: () => ({
    connectWifi: mockConnectWifi,
    pairAndConnect: mockPairAndConnect,
    connectWithPairing: mockConnectWithPairing,
    scanDevices: mockScanDevices,
    disconnect: vi.fn(),
    isScanning: false,
    discoveredDevices: [{ ip: '192.168.1.55', port: 5555 }],
    isConnecting: false,
    isConnected: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useUsbConnection', () => ({
  useUsbConnection: () => ({
    connectUsb: vi.fn(),
    tryAutoConnectUsb: vi.fn(),
    cancelAutoConnect: vi.fn(),
    disconnect: vi.fn(),
    isConnecting: false,
    isConnected: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useNetworkCheck', () => ({
  useNetworkCheck: () => ({ isOnline: true }),
}));

describe('ConnectionOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAdbStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  it('渲染基本信息并支持模式切换', () => {
    const onSelectMode = vi.fn();
    render(
      <ConnectionOverlay
        overlayState="manual"
        displayMode="virtual"
        rememberedDevices={[]}
        onSelectMode={onSelectMode}
        onConnect={vi.fn()}
        onForget={vi.fn()}
      />,
    );

    expect(screen.getByText('CARWEB')).toBeDefined();
    expect(screen.getByText('虚拟显示屏')).toBeDefined();
    expect(screen.getByText('屏幕镜像')).toBeDefined();

    fireEvent.click(screen.getByText('屏幕镜像'));
    expect(onSelectMode).toHaveBeenCalledWith('mirror');
  });

  it('切换到无线连接 Tab 并支持免线 6 位配对码配对建连', async () => {
    render(
      <ConnectionOverlay
        overlayState="manual"
        displayMode="virtual"
        rememberedDevices={[]}
        onSelectMode={vi.fn()}
        onConnect={vi.fn()}
        onForget={vi.fn()}
      />,
    );

    // 切换到无线连接
    fireEvent.click(screen.getByText('无线连接'));
    expect(mockScanDevices).toHaveBeenCalled();

    // 默认在配对子模式
    expect(screen.getByText('Android 11+ 免线配对指南')).toBeDefined();

    // 填入配对地址与 6 位配对码
    const addressInput = screen.getByPlaceholderText('例如: 192.168.1.100:37123');
    const codeInput = screen.getByPlaceholderText('例如: 123456');

    fireEvent.change(addressInput, { target: { value: '192.168.1.50:38999' } });
    fireEvent.change(codeInput, { target: { value: '654321' } });

    // 点击主操作按钮
    const submitBtn = screen.getByRole('button', { name: /配对并启动副屏/i });
    expect(submitBtn).toBeDefined();
    fireEvent.click(submitBtn);

    expect(mockPairAndConnect).toHaveBeenCalledWith('192.168.1.50:38999', '654321');
  });

  it('无线直连子面板支持选择已识别设备或手动输入 IP 直连', () => {
    render(
      <ConnectionOverlay
        overlayState="manual"
        displayMode="virtual"
        rememberedDevices={[]}
        onSelectMode={vi.fn()}
        onConnect={vi.fn()}
        onForget={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('无线连接'));

    // 切换到已知手机直连
    fireEvent.click(screen.getByText('已知手机直连'));

    // 验证局域网已识别设备
    expect(screen.getByText('192.168.1.55:5555')).toBeDefined();
    fireEvent.click(screen.getByText('192.168.1.55:5555'));

    // 输入框自动填入
    const ipInput = screen.getByPlaceholderText('例如: 192.168.1.100:5555') as HTMLInputElement;
    expect(ipInput.value).toBe('192.168.1.55:5555');

    // 点击直连
    const connectBtn = screen.getByRole('button', { name: /连接并启动副屏/i });
    fireEvent.click(connectBtn);

    expect(mockConnectWifi).toHaveBeenCalledWith('192.168.1.55:5555');
  });
});
