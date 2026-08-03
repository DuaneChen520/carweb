/**
 * Controller 健康状态机。
 *
 * 三态管理 control socket 的健康生命周期：
 *   IDLE → HEALTHY → DEGRADED → DEAD
 *                ↑         │
 *                └─────────┘（重试成功）
 *
 * 关键决策：不清空 controllerRef.current。DEAD 态通过 tryGetController
 * 返回 null 拒绝发送，但 ref 本身保持原值，避免误伤其他通道。
 */
export type ControllerHealthState = 'IDLE' | 'HEALTHY' | 'DEGRADED' | 'DEAD';

/**
 * 可恢复瞬时错误集合（S1-P0-1，车机触控失灵修复）。
 *
 * 车机 WebUSB 传输抖动、视频高码率流抢占带宽时，控制 socket 写入可能瞬时失败，
 * 错误消息形如 "Backpressure failed" / "Cannot write to a CLOSED writable stream" /
 * "Stream closed" / "AbortError" / "timed out"。这些**不是通道死亡**，
 * 不应一次性把健康态打到 DEAD（否则 `tryGetController` 返回 null，触控被静默丢弃，
 * 而视频 socket 独立继续播放——正是「应用没卡死但触控不了」的根因）。
 *
 * 命中本集合 → 走 DEGRADED 重试计数（连续失败才 DEAD，成功即回 HEALTHY）；
 * 未命中 → 视为致命错误，直接 DEAD（绝不滞留 DEGRADED 死循环）。
 */
const RECOVERABLE_ERROR_PATTERN =
  /Backpressure|CLOSED|Stream closed|AbortError|timed out/i;

export interface ControllerHealthOptions {
  /** 可恢复错误重试次数上限，默认 3。到达上限后进入 DEAD。 */
  maxRetries?: number;
}

type StateChangeListener = (state: ControllerHealthState) => void;

export class ControllerHealth {
  private _state: ControllerHealthState = 'IDLE';
  private retryCount = 0;
  private readonly maxRetries: number;
  private listeners: StateChangeListener[] = [];

  constructor(opts: ControllerHealthOptions = {}) {
    this.maxRetries = opts.maxRetries ?? 3;
  }

  get state(): ControllerHealthState {
    return this._state;
  }

  /** 注册状态变化监听。返回取消订阅函数。 */
  onStateChange(listener: StateChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emit(state: ControllerHealthState): void {
    this.listeners.forEach(l => l(state));
  }

  /** 标记 controller 健康（首次 write 成功 / 重连后的首次成功）。 */
  markHealthy(): void {
    this._state = 'HEALTHY';
    this.retryCount = 0;
    // console.log(`[CtrlHealth] HEALTHY`); // 诊断时取消注释
    this.emit('HEALTHY');
  }

  /**
   * 报告错误。根据错误类型和当前状态转换（S1-P0-1）：
   * - 可恢复瞬时错误（Backpressure / CLOSED / Stream closed / AbortError / timed out）→
   *   重试未用尽 → DEGRADED；重试用尽 → DEAD
   * - 致命错误（其余）→ 直接 DEAD（绝不滞留 DEGRADED 死循环）
   *
   * DEGRADED 态下 `tryGetController` 仍放行，发送层自行丢弃失败包；
   * 任意一次 `markHealthy()` 成功即清零计数回到 HEALTHY（瞬时抖动不累积成永久故障）。
   */
  reportError(error: unknown): void {
    const msg = error instanceof Error ? error.message : String(error);
    const isRecoverable = RECOVERABLE_ERROR_PATTERN.test(msg);

    if (!isRecoverable) {
      console.warn(`[CtrlHealth] DEAD (non-recoverable): ${msg}`);
      this._state = 'DEAD';
      this.emit('DEAD');
      return;
    }

    switch (this._state) {
      case 'HEALTHY':
      case 'DEGRADED':
        this.retryCount++;
        if (this.retryCount > this.maxRetries) {
          console.warn(`[CtrlHealth] DEAD: retries exhausted (${this.maxRetries})`);
          this._state = 'DEAD';
          this.emit('DEAD');
        } else {
          console.log(`[CtrlHealth] DEGRADED: recoverable error (attempt ${this.retryCount}/${this.maxRetries})`);
          this._state = 'DEGRADED';
          this.emit('DEGRADED');
        }
        break;
      default:
        // IDLE 或 DEAD 态下的错误不触发转换
        break;
    }
  }

  /**
   * 安全获取 controller。
   * - DEAD 态返回 null（拒绝发送，等待重连）
   * - 其他态返回 ref.current
   * - 不清空 ref
   */
  tryGetController<T>(ref: { current: T | null }): T | null {
    if (this._state === 'DEAD') return null;
    return ref.current;
  }

  /** 重置为 IDLE（重连成功后调用）。 */
  reset(): void {
    this._state = 'IDLE';
    this.retryCount = 0;
    // console.log(`[CtrlHealth] reset → IDLE`); // 诊断时取消注释
  }

  isDead(): boolean {
    return this._state === 'DEAD';
  }
}