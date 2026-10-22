// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NowPlayingCard } from '../NowPlayingCard';
import type { MediaInfo } from '@/lib/media-session-parser';

describe('NowPlayingCard 车机工效与视觉 Tokens 规范验收', () => {
  const dummyMedia: MediaInfo = {
    packageName: 'com.example.music',
    title: '夜曲',
    artist: '周杰伦',
    album: '十一月的萧邦',
    state: 'playing',
    position: 65000,
    duration: 210000,
  };

  it('控制按钮尺寸全部满足车机 48x48px 物理下限', () => {
    const handleControl = vi.fn();
    const handleLaunch = vi.fn();
    const getAppIcon = vi.fn().mockResolvedValue(null);

    render(
      <NowPlayingCard
        media={dummyMedia}
        estimatedPosition={65000}
        onControl={handleControl}
        onLaunchApp={handleLaunch}
        getAppIcon={getAppIcon}
      />
    );

    const prevBtn = screen.getByTitle('上一首');
    const playPauseBtn = screen.getByTitle('暂停');
    const nextBtn = screen.getByTitle('下一首');

    expect(prevBtn.className).toContain('w-12');
    expect(prevBtn.className).toContain('h-12');
    expect(playPauseBtn.className).toContain('w-12');
    expect(playPauseBtn.className).toContain('h-12');
    expect(nextBtn.className).toContain('w-12');
    expect(nextBtn.className).toContain('h-12');

    // 按钮交互
    fireEvent.click(prevBtn);
    expect(handleControl).toHaveBeenCalledWith('previous');

    fireEvent.click(playPauseBtn);
    expect(handleControl).toHaveBeenCalledWith('play-pause');

    fireEvent.click(nextBtn);
    expect(handleControl).toHaveBeenCalledWith('next');
  });

  it('进度条时间戳必须使用 >= 12px 字体 (text-xs)，杜绝 text-[10px]', () => {
    const getAppIcon = vi.fn().mockResolvedValue(null);
    const { container } = render(
      <NowPlayingCard
        media={dummyMedia}
        estimatedPosition={65000}
        onControl={vi.fn()}
        onLaunchApp={vi.fn()}
        getAppIcon={getAppIcon}
      />
    );

    // 严格断言整张卡片中不存在任何 text-[10px]
    expect(container.innerHTML).not.toContain('text-[10px]');
    expect(container.innerHTML).toContain('text-xs');
  });

  it('卡片容器严格使用 surface 语义 Token 与圆角材质', () => {
    const getAppIcon = vi.fn().mockResolvedValue(null);
    const { container } = render(
      <NowPlayingCard
        media={dummyMedia}
        estimatedPosition={65000}
        onControl={vi.fn()}
        onLaunchApp={vi.fn()}
        getAppIcon={getAppIcon}
      />
    );

    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('bg-surface-card');
    expect(card.className).toContain('border-surface-elevated');
  });
});
