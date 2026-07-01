export interface MediaInfo {
  packageName: string;
  title: string;
  artist: string;
  album: string;
  duration: number;   // ms
  position: number;   // ms
  state: 'playing' | 'paused' | 'other';
}

/**
 * 解析 `dumpsys media_session` 输出，返回第一个带 MediaMetadata 的活跃 session。
 *
 * 解析策略（基于可行性调研，不依赖行号/字段顺序）：
 * 1. 按 `package=` 行切分 session 块
 * 2. 取第一个同时含 MediaMetadata{} 的块
 * 3. 块内用宽松正则提取字段
 *
 * 字符串值可能带引号也可能不带，统一去引号。缺失字段置空串/0。
 * state: 3=playing, 2=paused, 其余归 other。
 */
export function parseMediaSessionOutput(output: string): MediaInfo | null {
  if (!output || output.trim().length === 0) return null;

  // 按 package= 切块（每块含该 session 的 PlaybackState + MediaMetadata）
  const packagePattern = /package=([^\s]+)/g;
  const matches: Array<{ pkg: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = packagePattern.exec(output)) !== null) {
    matches.push({ pkg: m[1]!, index: m.index });
  }

  if (matches.length === 0) return null;

  // 为每个 session 切出文本块（到下一个 package 行或结尾）
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!.index;
    const end = i + 1 < matches.length ? matches[i + 1]!.index : output.length;
    const block = output.slice(start, end);

    // 必须含 MediaMetadata 才算可用的播放 session
    if (!/MediaMetadata\s*\{/.test(block)) continue;

    return {
      packageName: matches[i]!.pkg,
      title: extractString(block, 'title'),
      artist: extractString(block, 'artist'),
      album: extractString(block, 'album'),
      duration: extractNumber(block, 'duration'),
      position: extractNumber(block, 'position'),
      state: extractState(block),
    };
  }

  return null;
}

/** 提取字符串字段，支持带引号和不带引号两种格式：title=晴天 或 title="晴天" */
function extractString(block: string, key: string): string {
  // 先尝试带引号：key="value"
  const quoted = new RegExp(`${key}="([^"]*)"`);
  const qm = block.match(quoted);
  if (qm) return qm[1]!;

  // 再尝试不带引号：key=value（值到逗号或 } 结束，允许含空格）
  const unquoted = new RegExp(`${key}=([^,}]+)`);
  const um = block.match(unquoted);
  if (um) return um[1]!;
  return '';
}

function extractNumber(block: string, key: string): number {
  const re = new RegExp(`${key}=(\\d+)`);
  const mm = block.match(re);
  return mm ? parseInt(mm[1]!, 10) : 0;
}

function extractState(block: string): MediaInfo['state'] {
  const m = block.match(/state=(\d+)/);
  if (!m) return 'other';
  const code = parseInt(m[1]!, 10);
  if (code === 3) return 'playing';
  if (code === 2) return 'paused';
  return 'other';
}
