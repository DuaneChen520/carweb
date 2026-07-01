import { describe, it, expect } from 'vitest';
import { parseMediaSessionOutput, type MediaInfo } from '../media-session-parser';

// 完整播放中 session
const PLAYING_OUTPUT = `
MediaSessionService (dump)

Sessions: #1 active
  package=com.netease.cloudmusic userId=0
  tag=CloudMusic
  PlaybackState {state=3, position=145320, buffered position=145320,
                 speed=1.0, updated=..., actions=..., error code=0}
  MediaMetadata {title=晴天, artist=周杰伦, album=叶惠美,
                 duration=269000, track number=5}
`;

// 暂停状态
const PAUSED_OUTPUT = `
MediaSessionService (dump)

Sessions: #1 active
  package=com.spotify.music userId=0
  tag=Spotify
  PlaybackState {state=2, position=30000, buffered position=30000, speed=0.0}
  MediaMetadata {title="Hotel California", artist="Eagles", album="Hell Freezes Over", duration=390000}
`;

// 多 session 并存
const MULTI_SESSION_OUTPUT = `
MediaSessionService (dump)

Sessions: #2 active
  package=com.android.systemui userId=0
  PlaybackState {state=1, position=0, buffered position=0, speed=0.0}

  package=com.netease.cloudmusic userId=0
  PlaybackState {state=3, position=10000, buffered position=10000, speed=1.0}
  MediaMetadata {title=七里香, artist=周杰伦, album=七里香, duration=299000}
`;

// metadata 部分缺失（无 album）
const PARTIAL_METADATA = `
Sessions: #1 active
  package=com.example.player userId=0
  PlaybackState {state=3, position=0, buffered position=0, speed=1.0}
  MediaMetadata {title=Some Song, artist=Some Artist, duration=180000}
`;

// 字段顺序与引号变体
const VARIANT_ORDER = `
Sessions: #1 active
  package=com.app.music userId=0
  MediaMetadata {duration=200000, title="带引号的歌", artist="A & B", album="精选"}
  PlaybackState {state=2, position=5000, speed=0.0}
`;

// 无活跃 session
const NO_SESSION = `
MediaSessionService (dump)

Sessions: #0 active
`;

describe('parseMediaSessionOutput', () => {
  it('parses playing session with unquoted values', () => {
    const result = parseMediaSessionOutput(PLAYING_OUTPUT);
    expect(result).toEqual<MediaInfo>({
      packageName: 'com.netease.cloudmusic',
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      duration: 269000,
      position: 145320,
      state: 'playing',
    });
  });

  it('parses paused session with quoted values', () => {
    const result = parseMediaSessionOutput(PAUSED_OUTPUT);
    expect(result).toEqual<MediaInfo>({
      packageName: 'com.spotify.music',
      title: 'Hotel California',
      artist: 'Eagles',
      album: 'Hell Freezes Over',
      duration: 390000,
      position: 30000,
      state: 'paused',
    });
  });

  it('returns first session with MediaMetadata among multiple', () => {
    const result = parseMediaSessionOutput(MULTI_SESSION_OUTPUT);
    expect(result).not.toBeNull();
    expect(result!.packageName).toBe('com.netease.cloudmusic');
    expect(result!.title).toBe('七里香');
  });

  it('handles missing album as empty string', () => {
    const result = parseMediaSessionOutput(PARTIAL_METADATA);
    expect(result).toEqual<MediaInfo>({
      packageName: 'com.example.player',
      title: 'Some Song',
      artist: 'Some Artist',
      album: '',
      duration: 180000,
      position: 0,
      state: 'playing',
    });
  });

  it('parses regardless of field order and quoted strings', () => {
    const result = parseMediaSessionOutput(VARIANT_ORDER);
    expect(result).toEqual<MediaInfo>({
      packageName: 'com.app.music',
      title: '带引号的歌',
      artist: 'A & B',
      album: '精选',
      duration: 200000,
      position: 5000,
      state: 'paused',
    });
  });

  it('returns null when no active session', () => {
    expect(parseMediaSessionOutput(NO_SESSION)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseMediaSessionOutput('')).toBeNull();
  });

  it('returns null when session has no MediaMetadata block', () => {
    const onlyPlayback = `
Sessions: #1 active
  package=com.no.meta userId=0
  PlaybackState {state=3, position=100, speed=1.0}
`;
    expect(parseMediaSessionOutput(onlyPlayback)).toBeNull();
  });

  it('treats state=4 (fast-forward) as other', () => {
    const ff = `
Sessions: #1 active
  package=com.app userId=0
  PlaybackState {state=4, position=100, speed=2.0}
  MediaMetadata {title=X, artist=Y, album=Z, duration=1000}
`;
    const result = parseMediaSessionOutput(ff);
    expect(result!.state).toBe('other');
  });
});
