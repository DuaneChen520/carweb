# 去 @yume-chan 化 / scrcpy 4.x 升级方案（经 GitHub 核实版）

> 生成日期：2026-08-04
> 数据来源：GitHub 连接器实拉 Genymobile/scrcpy 与 yume-chan/ya-webadb 发布记录

---

## 0. 先纠正三个关键事实（已用 GitHub 验证，推翻此前对话中的部分结论）

此前对话里我有两个判断需要修正，以下均为 GitHub 实测：

### 修正 1：「yume-chan 库最高只支持 3.3.3 server 协议」—— ❌ 错误

- `@yume-chan/ya-webadb` **v3.0.0-beta.1**（发布于 **2026-08-01**，本周）的 Release Notes 明确写明：
  > `@yume-chan/scrcpy` and `@yume-chan/adb-scrcpy`
  > * feat(scrcpy): **support server version 4.0 and 4.1** by @yume-chan in PR #854
  > * feat(scrcpy): make CodecOptions more flexible by @yume-chan in PR #858
- 也就是说，**上游已经原生支持 scrcpy 4.0 / 4.1 server 协议**，根本不需要靠自研才能上 4.x。
- 本项目 `package.json` 锁定的是 **v2 线**（`@yume-chan/scrcpy ^2.3.0`、`@yume-chan/adb-scrcpy ^2.3.2`、`@yume-chan/adb ^2.6.0`），所以即便上游已支持 4.x，本项目当前的依赖树也**没有**该能力。

### 修正 2：「4.1 相对 4.0 主要是尺寸约束 + --ignore-video-encoder-constraints」—— ✅ 对，但 4.0 本身是大版本

- scrcpy **v4.0**（2026-05-12）是一次大改，server 端引入：flex display、camera torch/zoom、video stream session metadata、video capabilities constraints 强制、`--keep-active`、`--min-size-alignment`、`--background-color`、SDL2→SDL3 迁移等。
- scrcpy **v4.1**（2026-07-12）相对 4.0 主要是增量修补：VP8/VP9 编码器、推文件后触发媒体扫描、尺寸约束算法改进 + `--ignore-video-encoder-constraints`、若干 colorspace/手柄/data race 修复、FFmpeg 8.1.2 / SDL 3.4.12 / libusb 1.0.30 升级。
- **结论**：4.1 对 Web 封装场景真正相关的只有「尺寸约束改进」和「`--ignore-video-encoder-constraints`」两条；其余（FFmpeg/SDL/终端/桌面图标/媒体扫描）是原生桌面客户端专属，与本项目无关。

### 修正 3：「本项目当前等于没有 4.x 能力」—— ⚠️ 部分对

- 本项目 **没有** 用 yume-chan 的 4.x 支持（锁 v2）。
- 但项目**已自研 `src/lib/scrcpy4/`** 把协议 override 到 4.0（继承 `AdbScrcpyOptions3_3_3`、`version='4.0'`、自写 `RESIZE_DISPLAY` 控制消息与 4.0 视频 demuxer），并配合官方 scrcpy v4.0 server 二进制（`public/scrcpy-server.jar`）。
- **重要修正（2026-08-04 经 GitHub 核实）**：`public/scrcpy-server.jar` 经 sha256 比对（官方 `scrcpy-server-v4.0` 发布物 digest = `84924bd5…3210f3a`，大小 732226 字节）**与官方原版字节级一致，无任何定制/OEM 修改**。此前文档中"车机定制 server"的表述是错误的——官方 scrcpy v4.0 的 `AudioCodec.java` 源码也证实其仅支持 OPUS/AAC/FLAC/RAW 四种音频 codec（标签均为 codec 名 ASCII），**不可能发出 `0x32333034`**。
- 因此现状是：**靠自研 + 官方原版 server 实现了 4.0，但绕过了上游库**。这与"上游 v3 已原生支持 4.0/4.1"形成对比——你们的自研层与上游 v3 在功能上高度重叠。

---

## 1. 当前依赖与耦合面（实测）

`package.json` 中的 `@yume-chan/*` 依赖：

| 包 | 版本 | src/ import 数 | 主要被用到的符号 |
|---|---|---|---|
| `@yume-chan/adb` | ^2.6.0 | 19 | `Adb`、`AdbDaemonTransport` |
| `@yume-chan/scrcpy` | ^2.3.0 | 10 | 枚举常量（`AndroidKeyCode`/`AndroidMotionEventAction`/`ScrcpyVideoCodecId` 等）、类型、控制消息 writer |
| `@yume-chan/adb-scrcpy` | ^2.3.2 | 5 | `AdbScrcpyOptions3_3_3`（被 `scrcpy4/options.ts` 继承）、`AdbScrcpyClient`、`AdbScrcpyExitedError` |
| `@yume-chan/stream-extra` | ^2.5.3 | 2 | `BufferedReadableStream`/`PushReadableStream`/`TransformStream` |
| `@yume-chan/scrcpy-decoder-webcodecs` | ^2.5.3 | 2 | 类型 `WebCodecsVideoDecoder` |
| `@yume-chan/adb-daemon-webusb` | ^2.3.2 | 2 | `AdbDaemonWebUsbDevice`/`Manager` |
| `@yume-chan/struct` | ^2.3.2 | 1 | `decodeUtf8` |
| `@yume-chan/no-data-view` | — | 1 | `getUint32BigEndian` |
| `@yume-chan/adb-credential-web` | ^2.1.0 | 1 | `AdbWebCredentialStore` |
| `@yume-chan/event` | ^2.0.0 | **0（死依赖）** | 无 |
| `@yume-chan/fetch-scrcpy-server` | ^1.0.0 | 构建期 | 拉取 server 二进制 |

---

## 2. 两种互斥的大方向（先选路，再谈替换）

基于修正后的事实，摆在面前的不是"自研 or 用库"二选一，而是：

### 方向 A：升级到上游 v3（推荐，性价比最高）
- 把 `@yume-chan/*` 从 v2 线升到 **v3.0.0-beta.1**（或等其 stable）。
- 上游 v3 已原生支持 scrcpy 4.0/4.1 server 协议，且 `CodecOptions` 更灵活。
- 你们自研的 `scrcpy4/` 大部分能力（4.0 协议、flex display、控制消息）**上游已经做了**，可逐步用上游实现替换自研层，反而降低维护负担。
- **风险**：v3 是 beta（刚发一周），API 可能变；需评估与现有 v2 代码的 breaking change。

### 方向 B：彻底自研库（你提出的诉求）
- 完全不依赖 yume-chan，自己实现 scrcpy 协议层。
- **前提认知**：上层 scrcpy 业务协议可自研（你们已证明可行）；但 **ADB / WebUSB 传输层不建议自研**（见 §3 红色区）。
- 这条路的真正价值不是"功能"，而是"不锁死在第三方库的发布节奏上"——但鉴于上游已支持 4.x，**自研的紧迫性大幅下降**。

> **建议**：以方向 A 为主（升级 v3 拿到原生 4.x 支持），方向 B 作为"协议层渐进自研"的长期演进，**不要从零重写 ADB**。

---

## 3. 逐包替换可行性地图（修正版）

### 🟢 立刻可替换（零风险，< 5 行改动）
- `@yume-chan/event`：**零 import，直接从 package.json 删除**（死依赖）。
- `@yume-chan/struct`：仅用 `decodeUtf8` → 换成 `new TextDecoder().decode(buf)`。
- `@yume-chan/no-data-view`：仅用 `getUint32BigEndian` → 换成 `new DataView(buf).getUint32(0, false)`。

### 🟡 可替换，需薄封装
- `@yume-chan/stream-extra`：浏览器原生已有 `ReadableStream`/`TransformStream`；仅缺 `BufferedReadableStream`(readExactly) 与 `PushReadableStream`(背压 push)，各写 ~30 行薄封装即可。你们 `scrcpy4/options.ts` 已手写该模式，吃得透。

### 🟢 已部分自研，可继续深化（主战场）
- `@yume-chan/scrcpy`：用到的多为**枚举常量 + 类型**。常量（如 `AndroidKeyCode`、`AndroidMotionEventAction`、`ScrcpyVideoCodecId`）本质是一组数字，scrcpy 官方 C 源码有完整定义，可全部自研进 `src/lib/scrcpy4/protocol.ts`；类型可自己 declare。控制消息写入你们已绕过（自己 serialize 成 `string[]`）。
- `@yume-chan/adb-scrcpy`：核心卡点。你们继承 `AdbScrcpyOptions3_3_3` 复用其 `createConnection`/序列化基础。要彻底脱离，需自研 `AdbScrcpyOptions` 基类。**但注意**：上游 v3 已原生支持 4.x，所以"脱离 adb-scrcpy"的优先级应低于"升级 v3 用它"。

### 🔴 不建议替换（硬核基础设施，自研 = 重写 ADB 协议栈）
- `@yume-chan/adb`：完整 ADB 协议栈（传输/认证/sync/shell/reverse），19 处 import 遍布 22 个文件。与 scrcpy 升级无关，自研零收益。
- `@yume-chan/adb-daemon-webusb`：WebUSB↔ADB 胶水层，与浏览器 USB API + ADB 认证强耦合。
- `@yume-chan/adb-credential-web`：ADB 密钥存储（WebCrypto + IndexedDB）。
- `@yume-chan/fetch-scrcpy-server`：构建期下载器；你们已有 `public/scrcpy-server.jar`，甚至可不用它，直接把 jar 放 public。

### 🟡 解码器（可保留）
- `@yume-chan/scrcpy-decoder-webcodecs`：仅类型 `WebCodecsVideoDecoder`，底层是浏览器原生 WebCodecs。yume-chan 封装已处理 chunk 时序/flush，替换收益低，**建议保留**。

---

## 4. 推荐执行计划（以"升级 v3"为主线，清理为前置）

> 用户已拍板：**升级到 yume-chan 最新版（v3.0.0-beta.1）**。下面是落地动作，详见 §7 的精确判别。

### 阶段 0：升级前验证（决定"动哪些"的先决条件）—— ✅ 2026-08-04 已完成
- [x] **验证 v3 对未知音频 codec 标签的容错行为**（已完成，结论反转）：实拉 v3 `libraries/scrcpy/src/2_0/impl/parse-audio-stream-metadata.ts` + `2_3/impl/parse-audio-stream-metadata.ts`。**v3 原生 `parseAudioMetadataCodec` 对未知标签抛 `Unknown audio codec metadata value`**（sendCodecMeta=true 默认路径）；仅 `sendCodecMeta=false` 时用 fallback 不抛错。**"若 v3 已容错则可删兜底"的假设不成立** → `parseAudioStreamMetadata` 容错重写**升级时必须保留**（作防御性兜底，防真机非预期标签），除非真机实测确认不再出现。另注意版本差异：v3 4_0 的 `parseAudioStreamMetadata` 用 `this.value.sendStreamMeta`（3_0 用 `sendCodecMeta`），本项目 override 原用 `sendCodecMeta ?? true`，升级后须对齐 4_0 语义。
- [x] **v3 API 兼容性审计**（已完成，见 §9）：逐符号验证本项目 20 处 `@yume-chan/*` import 在 v3.0.0-beta.1 的存续性，发现 7 处破坏性变更（§9.2）。
- [ ] 锁定 `3.0.0-beta.1`（不用 `^3`），避免 beta 期间自动升级到未验证版本。

### 阶段 1：零风险清理（✅ 2026-08-04 主分支已完成）
- [x] 删 `@yume-chan/event`（v3 中实为各包内部传递依赖，从 package.json 删除即可，node_modules 由传递依赖提供）。
- [x] 用原生 API 替换 `@yume-chan/struct`(`decodeUtf8`) 与 `@yume-chan/no-data-view`(`getUint32BigEndian`) —— 实际随 options.ts 重写自然消除：parseVideoStreamMetadata 改用 v3 上游，不再手写字节解析；仅容错版 parseAudioStreamMetadata 保留 getUint32BigEndian（该包 v3 仍存在，无替换必要）。
- [x] 全量 `npm run test`（291 通过）+ `npm run check`（通过）+ 本次改动文件 `lint`（全绿；全量 lint 因 ya-webadb-main 第三方副本与 src/ 存量错误而红，属基线问题，升级前同样存在）。

### 阶段 2：升级 v3 + 精简 scrcpy4 自研层（✅ 2026-08-04 主分支已完成，用户要求不建分支）
- [x] `package.json`：`@yume-chan/*` → `3.0.0-beta.1`（锁版本）；`npm install` 成功。
- [x] `src/lib/scrcpy4/options.ts` 重写：`extends AdbScrcpyOptions4_0`（v3 官方类，原生支持 4.0/4.1）；删除 `version` override、`controlMessageTypes` override、`serialize()` 追加、`parseVideoStreamMetadata` 重写、`createMediaStreamTransformer` override、`RESIZE_DISPLAY_TYPE` 常量。
- [x] 删除 `audioBufferMs`/`audioOutputBufferMs` 透传（无效透传，§7.4.1 第 3 行）；**保留 `parseAudioStreamMetadata` 容错重写**（新类 `AdbScrcpyOptions4_0Tolerant`，对齐 v3 4_0 `sendStreamMeta` 语义）。
- [x] 删除 `RESIZE_DISPLAY_TYPE = 21` 常量；flex resize 改用 `ScrcpyControlMessageWriter.resizeDisplay()`。
- [x] 删除 `src/lib/scrcpy4/control/resize-display.ts` 手写字节序列化（上游 writer 替代）+ 测试。
- [x] 删除 `video/demuxer.ts` + 测试（v3 上游 `createMediaStreamTransformer` 原生覆盖，输出 `ScrcpyVideoStreamPacket`）。
- [x] **升级中发现的额外破坏性变更（§9.2 未列全）**：① `AdbDaemonTransport.authenticate()` → `adbDaemonAuthenticate()`（useUsbConnection.ts 改写）；② `AdbWebCredentialStore`(default) → `AdbWebCryptoCredentialManager` + `TangoIndexedDbStorage`；③ ADB `subprocess.spawnWaitText` → `spawn(...).wait().toString()`（adb-commands/apk-utils/device-app-parser 及测试 mock 全面改写）；④ `adb.sync()` 方法 → `adb.sync` 属性；⑤ `WebGLVideoFrameRenderer(canvas)` → `(options)` + `canvasSize:'external'`（防覆盖 flex-client 的 canvas 尺寸管理）；⑥ `AdbScrcpyOptions4_0` 泛型从 `TVideo` 变 `TInit`（消费端类型调整）。
- [x] 三件套：`npm run check` ✅、`npm run test` ✅（291/291）、改动文件 `lint` ✅、`npm run build` ✅（2162 modules）。
- [ ] **真机验证（待做）**：镜像/触控/音频三链路；专验点：① `isClientResize` 位定义（v3 `header[0]&1` vs 自研 `getUint8(3)&1`）；② 音频是否仍现未知 codec 标签（若现 → `adb shell ps | grep scrcpy` 查根因，容错兜底已保留）；③ `esm/video/render/webgl.js` 动态 import（构建已验证分包正常）。

### 阶段 3（可选，长期演进）：协议层渐进自研
- [ ] 仅当"必须脱离上游发布节奏"成为硬诉求时，才考虑把 `scrcpy4/` 扩展为完全自研的协议库；在此之前**保留 `@yume-chan/adb` + `adb-daemon-webusb` + `adb-credential-web` 不动**（§3 红色区）。

---

## 5. ya-webadb v3.0.0-beta.1 做了什么（GitHub 实测 PR #854 / #858）

> 数据来源：WebFetch 拉取 PR #854、#858 与 v3.0.0-beta.1 Release 页面。

### 5.1 它实际改了什么
- **scrcpy server 4.0/4.1 原生支持（PR #854，10 commits，+5145/-963）**：
  - `@yume-chan/scrcpy` 新增 `src/4_0/`、`src/4_1/` 版本目录，每目录含 `defaults.ts`/`init.ts`/`compute-option-values.ts`/`control-message-types.ts`/`parse-video-stream-metadata.ts`；`latest.ts` 指向 **4.1**。
  - `@yume-chan/adb-scrcpy` 新增 `4_0.ts`/`4_1.ts`，导出 `AdbScrcpyOptions4_0`/`AdbScrcpyOptions4_1`。
  - **新增控制消息类型**：相机手电筒开关、相机变焦、调整显示尺寸（resize display）、文件扫描、设置显示电源（即 4.0 flex display / camera 那套）。
  - **新增 VP8/VP9 编解码**：`media-codec` 加 `vp8.ts`/`vp9.ts`，`scrcpy-decoder-webcodecs` 消费之。
- **CodecOptions 更灵活（PR #858，+70/-19）**：传 `undefined` 清除选项；数值接受 `bigint`/数字并做 32 位归一化；视频 `angle` 显式允许 `undefined`；元数据解析顺序调整更稳。
- **ADB 层仅 bug fix**（PR #857/#860/#855），无破坏性。

### 5.2 升级是否适用于本项目
- ✅ **功能高度适用**：本项目自研 `scrcpy4/` 干的事（4.0 协议、resize display、视频流解析），v3 **原生就做了**，且覆盖更全（多 camera/文件扫描/VP8/VP9）。
- ⚠️ **v3 是 beta**（刚发一周），API 可能还变。
- ❌ **最大障碍 = 选项系统重构**：v3 把 `ScrcpyOptions` 从"普通 options 对象"改成"**init-shaped generics + compute-option-values**"。本项目 `scrcpy4/options.ts` 继承的 `AdbScrcpyOptions3_3_3` 在 v3 里类名/构造方式大概率变化（变为 `AdbScrcpyOptions4_0` 且用 init 泛型）。**这是 v2→v3 的核心不兼容点，Release 未给 breaking-change 清单（因为是 beta）。**

### 5.3 与本项目自研层的实现逻辑区别（核心对比）
| 维度 | 本项目自研 `scrcpy4/` | v3 上游 |
|---|---|---|
| 版本/协议指定 | `extends AdbScrcpyOptions3_3_3` + `Object.defineProperty(version, ()=> '4.0')`，**继承 3.3.3 再 override 版本字符串** | `src/4_0/` 是**独立完整版本模块**，版本是类型系统一等公民，不继承 3.3.3 |
| 控制消息（resize display） | 手写 `serializeResizeDisplay` → `[type][w u16][h u16]` 5 字节，type 靠 `indexOf` 推算（注释写 4.0=18，代码常量却是 21） | `4_0/impl/control-message-types.ts` **声明式定义**整套 4.0 控制消息，类型系统保证 type 编号与协议一致 |
| 视频流解析 | 自研 `video/demuxer.ts`：MSB 嗅探会话/媒体包、61-bit PTS 位域；重写 `parseVideoStreamMetadata` 规避 2.3 多读 8 字节 | `4_0/parse-video-stream-metadata.ts` 已对齐 4.0 包格式；PR #858 调整"元数据读取顺序在 codec 赋值前"，用统一 `compute-option-values` 基元而非逐版本手写 |
| CodecOptions 设置 | 直接拼 `args` 字符串（`audio_buffer=150ms`） | 走类型化 `CodecOptions` setter（支持 undefined 清除、bigint 归一化） |

### 5.4 结论
- v3 干的**正是本项目 `scrcpy4/` 自研的部分，且更完整**（还含 camera/VP8/VP9/文件扫描）。
- 区别在于：本项目是"继承 3.3.3 + override 版本号 + 手写协议细节"；v3 是"独立版本模块 + 泛型类型系统 + 声明式控制消息"。
- **升级策略**：升 v3 后，应**删掉与上游重复的自研代码，仅保留真正私有的逻辑**（`audio_buffer` 透传——官方 4.0 server 无此选项；以及 `parseAudioStreamMetadata` 容错重写——作为防御性兜底，因官方 server 不发 `0x32333034`，根因待真机复核）。但 v3 是 beta + 选项系统重构，建议等 stable 或先在分支试水，不要直接上主分支。

---

## 6. 关于"是否需要升级到 scrcpy 4.1"的最终结论（修正版）

- **功能层面**：4.1 对本项目（Web 车机镜像）增益有限，仅"尺寸约束更稳"和"`--ignore-video-encoder-constraints`"两条相关。
- **能力层面**：**上游 ya-webadb v3 已原生支持 4.0/4.1**，不再需要"自研才能实现 4.x"——此前该判断已纠正。
- **决策建议**：
  1. 若仅为"拿到 4.1 能力"→ **升级 `@yume-chan/*` 到 v3** 比"自研 + 重编译 server"省事得多（详见 §5；server 已是官方原版，无需重编译）。
  2. 若坚持自研库 → 走 §4 三阶段，但阶段 3 的"脱离 adb-scrcpy"优先级应低于"升级 v3"，避免重复造轮子。
  3. **无论哪条路，都不要替换 ADB / WebUSB 基础设施层**（§3 红色区）。

---

## 7. 升级到 yume-chan 最新版（v3.0.0-beta.1）的「动 vs 不动」精确评估

> 数据来源：GitHub MCP 实拉 yume-chan/ya-webadb `v3.0.0-beta.1` 源码
> - `libraries/adb-scrcpy/src/4_0.ts`（AdbScrcpyOptions4_0 实现）
> - `libraries/scrcpy/src/4_0/index.ts`（ScrcpyOptions4_0 实现）
> - `libraries/scrcpy/src/4_0/impl/init.ts`（4.0 支持的选项字段）
> - `libraries/scrcpy/src/4_0/impl/control-message-types.ts`（控制消息声明）

### 7.1 先确认一个事实：v3 的 monorepo 布局变了
- **包路径从 `packages/<pkg>/src` 改为 `libraries/<pkg>/src`**（v3 把 packages 重命名为 libraries）。
- 包名（`@yume-chan/adb`、`@yume-chan/scrcpy` 等）**保持不变**，import 语句不用改包名，但发布版本号跳到 3.x。
- `latest` 指针：`@yume-chan/scrcpy` 的 `latest.ts` 已指向 **4.1**；`AdbScrcpyOptions` 现按版本号分文件（`4_0.ts`/`4_1.ts`）。

### 7.2 v3 的 `ScrcpyOptions4_0` 已原生覆盖本项目哪些能力（关键）

实测 `libraries/scrcpy/src/4_0/impl/init.ts`，`Init` 接口已包含：

```ts
interface Init extends Omit<PrevImpl.Init, "sendCodecMeta"> {
  minSizeAlignment?: 1 | 2 | 4 | 8 | 16 | undefined;  // 4.1 的 --min-size-alignment
  cameraZoom?: number | undefined;                     // 4.0 camera
  cameraTorch?: boolean | undefined;                   // 4.0 camera
  flexDisplay?: boolean | undefined;                   // 4.0 flex display
  keepActive?: boolean | undefined;                     // 4.0 --keep-active
  sendStreamMeta?: boolean | undefined;                // 4.0 session metadata
}
```

`control-message-types.ts` 已**声明式**定义全套 4.0 控制消息，含 `ResizeDisplay: 21`（与本项目手写的 `RESIZE_DISPLAY_TYPE = 21` 完全一致，且更权威）。

`ScrcpyOptions4_0` 类已原生实现：`serialize()`、`parseVideoStreamMetadata()`、`parseAudioStreamMetadata()`、`createMediaStreamTransformer()`、`controlMessageTypes`——全部基于统一的 `computeOptionValues(init, Defaults)` 基元，比本项目逐版本手写更完整（还内置 clipboard/uHid/scroll 等）。

**结论：本项目 `scrcpy4/options.ts` 里 override 的 5 个方法，上游 v3 已全部原生覆盖，且更完整。**

### 7.3 动 vs 不动：文件级判别表

| 现有代码 | 是否动 | 理由 |
|---|---|---|
| `src/lib/scrcpy4/options.ts` 的 `version` override（`Object.defineProperty`） | **删** | v3 `AdbScrcpyOptions4_0` 的 `version` 由构造参数 `clientOptions?.version ?? "4.0"` 决定，无需手写 override |
| `src/lib/scrcpy4/options.ts` 的 `controlMessageTypes` override（`[...super, RESIZE_DISPLAY_TYPE]`） | **删** | v3 `ControlMessageTypes` 已声明式含 `ResizeDisplay: 21`，上游枚举即权威，本项目手写常量冗余且可能冲突 |
| `src/lib/scrcpy4/options.ts` 的 `serialize()` 追加 `flex_display`/`keep_active` | **删** | `flexDisplay`/`keepActive` 已在 v3 `Init` 中，上游 `serialize()` 自动处理 |
| `src/lib/scrcpy4/options.ts` 的 `parseVideoStreamMetadata()` 自研重写 | **删除/降为兜底** | v3 `parseVideoStreamMetadata` 已对齐 4.0 包格式（PR #858 修过解析时序）。官方 server 视频流即 4.0 标准格式，无"定制差异"风险，可直接用上游版 |
| `src/lib/scrcpy4/options.ts` 的 `parseAudioStreamMetadata()` 重写（容错未知标签 `0x32333034`） | **保留 + 评估（防御性兜底）** | 官方 scrcpy v4.0 `AudioCodec.java` 仅 OPUS/AAC/FLAC/RAW 四种，**不可能发出 `0x32333034`**（该值 ASCII 为 "3204"，非任何 codec 名）。原 ADR-0016 称"定制 server 上报"已被 sha256 比对推翻。此重写实为防御性兜底：升级 v3 后实测 v3 原生解析器对未知标签的行为——若 v3 已容错或真机不再出现该值，则可删 |
| `src/lib/scrcpy4/options.ts` 的 `serialize()` 追加 `audio_buffer`/`audio_output_buffer` | **删（无效透传，server 不识别 + Web 侧未使用）** | ⚠️ **经 GitHub 实拉官方 scrcpy v4.0 源码核实：`--audio-buffer` / `--audio-output-buffer` 是桌面 client（scrcpy.c → `sc_audio_player_init`）的**本地播放缓冲参数**，作用于 PC 侧 SDL 播放器；server 端 `Options.java` 的 `parse()` **根本没有 `audio_buffer` / `audio_output_buffer` 这两个 key**（音频相关 key 仅 `audio`/`audio_codec`/`audio_source`/`audio_dup`/`audio_bit_rate`/`audio_codec_options`/`audio_encoder`），未知 key 走 `default: Ln.w("Unknown server option")` 被**静默忽略**。本项目是 Web 直连 server、无 SDL 播放器，这两个值**唯一去向就是拼进 server 启动参数**，server 忽略之、Web 侧（`useVideoDecoder` 等）也从不读取——对当前架构**零作用**。此前称"车机私有扩展、需真机验证"是错误定性，实际是透传给了错误的对象（server 而非 client）。删除即可，不影响任何功能 |
| `src/lib/scrcpy4/options.ts` 的 `createMediaStreamTransformer()` 自研 demuxer | **删** | 升级 v3 后 `createMediaStreamTransformer` 直接改用上游实现，本 override 不再需要 |
| `src/lib/scrcpy4/control/resize-display.ts` 手写 5 字节序列化 | **删** | v3 已把 ResizeDisplay 控制消息纳入类型系统，直接走上游 `serialize*ControlMessage` 或控制消息 writer，不必手写字节 |
| `src/lib/scrcpy4/video/demuxer.ts` | **删（v3 已原生覆盖）** | ⚠️ **修正前判**：曾误判为"项目私有契约必须保留"。实测 v3 上游 `libraries/scrcpy/src/4_0/impl/media-stream-transformer.ts` 的 `createMediaStreamTransformer` **已原样实现 4.0 session 包解析**，输出 `ScrcpyVideoStreamPacket` 与本项目 `Scrcpy4MediaPacket` **完全同构**：`{type:'session', isClientResize, width, height}` / `{type:'configuration', data}` / `{type:'data', keyframe, pts, data}`。故 demuxer.ts **无保留必要**。升级步骤：① `options.ts` 删除 `createMediaStreamTransformer` override，改用 v3 上游；② `useVideoDecoder.ts` / `scrcpy-session.ts` 把 `packet.clientResized` 改名为 `packet.isClientResize`、把 `Scrcpy4MediaPacket` 类型替换为 v3 的 `ScrcpyVideoStreamPacket` 即可对接。同时删 `__tests__/demuxer.test.ts`（或改为测上游契约字段名） |
| `src/lib/scrcpy4/controller-health.ts` | **保留（业务必要，无上游同构）** | 纯业务：control-socket 健康状态机（IDLE/HEALTHY/DEGRADED/DEAD + 可恢复错误重试）。**不 import 任何 `@yume-chan/*`**，与协议版本、与升级零耦合。上游 yume-chan 不提供"control-socket 健康状态机"这种业务概念，**无同构实现**，属业务必要性保留 |
| `src/lib/scrcpy4/flex-client.ts` | **保留，但被 v3 迁移牵动（非"零耦合"）** | 纯业务：flex display 反抖动状态机。但注意它**通过 `onSessionPacket(w, h, clientResized)` 消费 demuxer 的 `Scrcpy4MediaPacket.clientResized` 字段**（见 scrcpy-session.ts:669、useVideoDecoder.ts:53）。demuxer 删除改用 v3 上游 `ScrcpyVideoStreamPacket` 后，**该字段改名 `isClientResize``**（已实拉 v3 上游 media-stream-transformer.ts 确认），flex-client 的调用签名必须同步改 `clientResized` → `isClientResize`。故"保留"成立，但"完全无关 / 零耦合"表述**错误**——它是被 v3 字段改名牵动的 |
| `src/lib/scrcpy4/index.ts` | **保留（导出聚合点）** | 仅 re-export，随上述文件的去留同步调整（demuxer 删后从此文件移除对应导出） |
| `RESIZE_DISPLAY_TYPE = 21` 常量 | **删** | 用 v3 的 `ScrcpyControlMessageType.ResizeDisplay` 枚举替代 |
| `AUDIO_CODEC_FALLBACK` 常量 | **保留** | 音频回退值，与协议版本无关；默认 opus 与官方 scrcpy 默认一致 |
| `options.ts` 第 152-162 行 `[DEBUG-a3f2]` 调试 dump | **删（生产代码净化）** | 这段 `console.log` 前 32 字节 hex/ascii 是诊断残留，不属于功能；升级时应一并清理 |

### 7.4 必须保留的私有逻辑（分类）

**A. 无上游同构、纯业务必要性保留（与"是否 upgraded 库"无关，但 flex-client 字段名受 v3 牵动）：**
1. **`controller-health.ts` 控制链路健康状态机**：车机 WebUSB 抖动场景独有（S1-P0-1 触控修复的根基），纯业务逻辑，**不 import 任何 `@yume-chan/*`**，上游 yume-chan 无此概念（无同构），必须保留。
2. **`flex-client.ts` flex display 反抖动状态机**：车机虚拟屏 resize 场景独有，纯业务逻辑。⚠️ **但非"零耦合"**：它通过 `onSessionPacket(w, h, clientResized)` 接收 demuxer 产出的 `Scrcpy4MediaPacket.clientResized`；demuxer 删除后改用 v3 上游包，`clientResized` 字段改名 `isClientResize`（已实拉上游确认），flex-client 调用签名须同步改。**结论：保留文件，但升级 v3 时必须改这一处字段名。**

**B. options 层需随升级 v3 调整的私有扩展：**
3. **`audioBufferMs` / `audioOutputBufferMs` 透传**（`options.ts` serialize 内）：~~此前判为"唯一私有逻辑必须保留"~~ —— **经 GitHub 实拉官方 v4.0 源码核实，应判为「无效透传，删除」**。理由：① `--audio-buffer`/`--audio-output-buffer` 是桌面 client 的**本地播放缓冲**参数（scrcpy.c → `sc_audio_player_init`），非 server 参数；② server 端 `Options.java` 的 `parse()` **无此 key**，未知 key 静默忽略（`Ln.w("Unknown server option")`）；③ 本项目 Web 直连 server、无 SDL 播放器，该值唯一去向是拼进 server 启动参数，对架构零作用；Web 侧解码器从不读取。删除不影响任何功能（详见 §7.4.1 第 3 行佐证）。
4. **音频 codec 容错重写（防御性兜底，非"定制 server 专属"）**：官方 v4.0 server 仅 OPUS/AAC/FLAC/RAW，不可能发出 `0x32333034`（sha256 比对已证 server 是官方原版；该值 ASCII 为 "3204" 非任何 codec 名）。原 ADR-0016 称"定制 server 上报"已被推翻。此重写实为**防御性兜底**——防的是真机环境里非预期音频标签（OEM 预装其它 scrcpy 进程/残留/并发会话干扰）。升级 v3 后实测 v3 原生 `parseAudioStreamMetadata` 对未知标签的行为：若 v3 已容错或真机不再出现该值，则删；若仍出现且上游抛错，则保留。

> 注：A 组（1/2 条）与"是否升级 yume-chan"无关，无论库怎么升级都应保留（flex-client 仅字段名受牵动，见上）。只有 B 组（3/4 条）会在升级 v3 后随 `AdbScrcpyOptions3_3_3` → `AdbScrcpyOptions4_0` 的迁移而调整写法。`video/demuxer.ts` 经核实**已由 v3 上游原生覆盖，可删**（见 §7.3）。

### 7.4.1 保留项复核结论（依"上游同构 / 业务必要"二分法逐条复核）

用户要求：所有"保留项"必须复核——上游是否已提供同构实现？若已同构则可删；若确属业务必要则保留。复核结果：

| # | 保留项 | 上游 v3 是否同构 | 业务必要性 | 复核结论 |
|---|---|---|---|---|
| 1 | `controller-health.ts` | ❌ 无同构（yume-chan 无"control-socket 健康状态机"概念） | ✅ 车机 WebUSB 抖动场景独有（S1-P0-1 触控修复根基） | **保留，且零改写** |
| 2 | `flex-client.ts` | ❌ 无同构（yume-chan 无"flex display 反抖动"概念） | ✅ 车机虚拟屏 resize 场景独有 | **保留，但升级 v3 时改一处字段名 `clientResized`→`isClientResize`**（受 demuxer 删除牵动，非业务无关） |
| 3 | `audioBufferMs`/`audioOutputBufferMs` 透传 | server 端无此 key（v3 `Init` 也无） | ❌ **无业务必要性**：`--audio-buffer`/`--audio-output-buffer` 是桌面 client 的**本地播放缓冲**参数（scrcpy.c → `sc_audio_player_init`），非 server 参数；官方 `Options.java` 的 `parse()` 根本没有该 key，未知 key 静默忽略；本项目 Web 直连 server 无 SDL 播放器，该值唯一去向是拼进 server 启动参数（被忽略），Web 侧从不读取 | **删除（无效透传）**：server 不识别、Web 侧未使用，对当前架构零作用。若真要在 Web 侧降低音频卡顿，正确做法是给 WebCodecs 音频渲染管线加 JS 侧缓冲/抖动补偿，而非发给 server |
| 4 | `parseAudioStreamMetadata` 容错重写 | ⚠️ 上游 v3 已有 `parseAudioStreamMetadata`，但**对未知 codec 标签的容错行为待实测** | ⚠️ 防御性兜底（官方 server 不发 `0x32333034`，根因未坐实） | **降级为"依真机实测决定去留"**：升 v3 后先测 v3 原生解析器对未知标签是否抛错，若不抛错则可删 |

**关键新发现（复核 demuxer 时暴露）**：本项目 `demuxer.ts` 解析 session 包的 `clientResized` 取自 **`dv.getUint8(3) & 0x01`**（第 3 字节 bit0），而 v3 上游取 **`header[0] & 1`**（第 0 字节 bit0）——**字节位置不一致**。若删 demuxer 直接改用 v3 上游包，flex-client 收到的 `isClientResize` 来自 v3 的位定义。升级落地时须**真机验证两者位定义一致**，否则 flex-client 的 pending 清除逻辑会误判（这是此前"v3 完全同构、可直接替换"判断中遗漏的边界）。

### 7.5 server 二进制（结论）
`public/scrcpy-server.jar` 经 sha256 验证为**官方 scrcpy v4.0 原版**（digest `84924bd5…3210f3a`，大小 732226），与 yume-chan 库版本**解耦**——升 v3 不影响它，协议已确认对齐 4.0。

### 7.6 升级落地的具体步骤（分支试水，不碰主分支）
1. 新建分支 `chore/upgrade-yume-chan-v3`。
2. 改 `package.json`：`@yume-chan/*` 从 `^2.x` 改为 `^3.0.0-beta.1`（或锁定 `3.0.0-beta.1`）。注意 **monorepo 路径变化不影响包名**，正常 `npm install` 即可。
3. 改 `src/lib/scrcpy4/options.ts`：
   - `extends AdbScrcpyOptions3_3_3` → `extends AdbScrcpyOptions4_0`（从 `@yume-chan/adb-scrcpy` 导入）。
   - 删除 `version` override、`controlMessageTypes` override、`serialize()` 里 `flex_display`/`keep_active` 部分。
   - 删除 `audio_buffer`/`audio_output_buffer` 透传（经核实为无效透传，server 不识别、Web 侧未使用，见 §7.4.1 第 3 行）。
   - 评估 `parseAudioStreamMetadata` 容错（依真机实测决定去留）。
4. 全局替换 scrcpy 常量 import：`RESIZE_DISPLAY_TYPE` → `ScrcpyControlMessageType.ResizeDisplay`；`AndroidKeyCode` 等确认 v3 仍导出。
5. 跑 `npm run test` / `npm run check` / `npm run lint`（AGENTS.md 强制三件套）。
6. **真机验证**（关键）：用官方 server + 升级后的 v3 跑通镜像、触控、音频；若真机仍出现未知音频 codec 标签（如 `0x32333034`），先定位根因（设备端是否有其它 scrcpy 进程/残留），而非直接假定"定制 server"。
7. 若步骤 6 确认上游无法容错该未知标签且确有来源，则在子类中保留 `parseAudioStreamMetadata` 重写作为兜底。

### 7.6 风险与前置判断
- ⚠️ **v3 是 beta**：API 在 stable 前可能变。建议锁定 `3.0.0-beta.1` 而非 `^3`，避免自动升级到未验证版本。
- ⚠️ **选项系统重构（init-shaped generics）**：本项目现有 `options.ts` 的 `Init` 类型定义需对齐 v3 的 `ScrcpyOptions4_0.Init`，这是主要改写点。
- ✅ **自研层几乎可全删**：除 `controller-health` / `flex-client`（纯业务、无同构）外，`audio_buffer` 透传经核实为无效透传（删）、video/demuxer 由 v3 原生覆盖（删）、其余 override 均由 v3 覆盖（删）。唯一"可能保留"的是 `parseAudioStreamMetadata` 容错兜底，且须真机实测后才决定。
- ✅ **ADB / WebUSB 层完全不动**：`@yume-chan/adb`、`adb-daemon-webusb`、`adb-credential-web` 在 v3 中 API 基本不变（仅 bug fix），无需改写。

---

## 附：GitHub 核实证据链
- Genymobile/scrcpy v4.1（2026-07-12）：VP8/VP9、尺寸约束改进、`--ignore-video-encoder-constraints`、FFmpeg/SDL/libusb 升级。
- Genymobile/scrcpy v4.0（2026-05-12）：flex display、camera torch/zoom、session metadata、video capabilities constraints、`--keep-active` 等。
- yume-chan/ya-webadb v3.0.0-beta.1（2026-08-01）：PR #854「support server version 4.0 and 4.1」。
- yume-chan/ya-webadb v2.6.1（2026-06-04）：仅 bug fix，不含 4.x 支持（即本项目 v2 线现状）。
- **scrcpy-server 原版确认（2026-08-04）**：`public/scrcpy-server.jar` 大小 732226 字节、sha256 = `84924bd564a1eb6089c872c7521f968058977f91f5ff02514a8c74aff3210f3a`，与官方 `scrcpy-server-v4.0` release asset **完全相同** → 字节级官方原版，无任何定制/OEM 修改。
- **官方 v4.0 音频 codec 范围（2026-08-04，读 `server/src/main/java/com/genymobile/scrcpy/audio/AudioCodec.java`）**：仅 `OPUS(0x6f707573)` / `AAC(0x00616163)` / `FLAC(0x666c6163)` / `RAW(0x00726177)` 四种，标签恒为 codec 名 ASCII。**不可能发出 `0x32333034`**（其 ASCII 为 "3204"）。
- **`audio_buffer` / `audio_output_buffer` 透传核实（2026-08-04，实拉官方 v4.0 `app/src/scrcpy.c` + `server/src/main/java/com/genymobile/scrcpy/Options.java`）**：① `scrcpy.c` 中这两个参数仅传给 `sc_audio_player_init()`（桌面 client 本地 SDL 播放缓冲），**非 server 参数**；② server 端 `Options.java` 的 `parse()` 的 `switch` **无 `audio_buffer` / `audio_output_buffer` 分支**，未知 key 走 `default: Ln.w("Unknown server option")` 静默忽略；③ 本项目 Web 直连 server、无 SDL 播放器，该值唯一去向是拼进 server 启动 `args`（被忽略），Web 侧解码器从不读取。结论：**`audio_buffer` 透传对当前架构零作用，应删除**（此前"车机私有扩展、需真机验证"为错误定性）。

## §8 关键事实澄清（2026-08-04 用户质询后修正）

**用户质询**：「我们当时用的就是 scrcpy 官方的 4.0 server 文件，难道比对后发现我们的 server 修改了东西？这些修改是必要的吗？」

**核实结论**：
1. **`public/scrcpy-server.jar` 是官方 scrcpy v4.0 原版**，sha256 比对字节级一致（证据见上）。项目中**无任何 server 定制痕迹**：`patches/` 只有 `adb-daemon-webusb` 的 AbortError 补丁；无 server 源码、无 vendor、无 submodule；构建链路只是把本地 jar fetch 出去，没有"编译定制 server"步骤。
2. **`0x32333034` 不可能来自官方 server**。官方 v4.0 `AudioCodec.java` 仅四种标准 codec，且该值 ASCII 为 "3204" 非任何 codec 名。原 ADR-0015/0016 称"车机定制 server 上报私有标签"的说法**已被事实推翻**——更可能的解释是：真机设备上存在车机 OEM ROM 预装的其它 scrcpy 进程/旧 server 残留，或原作者观察时并发会话干扰导致误判。
3. **`options.ts` 的 `parseAudioStreamMetadata` 容错重写是"防御性兜底"而非"定制 server 专属"**。它让音频连接不因未知标签崩溃是对的，但根因从未被坐实（ADR-0016 自身标注"待真机复核"）。**已实测 v3 原生解析器（2026-08-04）：v3 对未知标签抛错、不容错**（§9.1），故升级时**保留此兜底重写**是必要的（防真机非预期标签），待真机确认不再出现未知标签后再考虑删除。
4. ~~**真正私有的、必须保留的只有 `audio_buffer`/`audio_output_buffer` 透传**~~ —— **已被推翻（2026-08-04）**：实拉官方 v4.0 源码证实这两个参数是**桌面 client 本地播放缓冲**（`scrcpy.c` → `sc_audio_player_init`），server 端 `Options.java` 无此 key 且静默忽略，本项目 Web 直连 server、无 SDL 播放器、Web 侧从不读取 → **无效透传，应删除**。详见 §7.3 / §7.4.1 第 3 行与证据链。

**对升级方案的影响**：§7 中"必须保留定制 server 逻辑"的表述已全部修正为"保留防御性兜底（parseAudioStreamMetadata，已实测 v3 不容错）"。"私有透传"（audio_buffer）已删除。

**遗留待办**：真机验证时若仍出现未知音频 codec 标签，应先 `adb shell ps | grep scrcpy` 确认设备端是否跑了多个 scrcpy 进程，定位真正来源，再决定兜底策略。

---

## §9 v3 升级前兼容性审计（2026-08-04 完成，升级前置最后检查）

> 方法：用 GitHub 连接器实拉 yume-chan/ya-webadb `v3.0.0-beta.1` 各包源码，逐一核对本项目 20 处 `@yume-chan/*` import（§1 表 + grep 实测）的符号存续性。

### 9.1 v3 上游行为实测结论

| 验证项 | v3 实测行为 | 对本项目的影响 |
|---|---|---|
| `parseAudioMetadataCodec`（未知音频 codec 标签） | **抛 `Unknown audio codec metadata value`**（`libraries/scrcpy/src/2_3/impl/parse-audio-stream-metadata.ts`） | `parseAudioStreamMetadata` 容错重写**必须保留**（防御性兜底） |
| `parseAudioStreamMetadata` 参数语义 | v3 4_0 用 `sendStreamMeta`；3_0 用 `sendCodecMeta`（版本差异） | 本项目 override 原用 `sendCodecMeta ?? true`，升级后对齐 4_0 语义 |
| `AdbScrcpyOptions4_0` 基类 | **直接 `extends ScrcpyOptions4_0`**（不再继承 3_3_3）；`serialize()` 无参由基类实现；构造 `(init, clientOptions?)`；`version = clientOptions?.version ?? "4.0"` | "继承 3_3_3 + override 5 方法"模式整体废弃，重写 options.ts |
| `AdbScrcpyClient` | 保留；`videoStream` getter 类型变为 `AdbScrcpyVideoStream`（新 video.ts 类） | 消费端（useVideoDecoder.ts）对接类型调整 |
| `AdbScrcpyExitedError` | 保留；构造签名变为 `(output: readonly string[])` + `Symbol.hasInstance` | scrcpy-session.ts 使用处核对（若只判断类型则兼容） |
| `ScrcpyControlMessageWriter` | 保留；构造 `(writer, options)`；**新增 `resizeDisplay()` 方法** | ① 构造传参变化；② 自研 `resize-display.ts` 可删，改用 `writer.resizeDisplay()` |
| `AdbDaemonTransport.authenticate()` | **删除**，改为独立函数 `adbDaemonAuthenticate({serial, connection, credentialManager})`（`daemon/auth/authenticator.ts`）；参数名 `credentialStore` → `credentialManager` | **useUsbConnection.ts 必须改写**（7 处破坏性变更之一） |
| `adb-credential-web` | `AdbWebCredentialStore`（default）**删除**，改为 `AdbWebCryptoCredentialManager`（named，`(storage: TangoKeyStorage, name?)`） | **useUsbConnection.ts import 改写** |
| `WebCodecsVideoDecoder` | 保留；构造 `{codec, renderer?, hardwareAcceleration?, optimizeForLatency?}`；自带 renderer 管线；`render/webgl.ts` 存在 | 构造参数核对；`esm/video/render/webgl.js` 动态 import 路径待 npm install 后验证 |
| `ScrcpyMediaStreamPacket` | **删除**，改 `ScrcpyVideoStreamPacket`（`base/media.ts`：session 包字段 `isClientResize`） | options.ts import 改写 + demuxer 对接字段名 |

### 9.2 本项目 import 符号 vs v3 存续清单

**✅ v3 保留（无需改动）**：`Adb`、`AdbNoneProtocolProcess`、`AdbNoneProtocolSpawner`、`AdbDaemonTransport`（class，仅 authenticate 移走）、`AdbDaemonWebUsbDevice`、`AdbDaemonWebUsbDeviceManager`、`AdbDaemonWebUsbDeviceObserver`、`AdbScrcpyClientOptions`、`ScrcpyControlMessageType`、`ScrcpyVideoCodecId`、`ScrcpyAudioCodec`、`ScrcpyAudioStreamMetadata`、`ScrcpyVideoStream`、`ScrcpyNewDisplay`、`ScrcpyCaptureOrientation`、`ScrcpyLockOrientation`、`ScrcpyOrientation`、`AndroidKeyCode`、`AndroidKeyEventAction`、`AndroidMotionEventAction`、`getUint32BigEndian`、`decodeUtf8`、stream-extra 的 `ReadableStream`/`TransformStream`/`BufferedReadableStream`/`PushReadableStream`。

**⚠️ v3 破坏性变更（升级必须改，共 7 处）**：
1. `AdbScrcpyOptions3_3_3`（options.ts 继承基类）→ `AdbScrcpyOptions4_0`（直接 extends `ScrcpyOptions4_0`，非继承 3_3_3）
2. `ScrcpyMediaStreamPacket`（type）→ `ScrcpyVideoStreamPacket`（字段 `clientResized` → `isClientResize`）
3. `AdbDaemonTransport.authenticate()` → `adbDaemonAuthenticate()` 独立函数
4. `AdbWebCredentialStore`（default import）→ `AdbWebCryptoCredentialManager`（named import）
5. `AdbScrcpyExitedError` 构造签名（`(output)`）
6. `ScrcpyControlMessageWriter` 构造签名（`(writer, options)`）
7. `WebCodecsVideoDecoder` 构造参数（renderer 内置化）

### 9.3 升级前最终准备清单（分支 `chore/upgrade-yume-chan-v3`）

**前置（零风险，可独立先提交）**：
- [ ] 删 `@yume-chan/event`（零 import 死依赖）
- [ ] 原生替换 `decodeUtf8` / `getUint32BigEndian`（options.ts 重写后可能直接不再需要）
- [ ] 清理 `[DEBUG-a3f2]` console.log dump（options.ts 152-162 行）

**升级主流程**：
- [ ] `package.json` 全部 `@yume-chan/*` → `3.0.0-beta.1`（锁版本不用 `^3`）
- [ ] **`useUsbConnection.ts` 改写**（§9.2 变更 3/4）：`adbDaemonAuthenticate({serial, connection, credentialManager})` + `AdbWebCryptoCredentialManager`（storage 用 v3 indexed-db/local-storage 实现，待 install 后确认具体工厂）
- [ ] **`options.ts` 重写**（§9.2 变更 1/2 + §7.3 删除项）：`extends AdbScrcpyOptions4_0`；删 version/controlMessageTypes/serialize 追加/demuxer override/audio_buffer 透传；**保留 `parseAudioStreamMetadata` 容错重写**（对齐 v3 4_0 `sendStreamMeta` 语义，传自定义容错 `parseMetadataCodec`）；删 `RESIZE_DISPLAY_TYPE` 用 `ScrcpyControlMessageType.ResizeDisplay`
- [ ] `useVideoDecoder.ts` / `scrcpy-session.ts`：`Scrcpy4MediaPacket` → v3 包类型；`clientResized` → `isClientResize`；`ScrcpyControlMessageWriter` 构造适配；`AdbScrcpyVideoStream` 类型对接
- [ ] `flex-client.ts` 调用签名字段名同步改
- [ ] 三件套 `npm run test` / `check` / `lint` 全绿
- [x] **真机/浏览器实测（2026-08-04，用户实机暴露）**：① `isClientResize` 位定义 —— 待真机确认；② 音频未知 codec —— 待真机确认；③ `esm/video/render/webgl.js` 动态 import —— 构建已验证分包正常；④ **发现并修复 v3 beta 的 adb-credential-web IndexedDB 双 bug（见 §10）**

## §10 实测发现的 v3 beta bug 与修复（2026-08-04，用户浏览器实测暴露）

**现象**：USB 连接时控制台刷屏 `AbortError: The transaction was aborted`，最终 `Error: callback must not be an async function`（`shared.ts`）→ 认证链路（`AdbWebCryptoCredentialManager.iterateKeys`）全挂，无法连接。

**根因 1 —— `createTransaction` 拒绝 Promise callback（`shared.js/shared.ts`）**：
- v3.0.0-beta.1 的 `createTransaction` 检测 `callback(transaction)` 返回 `instanceof Promise` 即抛 `"callback must not be an async function"`；
- 但 `v2.js` 的 `load()` 与 `getAllKeysV1()` 把 `waitRequest(store.getAll())`（Promise）作为 callback 返回值 → **load 必炸**（认证 iterateKeys 即走此路径）。

**根因 2 —— 缓存 db 连接 close 后未重置（`v2.js/v2.ts`）**：
- `#openDatabasePromise` 缓存 db 连接，但 `save()/load()/clear()` 每次 `finally { db.close() }` 后**不重置缓存**；
- 修复根因 1 后暴露：下一次操作在已关闭的 db 上 `database.transaction()` 抛 `InvalidStateError`。

**修复（patch-package，`patches/@yume-chan+adb-credential-web+3.0.0-beta.1.patch`，esm+src 四段 diff）**：
1. `createTransaction` 允许 Promise callback：`returned.then(r => result = r, e => { reject(e); transaction.abort(); })` —— IDB request `onsuccess` 在事务 `complete` 之前触发，`result` 赋值时序正确；
2. `save()/load()/clear()` 的 `finally` 里 `db.close()` 后 `this.#openDatabasePromise = undefined`。

**验证**：fake-indexeddb 实测 4 场景全过 —— ① 首次 `iterateKeys`（空库，原 AbortError）；② `generateKey`（原 InvalidStateError）；③ 再次 `iterateKeys` 读到 1 key；④ 新 manager 实例读到同一持久化 key。三件套 + build 全绿。

> 上游影响：此 bug 在 yume-chan v3.0.0-beta.1 存在（`v2.js` 与 `shared.js` 内部不一致），修复已本地化；升级到修复版前补丁需保留。
