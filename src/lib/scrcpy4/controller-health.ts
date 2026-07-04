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

export interface ControllerHealthOptions {
  /** Socket closed 重试次数上限，默认 3。到达上限后进入 DEAD。 */
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
    console.log(`[CtrlHealth] HEALTHY`);
    this.emit('HEALTHY');
  }

  /**
   * 报告错误。根据错误类型和当前状态转换：
   * - 非 Socket closed 错误 → 直接 DEAD
   * - Socket closed 且重试未用尽 → DEGRADED
   * - Socket closed 且重试用尽 → DEAD
   */
  reportError(error: unknown): void {
    const msg = error instanceof Error ? error.message : String(error);
    const isSocketClosed = msg.includes('Socket closed');

    if (!isSocketClosed) {
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
          console.log(`[CtrlHealth] DEGRADED: socket closed (attempt ${this.retryCount}/${this.maxRetries})`);
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
    console.log(`[CtrlHealth] reset → IDLE`);
  }

  isDead(): boolean {
    return this._state === 'DEAD';
  }
}