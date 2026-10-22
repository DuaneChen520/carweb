# ADR-0016: 专用音频连接启动崩溃的修复（音频流元数据容错解析）

- 状态：已落地，待真机复核（2026-07-14）
- 相关：ADR-0015（专用音频采集连接架构）、ADR-0017（scrcpy 4.0 flex display 迁移）

> ⚠️ **正文根因表述已被推翻**，以文末「附录：事实更正（2026-10-22）」为准：
> `public/scrcpy-server.jar` 是**官方 scrcpy v4.0 原版**（sha256 逐字节核对），不存在「车机 OEM 定制 server」；
> `0x32333034` 不是私有 codec 标签，而是 **`sendDeviceMeta` 写入音频 socket 的 64 字节设备名的前 4 字节**。
> 正文保留原判断过程以存档。

---

## 背景（Context）

ADR-0015 落地后，真机 Console 暴露**第二个**根因：专用音频采集连接（`audioOnly:true`，`displayId:0`）启动失败，并非无声而是直接抛错：

```
scrcpy-session.ts:654 [ScrcpySession:...] 启动失败: Error: Unknown audio codec metadata value: 842215476
    at parseAudioStreamMetadata (parse-audio-stream-metadata.ts:49:23)
    at async _AdbScrcpyClient.createAudioStream_fn (client.ts:364:13)
```

`842215476 = 0x32333034`。此错误发生在 `_ensureAudioCapture` 拉起的专用连接上，导致 `start()` reject → `SessionManager` 捕获并注销该连接（`_ensureAudioCapture` 的 try/catch）——**分屏桌面仍能正常启动，但音频依旧缺失**。即 ADR-0015 解决了一层（多 pane 争抢 `disabled`），但专用连接自身撞上了这一层。

## 真因（源码坐实，2026-07-14）

1. `@yume-chan/scrcpy@2.3.0` 的 `parseAudioStreamMetadata`（`base/audio.ts` + `2_0/impl/parse-audio-stream-metadata.ts`）只认识 **4 种**编解码器标签：
   - `OPUS  = 0x6f707573`（`"opus"`）
   - `AAC   = 0x00616163`（`"aac "`)
   - `FLAC  = 0x666c6163`（`"flac"`）
   - `RAW   = 0x00726177`（`"raw "`）  
   其余值一律 `throw new Error("Unknown audio codec metadata value: ...")`。

2. **官方 scrcpy 4.0 的 `AudioCodec.java` 定义的也是完全相同的 4 种、相同值**（已对 v4.0 tag 源码核实：`OPUS(0x6f_70_75_73,"opus",...)` / `AAC(0x00_61_61_63,"aac",...)` / `FLAC` / `RAW`）。即标准 scrcpy（含 4.0）的音频元数据格式与标签集是固定的。

3. 本项目设备端运行的是**项目自带的定制版 `public/scrcpy-server.jar`**（车机 OEM 修改的 scrcpy server）。它上报的音频编解码器标签是 `0x32333034`，**不属于上述 4 种标准值** → 库不认识 → 抛错。

4. `AdbScrcpyOptions4_0` 此前**只重写了 `parseVideoStreamMetadata`**（因 4.0 视频元数据格式变了），**未重写 `parseAudioStreamMetadata`**，于是沿用了 2.0 解析器 → 遇到私有标签直接抛 `Unknown audio codec metadata value`。

关键澄清：这与 ADR-0015 的「并发 `audio:true` 争抢 `disabled`」是**两个独立问题**：
- 虚拟屏 pane 拿不到音频是因为**虚拟显示本就没有音频**（server 返回 `disabled`）——ADR-0015 已通过 `audio:false` 处理；
- 专用连接（`displayId:0`，主屏有音频）拿不到音频是因为**定制 server 的私有编解码器标签**被库拒绝——本 ADR 处理。
二者叠加，解释了「这台设备浏览器端音频从未工作过」。

## 决策（Decision）

### D1：重写 `AdbScrcpyOptions4_0.parseAudioStreamMetadata`，对未知标签容错

逻辑（`src/lib/scrcpy4/options.ts`）：
- `0x00000000` / `0x00000001` → 仍透传 `disabled` / `errored`（标准语义不变）；
- `0x32333034` 等**未知标签** → **不抛错**，回退到协商的 `audioCodec`，正常消费 4 字节元数据（因 `sendCodecMeta=true` 时这 4 字节就是元数据，不能回推），并打诊断日志：
  ```
  [AdbScrcpyOptions4_0] 未知音频编解码器标签 0x32333034，回退到协商 audioCodec=opus（设备定制 scrcpy server）
  ```
- `sendCodecMeta=false` 分支：4 字节是真实音频数据，照原逻辑回推到流、按协商 `audioCodec` 推断（同样容错）。

### D2：单一旋钮 `AUDIO_CODEC_FALLBACK`（默认 `"opus"`）

- 从 `scrcpy4/options.ts` 导出 `AUDIO_CODEC_FALLBACK`，并在 `scrcpy-session.ts` 的 options 构造里设为 `audioCodec: AUDIO_CODEC_FALLBACK`。
- **一个旋钮同时控制「发给 server 的 `--audio-codec` 请求」与「解析未知标签时的回退 codec」**，避免两处不一致。
- 默认 `opus`：scrcpy 默认编码器，且定制 server 大概率沿用其默认编码；`setupAudioStream` 用 `codec.webCodecId` 配置 WebCodecs 解码器（Opus→`"opus"`，Aac→`"mp4a.66"`）。
- 若设备实际用 AAC（无 Opus 编码器），把常量改为 `"aac"` 即可，`index.ts` 已随 `AdbScrcpyOptions4_0` 一并导出。

### D3：测试锁定

`src/lib/scrcpy4/__tests__/options.test.ts` 新增 5 例：
- 未知标签 `0x32333034` → `success` + `webCodecId==="opus"`（**不抛错**）；
- 标准 `opus` 标签 `0x6f707573` → `success` + `opus`；
- `0x00000000` / `0x00000001` → `disabled` / `errored` 透传；
- `sendCodecMeta=false` + `audioCodec:"aac"` → `success` + `webCodecId==="mp4a.66"`（音频数据回推路径）。

### D4：官方核对结论 + opus→aac 自动自愈（2026-07-14 补，回应「直接核对 scrcpy 官方实现」）

**官方核对（scrcpy v4.0 源码 `AudioCodec.java` / `AudioEncoder.java` / `doc/audio.md` 坐实）：**
- 标准 scrcpy 音频编解码器**仅 4 种**，且 4 字节标签恒为 codec 名 ASCII：`OPUS=0x6f707573`、`AAC=0x00616163`、`FLAC=0x666c6163`、`RAW=0x00726177`；`opus` 是**默认**。
- server（`AudioEncoder`）用 `Streamer.getCodec()` 选定编码，`writeAudioHeader()` 把**该 codec 的 `getId()`（即上述标准标签）**写回 client——**写回的标签永远等于它真正编码的 codec**。
- `doc/audio.md` 官方指引：若 `Failed to initialize audio/opus`（设备无 Opus 编码器），应改用 `--audio-codec=aac`。
- **推论**：设备上报 `0x32333034`（四者皆非）只能来自定制 server 私有标签。该 server 要么「编码了我们请求的 codec、仅标签写成私有」，要么「忽略 `--audio-codec` 请求、自定编码」。这两种情况都无法从标签本身区分，必须靠解码结果判定。

**因此 D1/D2 的「默认 opus 回退」与官方默认一致；但为彻底消除「手动翻旋钮」的猜测环节，新增自动自愈：**

- `ScrcpySession`：`onAudioDecodeError?(sessionId)` 回调；`setupAudioStream` 的 worker `error` 消息（解码器 `error` 事件经 worker 内部 3 次同 codec 重试后仍失败才上抛）现在上抛此回调。`StartOptions` 新增 `audioCodecOverride?: typeof AUDIO_CODEC_FALLBACK`，`start()` 用其覆盖 `audioCodec`（默认仍 `AUDIO_CODEC_FALLBACK`）。
- `SessionManager`：
  - state 新增 `audioCaptureCodec` / `audioCaptureRetried`；`_ensureAudioCapture(adb, codec='opus')` 接受 codec 参数，且同一 codec 已存在则复用、不同则先停旧的再起新的；
  - 专用音频连接的 `onAudioDecodeError` 回调：若当前是 `opus` 且**未重试过** → 置 `audioCaptureRetried` 并 `void _ensureAudioCapture(liveAdb, 'aac')`（自动改用 aac 重试）；若已是 `aac` 或已重试 → 仅打 `已无更多回退` 日志，不无限循环。
  - `_stopAudioCapture` / `setAdb` 清理时一并重置 `audioCaptureCodec` / `audioCaptureRetried`。
- 这与官方 `opus → aac` 回退指引**完全对齐**：用户不再需要看日志手动改常量，解码失败会自动尝试另一种官方支持的编码。

### D5：测试锁定（自愈）

`src/lib/__tests__/audio-capture-self-heal.test.ts` 新增 2 例（mock `ScrcpySession` 捕获 `onAudioDecodeError` 回调）：
- opus 解码失败 → 自动改用 `aac` 新建第二个 session（且首次 `start` 携带 `audioCodecOverride:'aac'`）；
- aac 仍失败 → **不再**新建第三个 session（无更多回退），验证不 infinite-loop。

## 后果与权衡（Consequences）

- ✅ 专用音频连接不再因未知 codec 崩溃，分屏桌面启动链路健壮；`_ensureAudioCapture` 的 try/catch 仍是兜底，但正常情况下不再触发。
- ✅ 默认 opus 与官方 scrcpy 默认一致（D1/D2），且通过 **opus→aac 自动自愈（D4）** 兜底「设备实际用 aac」的情况——与官方 `--audio-codec=aac` 回退指引对齐，用户无需手动翻旋钮。
- ✅ 尽力解码：未知标签映射到协商 `audioCodec`，解码器按 `webCodecId` 配置，链路自洽；自愈只尝试官方支持的编码，不会误试 flac/raw。
- ⚠️ 仍受定制 server 不确定性约束：若定制 server 既上报未知标签、又自定编码为 flac/raw（极少见），opus→aac 两次尝试均失败，最终静默无声；此时需把 `AUDIO_CODEC_FALLBACK` 直接设为对应值（并已加 `audioCodecOverride` 通道支撑）。属极小概率，且日志会打出标签十六进制值便于定位。
- ⚠️ 证实「该设备浏览器端音频从未工作」：定制 server 的私有标签是一层独立 blocker，ADR-0015 解决并发层、本 ADR 解决编解码器层。

## 验证

- `tsc --noEmit` 0 错误。
- 测试合计 **36/36 通过**：
  - `options.test.ts` 11（含 5 例音频解析容错）；
  - `scrcpy-session.test.ts` 18；
  - `session-manager-launch-gate.test.ts` 5；
  - `audio-capture-self-heal.test.ts` 2（opus→aac 自愈 + 不无限重试）。
- 真机预期：专用音频连接成功启动（Console 见「未知音频编解码器标签 0x32333034，回退到协商 audioCodec=opus」警告），用户手势后浏览器播放设备整机声音；**若设备实际编码为 aac，会自动重试并出声，无需手动改常量**。若两次尝试后仍无声，检查 Console 的回退标签值，必要时把 `AUDIO_CODEC_FALLBACK` 设为对应编码。

---

## 附录：事实更正（2026-10-22）

### 更正一：本仓库的 `public/scrcpy-server.jar` 并非「车机 OEM 定制版」，而是 Genymobile/scrcpy 官方 v4.0 产物

以 SHA-256 核验（`sha256sum public/scrcpy-server.jar`）：

```
84924bd564a1eb6089c872c7521f968058977f91f5ff02514a8c74aff3210f3a  public/scrcpy-server.jar
```

该值与 Genymobile/scrcpy **v4.0** 官方发布包 `server/scrcpy-server.jar` 的 `SHA256SUMS.txt` 一致（官方校验和已逐字节比对确认）。

**影响**：本 ADR 正文（以及 ADR-0015、GLOSSARY.md）原先把 `0x32333034` 的来源归因为「车机 OEM 修改的 scrcpy server 上报私有标签」——**该归因不成立**。既然设备端运行的就是官方 v4.0 server，而官方 `AudioCodec.java` 只定义 `OPUS/AAC/FLAC/RAW` 四种标签且写回的必然是它真正编码的 codec，官方 server **不可能**上报 `0x32333034`。

### 更正二：`0x32333034` 不是 codec 标签，而是**设备名**的前 4 字节（真因已定位并已修复）

真实链路（2026-07-14 下午定位）：

```
hex:   32 33 30 34 46 50 4e 36 44 43 00 00 00 00 00 00 ...
ascii: "2304FPN6DC......................"
```

- scrcpy server 在**第一个 socket** 上写入 **64 字节设备名**（官方 `sendDeviceMeta` 选项，默认 `true`）。
- `video:true` 时设备名写入**视频** socket——`parseVideoStreamMetadata` 正确跳过这 64 字节。
- `video:false`（即 `audioOnly` 专用音频连接）时，设备名改写入**音频** socket——而 `parseAudioStreamMetadata` **没有跳过这 64 字节**，直接把设备名的前 4 字节当成了 codec 标签。

故 `0x32333034` = 设备名 `"2304FPN6DC…"` 的前缀，与 codec 无关；官方 server 不可能上报它。

**已落地的修复**（代码现仍在位）：
- `ScrcpySession.start` 构建 options 时显式设置 `sendDeviceMeta: !audioOnly`（`src/lib/scrcpy-session.ts`），`audioOnly` 连接关闭设备名写入，从源头杜绝污染；
- `SessionManager._ensureAudioCapture` 传 `audioOnly:true`；
- 期间尝试过的 `drainVideo` workaround（`video:true` + 排空视频流）已**撤销**（浪费 CPU 编码视频）。

### 更正三：决策本身仍然成立，保留

- **D1（未知标签容错回退）**：保留，但定性为**防御性兜底**——防止真机环境下出现非预期音频标签时整条音频连接崩溃；官方 server 的四种标准标签已能正常解析。
- **D2（`AUDIO_CODEC_FALLBACK` 单一旋钮）**：保留。
- **D4（opus→aac 自动自愈）**：保留，且与官方 `doc/audio.md` 的回退指引一致。

### 遗留待办

1. 真机复核：确认 `sendDeviceMeta:false` 生效后，专用音频连接能读到**标准** codec 标签（`0x6f707573` / `0x00616163`），且整机声音可闻。
2. 若仍读不到标准标签，采集音频 socket 首包（hex + ASCII 双视图）定位偏移。
3. 观察 `AUDIO_CODEC_FALLBACK` 容错告警在真机上是否还会出现——若长期不再出现，可评估是否收敛该兜底逻辑（但建议保留）。
