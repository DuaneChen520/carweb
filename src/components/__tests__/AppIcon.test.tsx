// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppIcon } from '../AppIcon';

describe('AppIcon 车机工效与视觉 Tokens 规范验收', () => {
  it('compact 模式（侧栏 Dock）必须具备 48x48px 物理触控靶区', () => {
    const handleLaunch = vi.fn();
    const getAppIcon = vi.fn().mockResolvedValue(null);

    render(
      <AppIcon
        pkg="com.autonavi.amapauto"
        name="高德地图车机版"
        getAppIcon={getAppIcon}
        onLaunch={handleLaunch}
        compact
      />
    );

    const button = screen.getByRole('button', { name: '高德地图车机版' });
    expect(button.className).toContain('w-12');
    expect(button.className).toContain('h-12');

    fireEvent.click(button);
    expect(handleLaunch).toHaveBeenCalledWith('com.autonavi.amapauto');
  });

  it('非 compact 模式下应用标题字号 >= 12px (text-xs)，杜绝 text-[10px]', () => {
    const getAppIcon = vi.fn().mockResolvedValue(null);
    const { container } = render(
      <AppIcon
        pkg="com.autonavi.amapauto"
        name="高德地图车机版"
        getAppIcon={getAppIcon}
        onLaunch={vi.fn()}
      />
    );

    expect(container.innerHTML).not.toContain('text-[10px]');
    expect(container.innerHTML).toContain('text-xs');
  });
});
