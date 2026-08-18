import type { AdbDaemonDevice, AdbPacketData, AdbPacketInit } from '@yume-chan/adb';
import type { Consumable, ReadableWritablePair } from '@yume-chan/stream-extra';

import { createAdbDaemonConnectionFromWebSocket } from './websocket-stream';

/**
 * 通过 WebSocket 桥接代理连接到 ADB 守护进程的传输层实现。
 *
 * 与 `AdbDaemonWebUsbDevice` 接口对齐，但后端是 WebSocket ↔ TCP 桥接。
 *
 * 使用方式：
 * ```ts
 * const device = new AdbDaemonWebSocketDevice('192.168.1.100', 5555);
 * const conn = await device.connect();
 * const transport = await adbDaemonAuthenticate({ serial: device.serial, connection: conn, credentialManager });
 * const adb = new Adb(transport);
 * ```
 */
export class AdbDaemonWebSocketDevice implements AdbDaemonDevice {
  /**
   * WebSocket 桥接代理的地址。
   * 默认 localhost:8080（桥接代理运行在车机本地）。
   */
  public readonly bridgeHost: string;
  public readonly bridgePort: number;

  /**
   * 目标 ADB 设备的 IP 和端口。
   */
  public readonly targetHost: string;
  public readonly targetPort: number;

  /**
   * 可选的 WebSocket 工厂函数，用于测试注入。
   */
  public readonly wsFactory?: (url: string) => WebSocket;

  constructor(
    targetHost: string,
    targetPort: number = 5555,
    bridgeHost: string = 'localhost',
    bridgePort: number = 8080,
    wsFactory?: (url: string) => WebSocket,
  ) {
    this.targetHost = targetHost;
    this.targetPort = targetPort;
    this.bridgeHost = bridgeHost;
    this.bridgePort = bridgePort;
    this.wsFactory = wsFactory;
  }

  /**
   * 唯一标识符，格式为 `{ip}:{port}`。
   * 与 `adb connect` 的地址格式一致。
   */
  get serial(): string {
    return `${this.targetHost}:${this.targetPort}`;
  }

  /**
   * 设备可读名称。
   */
  get name(): string {
    return `WiFi-${this.targetHost}`;
  }

  /**
   * 建立与 ADB 守护进程的连接。
   *
   * 1. 通过 WebSocket 连接到本地桥接代理
   * 2. 桥接代理将流量转发到目标 ADB 设备的 TCP 端口
   * 3. 返回适配后的 ADB 数据包流
   */
  async connect(): Promise<
    ReadableWritablePair<AdbPacketData, Consumable<AdbPacketInit>>
  > {
    const url = `ws://${this.bridgeHost}:${this.bridgePort}/adb/${this.targetHost}:${this.targetPort}`;

    const ws = this.wsFactory ? this.wsFactory(url) : new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    // 等待 WebSocket 连接打开
    await new Promise<void>((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      const onOpen = () => {
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error(`WebSocket 连接失败: ${url}`));
      };

      const onClose = () => {
        cleanup();
        reject(new Error(`WebSocket 连接关闭: ${url}`));
      };

      const cleanup = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
        ws.removeEventListener('close', onClose);
      };

      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);
    });

    return createAdbDaemonConnectionFromWebSocket(ws);
  }
}