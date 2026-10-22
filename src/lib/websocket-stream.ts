import type { AdbPacketData, AdbPacketInit } from '@yume-chan/adb';
import { AdbPacket, AdbPacketHeader } from '@yume-chan/adb';
import type { Consumable, ReadableWritablePair } from '@yume-chan/stream-extra';
import { PushReadableStream, MaybeConsumable, tryClose } from '@yume-chan/stream-extra';
import { Uint8ArrayExactReadable } from '@yume-chan/struct';

/**
 * WebSocket 的二进制帧是消息边界对齐的（一个 frame = 一段完整数据）。
 * 但 TCP 转发时，一个 ADB packet 可能跨多个 WebSocket 消息，也可能多个 packet 在同一个消息中。
 * 本模块负责从 WebSocket 的二进制帧流中提取并解析完整的 ADB 数据包。
 */

const HEADER_SIZE = 24; // AdbPacketHeader 固定 24 字节

/**
 * 将 WebSocket 连接适配为 AdbDaemonConnection（ReadableWritablePair<AdbPacketData, AdbPacketInit>）。
 *
 * readable: 从 WebSocket 二进制帧中解析出的 AdbPacketData 流
 * writable: 接受 AdbPacketInit，序列化为二进制后通过 WebSocket 发送
 */
export function createAdbDaemonConnectionFromWebSocket(
  ws: WebSocket,
): ReadableWritablePair<AdbPacketData, Consumable<AdbPacketInit>> {
  const readable = new PushReadableStream<AdbPacketData>((controller) => {
    /** 累积缓冲区，用于处理跨消息的 ADB packet 边界。 */
    let buffer = new Uint8Array(0);

    const onMessage = async (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer) && !(event.data instanceof Blob)) {
        return; // 忽略非二进制消息
      }

      let chunk: Uint8Array;
      if (event.data instanceof ArrayBuffer) {
        chunk = new Uint8Array(event.data);
      } else {
        chunk = new Uint8Array(await event.data.arrayBuffer());
      }

      // 追加到缓冲区
      const newBuffer = new Uint8Array(buffer.length + chunk.length);
      newBuffer.set(buffer);
      newBuffer.set(chunk, buffer.length);
      buffer = newBuffer;

      // 尝试从缓冲区中解析完整 ADB packet
      while (buffer.length >= HEADER_SIZE) {
        const headerReader = new Uint8ArrayExactReadable(buffer);
        const header = AdbPacketHeader.deserialize(headerReader);
        const totalSize = HEADER_SIZE + header.payloadLength;

        if (buffer.length < totalSize) {
          // 数据还不够，等待更多消息
          break;
        }

        // 提取完整 ADB packet 数据
        const packetBytes = buffer.slice(0, totalSize);
        buffer = buffer.slice(totalSize);

        const packetReader = new Uint8ArrayExactReadable(packetBytes);
        const packet = AdbPacket.deserialize(packetReader);

        // 转换为 AdbPacketData（去掉 checksum 和 magic）
        const packetData: AdbPacketData = {
          command: packet.command,
          arg0: packet.arg0,
          arg1: packet.arg1,
          payload: packet.payload,
        };

        await controller.enqueue(packetData);
      }
    };

    const onError = (event: Event) => {
      controller.error(new Error(`WebSocket 错误: ${JSON.stringify(event)}`));
    };

    const onClose = () => {
      tryClose(controller);
    };

    ws.addEventListener('message', onMessage);
    ws.addEventListener('error', onError);
    ws.addEventListener('close', onClose);

    // 如果 WebSocket 已经关闭，立即结束
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      tryClose(controller);
    }
  });

  const writable = new MaybeConsumable.WritableStream<AdbPacketInit>({
    write: async (packetInit) => {
      if (ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket 未连接');
      }

      const bytes = AdbPacket.serialize(packetInit);
      ws.send(bytes);
    },
    close: () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    },
    abort: () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    },
  });

  return { readable, writable };
}