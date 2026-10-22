import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdbServerWebSocketConnector } from '../adb-server-connector';

class MockWebSocket {
  public url: string;
  public readyState: number = 0; // CONNECTING
  public binaryType: string = 'blob';

  private listeners: Record<string, Array<(...args: unknown[]) => void>> = {
    open: [],
    message: [],
    error: [],
    close: [],
  };

  public sentData: (Uint8Array | string)[] = [];

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  constructor(url: string, autoOpen = true) {
    this.url = url;
    if (autoOpen) {
      this.readyState = MockWebSocket.OPEN;
    }
  }

  addEventListener(event: string, handler: (...args: unknown[]) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeEventListener(event: string, handler: (...args: unknown[]) => void) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
    }
  }

  send(data: Uint8Array | ArrayBuffer | string) {
    if (data instanceof Uint8Array) {
      this.sentData.push(data);
    } else if (data instanceof ArrayBuffer) {
      this.sentData.push(new Uint8Array(data));
    } else if (typeof data === 'string') {
      this.sentData.push(data);
    }
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', { type: 'close' });
  }

  mockOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.emit('open', { type: 'open' });
  }

  mockReceiveBuffer(data: Uint8Array) {
    this.emit('message', { data: data.buffer });
  }

  mockReceiveString(str: string) {
    this.emit('message', { data: str });
  }

  mockError(errorEvent: unknown = { type: 'error' }) {
    this.emit('error', errorEvent);
  }

  mockClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', { type: 'close' });
  }

  private emit(event: string, data: unknown) {
    this.listeners[event]?.forEach((h) => h(data));
  }
}

describe('AdbServerWebSocketConnector', () => {
  let createdSockets: MockWebSocket[] = [];

  beforeEach(() => {
    createdSockets = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createConnector(options?: { host?: string; port?: number; autoOpen?: boolean }) {
    return new AdbServerWebSocketConnector({
      host: options?.host,
      port: options?.port,
      wsFactory: (url) => {
        const ws = new MockWebSocket(url, options?.autoOpen ?? true);
        createdSockets.push(ws);
        return ws as unknown as WebSocket;
      },
    });
  }

  it('使用默认配置构造并连向 ws://localhost:8080/adb', async () => {
    const connector = createConnector();
    const conn = await connector.connect();

    expect(createdSockets).toHaveLength(1);
    expect(createdSockets[0].url).toBe('ws://localhost:8080/adb');
    expect(conn.readable).toBeDefined();
    expect(conn.writable).toBeDefined();
    expect(typeof conn.close).toBe('function');
    expect(conn.closed).toBeInstanceOf(Promise);
  });

  it('支持自定义主机名与端口', async () => {
    const connector = createConnector({ host: '192.168.1.5', port: 9000 });
    await connector.connect();

    expect(createdSockets[0].url).toBe('ws://192.168.1.5:9000/adb');
  });

  it('读取流可接收来自 WebSocket 的二进制与字符串数据', async () => {
    const connector = createConnector();
    const conn = await connector.connect();
    const reader = conn.readable.getReader();

    const sample = new Uint8Array([0x4f, 0x4b, 0x41, 0x59]); // "OKAY"
    createdSockets[0].mockReceiveBuffer(sample);

    const chunk1 = await reader.read();
    expect(chunk1.value).toEqual(sample);

    createdSockets[0].mockReceiveString('0004OKAY');
    const chunk2 = await reader.read();
    expect(new TextDecoder().decode(chunk2.value)).toBe('0004OKAY');

    reader.releaseLock();
    conn.close();
  });

  it('写入流能将字节成功通过 WebSocket 发送', async () => {
    const connector = createConnector();
    const conn = await connector.connect();
    const writer = conn.writable.getWriter();

    const payload = new Uint8Array([1, 2, 3, 4]);
    await writer.write(payload);

    expect(createdSockets[0].sentData).toHaveLength(1);
    expect(createdSockets[0].sentData[0]).toEqual(payload);

    writer.releaseLock();
    conn.close();
  });

  it('WebSocket 连接建立失败时 connect() 抛出明确异常', async () => {
    const connector = createConnector({ autoOpen: false });

    const connectPromise = connector.connect();
    // 触发错误
    createdSockets[0].mockError();

    await expect(connectPromise).rejects.toThrow('无法通过 WebSocket 连接到 ADB 宿主网桥');
  });

  it('调用 conn.close() 触发底层 WebSocket 关闭并使 closed Promise 完成', async () => {
    const connector = createConnector();
    const conn = await connector.connect();

    expect(createdSockets[0].readyState).toBe(MockWebSocket.OPEN);
    conn.close();
    expect(createdSockets[0].readyState).toBe(MockWebSocket.CLOSED);
    await expect(conn.closed).resolves.toBeUndefined();
  });
});
