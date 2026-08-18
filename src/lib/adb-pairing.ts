/**
 * Android 11+ 无线调试配对协议。
 *
 * 配对流程：
 * 1. 手机开启无线调试 → 显示 QR 码（或配对码 + IP:端口）
 * 2. 车机扫码 → 解析出设备信息
 * 3. 车机通过 WebSocket 桥接代理发送配对请求
 * 4. 桥接代理处理 TLS PSK 握手 + 配对协议
 * 5. 配对完成 → 后续直接走 ADB 端口 5555
 */

/** 从 Android 11+ 无线调试 QR 码中解析出的配对信息。 */
export interface AdbPairingInfo {
  /** 设备名称（如 SM-G998B） */
  deviceName: string;
  /** 六位配对码 */
  pairingCode: string;
  /** 手机 IP 地址 */
  host: string;
  /** 配对端口（37000+，随机的，不是 5555） */
  pairingPort: number;
}

/**
 * 解析 Android 11+ 无线调试 QR 码。
 *
 * QR 码格式：
 * `WIFI:T:ADB;S:{deviceName};P:{pairingCode};H:{host};D:{port};;`
 *
 * 示例：
 * `WIFI:T:ADB;S:SM-G998B;P:123456;H:192.168.1.100;D:37001;;`
 *
 * @param qrCode 从 QR 码中读取的字符串
 * @returns 解析后的配对信息，格式无效时返回 null
 */
export function parseAdbQrCode(qrCode: string): AdbPairingInfo | null {
  if (!qrCode.startsWith('WIFI:T:ADB;')) {
    return null;
  }

  const fields = qrCode.split(';');
  const info: Record<string, string> = {};

  for (const field of fields) {
    if (field.includes(':')) {
      const colonIndex = field.indexOf(':');
      const key = field.substring(0, colonIndex);
      const value = field.substring(colonIndex + 1);
      info[key] = value;
    }
  }

  if (!info['S'] || !info['P'] || !info['H'] || !info['D']) {
    return null;
  }

  const port = parseInt(info['D'], 10);
  if (isNaN(port) || port <= 0 || port > 65535) {
    return null;
  }

  return {
    deviceName: info['S'],
    pairingCode: info['P'],
    host: info['H'],
    pairingPort: port,
  };
}

/**
 * ADB 配对结果。
 */
export interface AdbPairingResult {
  success: boolean;
  error?: string;
}

/**
 * 通过 WebSocket 桥接代理执行 ADB 配对。
 *
 * 实际 TLS PSK 握手 + 配对协议由桥接代理处理。
 * 浏览器端通过 WebSocket 发送配对请求并等待结果。
 *
 * @param bridgeUrl 桥接代理 WebSocket URL（如 ws://localhost:8080）
 * @param info 配对信息（从 QR 码解析得到）
 * @param publicKeyPem 车机的 RSA 公钥（PEM 格式）
 * @returns 配对结果
 */
export async function pairWithDevice(
  bridgeUrl: string,
  info: AdbPairingInfo,
  publicKeyPem: string,
): Promise<AdbPairingResult> {
  const ws = new WebSocket(`${bridgeUrl}/pair`);
  ws.binaryType = 'arraybuffer';

  // 等待连接建立
  await new Promise<void>((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('无法连接到桥接代理'));
  });

  try {
    // 发送配对请求（JSON）
    const request = JSON.stringify({
      type: 'pair',
      host: info.host,
      port: info.pairingPort,
      code: info.pairingCode,
      publicKey: publicKeyPem,
    });
    ws.send(request);

    // 等待响应
    const result = await new Promise<AdbPairingResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('配对超时'));
      }, 30000);

      const onMessage = (event: MessageEvent) => {
        let data: string;
        if (event.data instanceof ArrayBuffer) {
          data = new TextDecoder().decode(event.data);
        } else if (event.data instanceof Blob) {
          // 不处理 Blob，跳过
          return;
        } else {
          data = event.data as string;
        }

        try {
          const response = JSON.parse(data);
          clearTimeout(timeout);
          cleanup();
          resolve(response);
        } catch {
          // 非 JSON 消息，忽略
        }
      };

      const onError = () => {
        clearTimeout(timeout);
        cleanup();
        reject(new Error('配对连接错误'));
      };

      const cleanup = () => {
        ws.removeEventListener('message', onMessage);
        ws.removeEventListener('error', onError);
      };

      ws.addEventListener('message', onMessage);
      ws.addEventListener('error', onError);
    });

    return result;
  } finally {
    ws.close();
  }
}

/**
 * 验证 IP 地址格式是否合法。
 */
export function isValidIpAddress(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && String(num) === part;
  });
}

/**
 * 验证端口号是否合法。
 */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}