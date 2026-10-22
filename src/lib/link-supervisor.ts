/**
 * 链路监督（LinkSupervisor）。
 *
 * 端到端链路健康与重连的单一深模块，框架无关、可脱离 React 单测。
 * 演进自 ADR-0005：ControllerHealth 从「仅 control-socket」扩为「整条链路」。
 *
 * 设计约束（详见 GLOSSARY.md「链路监督（LinkSupervisor）」）：
 * - 管「连接建立之后」的链路健康与重连；初始 USB 建连仍归 useUsbConnection。
 * - 五态 LinkState：connected / degraded / reconnecting / disconnected / failed。
 * - ADB-down 优先：ADB 传输断开立即进入 disconnected，且不消耗 scrcpy 重连次数
 *   （传输已失，重连无意义）。
 * - 单一重连计数与退避，由注入的 reconnect 策略执行实际 stop→start。
 *
 * 兼容接口：本类实现 ControllerHealth 的对外方法（tryGetController / markHealthy /
 * reportError / onStateChange / reset / isDead / state），因此可直接替代
 * ControllerHealth 传给 useInputInjector 与 flex-resize，无需改动其调用点。
 */

import { ControllerHealth, type ControllerHealthState } from './scrcpy4';

export type LinkState =
  | 'connected'
  | 'degraded'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

/** 实际执行一次会话重连（stop→start）。由会话层注入，必须保留虚拟屏 displayConfig。 */
export type ReconnectStrategy = (attempt: number) => Promise<void>;

export interface LinkSupervisorOptions {
  /** 执行一次会话重连。失败抛错，成功 resolve。 */
  reconnect: ReconnectStrategy;
  /** 重连最大尝试次数，默认 3。 */
  maxReconnectAttempts?: number;
  /** 退避基数（ms），默认 500；第 n 次退避 = base * 2^(n-1)。 */
  backoffBaseMs?: number;
  /** control-socket 子监视器（默认新建 ControllerHealth），可注入以便测试。 */
  controlHealth?: ControllerHealth;
}

/** ADB 链路信号源适配器：把「全局 ADB 连接状态」抽象为订阅接口，便于测试时注入假信号。 */
export interface AdbLinkSignal {
  /** 订阅 ADB 是否连通；返回取消订阅函数。 */
  subscribe: (onChange: (connected: boolean) => void) => () => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class LinkSupervisor {
  private readonly reconnectStrategy: ReconnectStrategy;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly controlHealth: ControllerHealth;

  private _linkState: LinkState = 'connected';
  private attempt = 0;
  private adbConnected = true;
  private reconnecting = false;
  private unsubscribers: Array<() => void> = [];
  private linkListeners: Array<(s: LinkState) => void> = [];

  constructor(opts: LinkSupervisorOptions) {
    this.reconnectStrategy = opts.reconnect;
    this.maxAttempts = opts.maxReconnectAttempts ?? 3;
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
    this.controlHealth = opts.controlHealth ?? new ControllerHealth();

    // 订阅内部 control-socket 子监视器状态，驱动统一 LinkState。
    this.unsubscribers.push(
      this.controlHealth.onStateChange((s) => this.onControlHealthChange(s)),
    );
  }

  // ---- 统一链路状态（LinkState）----

  get linkState(): LinkState {
    return this._linkState;
  }

  /** 订阅统一链路状态变化（供 App overlay、VirtualScreen 僵尸清理等消费者）。 */
  onLinkStateChange(listener: (s: LinkState) => void): () => void {
    this.linkListeners.push(listener);
    return () => {
      this.linkListeners = this.linkListeners.filter((l) => l !== listener);
    };
  }

  private emitLinkState(): void {
    for (const l of this.linkListeners) l(this._linkState);
  }

  private setLinkState(s: LinkState): void {
    if (this._linkState === s) return;
    this._linkState = s;
    this.emitLinkState();
  }

  // ---- ADB 链路信号 ----

  /** 接入 ADB 链路信号源（通常包装 useAdbStore 的 disconnected）。返回取消订阅函数。 */
  attachAdbSignal(signal: AdbLinkSignal): () => void {
    const unsub = signal.subscribe((connected) => {
      this.adbConnected = connected;
      if (!connected) {
        // ADB-down 优先：立即 disconnected，不消耗 scrcpy 重连次数。
        this.setLinkState('disconnected');
      } else if (this.controlHealth.state === 'HEALTHY' || this.controlHealth.state === 'IDLE') {
        this.setLinkState('connected');
      } else if (this.controlHealth.state === 'DEAD') {
        // ADB 恢复后若 control-socket 仍 DEAD，继续重连。
        void this.runReconnect();
      }
    });
    this.unsubscribers.push(unsub);
    return unsub;
  }

  // ---- control-socket 子监视器驱动 ----

  private onControlHealthChange(s: ControllerHealthState): void {
    if (!this.adbConnected) return; // ADB 已断，状态由 ADB 信号主导。
    switch (s) {
      case 'HEALTHY':
      case 'IDLE':
        if (this._linkState !== 'reconnecting' && this._linkState !== 'failed') {
          this.setLinkState('connected');
        }
        break;
      case 'DEGRADED':
        this.setLinkState('degraded');
        break;
      case 'DEAD':
        void this.runReconnect();
        break;
    }
  }

  private async runReconnect(): Promise<void> {
    if (this.reconnecting) return;
    if (!this.adbConnected) {
      this.setLinkState('disconnected');
      return;
    }
    this.reconnecting = true;
    this.setLinkState('reconnecting');

    while (this.attempt < this.maxAttempts) {
      if (!this.adbConnected) {
        this.reconnecting = false;
        this.setLinkState('disconnected');
        return;
      }
      this.attempt++;
      const delay = this.backoffBaseMs * Math.pow(2, this.attempt - 1);
      await sleep(delay);
      try {
        await this.reconnectStrategy(this.attempt);
        // 成功：重置子监视器与计数，回到 connected。
        this.controlHealth.reset();
        this.attempt = 0;
        this.reconnecting = false;
        this.setLinkState('connected');
        return;
      } catch {
        // 失败：继续下一轮尝试。
      }
    }

    // 重连用尽。
    this.reconnecting = false;
    this.setLinkState('failed');
  }

  // ---- ControllerHealth 兼容接口（直接喂 useInputInjector / flex-resize）----

  get state(): ControllerHealthState {
    return this.controlHealth.state;
  }

  onStateChange(listener: (s: ControllerHealthState) => void): () => void {
    return this.controlHealth.onStateChange(listener);
  }

  tryGetController<T>(ref: { current: T | null }): T | null {
    return this.controlHealth.tryGetController(ref);
  }

  markHealthy(): void {
    this.controlHealth.markHealthy();
  }

  reportError(error: unknown): void {
    this.controlHealth.reportError(error);
  }

  isDead(): boolean {
    return this.controlHealth.isDead();
  }

  reset(): void {
    // 重连计数与进行中标志一并归零（新会话启动 / 重连成功后调用）。
    this.attempt = 0;
    this.reconnecting = false;
    this.controlHealth.reset();
  }

  /** 释放所有订阅；实例销毁时调用。 */
  dispose(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
    this.linkListeners = [];
    this.controlHealth.reset();
  }
}
