/**
 * 序列化 scrcpy 4.0 RESIZE_DISPLAY 控制消息。
 * 格式：[type:1] [width:u16 BE] [height:u16 BE] = 5 字节。
 *
 * @param typeByte RESIZE_DISPLAY 的线上 type 字节值，
 *   由 controlMessageTypes.indexOf(ResizeDisplay) 决定（4.0 为 18）。
 */
export function serializeResizeDisplay(
  typeByte: number,
  width: number,
  height: number,
): Uint8Array {
  const buf = new Uint8Array(5);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  dv.setUint8(0, typeByte);
  dv.setUint16(1, width, false);  // false = big-endian
  dv.setUint16(3, height, false);
  return buf;
}
