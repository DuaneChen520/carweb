import { useState, useCallback, useEffect } from 'react';

export interface NetworkInfo {
  isOnline: boolean;
  connectionType: string | null;
  localIp: string | null;
  isSameNetwork: boolean | null;
  isHotspot: boolean | null;
}

export function useNetworkCheck() {
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo>({
    isOnline: navigator.onLine,
    connectionType: null,
    localIp: null,
    isSameNetwork: null,
    isHotspot: null,
  });
  const [isChecking, setIsChecking] = useState(false);

  const checkNetwork = useCallback(async () => {
    setIsChecking(true);

    try {
      // 获取网络连接类型
      const connection = (navigator as unknown as Record<string, unknown>).connection as
        | { type?: string; effectiveType?: string }
        | undefined;
      const connectionType = connection?.type || null;

      // 获取本地 IP
      let localIp: string | null = null;
      try {
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await new Promise<void>((resolve) => setTimeout(resolve, 1000));

        const sdp = pc.localDescription?.sdp;
        if (sdp) {
          const matches = sdp.match(/(\d+\.\d+\.\d+\.\d+)/g);
          if (matches) {
            // 过滤掉本地回环地址
            const validIp = matches.find((ip: string) => !ip.startsWith('127.'));
            if (validIp) {
              localIp = validIp;
            }
          }
        }
        pc.close();
      } catch {
        // 忽略错误
      }

      // 判断是否是热点环境
      // 热点通常使用 192.168.43.x 或 172.20.10.x 网段
      const isHotspot = localIp ? (
        localIp.startsWith('192.168.43.') ||
        localIp.startsWith('172.20.10.') ||
        localIp.startsWith('192.168.173.')
      ) : null;

      setNetworkInfo({
        isOnline: navigator.onLine,
        connectionType,
        localIp,
        isSameNetwork: localIp !== null,
        isHotspot,
      });
    } catch (error) {
      console.error('网络检测错误:', error);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    checkNetwork();

    const handleOnline = () => {
      setNetworkInfo(prev => ({ ...prev, isOnline: true }));
      checkNetwork();
    };

    const handleOffline = () => {
      setNetworkInfo(prev => ({ ...prev, isOnline: false, isSameNetwork: false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [checkNetwork]);

  return {
    ...networkInfo,
    isChecking,
    checkNetwork,
  };
}
