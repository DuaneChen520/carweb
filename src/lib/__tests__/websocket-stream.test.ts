import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdbCommand, AdbPacket, AdbPacketHeader } from '@yume-chan/adb';
import { Consumable } from '@yume-chan/stream-extra';
import { createAdbDaemonConnectionFromWebSocket } from '../websocket-stream';

// 模拟的 Event 对象（Node.js 没有 DOM Event）
class MockEvent {
  type: string;
  constructor(type: string) {
    this.type = type;
  }
}

// 模拟 WebSocket 实现
class MockWebSocket {
  public url: string;
  public readyState: number = 0; // CONNECTING
  public binaryType: string = 'blob';

  private listeners: Record<string, Array<(...args: any[]) => void>> = {
    open: [],
    message: [],
    error: [],
    close: [],
  };

  // 用于测试发送数据
  public sentData: Uint8Array[] = [];

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  constructor(url: string) {
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
  }

  addEventListener(event: string, handler: (...args: any[]) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeEventListener(event: string, handler: (...args: any[]) => void) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(h => h !== handler);
    }
  }

  send(data: ArrayBuffer | ArrayBufferView | Blob | string) {
    if (data instanceof ArrayBuffer) {
      this.sentData.push(new Uint8Array(data));
    } else if (ArrayBuffer.isView(data)) {
      this.sentData.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    }
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', { type: 'close' });
  }

  // 测试辅助方法：模拟收到消息
  mockReceiveMessage(data: Uint8Array) {
    this.emit('message', { data: data.buffer });
  }

  // 测试辅助方法：模拟收到 Blob 消息
  mockReceiveBlob(data: Uint8Array) {
    this.emit('message', { data: new MockBlob(data) });
  }

  private emit(event: string, data: any) {
    this.listeners[event]?.forEach(h => h(data));
  }
}

// 模拟 Blob（Node.js 没有 Blob）
class MockBlob {
  private data: Uint8Array;
  constructor(data: Uint8Array) {
    this.data = data;
  }
  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.data.buffer;
  }
}

describe('createAdbDaemonConnectionFromWebSocket', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('返回 readable 和 writable 流', async () => {
    const ws = new MockWebSocket('ws://localhost:8080/test') as any;
    const conn = createAdbDaemonConnectionFromWebSocket(ws);

    expect(conn.readable).toBeDefined();
    expect(conn.writable).toBeDefined();
  });

  it('从 WebSocket 消息中解析 ADB 数据包', async () => {
    const ws = new MockWebSocket('ws://localhost:8080/test') as any;
    const conn = createAdbDaemonConnectionFromWebSocket(ws);

    // 先获取 reader（确保 PushReadableStream 的 controller 已激活）
    const reader = conn.readable.getReader();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 构造一个 ADB CNXN 数据包
    const packetInit = {
      command: AdbCommand.Connect,
      arg0: 0x01000001,
      arg1: 32 * 1024 * 1024,
      payloadLength: 0,
      checksum: 0,
      magic: 0,
      payload: new Uint8Array(0),
    };
    const packetBytes = AdbPacket.serialize(packetInit);

    // 模拟收到消息
    (ws as any).mockReceiveMessage(packetBytes);

    const result = await reader.read();

    expect(result.value).toBeDefined();
    expect(result.value!.command).toBe(AdbCommand.Connect);
    expect(result.value!.arg0).toBe(0x01000001);
    expect(result.value!.arg1).toBe(32 * 1024 * 1024);
  });

  it('跨消息边界累积并解析 ADB 包', async () => {
    const ws = new MockWebSocket('ws://localhost:8080/test') as any;
    const conn = createAdbDaemonConnectionFromWebSocket(ws);

    // 先获取 reader（确保 PushReadableStream 的 controller 已激活）
    const reader = conn.readable.getReader();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 构造一个带 payload 的 ADB 包
    const payload = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    const packetInit = {
      command: AdbCommand.Open,
      arg0: 1,
      arg1: 0,
      payloadLength: payload.length,
      checksum: payload.reduce((a, b) => a + b, 0),
      magic: AdbCommand.Open ^ 0xffffffff,
      payload,
    };
    const packetBytes = AdbPacket.serialize(packetInit);

    // 分两次发送：先发送头部，再发送 payload
    const header = packetBytes.slice(0, 24);
    const body = packetBytes.slice(24);

    (ws as any).mockReceiveMessage(header);
    await new Promise((resolve) => setTimeout(resolve, 5));
    (ws as any).mockReceiveMessage(body);

    const result = await reader.read();

    expect(result.value).toBeDefined();
    expect(result.value!.command).toBe(AdbCommand.Open);
    expect(result.value!.arg0).toBe(1);
    expect(new Uint8Array(result.value!.payload)).toEqual(payload);
  });

  it('多个 ADB 包在同一个消息中', async () => {
    const ws = new MockWebSocket('ws://localhost:8080/test') as any;
    const conn = createAdbDaemonConnectionFromWebSocket(ws);

    // 先获取 reader（确保 PushReadableStream 的 controller 已激活）
    const reader = conn.readable.getReader();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 构造两个包
    const packet1 = {
      command: AdbCommand.Connect,
      arg0: 1,
      arg1: 1,
      payloadLength: 0,
      checksum: 0,
      magic: 0,
      payload: new Uint8Array(0),
    };
    const packet2 = {
      command: AdbCommand.Okay,
      arg0: 2,
      arg1: 2,
      payloadLength: 0,
      checksum: 0,
      magic: 0,
      payload: new Uint8Array(0),
    };

    const bytes1 = AdbPacket.serialize(packet1);
    const bytes2 = AdbPacket.serialize(packet2);

    // 合并到一个消息中发送
    const combined = new Uint8Array(bytes1.length + bytes2.length);
    combined.set(bytes1);
    combined.set(bytes2, bytes1.length);

    (ws as any).mockReceiveMessage(combined);

    const result1 = await reader.read();
    const result2 = await reader.read();

    expect(result1.value!.command).toBe(AdbCommand.Connect);
    expect(result2.value!.command).toBe(AdbCommand.Okay);
  });

  it('writable 流发送 AdbPacketInit 数据', async () => {
    const ws = new MockWebSocket('ws://localhost:8080/test') as any;
    const conn = createAdbDaemonConnectionFromWebSocket(ws);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const writer = conn.writable.getWriter();
    await writer.write(new Consumable({
      command: AdbCommand.Open,
      arg0: 1,
      arg1: 2,
      payloadLength: 0,
      checksum: 0,
      magic: 0,
      payload: new Uint8Array(0),
    }));

    expect(ws.sentData.length).toBeGreaterThan(0);
    // 验证发送的数据是可解析的 ADB 包
    const sentPacket = AdbPacket.deserialize(new Uint8ArrayExactReadable(ws.sentData[0]));
    expect(sentPacket.command).toBe(AdbCommand.Open);
    expect(sentPacket.arg0).toBe(1);
    expect(sentPacket.arg1).toBe(2);
  });
});

// 需要导入 ExactReadable
import { Uint8ArrayExactReadable } from '@yume-chan/struct';