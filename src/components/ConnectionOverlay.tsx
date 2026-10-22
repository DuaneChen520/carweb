import { useState, useEffect } from 'react';
import {
  Monitor,
  Smartphone,
  Usb,
  Wifi,
  RefreshCw,
  AlertCircle,
  X,
  CheckCircle2,
  Scan,
  QrCode,
  KeyRound,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useUsbConnection } from '../hooks/useUsbConnection';
import { useWifiConnection, type ScannedDevice } from '../hooks/useWifiConnection';
import { useNetworkCheck } from '../hooks/useNetworkCheck';
import { useAdbStore } from '../hooks/useAdbStore';
import type { RememberedDevice, DisplayMode } from '../hooks/useRememberedDevices';
import { forgetDeviceCache } from '@/lib/forget-device-cache';

interface ConnectionOverlayProps {
  overlayState: 'auto-connecting' | 'auto-reconnecting' | 'auto-failed' | 'manual' | 'reconnecting';
  displayMode: DisplayMode;
  rememberedDevices: RememberedDevice[];
  onSelectMode: (mode: DisplayMode) => void;
  onConnect: (
    device: { id: string; name: string; type: 'usb' | 'wifi'; address: string },
    mode: DisplayMode,
    remember: boolean,
  ) => void;
  onForget: (id: string) => void;
  onCancelAutoConnect?: () => void;
  onReconnect?: () => void;
  fading?: boolean;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 0) return '刚刚';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

export function ConnectionOverlay({
  overlayState,
  displayMode,
  rememberedDevices,
  onSelectMode,
  onConnect,
  onForget,
  onCancelAutoConnect,
  onReconnect,
  fading = false,
}: ConnectionOverlayProps) {
  const [activeTab, setActiveTab] = useState<'usb' | 'wifi'>('usb');
  const [wirelessSubTab, setWirelessSubTab] = useState<'pair' | 'direct'>('pair');

  // 免线配对状态
  const [pairingAddress, setPairingAddress] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [showQrBox, setShowQrBox] = useState(false);
  const [qrCodeText, setQrCodeText] = useState('');

  // 直连状态
  const [wifiAddress, setWifiAddress] = useState('');
  const [selectedDevice, setSelectedDevice] = useState<RememberedDevice | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);

  const usb = useUsbConnection();
  const wifi = useWifiConnection();
  useNetworkCheck();
  const store = useAdbStore();

  useEffect(() => {
    if (!isConnecting) return;
    if (store.connectionStatus === 'connected') {
      setIsConnecting(false);
      setSelectedDevice(null);
      const type = store.connectionType as 'usb' | 'wifi';
      onConnect(
        {
          id: store.deviceSerial || '',
          name: store.deviceName || '未知设备',
          type,
          address:
            type === 'wifi'
              ? store.wifiAddress || wifiAddress || pairingAddress
              : store.deviceSerial || '',
        },
        displayMode,
        rememberDevice,
      );
    } else if (store.connectionStatus === 'idle' || store.connectionStatus === 'error') {
      setIsConnecting(false);
      setSelectedDevice(null);
    }
  }, [
    store.connectionStatus,
    isConnecting,
    store.connectionType,
    store.deviceSerial,
    store.deviceName,
    store.wifiAddress,
    wifiAddress,
    pairingAddress,
    onConnect,
    displayMode,
    rememberDevice,
  ]);

  const handleConnectClick = async (device?: RememberedDevice) => {
    setIsConnecting(true);

    const target = device ?? selectedDevice;

    if (target) {
      if (target.type === 'usb') {
        await usb.tryAutoConnectUsb(target.id);
      } else {
        await wifi.connectWifi(target.address);
      }
      return;
    }

    if (activeTab === 'usb') {
      await usb.connectUsb();
    } else if (wirelessSubTab === 'pair') {
      if (pairingAddress.trim() && pairingCode.trim()) {
        await wifi.pairAndConnect(pairingAddress.trim(), pairingCode.trim());
      } else {
        setIsConnecting(false);
      }
    } else if (wifiAddress.trim()) {
      await wifi.connectWifi(wifiAddress.trim());
    } else {
      setIsConnecting(false);
    }
  };

  /** 扫码或文本二维码解析配对 */
  const handleQrPairing = async () => {
    if (!qrCodeText.trim()) return;
    setIsConnecting(true);
    await wifi.connectWithPairing(qrCodeText.trim());
  };

  /** 选择扫描到的局域网在线设备 */
  const handleSelectScannedDevice = (device: ScannedDevice) => {
    setWifiAddress(`${device.ip}:${device.port}`);
  };

  if (overlayState === 'auto-connecting' || overlayState === 'auto-reconnecting') {
    const message = overlayState === 'auto-reconnecting' ? '正在重新建立连接…' : '正在自动连接…';
    return (
      <div
        className={`fixed inset-0 z-50 bg-surface-base/80 backdrop-blur-xl flex items-center justify-center transition-opacity duration-300 ${
          fading ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <div className="text-center">
          <div className="relative w-12 h-12 mx-auto mb-4">
            <RefreshCw className="w-12 h-12 text-accent-400/30" />
            <RefreshCw className="absolute inset-0 w-12 h-12 text-accent-400 animate-spin" />
          </div>
          <p className="text-content-primary text-lg font-medium">{message}</p>
          {onCancelAutoConnect && (
            <button
              onClick={onCancelAutoConnect}
              className="mt-6 text-content-secondary text-sm hover:text-content-primary transition-colors min-h-[48px] px-4 flex items-center justify-center mx-auto"
            >
              取消
            </button>
          )}
        </div>
      </div>
    );
  }

  if (overlayState === 'reconnecting') {
    return (
      <div
        className={`fixed inset-0 z-50 bg-surface-base/80 backdrop-blur-xl flex items-center justify-center transition-opacity duration-300 ${
          fading ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <div className="text-center max-w-sm px-6">
          <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6 text-amber-400" />
          </div>
          <p className="text-content-primary text-lg font-medium mb-1">连接已断开</p>
          <p className="text-content-secondary text-sm mb-6">
            {store.error || '设备可能已被断开或无线信号中断，请重新连接。'}
          </p>
          <div className="flex gap-3 justify-center">
            {onReconnect && (
              <button
                onClick={onReconnect}
                className="px-6 py-2.5 min-h-[48px] bg-accent-500 hover:bg-accent-600 shadow-accent-glow text-white font-medium rounded-xl transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                重新连接
              </button>
            )}
            <button
              onClick={() => {
                usb.cancelAutoConnect();
                window.location.reload();
              }}
              className="px-6 py-2.5 min-h-[48px] bg-surface-card hover:bg-surface-elevated text-content-primary font-medium rounded-xl border border-surface-card transition-colors flex items-center justify-center"
            >
              返回
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (overlayState === 'auto-failed') {
    return (
      <div
        className={`fixed inset-0 z-50 bg-surface-base/80 backdrop-blur-xl flex items-center justify-center transition-opacity duration-300 ${
          fading ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <div className="text-center max-w-sm px-6">
          <div className="w-12 h-12 rounded-full bg-surface-card border border-surface-card flex items-center justify-center mx-auto mb-4">
            <Usb className="w-6 h-6 text-content-secondary" />
          </div>
          <p className="text-content-primary text-lg font-medium mb-1">暂时无法自动连接</p>
          <p className="text-content-secondary text-sm mb-6">设备可能正忙，可在下方手动重新连接。</p>
          <button
            onClick={onCancelAutoConnect ?? (() => {})}
            className="px-6 py-2.5 min-h-[48px] bg-accent-500 hover:bg-accent-600 shadow-accent-glow text-white font-medium rounded-xl transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base flex items-center justify-center mx-auto"
          >
            手动连接
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* 连接成功过渡效果 */}
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-200 ${
          fading ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="absolute inset-0 bg-surface-base/80 backdrop-blur-xl" />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(60rem 40rem at 45% -10%, rgba(47,106,230,0.22), transparent 60%)',
          }}
        />
        <div className="relative text-center animate-scale-in">
          <div className="w-16 h-16 rounded-full bg-accent-500/20 flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-8 h-8 text-accent-400" />
          </div>
          <p className="text-content-primary text-base font-medium">已连接</p>
        </div>
      </div>

      <div
        className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 transition-opacity duration-300 ${
          fading ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <div className="absolute inset-0 bg-surface-base/80 backdrop-blur-xl" />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(60rem 40rem at 45% -10%, rgba(47,106,230,0.22), transparent 60%)',
          }}
        />
        <div className="absolute inset-0 pointer-events-none noise-overlay" />

        <div className="relative w-full max-w-md mt-[8vh] mb-8 animate-scale-in">
          <div className="text-center mb-8">
            <h1 className="mb-2 flex items-baseline justify-center gap-1 font-black tracking-tight">
              <span className="text-5xl bg-gradient-to-b from-white to-slate-300 bg-clip-text text-transparent">
                CARWEB
              </span>
              <span className="text-2xl font-semibold text-content-muted tracking-normal">.top</span>
            </h1>
            <p className="text-content-secondary text-sm">为手机拓展的座舱独立副屏</p>
          </div>

          {/* 模式选择 */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <button
              onClick={() => onSelectMode('virtual')}
              className={`flex flex-col items-center gap-2 p-5 rounded-2xl border transition-all duration-200 active:scale-[0.98] min-h-[48px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base ${
                displayMode === 'virtual'
                  ? 'border-accent-400 bg-accent-500/10 ring-1 ring-accent-400 shadow-accent-glow'
                  : 'border-surface-card bg-surface-card hover:bg-surface-elevated hover:border-accent-400/30'
              }`}
            >
              <Monitor
                className={`w-7 h-7 transition-colors ${
                  displayMode === 'virtual' ? 'text-accent-400' : 'text-content-secondary'
                }`}
              />
              <span
                className={`text-sm font-medium ${
                  displayMode === 'virtual' ? 'text-accent-400' : 'text-content-primary'
                }`}
              >
                虚拟显示屏
              </span>
              <span className="text-xs text-content-muted">创建独立副屏，互不干扰</span>
            </button>
            <button
              onClick={() => onSelectMode('mirror')}
              className={`flex flex-col items-center gap-2 p-5 rounded-2xl border transition-all duration-200 active:scale-[0.98] min-h-[48px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base ${
                displayMode === 'mirror'
                  ? 'border-accent-400 bg-accent-500/10 ring-1 ring-accent-400 shadow-accent-glow'
                  : 'border-surface-card bg-surface-card hover:bg-surface-elevated hover:border-accent-400/30'
              }`}
            >
              <Smartphone
                className={`w-7 h-7 transition-colors ${
                  displayMode === 'mirror' ? 'text-accent-400' : 'text-content-secondary'
                }`}
              />
              <span
                className={`text-sm font-medium ${
                  displayMode === 'mirror' ? 'text-accent-400' : 'text-content-primary'
                }`}
              >
                屏幕镜像
              </span>
              <span className="text-xs text-content-muted">手机全屏同步镜像</span>
            </button>
          </div>

          {/* 已记住的设备 */}
          {rememberedDevices.length > 0 && (
            <div className="mb-6">
              <div className="text-content-secondary text-xs mb-2">已配对设备（点击直连）</div>
              <div className="space-y-2">
                {rememberedDevices.map((device) => (
                  <div key={device.id} className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSelectedDevice(device);
                        handleConnectClick(device);
                      }}
                      className={`flex-1 flex items-center justify-between p-3 rounded-xl border min-h-[48px] transition-colors ${
                        selectedDevice?.id === device.id
                          ? 'border-accent-400 bg-surface-elevated'
                          : 'border-surface-card bg-surface-card hover:bg-surface-elevated'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {device.type === 'usb' ? (
                          <Usb className="w-4 h-4 text-content-secondary" />
                        ) : (
                          <Wifi className="w-4 h-4 text-accent-400" />
                        )}
                        <div className="text-left">
                          <div className="text-content-primary text-sm font-medium">{device.name}</div>
                          <div className="text-content-muted text-xs tabular-nums">{device.address}</div>
                        </div>
                      </div>
                      <div className="text-content-muted text-xs">{formatRelativeTime(device.lastConnected)}</div>
                    </button>
                    <button
                      onClick={() => {
                        const forgetSerial = device.serial || device.id;
                        forgetDeviceCache(forgetSerial);
                        onForget(device.id);
                      }}
                      className="p-3 min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl text-content-muted hover:text-red-400 hover:bg-surface-elevated border border-transparent hover:border-surface-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
                      title="忘记此设备"
                      aria-label="忘记此设备"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-surface-card" />
            <span className="text-content-muted text-xs">连接新设备</span>
            <div className="flex-1 h-px bg-surface-card" />
          </div>

          {/* 连接面板 */}
          <div className="bg-surface-elevated/95 backdrop-blur-xl rounded-2xl border border-surface-card shadow-float overflow-hidden mb-6">
            <div className="flex border-b border-surface-card">
              <button
                onClick={() => setActiveTab('usb')}
                className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium min-h-[48px] transition-colors ${
                  activeTab === 'usb'
                    ? 'text-accent-400 border-b-2 border-accent-400 bg-accent-500/10'
                    : 'text-content-secondary hover:text-content-primary'
                }`}
              >
                <Usb className="w-4 h-4" />
                有线连接
              </button>
              <button
                onClick={() => {
                  setActiveTab('wifi');
                  wifi.scanDevices();
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium min-h-[48px] transition-colors ${
                  activeTab === 'wifi'
                    ? 'text-accent-400 border-b-2 border-accent-400 bg-accent-500/10'
                    : 'text-content-secondary hover:text-content-primary'
                }`}
              >
                <Wifi className="w-4 h-4" />
                无线连接
              </button>
            </div>

            <div className="p-5">
              {activeTab === 'usb' ? (
                <div className="space-y-4">
                  <div className="text-content-secondary text-xs text-center">
                    使用 USB 数据线将手机连接到车机接口
                  </div>
                  <div className="flex justify-center py-2">
                    <div className="w-16 h-16 rounded-full bg-surface-card border border-surface-card flex items-center justify-center">
                      <Usb className="w-8 h-8 text-content-secondary" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 无线二级切换 */}
                  <div className="grid grid-cols-2 p-1 bg-surface-base rounded-xl border border-surface-card text-xs font-medium">
                    <button
                      onClick={() => setWirelessSubTab('pair')}
                      className={`py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5 min-h-[48px] ${
                        wirelessSubTab === 'pair'
                          ? 'bg-accent-500 text-white shadow-sm'
                          : 'text-content-secondary hover:text-content-primary'
                      }`}
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      配对新手机（免线）
                    </button>
                    <button
                      onClick={() => {
                        setWirelessSubTab('direct');
                        wifi.scanDevices();
                      }}
                      className={`py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5 min-h-[48px] ${
                        wirelessSubTab === 'direct'
                          ? 'bg-accent-500 text-white shadow-sm'
                          : 'text-content-secondary hover:text-content-primary'
                      }`}
                    >
                      <Wifi className="w-3.5 h-3.5" />
                      已知手机直连
                    </button>
                  </div>

                  {wirelessSubTab === 'pair' ? (
                    <div className="space-y-4">
                      {/* 配对操作指引 */}
                      <div className="p-3.5 bg-surface-base border border-surface-card rounded-xl space-y-2 text-xs text-content-primary">
                        <div className="font-medium text-content-primary flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent-400" />
                          Android 11+ 免线配对指南
                        </div>
                        <ol className="list-decimal list-inside space-y-1 text-content-secondary pl-1 leading-relaxed">
                          <li>手机与车机连入同一 WiFi（或开启手机热点让车机连接）；</li>
                          <li>打开手机系统「开发者选项 → 无线调试」；</li>
                          <li>点击「使用配对码配对设备」，查看配对码与 IP 端口。</li>
                        </ol>
                      </div>

                      {/* 输入配对 IP:端口 */}
                      <div>
                        <label className="text-content-secondary text-xs mb-1.5 block">
                          手机配对 IP 与端口（如 192.168.1.100:37123）
                        </label>
                        <input
                          type="text"
                          value={pairingAddress}
                          onChange={(e) => setPairingAddress(e.target.value)}
                          placeholder="例如: 192.168.1.100:37123"
                          className="w-full px-4 py-3 bg-surface-base border border-surface-card rounded-xl text-content-primary text-sm placeholder:text-content-muted focus:outline-none focus:border-accent-400 min-h-[48px] tabular-nums"
                        />
                      </div>

                      {/* 输入 6 位配对码 */}
                      <div>
                        <label className="text-content-secondary text-xs mb-1.5 block">6 位配对码</label>
                        <input
                          type="text"
                          maxLength={6}
                          value={pairingCode}
                          onChange={(e) => setPairingCode(e.target.value.replace(/\D/g, ''))}
                          placeholder="例如: 123456"
                          className="w-full px-4 py-3 bg-surface-base border border-surface-card rounded-xl text-content-primary text-lg tracking-widest text-center placeholder:text-content-muted focus:outline-none focus:border-accent-400 min-h-[48px] tabular-nums font-mono"
                        />
                      </div>

                      {/* 二维码解析展开 */}
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => setShowQrBox(!showQrBox)}
                          className="w-full text-xs text-accent-400 hover:text-accent-300 flex items-center justify-center gap-1.5 py-3 min-h-[48px]"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          {showQrBox ? '收起二维码文本解析' : '或通过二维码信息配对'}
                          {showQrBox ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>

                        {showQrBox && (
                          <div className="mt-2 p-3 bg-surface-base rounded-xl border border-surface-card space-y-2">
                            <textarea
                              value={qrCodeText}
                              onChange={(e) => setQrCodeText(e.target.value)}
                              placeholder="粘贴扫码枪识别出的 WIFI:T:ADB;S:... 二维码字符串"
                              rows={2}
                              className="w-full p-2.5 bg-surface-card border border-surface-card rounded-lg text-content-primary text-xs placeholder:text-content-muted focus:outline-none focus:border-accent-400 resize-none tabular-nums"
                            />
                            <button
                              type="button"
                              onClick={handleQrPairing}
                              disabled={!qrCodeText.trim() || isConnecting}
                              className="w-full py-3 bg-surface-card hover:bg-surface-elevated border border-surface-card disabled:opacity-50 text-content-primary text-xs font-medium rounded-lg transition-colors min-h-[48px] flex items-center justify-center gap-2"
                            >
                              解析并自动配对
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* 已在线的 ADB 设备列表 */}
                      {wifi.discoveredDevices.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-content-secondary text-xs flex items-center justify-between">
                            <span>局域网已识别设备:</span>
                            <button
                              onClick={wifi.scanDevices}
                              disabled={wifi.isScanning}
                              className="text-accent-400 text-xs flex items-center gap-1 hover:underline min-h-[48px] px-2"
                            >
                              <Scan className="w-3.5 h-3.5" />
                              {wifi.isScanning ? '刷新中...' : '刷新'}
                            </button>
                          </div>
                          {wifi.discoveredDevices.map((device) => (
                            <button
                              key={`${device.ip}:${device.port}`}
                              onClick={() => handleSelectScannedDevice(device)}
                              className="w-full px-3.5 py-3 bg-surface-base hover:bg-surface-card rounded-xl border border-surface-card text-content-primary text-xs text-left transition-colors flex items-center justify-between min-h-[48px]"
                            >
                              <div className="flex items-center gap-2.5">
                                <Smartphone className="w-4 h-4 text-accent-400" />
                                <span className="tabular-nums font-medium">
                                  {device.ip}:{device.port}
                                </span>
                              </div>
                              <span className="text-content-muted text-xs">点击填入</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* 手动 IP:端口 输入 */}
                      <div>
                        <label className="text-content-secondary text-xs mb-1.5 block">
                          设备 IP 地址与主端口（默认 5555）
                        </label>
                        <input
                          type="text"
                          value={wifiAddress}
                          onChange={(e) => setWifiAddress(e.target.value)}
                          placeholder="例如: 192.168.1.100:5555"
                          className="w-full px-4 py-3 bg-surface-base border border-surface-card rounded-xl text-content-primary text-sm placeholder:text-content-muted focus:outline-none focus:border-accent-400 min-h-[48px] tabular-nums"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 错误展示 */}
              {store.error && (
                <div className="mt-4 p-3 bg-red-950/30 border border-red-800/40 rounded-xl flex items-center gap-2 text-red-400 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{store.error}</span>
                </div>
              )}

              {/* 底部主 CTA 按钮 */}
              <button
                onClick={() => handleConnectClick()}
                disabled={
                  isConnecting ||
                  (activeTab === 'wifi' &&
                    ((wirelessSubTab === 'pair' && (!pairingAddress.trim() || !pairingCode.trim())) ||
                      (wirelessSubTab === 'direct' && !wifiAddress.trim())))
                }
                className="w-full mt-5 py-3.5 bg-accent-500 hover:bg-accent-600 disabled:bg-surface-card disabled:text-content-muted disabled:border-surface-card disabled:opacity-50 disabled:cursor-not-allowed shadow-accent-glow text-white font-medium rounded-xl transition-all duration-200 active:scale-[0.99] min-h-[48px] flex items-center justify-center gap-2 text-sm"
              >
                {isConnecting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    正在连接手机…
                  </>
                ) : (
                  <>
                    <Monitor className="w-4 h-4" />
                    {activeTab === 'wifi' && wirelessSubTab === 'pair' ? '配对并启动副屏' : '连接并启动副屏'}
                  </>
                )}
              </button>

              <label className="mt-3.5 flex items-center justify-center gap-2 text-content-secondary text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                  className="rounded border-surface-card bg-surface-base text-accent-500 focus:ring-accent-500"
                />
                记住此设备（下次上车一键免配对连接）
              </label>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
