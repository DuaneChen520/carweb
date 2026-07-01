/**
 * Flex display 反抖动状态机。
 *
 * 三道防线避免 resize 环路：
 * 1. 结构性隔离（主防线）：onContainerResize 由 CSS 变化驱动，
 *    onSessionPacket 只改 canvas backing store（setCanvasSize），不改 CSS → 无环路。
 * 2. pendingResize squash：未确认前新请求覆盖旧请求。
 * 3. clientResized 标志：仅 clientResized=true 的 session 包清除 pending。
 */

export interface FlexDisplayClientOptions {
  /** 发送 RESIZE_DISPLAY 控制消息（由调用方包装 writer.write）。 */
  sendResize: (width: number, height: number) => Promise<void>;
  /** 设置 canvas backing store 尺寸（canvas.width/height，非 CSS）。 */
  setCanvasSize: (width: number, height: number) => void;
  /** 防抖时间，默认 150ms。 */
  debounceMs?: number;
}

export class FlexDisplayClient {
  private currentDisplaySize: { w: number; h: number } | null = null;
  private pendingResize: { w: number; h: number } | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly sendResize: (w: number, h: number) => Promise<void>;
  private readonly setCanvasSize: (w: number, h: number) => void;

  constructor(opts: FlexDisplayClientOptions) {
    this.sendResize = opts.sendResize;
    this.setCanvasSize = opts.setCanvasSize;
    this.debounceMs = opts.debounceMs ?? 150;
  }

  /** 设置初始虚拟屏尺寸（来自 startScrcpy 的 displayConfig）。 */
  setInitialDisplaySize(w: number, h: number): void {
    this.currentDisplaySize = { w, h };
  }

  /** ResizeObserver 回调（CSS 尺寸变化）。 */
  onContainerResize(cssW: number, cssH: number, scale: number, dpr: number): void {
    const target = {
      w: Math.round(cssW * scale * dpr),
      h: Math.round(cssH * scale * dpr),
    };
    // 尺寸已匹配且无 pending → 不发
    if (
      this.pendingResize === null &&
      this.currentDisplaySize !== null &&
      this.currentDisplaySize.w === target.w &&
      this.currentDisplaySize.h === target.h
    ) {
      return;
    }

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.requestResize(target);
    }, this.debounceMs);
  }

  private requestResize(target: { w: number; h: number }): void {
    // squash：只保留最新请求
    this.pendingResize = target;
    this.sendResize(target.w, target.h).catch((e) => {
      console.warn('[FlexClient] RESIZE_DISPLAY 发送失败:', e);
    });
  }

  /** demuxer 解出 session 包时调用。 */
  onSessionPacket(w: number, h: number, clientResized: boolean): void {
    this.currentDisplaySize = { w, h };
    // 通知 canvas backing store 更新
    this.setCanvasSize(w, h);

    if (clientResized) {
      // 客户端请求的 resize 被确认，清除 pending
      if (
        this.pendingResize !== null &&
        this.pendingResize.w === w &&
        this.pendingResize.h === h
      ) {
        this.pendingResize = null;
      }
    } else {
      // 独立变化（如 App 自旋转），不清除 pending；若 pending 仍在，重发以校正
      if (this.pendingResize !== null) {
        this.sendResize(this.pendingResize.w, this.pendingResize.h).catch((e) => {
          console.warn('[FlexClient] RESIZE_DISPLAY 重发失败:', e);
        });
      }
    }
  }

  /** WebCodecs 解码器 sizeChanged（新 SPS/PPS 到达）时调用。 */
  onDecoderSizeChanged(w: number, h: number): void {
    this.setCanvasSize(w, h);
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingResize = null;
  }
}
