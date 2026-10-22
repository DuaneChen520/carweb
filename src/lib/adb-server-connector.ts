import type { Adb, AdbServerClient } from '@yume-chan/adb';
import { PushReadableStream, MaybeConsumable, tryClose } from '@yume-chan/stream-extra';

export interface AdbServerConnectorOptions {
  /** 宿主网桥主机名，默认 'localhost' */
  host?: string;
  /** 宿主网桥端口，默认 8080 */
  port?: number;
  /** 可选注入的 WebSocket 工厂函数（用于测试或自定义网络环境） */
  wsFactory?: (url: string) => WebSocket;
}

/**
 * 将车机本地 WebSocket 网桥（/adb）适配为 @yume-chan/adb 标准的 AdbServerClient.ServerConnector。
 *
 * 底层通过 WebSocket 连入宿主网桥，网桥将双向字节流无损透传给本地运行的官方 ADB 服务端（127.0.0.1:5037）。
 */
export class AdbServerWebSocketConnector implements AdbServerClient.ServerConnector {
  public readonly host: string;
  public readonly port: number;
  private readonly wsFactory: (url: string) => WebSocket;

  constructor(options?: AdbServerConnectorOptions) {
    this.host = options?.host ?? 'localhost';
    this.port = options?.port ?? 8080;
    this.wsFactory = options?.wsFactory ?? ((url: string) => new WebSocket(url));
  }

  /**
   * 与 ADB 宿主网桥建立全双工字节流连接。
   */
  async connect(_options?: AdbServerClient.ServerConnectionOptions): Promise<AdbServerClient.ServerConnection> {
    const url = `ws://${this.host}:${this.port}/adb`;
    const ws = this.wsFactory(url);
    ws.binaryType = 'arraybuffer';

    let closedResolve!: (value: undefined) => void;
    const closedPromise = new Promise<undefined>((resolve) => {
      closedResolve = resolve;
    });

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
        reject(new Error(`无法通过 WebSocket 连接到 ADB 宿主网桥: ${url}`));
      };

      const onClose = () => {
        cleanup();
        reject(new Error(`WebSocket 连接已过早关闭: ${url}`));
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

    const readable = new PushReadableStream<Uint8Array>((controller) => {
      const onMessage = async (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          await controller.enqueue(new Uint8Array(event.data));
        } else if (event.data instanceof Blob) {
          const ab = await event.data.arrayBuffer();
          await controller.enqueue(new Uint8Array(ab));
        } else if (typeof event.data === 'string') {
          await controller.enqueue(new TextEncoder().encode(event.data));
        }
      };

      const onError = (e: Event) => {
        controller.error(new Error(`WebSocket 链路发生错误: ${JSON.stringify(e)}`));
      };

      const onClose = () => {
        tryClose(controller);
        closedResolve(undefined);
      };

      ws.addEventListener('message', onMessage);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);

      if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        tryClose(controller);
        closedResolve(undefined);
      }
    });

    const writable = new MaybeConsumable.WritableStream<Uint8Array>({
      write: async (chunk) => {
        if (ws.readyState !== WebSocket.OPEN) {
          throw new Error('WebSocket 已断开，无法向 ADB 宿主发送数据');
        }
        ws.send(chunk);
      },
      close: () => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        closedResolve(undefined);
      },
      abort: () => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        closedResolve(undefined);
      },
    });

    return {
      readable,
      writable,
      close: () => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        closedResolve(undefined);
      },
      get closed() {
        return closedPromise;
      },
    };
  }

  addReverseTunnel(_handler: Adb.IncomingSocketHandler, _address?: string): Promise<string> {
    throw new Error('ADB Server 连接器暂不支持反向隧道');
  }

  removeReverseTunnel(_address: string): Promise<void> {
    return Promise.resolve();
  }

  clearReverseTunnels(): Promise<void> {
    return Promise.resolve();
  }
}
