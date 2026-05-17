import { useState } from 'react';
import { Usb, Wifi, WifiOff, RefreshCw, Monitor, AlertCircle, CheckCircle } from 'lucide-react';
import { useUsbConnection } from '../hooks/useUsbConnection';
import { useWifiConnection } from '../hooks/useWifiConnection';
import { useNetworkCheck } from '../hooks/useNetworkCheck';
import { useAdbStore } from '../hooks/useAdbStore';

interface ConnectionPanelProps {
  onStartMirror: () => void;
}

export function ConnectionPanel({ onStartMirror }: ConnectionPanelProps) {
  const [activeTab, setActiveTab] = useState<'usb' | 'wifi'>('usb');
  const [wifiAddress, setWifiAddress] = useState('');

  const usb = useUsbConnection();
  const wifi = useWifiConnection();
  const network = useNetworkCheck();
  const store = useAdbStore();

  const isConnected = store.connectionStatus === 'connected';
  const deviceName = store.deviceName;

  const handleConnect = async () => {
    if (activeTab === 'usb') {
      await usb.connectUsb();
    } else {
      if (wifiAddress.trim()) {
        await wifi.connectWifi(wifiAddress.trim());
      }
    }
  };

  const handleDisconnect = async () => {
    if (store.connectionType === 'usb') {
      await usb.disconnect();
    } else {
      await wifi.disconnect();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="w-full max-w-md">
        {/* 标题 */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">车机虚拟屏</h1>
          <p className="text-slate-400">通过有线或无线方式连接手机</p>
        </div>

        {/* 网络状态卡片 */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 mb-6 border border-slate-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {network.isOnline ? (
                <Wifi className="w-5 h-5 text-emerald-400" />
              ) : (
                <WifiOff className="w-5 h-5 text-red-400" />
              )}
              <span className="text-slate-300 text-sm">
                {network.isOnline ? '网络已连接' : '网络未连接'}
              </span>
            </div>
            <button
              onClick={network.checkNetwork}
              className="p-1 hover:bg-slate-700 rounded-lg transition-colors"
              disabled={network.isChecking}
            >
              <RefreshCw className={`w-4 h-4 text-slate-400 ${network.isChecking ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {network.localIp && (
            <div className="mt-2 text-xs text-slate-500">
              本机 IP: {network.localIp}
              {network.isHotspot && (
                <span className="ml-2 text-amber-400">(热点模式)</span>
              )}
            </div>
          )}
        </div>

        {/* 连接类型选择 */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700 overflow-hidden">
          {/* 标签页 */}
          <div className="flex border-b border-slate-700">
            <button
              onClick={() => setActiveTab('usb')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
                activeTab === 'usb'
                  ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-700/30'
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
                  ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-700/30'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              <Wifi className="w-4 h-4" />
              无线连接
            </button>
          </div>

          {/* 内容区域 */}
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
                <div className="text-slate-400 text-sm text-center">
                  确保手机和车机在同一局域网
                </div>
                <div className="space-y-2">
                  <label className="text-slate-300 text-sm">设备 IP 地址</label>
                  <input
                    type="text"
                    value={wifiAddress}
                    onChange={(e) => setWifiAddress(e.target.value)}
                    placeholder="例如: 192.168.1.100"
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 transition-colors"
                  />
                </div>
                <button
                  onClick={wifi.scanDevices}
                  disabled={wifi.isScanning}
                  className="w-full py-2 text-sm text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
                >
                  {wifi.isScanning ? '扫描中...' : '扫描局域网设备'}
                </button>
                {wifi.discoveredDevices.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-slate-300 text-sm">发现的设备:</div>
                    {wifi.discoveredDevices.map((ip) => (
                      <button
                        key={ip}
                        onClick={() => setWifiAddress(ip)}
                        className="w-full px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 text-sm text-left transition-colors"
                      >
                        {ip}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 错误提示 */}
            {store.error && (
              <div className="mt-4 flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4" />
                {store.error}
              </div>
            )}

            {/* 连接状态 */}
            {isConnected && (
              <div className="mt-4 flex items-center gap-2 text-emerald-400 text-sm">
                <CheckCircle className="w-4 h-4" />
                已连接: {deviceName}
              </div>
            )}

            {/* 操作按钮 */}
            <div className="mt-6 space-y-3">
              {!isConnected ? (
                <button
                  onClick={handleConnect}
                  disabled={usb.isConnecting || wifi.isConnecting}
                  className="w-full py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {usb.isConnecting || wifi.isConnecting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      连接中...
                    </>
                  ) : (
                    <>
                      <Monitor className="w-4 h-4" />
                      连接设备
                    </>
                  )}
                </button>
              ) : (
                <div className="space-y-3">
                  <button
                    onClick={onStartMirror}
                    className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <Monitor className="w-4 h-4" />
                    启动虚拟屏
                  </button>
                  <button
                    onClick={handleDisconnect}
                    className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium rounded-lg transition-colors"
                  >
                    断开连接
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 使用说明 */}
        <div className="mt-6 text-slate-500 text-xs text-center space-y-1">
          <p>有线连接: 使用 USB 数据线直连</p>
          <p>无线连接: 车机或手机开启热点，连接同一网络</p>
        </div>
      </div>
    </div>
  );
}
