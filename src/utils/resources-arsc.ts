const CHUNK_RES_TABLE = 0x0002;
const CHUNK_RES_TABLE_PACKAGE = 0x0200;
const CHUNK_RES_TABLE_TYPE_SPEC = 0x0202;
const CHUNK_RES_TABLE_TYPE = 0x0201;
const CHUNK_STRING_POOL = 0x0001;

const VALUE_TYPE_STRING = 0x03;

function readArscStringPool(data: DataView, offset: number): string[] {
  const stringCount = data.getUint32(offset + 8, true);
  const styleCount = data.getUint32(offset + 12, true);
  const flags = data.getUint32(offset + 16, true);
  const stringsStart = data.getUint32(offset + 20, true);
  const isUtf8 = (flags & 0x0100) !== 0;

  const stringOffsets: number[] = [];
  for (let i = 0; i < stringCount; i++) {
    stringOffsets.push(data.getUint32(offset + 28 + i * 4, true));
  }

  const strings: string[] = [];
  const stringDataBase = offset + stringsStart;

  for (let i = 0; i < stringCount; i++) {
    const strOffset = stringOffsets[i]!;
    const pos = stringDataBase + strOffset;

    if (isUtf8) {
      let readPos = pos;
      let charCount = data.getUint8(readPos);
      let charCountBytes = 1;
      if ((charCount & 0x80) !== 0) {
        charCount = ((charCount & 0x7f) << 8) | data.getUint8(readPos + 1);
        charCountBytes = 2;
      }
      readPos += charCountBytes;

      let byteCount = data.getUint8(readPos);
      let byteCountBytes = 1;
      if ((byteCount & 0x80) !== 0) {
        byteCount = ((byteCount & 0x7f) << 8) | data.getUint8(readPos + 1);
        byteCountBytes = 2;
      }
      readPos += byteCountBytes;

      let end = readPos;
      while (end < data.byteLength && data.getUint8(end) !== 0) end++;
      const raw = new Uint8Array(data.buffer, data.byteOffset + readPos, end - readPos);
      strings.push(new TextDecoder('utf-8').decode(raw));
    } else {
      let lenByte = data.getUint16(pos, true);
      let dataOffset: number;
      if ((lenByte & 0x8000) !== 0) {
        lenByte = ((lenByte & 0x7fff) << 16) | data.getUint16(pos + 2, true);
        dataOffset = 4;
      } else {
        dataOffset = 2;
      }
      const nullTermPos = pos + dataOffset;
      let end = nullTermPos;
      while (end + 1 < data.byteLength && data.getUint16(end, true) !== 0) end += 2;
      const raw = new Uint16Array(data.buffer, data.byteOffset + nullTermPos, (end - nullTermPos) / 2);
      strings.push(String.fromCharCode(...raw));
    }
  }

  return strings;
}

export function resolveStringResource(arscBuffer: ArrayBuffer, resourceId: number): string | null {
  const data = new DataView(arscBuffer);
  const magic = data.getUint16(0, true);
  if (magic !== CHUNK_RES_TABLE) {
    return null;
  }

  let globalStrings: string[] | null = null;

  let offset = 12;

  while (offset < data.byteLength - 11) {
    const chunkType = data.getUint16(offset, true);
    const chunkSize = data.getUint32(offset + 4, true);
    if (chunkSize < 12) break;

    if (chunkType === CHUNK_STRING_POOL) {
      if (!globalStrings) {
        globalStrings = readArscStringPool(data, offset);
      }
      offset += chunkSize;
      continue;
    }

    if (chunkType !== CHUNK_RES_TABLE_PACKAGE) {
      offset += chunkSize;
      continue;
    }

    const packageId = data.getUint32(offset + 8, true);
    const targetPackageId = (resourceId >> 24) & 0xff;

    if (packageId !== targetPackageId) {
      offset += chunkSize;
      continue;
    }

    const targetTypeId = (resourceId >> 16) & 0xff;
    const targetEntryIndex = resourceId & 0xffff;

    let packageOffset = offset + 12 + 256;
    const packageEnd = offset + chunkSize;

    while (packageOffset < packageEnd - 11) {
      const innerType = data.getUint16(packageOffset, true);
      const innerSize = data.getUint32(packageOffset + 4, true);
      if (innerSize < 12) break;

      if (innerType === CHUNK_STRING_POOL) {
        packageOffset += innerSize;
        continue;
      }

      if (innerType === CHUNK_RES_TABLE_TYPE_SPEC) {
        packageOffset += innerSize;
        continue;
      }

      if (innerType === CHUNK_RES_TABLE_TYPE) {
        const typeId = data.getUint8(packageOffset + 8);
        const entryCount = data.getUint32(packageOffset + 12, true);
        const entriesStart = data.getUint32(packageOffset + 16, true);

        if (typeId === targetTypeId && targetEntryIndex < entryCount) {
          const entriesOffsetBase = packageOffset + 28;
          const entryOffset = data.getUint32(entriesOffsetBase + targetEntryIndex * 4, true);

          if (entryOffset !== 0xFFFFFFFF) {
            const entryPos = packageOffset + entriesStart + entryOffset;

            const entrySize = data.getUint16(entryPos, true);
            const valueStart = entryPos + entrySize;

            const valueType = data.getUint8(valueStart + 3);
            const valueData = data.getUint32(valueStart + 4, true);

            if (valueType === VALUE_TYPE_STRING && globalStrings) {
              const strIndex = valueData;
              if (strIndex >= 0 && strIndex < globalStrings.length) {
                return globalStrings[strIndex]!;
              }
            }
          }
        }

        packageOffset += innerSize;
        continue;
      }

      packageOffset += innerSize;
    }

    offset += chunkSize;
  }

  return null;
}