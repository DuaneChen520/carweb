/**
 * 统一链路状态总线（link-state bus）。
 *
 * 极简的模块级发布/订阅，用于在 React 组件树层级之外（如 App 是 ScrcpyProvider
 * 的父组件，无法直接读取会话 context）传播「当前活动会话的 LinkState」。
 *
 * 生产者：useScrcpySession 内的 LinkSupervisor 通过 onLinkStateChange 调用 publishLinkState。
 * 消费者：App 的「重连提示」overlay、VirtualScreen 的僵尸清理等。
 *
 * 注意：这是全局单例总线。当前仅镜像路径（useScrcpySession/LinkSupervisor）会发布；
 * 候选1 收口（useScrcpySession 退化为 ScrcpySession 薄适配器）后，统一会话层将独占发布，
 * 语义与「主会话链路状态」一致。多会话并存时以「最后写入者」为准；由于同一时刻仅一个
 * 显示模式激活，不会冲突。
 */

import type { LinkState } from './link-supervisor';

type LinkStateListener = (state: LinkState) => void;

const listeners = new Set<LinkStateListener>();

/** 发布一次链路状态变化（由 LinkSupervisor 调用）。 */
export function publishLinkState(state: LinkState): void {
  for (const listener of listeners) listener(state);
}

/** 订阅链路状态变化，返回取消订阅函数。 */
export function subscribeLinkState(listener: LinkStateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
