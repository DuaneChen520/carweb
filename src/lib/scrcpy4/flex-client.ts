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
  /**
   * ADR-0011：resize 进行中回调。
   * pendingResize 从 null→非null 时触发 active=true（resize 发起，画面即将清屏）；
   * pendingResize 从非null→null 时触发 active=false（server 确认 resize，新帧已到）。
   * 供 UI 层在「应用尺寸变化过渡」期间显示浅白占位，覆盖 canvas 清屏白闪。
   * 也可在实例化后直接赋值 flexClient.onResizeActivity 覆盖。
   */
  onResizeActivity?: (active: boolean) => void;
}

export class FlexDisplayClient {
  private currentDisplaySize: { w: number; h: number } | null = null;
  private pendingResize: { w: number; h: number } | null = null;
  private lastRetryTime = 0;
  private readonly retryInterval = 500; // clientResized=false 重试间隔
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly sendResize: (w: number, h: number) => Promise<void>;
  private readonly setCanvasSize: (w: number, h: number) => void;
  /** 最近一次发送的尺寸，用于去重。 */
  private lastSentTarget: { w: number; h: number } | null = null;
  /** ADR-0011：resize 进行中回调（见 onResizeActivity 文档）。 */
  public onResizeActivity?: (active: boolean) => void;

  constructor(opts: FlexDisplayClientOptions) {
    this.sendResize = opts.sendResize;
    this.setCanvasSize = opts.setCanvasSize;
    this.debounceMs = opts.debounceMs ?? 150;
    this.onResizeActivity = opts.onResizeActivity;
  }

  /** 设置初始虚拟屏尺寸（来自 startScrcpy 的 displayConfig）。 */
  setInitialDisplaySize(w: number, h: number): void {
    this.currentDisplaySize = { w, h };
  }

  /** ResizeObserver 回调（CSS 尺寸变化）。 */
  onContainerResize(cssW: number, cssH: number, scale: number, dpr: number): void {
    // 总是先清除旧定时器，防止提前返回时遗漏导致陈旧的防抖回调误发
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

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
    // pendingResize 已存在且与新 target 相同 → 跳过（已发送等确认，不重复发）
    if (
      this.pendingResize !== null &&
      this.pendingResize.w === target.w &&
      this.pendingResize.h === target.h
    ) {
      return;
    }
    // 与最近一次已发送的完全一致 → 跳过（去重，预防 ResizeObserver 高频触发）
    if (
      this.lastSentTarget !== null &&
      this.lastSentTarget.w === target.w &&
      this.lastSentTarget.h === target.h
    ) {
      return;
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.requestResize(target);
    }, this.debounceMs);
  }

  private requestResize(target: { w: number; h: number }): void {
    // squash：只保留最新请求
    this.pendingResize = target;
    this.lastSentTarget = target;
    // ADR-0011：通知 UI 进入「尺寸变化过渡」（canvas 即将清屏白闪，需占位覆盖）
    this.onResizeActivity?.(true);
    this.sendResize(target.w, target.h)
      .catch((e) => {
        console.warn('[FlexClient] RESIZE_DISPLAY 发送失败:', e);
        // 发送即失败（如 flexClient 尚未就绪）→ 清除 pending 并结束过渡态，
        // 否则 onResizeActivity(false) 永不触发，UI 占位会永久卡在屏幕上。
        this.pendingResize = null;
        this.onResizeActivity?.(false);
      });
  }

  /** demuxer 解出 session 包时调用。 */
  onSessionPacket(w: number, h: number, clientResized: boolean): void {
    this.currentDisplaySize = { w, h };
    // 通知 canvas backing store 更新
    this.setCanvasSize(w, h);

    if (clientResized) {
      // server 确认了客户端请求的 resize 已生效：无论实际尺寸是否精确等于请求值，
      // 都视为已应用并清除 pending，结束「尺寸变化过渡」（占位淡出）。
      // 旧逻辑要求尺寸精确匹配才清 pending，一旦设备回的尺寸有细微出入
      // （虚拟屏分辨率取整、DPR 抖动）便永不清除，导致 UI 占位卡死。
      if (this.pendingResize !== null) {
        this.pendingResize = null;
        this.onResizeActivity?.(false);
      }
    } else {
      // 独立变化（如 App 自旋转），不清除 pending；
      // 但如果 session 包尺寸与 pendingResize 匹配，server 实际已应用了变化，清除 pending
      this.clearPendingIfMatches(w, h);
      // 若 pending 仍在且未与 session 匹配，重发以校正（带节流）
      if (this.pendingResize !== null && Date.now() - this.lastRetryTime > this.retryInterval) {
        this.lastRetryTime = Date.now();
        this.sendResize(this.pendingResize.w, this.pendingResize.h).catch((e) => {
          console.warn('[FlexClient] RESIZE_DISPLAY 重发失败:', e);
          // 重发失败同样结束过渡，避免占位卡死
          this.pendingResize = null;
          this.onResizeActivity?.(false);
        });
      }
    }
  }

  /** 如果 pendingResize 与 session 包尺寸匹配，清除 pending。 */
  private clearPendingIfMatches(w: number, h: number): void {
    if (
      this.pendingResize !== null &&
      this.pendingResize.w === w &&
      this.pendingResize.h === h
    ) {
      this.pendingResize = null;
      // ADR-0011：resize 已被 server 确认，退出「尺寸变化过渡」，占位淡出
      this.onResizeActivity?.(false);
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
    if (this.pendingResize !== null) {
      this.pendingResize = null;
      // ADR-0011：组件卸载/会话销毁时强制结束过渡状态，避免占位残留
      this.onResizeActivity?.(false);
    }
    this.lastSentTarget = null;
  }
}
