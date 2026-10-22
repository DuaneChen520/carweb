// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NeumorphicButton, ICON_SIZE } from '../NeumorphicButton';

describe('NeumorphicButton 人机工效与视觉规范验收', () => {
  it('触控靶区尺寸必须满足车机硬指标 (>= 48x48px)', () => {
    render(
      <NeumorphicButton ariaLabel="车机主控制按键">
        <span>Icon</span>
      </NeumorphicButton>
    );

    const button = screen.getByRole('button', { name: '车机主控制按键' });
    expect(button).toBeDefined();

    // 检查内联样式与盒模型尺寸设定
    expect(button.style.width).toBe('48px');
    expect(button.style.height).toBe('48px');
  });

  it('图标预设尺寸符合座舱次级图标标准 (20px)', () => {
    expect(ICON_SIZE).toBe(20);
  });

  it('按压交互使用 Pointer 事件且不破坏几何尺寸', () => {
    const handleClick = vi.fn();
    render(
      <NeumorphicButton ariaLabel="动态反馈按钮" onClick={handleClick} variant="dark">
        <span>Tap</span>
      </NeumorphicButton>
    );

    const button = screen.getByRole('button', { name: '动态反馈按钮' });

    // 触发 PointerDown 按压态
    fireEvent.pointerDown(button);
    // 按压状态下宽高必须维持 48px，杜绝布局跳变
    expect(button.style.width).toBe('48px');
    expect(button.style.height).toBe('48px');

    // 触发 PointerUp 释放
    fireEvent.pointerUp(button);
    expect(button.style.width).toBe('48px');
    expect(button.style.height).toBe('48px');

    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('暗色座舱变体采用冷调 Slate 背景，杜绝夜间纯黑', () => {
    render(
      <NeumorphicButton ariaLabel="暗色按钮" variant="dark">
        <span>Dark</span>
      </NeumorphicButton>
    );

    const button = screen.getByRole('button', { name: '暗色按钮' });
    // 暗色背景 Slate-800 (#1e293b)，非纯黑 #000000
    expect(button.style.background).toBe('rgb(30, 41, 59)');
  });
});
