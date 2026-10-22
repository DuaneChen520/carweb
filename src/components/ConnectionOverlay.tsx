import { useState, useEffect } from 'react';
import { Monitor, Smartphone, Usb, Wifi, RefreshCw, AlertCircle, X, CheckCircle2, Scan, QrCode, Radio, Network } from 'lucide-react';
import { useUsbConnection } from '../hooks/useUsbConnection';
import { useWifiConnection, type WifiTopology, type ScannedDevice } from '../hooks/useWifiConnection';
import { useNetworkCheck } from '../hooks/useNetworkCheck';
import { useAdbStore } from '../hooks/useAdbStore';
import type { RememberedDevice, DisplayMode } from '../hooks/useRememberedDevices';
import { forgetDeviceCache } from '@/lib/forget-device-cache';

interface ConnectionOverlayProps {
  overlayState: 'auto-connecting' | 'auto-reconnecting' | 'auto-failed' | 'manual' | 'reconnecting';
  displayMode: DisplayMode;
  rememberedDevices: RememberedDevice[];
  onSelectMode: (mode: DisplayMode) => void;
  onConnect: (device: { id: string; name: string; type: 'usb' | 'wifi'; address: string }, mode: DisplayMode, remember: boolean) => void;
  onForget: (id: string) => void;
  onCancelAutoConnect?: () => void;
  onReconnect?: () => void;
  fading?: boolean;
}

/** 拓扑选项定义 */
const TOPOLOGY_OPTIONS: { key: WifiTopology; label: string; desc: string; icon: typeof Radio }[] = [
  { key: 'phone-hotspot', label: '手机热点', desc: '手机开热点，车机连接', icon: Radio },
  { key: 'car-hotspot', label: '车机热点', desc: '车机开热点，手机连接（新能源车）', icon: Network },
  { key: 'manual', label: '手动输入', desc: '已知设备 IP 地址', icon: Wifi },
];

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

export function ConnectionOverlay({ overlayState, displayMode, rememberedDevices, onSelectMode, onConnect, onForget, onCancelAutoConnect, onReconnect, fading = false }: ConnectionOverlayProps) {
  const [activeTab, setActiveTab] = useState<'usb' | 'wifi'>('usb');
  const [wifiAddress, setWifiAddress] = useState('');
  const [selectedDevice, setSelectedDevice] = useState<RememberedDevice | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);
  // 无线连接状态
  const [showQrInput, setShowQrInput] = useState(false);
  const [qrCodeText, setQrCodeText] = useState('');

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
          address: type === 'wifi' ? (store.wifiAddress || wifiAddress) : store.deviceSerial || '',
        },
        displayMode,
        rememberDevice,
      );
    } else if (store.connectionStatus === 'idle' || store.connectionStatus === 'error') {
      setIsConnecting(false);
      setSelectedDevice(null);
    }
  }, [store.connectionStatus, isConnecting, store.connectionType, store.deviceSerial, store.deviceName, store.wifiAddress, wifiAddress, onConnect, displayMode, rememberDevice]);

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
    } else if (wifiAddress.trim()) {
      await wifi.connectWifi(wifiAddress.trim());
    } else {
      setIsConnecting(false);
    }
  };

  /** 扫码配对连接 */
  const handleQrPairing = async () => {
    if (!qrCodeText.trim()) return;
    setIsConnecting(true);
    await wifi.connectWithPairing(qrCodeText.trim());
  };

  /** 选择扫描发现的设备 */
  const handleSelectScannedDevice = (device: ScannedDevice) => {
    setWifiAddress(`${device.ip}:${device.port}`);
  };

  if (overlayState === 'auto-connecting' || overlayState === 'auto-reconnecting') {
    const message = overlayState === 'auto-reconnecting' ? '正在重新建立连接…' : '正在自动连接…';
    return (
      <div className={`fixed inset-0 z-50 bg-black/40 backdrop-blur-xl flex items-center justify-center transition-opacity duration-300 ${fading ? 'opacity-0' : 'opacity-100'}`}>
        <div className="text-center">
          <div className="relative w-12 h-12 mx-auto mb-4">
            <RefreshCw className="w-12 h-12 text-accent-400/30" />
            <RefreshCw className="absolute inset-0 w-12 h-12 text-accent-400 animate-spin" />
          </div>
          <p className="text-white text-lg">{message}</p>
          {onCancelAutoConnect && (
            <button
              onClick={onCancelAutoConnect}
              className="mt-6 text-slate-400 text-sm hover:text-slate-200 transition-colors"
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
      <div className={`fixed inset-0 z-50 bg-black/40 backdrop-blur-xl flex items-center justify-center transition-opacity duration-300 ${fading ? 'opacity-0' : 'opacity-100'}`}>
        <div className="text-center max-w-sm px-6">
          <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6 text-amber-400" />
          </div>
          <p className="text-slate-200 text-lg mb-1">连接已断开</p>
          <p className="text-slate-400 text-sm mb-6">设备可能已被拔出或连接异常，请重新连接。</p>
          <div className="flex gap-3 justify-center">
            {onReconnect && (
              <button
                onClick={onReconnect}
                className="px-6 py-2.5 bg-accent-500 hover:bg-accent-600 shadow-accent-glow text-white font-medium rounded-xl transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 flex items-center gap-2"
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
              className="px-6 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium rounded-lg transition-colors"
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
      <div className={`fixed inset-0 z-50 bg-black/40 backdrop-blur-xl flex items-center justify-center transition-opacity duration-300 ${fading ? 'opacity-0' : 'opacity-100'}`}>
        <div className="text-center max-w-sm px-6">
          <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center mx-auto mb-4">
            <Usb className="w-6 h-6 text-slate-300" />
          </div>
          <p className="text-slate-200 text-lg mb-1">暂时无法自动连接</p>
          <p className="text-slate-400 text-sm mb-6">设备可能正忙，可在下方手动重新连接。</p>
          <button
            onClick={onCancelAutoConnect ?? (() => {})}
            className="px-6 py-2.5 bg-accent-500 hover:bg-accent-600 shadow-accent-glow text-white font-medium rounded-xl transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            手动连接
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Lever 4: 连接成功确认微交互 */}
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-200 ${
          fading ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-xl" />
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
          <p className="text-white text-base font-medium">已连接</p>
        </div>
      </div>

    <div className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 transition-opacity duration-300 ${fading ? 'opacity-0' : 'opacity-100'}`}>
      {/* 分层背景 */}
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-xl" />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(60rem 40rem at 45% -10%, rgba(47,106,230,0.22), transparent 60%)',
        }}
      />
      <div className="absolute inset-0 pointer-events-none noise-overlay" />

      <div className="relative w-full max-w-md mt-[10vh] mb-8 animate-scale-in">
        <div className="text-center mb-10">
          <h1 className="mb-2 flex items-baseline justify-center gap-1 font-black tracking-tight">
            <span className="text-5xl bg-gradient-to-b from-white to-slate-300 bg-clip-text text-transparent">CARWEB</span>
            <span className="text-2xl font-semibold text-slate-500 tracking-normal">.top</span>
          </h1>
          <p className="text-slate-400">为手机拓展的浏览器大屏</p>
          <div className="flex items-center justify-center gap-1.5 mt-4">
            <div className="w-8 h-0.5 rounded-full bg-accent-500/40" />
            <div className="w-1.5 h-1.5 rounded-full bg-accent-400/60" />
            <div className="w-8 h-0.5 rounded-full bg-accent-500/40" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <button
            onClick={() => onSelectMode('virtual')}
            className={`flex flex-col items-center gap-2 p-6 rounded-2xl border transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
              displayMode === 'virtual'
                ? 'border-accent-400 bg-accent-500/10 ring-1 ring-accent-400 shadow-accent-glow'
                : 'border-slate-700 bg-slate-800/50 hover:bg-slate-700/40 hover:border-slate-600'
            }`}
          >
            <Monitor className={`w-8 h-8 transition-colors ${displayMode === 'virtual' ? 'text-accent-400' : 'text-slate-400'}`} />
            <span className={`text-sm font-medium ${displayMode === 'virtual' ? 'text-accent-400' : 'text-white'}`}>虚拟显示屏</span>
            <span className="text-xs text-slate-500">创建独立副屏</span>
          </button>
          <button
            onClick={() => onSelectMode('mirror')}
            className={`flex flex-col items-center gap-2 p-6 rounded-2xl border transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
              displayMode === 'mirror'
                ? 'border-accent-400 bg-accent-500/10 ring-1 ring-accent-400 shadow-accent-glow'
                : 'border-slate-700 bg-slate-800/50 hover:bg-slate-700/40 hover:border-slate-600'
            }`}
          >
            <Smartphone className={`w-8 h-8 transition-colors ${displayMode === 'mirror' ? 'text-accent-400' : 'text-slate-400'}`} />
            <span className={`text-sm font-medium ${displayMode === 'mirror' ? 'text-accent-400' : 'text-white'}`}>屏幕镜像</span>
            <span className="text-xs text-slate-500">同步手机屏幕</span>
          </button>
        </div>

        {rememberedDevices.length > 0 && (
          <div className="mb-6">
            <div className="text-slate-400 text-sm mb-3">已记忆的设备</div>
            <div className="space-y-2">
              {rememberedDevices.map((device) => (
                <div key={device.id} className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setSelectedDevice(device);
                      handleConnectClick(device);
                    }}
                    className={`flex-1 flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      selectedDevice?.id === device.id
                        ? 'border-accent-400 bg-slate-700/50'
                        : 'border-slate-700 bg-slate-800/50 hover:bg-slate-700/30'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {device.type === 'usb' ? (
                        <Usb className="w-4 h-4 text-slate-400" />
                      ) : (
                        <Wifi className="w-4 h-4 text-slate-400" />
                      )}
                      <div className="text-left">
                        <div className="text-white text-sm">{device.name}</div>
                        <div className="text-slate-500 text-xs">{device.address}</div>
                      </div>
                    </div>
                    <div className="text-slate-500 text-xs">{formatRelativeTime(device.lastConnected)}</div>
                  </button>
                  <button
                    onClick={() => {
                      const forgetSerial = device.serial || device.id;
                      console.log(`[ConnectionOverlay] 用户忘记设备：serial=${forgetSerial}`);
                      forgetDeviceCache(forgetSerial);
                      onForget(device.id);
                    }}
                    className="p-2 rounded-lg text-slate-600 hover:text-red-400 hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
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
          <div className="flex-1 h-px bg-slate-700" />
          <span className="text-slate-500 text-sm">或连接新设备</span>
          <div className="flex-1 h-px bg-slate-700" />
        </div>

        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700 overflow-hidden mb-6">
          <div className="flex border-b border-slate-700">
            <button
              onClick={() => setActiveTab('usb')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
                activeTab === 'usb'
                  ? 'text-accent-400 border-b-2 border-accent-400 bg-slate-700/30'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              <Usb className="w-4 h-4" />
              有线连接
            </button>
            <button
              onClick={() => setActiveTab('wifi')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
                activeTab === 'wifi'
                  ? 'text-accent-400 border-b-2 border-accent-400 bg-slate-700/30'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              <Wifi className="w-4 h-4" />
              无线连接
            </button>
          </div>

          <div className="p-6">
            {activeTab === 'usb' ? (
              <div className="space-y-4">
                <div className="text-slate-400 text-sm text-center">
                  使用 USB 数据线连接手机和车机
                </div>
                <div className="flex justify-center">
                  <div className="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center">
                    <Usb className="w-8 h-8 text-slate-400" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* 网络拓扑选择 */}
                <div>
                  <label className="text-slate-300 text-sm mb-2 block">连接方式</label>
                  <div className="grid grid-cols-3 gap-2">
                    {TOPOLOGY_OPTIONS.map((opt) => (
                      <button
                        key={opt.key}
                        onClick={() => {
                          wifi.setTopology(opt.key);
                          if (opt.key === 'car-hotspot') {
                            wifi.scanDevices();
                          }
                          if (opt.key === 'manual') {
                            setShowQrInput(false);
                          }
                        }}
                        className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-xs transition-colors ${
                          wifi.topology === opt.key
                            ? 'border-accent-400 bg-accent-500/10 text-accent-400'
                            : 'border-slate-600 bg-slate-700/30 text-slate-400 hover:border-slate-500'
                        }`}
                      >
                        <opt.icon className="w-5 h-5" />
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 提示信息 */}
                <div className="text-slate-400 text-xs text-center bg-slate-700/20 rounded-lg p-2">
                  {wifi.topology === 'phone-hotspot' && '手机开热点后，车机自动检测手机的 IP 地址'}
                  {wifi.topology === 'car-hotspot' && '车机开热点后，扫描局域网中的设备'}
                  {wifi.topology === 'manual' && '手动输入设备的 IP 地址'}
                </div>

                {/* 车机热点模式：自动扫描 */}
                {wifi.topology === 'car-hotspot' && (
                  <button
                    onClick={wifi.scanDevices}
                    disabled={wifi.isScanning}
                    className="w-full py-2 text-sm text-accent-400 hover:text-accent-300 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <Scan className="w-4 h-4" />
                    {wifi.isScanning ? '扫描中...' : '扫描局域网设备'}
                  </button>
                )}

                {/* 扫描发现的设备列表 */}
                {wifi.discoveredDevices.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-slate-300 text-sm">发现的设备:</div>
                    {wifi.discoveredDevices.map((device) => (
                      <button
                        key={`${device.ip}:${device.port}`}
                        onClick={() => handleSelectScannedDevice(device)}
                        className="w-full px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 text-sm text-left transition-colors flex items-center gap-2"
                      >
                        <Smartphone className="w-4 h-4 text-slate-400" />
                        <span>{device.ip}:{device.port}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* IP 地址输入（手动输入模式 / 已选择扫描设备后填充） */}
                <div className="space-y-2">
                  <label className="text-slate-300 text-sm">设备 IP 地址</label>
                  <input
                    type="text"
                    value={wifiAddress}
                    onChange={(e) => setWifiAddress(e.target.value)}
                    placeholder="例如: 192.168.1.100:5555"
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-accent-400 transition-colors"
                  />
                </div>

                {/* 扫码配对入口 */}
                <div className="border-t border-slate-700 pt-4">
                  <button
                    onClick={() => {
                      setShowQrInput(!showQrInput);
                    }}
                    className="w-full py-2 text-sm text-accent-400 hover:text-accent-300 transition-colors flex items-center justify-center gap-2"
                  >
                    <QrCode className="w-4 h-4" />
                    {showQrInput ? '收起扫码输入' : '首次连接？扫码配对（Android 11+ 无线调试）'}
                  </button>

                  {showQrInput && (
                    <div className="mt-3 space-y-3 p-3 bg-slate-700/20 rounded-lg border border-slate-700">
                      <p className="text-slate-400 text-xs">
                        手机开启「开发者选项 → 无线调试 → 扫码配对」，扫描下方输入框旁边的二维码，或将 QR 码内容粘贴到下方：
                      </p>
                      <textarea
                        value={qrCodeText}
                        onChange={(e) => setQrCodeText(e.target.value)}
                        placeholder="粘贴 QR 码内容或输入配对码"
                        rows={2}
                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:border-accent-400 transition-colors resize-none"
                      />
                      <button
                        onClick={handleQrPairing}
                        disabled={!qrCodeText.trim() || isConnecting}
                        className="w-full py-2 bg-accent-500 hover:bg-accent-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                      >
                        {isConnecting ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            配对中...
                          </>
                        ) : (
                          '开始配对'
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {store.error && (
                  <div className="flex items-center gap-2 text-red-400 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {store.error}
                  </div>
                )}

                {!selectedDevice && (
                  <>
                    <button
                      onClick={() => handleConnectClick()}
                      disabled={isConnecting || !wifiAddress.trim()}
                      className="w-full mt-6 py-3 bg-accent-500 hover:bg-accent-600 disabled:bg-slate-600 disabled:cursor-not-allowed disabled:shadow-none shadow-accent-glow text-white font-medium rounded-xl transition-all duration-200 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 flex items-center justify-center gap-2"
                    >
                      {isConnecting ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          连接中...
                        </>
                      ) : (
                        <>
                          <Monitor className="w-4 h-4" />
                          连接并启动
                        </>
                      )}
                    </button>

                    <label className="mt-4 flex items-center gap-2 text-slate-400 text-sm cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={rememberDevice}
                        onChange={(e) => setRememberDevice(e.target.checked)}
                        className="rounded border-slate-600 bg-slate-700 text-accent-500 focus:ring-accent-500"
                      />
                      记住此设备
                    </label>
                  </>
                )}
              </div>
            )}

            {store.error && activeTab === 'usb' && (
              <div className="mt-4 flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {store.error}
              </div>
            )}

            {!selectedDevice && activeTab === 'usb' && (
              <>
                <button
                  onClick={() => handleConnectClick()}
                  disabled={isConnecting}
                  className="w-full mt-6 py-3 bg-accent-500 hover:bg-accent-600 disabled:bg-slate-600 disabled:cursor-not-allowed disabled:shadow-none shadow-accent-glow text-white font-medium rounded-xl transition-all duration-200 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 flex items-center justify-center gap-2"
                >
                  {isConnecting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      连接中...
                    </>
                  ) : (
                    <>
                      <Monitor className="w-4 h-4" />
                      连接并启动
                    </>
                  )}
                </button>

                <label className="mt-4 flex items-center gap-2 text-slate-400 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberDevice}
                    onChange={(e) => setRememberDevice(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-700 text-accent-500 focus:ring-accent-500"
                  />
                  记住此设备
                </label>
              </>
            )}
          </div>
        </div>
      </div>

      </div>
    </>
  );
}