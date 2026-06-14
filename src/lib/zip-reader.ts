const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

function readU32(data: DataView, offset: number): number {
  return data.getUint32(offset, true);
}

function readU16(data: DataView, offset: number): number {
  return data.getUint16(offset, true);
}

function readString(data: DataView, offset: number, length: number): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset + offset, length);
  return new TextDecoder('latin-1').decode(bytes);
}

function findEOCD(data: DataView): number | null {
  for (let i = data.byteLength - 22; i >= 0; i--) {
    if (readU32(data, i) === EOCD_SIG) return i;
  }
  return null;
}

export function extractZipEntry(data: ArrayBuffer, targetName: string): ArrayBuffer | null {
  const view = new DataView(data);
  const eocdOffset = findEOCD(view);
  if (eocdOffset === null) return null;

  const cdOffset = readU32(view, eocdOffset + 16);
  const cdEntries = readU16(view, eocdOffset + 10);

  let entryLocalOffset = -1;
  let entryCompMethod = 0;
  let entryUncompSize = 0;

  for (let i = 0; i < cdEntries; i++) {
    const entry = cdOffset + i * 46;
    if (readU32(view, entry) !== CENTRAL_HEADER_SIG) return null;

    const nameLen = readU16(view, entry + 28);
    // skip extraLen(2) + commentLen(2) at +30,+32
    const name = readString(view, entry + 46, nameLen);

    if (name === targetName) {
      entryLocalOffset = readU32(view, entry + 42);
      entryCompMethod = readU16(view, entry + 10);
      entryUncompSize = readU32(view, entry + 24);
      break;
    }
  }

  if (entryLocalOffset < 0) return null;

  const localExtraLen = readU16(view, entryLocalOffset + 28);
  const dataStart = entryLocalOffset + 30 + localExtraLen;

  if (entryCompMethod === 0) {
    return data.slice(dataStart, dataStart + entryUncompSize);
  }

  return null;
}
