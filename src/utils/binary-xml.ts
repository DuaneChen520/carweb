const ANDROID_NAMESPACE_URI = 'http://schemas.android.com/apk/res/android';

const CHUNK_STRING_POOL = 0x0001;
const CHUNK_XML_START_NAMESPACE = 0x0100;
const CHUNK_XML_END_NAMESPACE = 0x0101;
const CHUNK_XML_START_TAG = 0x0102;
const CHUNK_XML_END_TAG = 0x0103;

const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;

interface StringPool {
  strings: string[];
  isUtf8: boolean;
}

function readStringPool(data: DataView, offset: number): StringPool {
  const chunkSize = data.getUint32(offset + 4, true);
  const stringCount = data.getUint32(offset + 8, true);
  const styleCount = data.getUint32(offset + 12, true);
  const flags = data.getUint32(offset + 16, true);
  const stringsStart = data.getUint32(offset + 20, true);
  const stylesStart = data.getUint32(offset + 24, true);
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
      const lenByte = data.getUint16(pos, true);
      let strLen: number;
      let dataOffset: number;
      if ((lenByte & 0x8000) !== 0) {
        strLen = ((lenByte & 0x7fff) << 16) | data.getUint16(pos + 2, true);
        dataOffset = 4;
      } else {
        strLen = lenByte;
        dataOffset = 2;
      }
      const nullTermPos = pos + dataOffset;
      let end = nullTermPos;
      while (end + 1 < data.byteLength && (data.getUint16(end, true) !== 0)) end += 2;
      const raw = new Uint16Array(data.buffer, data.byteOffset + nullTermPos, (end - nullTermPos) / 2);
      strings.push(String.fromCharCode(...raw));
    }
  }

  return { strings, isUtf8 };
}

interface AXMLAttribute {
  namespace: string | null;
  name: string;
  valueString: string | null;
  valueType: number;
  valueData: number;
}

interface AXMLStartTag {
  type: 'start';
  namespace: string | null;
  name: string;
  attributes: AXMLAttribute[];
}

interface AXMLStartNamespace {
  type: 'namespace';
  prefix: string;
  uri: string;
}

type AXMLNode = AXMLStartNamespace | AXMLStartTag;

export interface ParsedManifest {
  label: { isString: true; value: string } | { isString: false; value: number } | null;
  icon: number | null;
}

export function parseAndroidManifest(buffer: ArrayBuffer): ParsedManifest {
  const data = new DataView(buffer);
  const magic = data.getUint32(0, true);
  if (magic !== 0x00080003) {
    console.error('[parseAXML] Invalid magic:', magic.toString(16));
    return { label: null, icon: null };
  }

  let stringPool: StringPool | null = null;
  let offset = 8;

  const namespaceMap = new Map<number, string>();

  while (offset < data.byteLength - 7) {
    const chunkType = data.getUint16(offset, true);
    const chunkSize = data.getUint32(offset + 4, true);
    if (chunkSize === 0) break;

    if (chunkType === CHUNK_STRING_POOL) {
      stringPool = readStringPool(data, offset);
    } else if (chunkType === CHUNK_XML_START_NAMESPACE && stringPool) {
      const prefixIdx = data.getInt32(offset + 16, true);
      const uriIdx = data.getInt32(offset + 20, true);
      if (prefixIdx >= 0 && prefixIdx < stringPool.strings.length &&
          uriIdx >= 0 && uriIdx < stringPool.strings.length) {
        namespaceMap.set(uriIdx, stringPool.strings[uriIdx]!);
      }
    } else if (chunkType === CHUNK_XML_START_TAG && stringPool) {
      const nsIdx = data.getInt32(offset + 12, true);
      const nameIdx = data.getInt32(offset + 16, true);
      const attrCount = data.getUint16(offset + 20, true);

      const tagNamespace = nsIdx >= 0 && nsIdx < stringPool.strings.length ? stringPool.strings[nsIdx] : null;
      const tagName = nameIdx >= 0 && nameIdx < stringPool.strings.length ? stringPool.strings[nameIdx] : '';

      if (tagName === 'application') {
        let label: ParsedManifest['label'] = null;
        let icon: number | null = null;

        let attrOffset = offset + 28;
        for (let i = 0; i < attrCount; i++) {
          const attrNsIdx = data.getInt32(attrOffset, true);
          const attrNameIdx = data.getInt32(attrOffset + 4, true);
          const attrValueStrIdx = data.getInt32(attrOffset + 8, true);
          const attrType = data.getUint8(attrOffset + 16);
          const attrData = data.getUint16(attrOffset + 18, true);

          const attrName = attrNameIdx >= 0 && attrNameIdx < stringPool.strings.length
            ? stringPool.strings[attrNameIdx] : '';

          const attrNs = attrNsIdx >= 0 && attrNsIdx < stringPool.strings.length
            ? stringPool.strings[attrNsIdx] : null;

          const isAndroid = attrNs === ANDROID_NAMESPACE_URI ||
            (attrNs === null && namespaceMap.get(attrNsIdx) === ANDROID_NAMESPACE_URI);

          if (!isAndroid) {
            attrOffset += 24;
            continue;
          }

          if (attrName === 'label') {
            if (attrType === TYPE_STRING) {
              const strValue = attrValueStrIdx >= 0 && attrValueStrIdx < stringPool.strings.length
                ? stringPool.strings[attrValueStrIdx]
                : null;
              if (strValue) {
                label = { isString: true, value: strValue };
              }
            } else if (attrType === TYPE_REFERENCE) {
              label = { isString: false, value: attrData };
            }
          } else if (attrName === 'icon') {
            if (attrType === TYPE_REFERENCE) {
              icon = attrData;
            }
          }

          attrOffset += 24;
        }

        return { label, icon };
      }
    }

    offset += chunkSize;
  }

  return { label: null, icon: null };
}