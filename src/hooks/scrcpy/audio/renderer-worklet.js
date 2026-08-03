/**
 * 车机音频播放 worklet（S2-P0-1 改造）。
 *
 * 变更说明（相对 ya-webadb pcm-player 衍生版本）：
 * - 删除 WSOLA 变速播放（speedUp / SCALE=0.9 / WINDOW_WEIGHT_TABLE / processSpeedUp）：
 *   变速在传输抖动时表现为「忽快忽慢、音调漂移」且让音频渲染线程过载（逐样本线性扫描），
 *   是车机「音频卡顿不连贯」的直接来源之一；
 * - 水位管理改为纯「起步缓冲 + 丢最旧（drop-oldest）+ underrun 静音」：
 *   - STARTING_THRESHOLD：0.1s → 0.25s（攒够再播，避免启动即欠载）；
 *   - MAX_BUFFER：0.35s → 0.8s（WebUSB 抖动缓冲），超限丢最旧 chunk，不做变速；
 *   - underrun（无数据）：输出静音帧，等待下一包到达继续；
 * - 采样率：解码 worker 输出前已统一重采样到 48000（decoder-worker.ts），此处不再处理。
 *
 * 实时安全：process() 内无数组扫描/求和（handleMessage 用增量计数器），仅顺序拷贝。
 */
const STARTING_THRESHOLD = 0.25; // 起步缓冲水位（秒）
const MAX_BUFFER = 0.8;          // 最大缓冲水位（秒），超限丢最旧
const SAMPLE_RATE = 48000;       // 解码输出已统一到 48000

class Float32SourceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channelCount = options.outputChannelCount?.[0] ?? 2;
    this.chunks = [];
    this.chunkSampleCounts = [];
    this.totalSampleCount = 0;
    this.mode = 'starting';

    this.port.onmessage = this.handleMessage.bind(this);
  }

  handleMessage(event) {
    const data = event.data;

    if (data.type === 'pcm') {
      const float32 = new Float32Array(data.buffer);
      const sampleCount = float32.length / this.channelCount;

      // drop-oldest：缓冲超上限时丢弃最旧 chunk（保留既有机制，阈值已调大）
      while (this.totalSampleCount > MAX_BUFFER * SAMPLE_RATE && this.chunks.length > 0) {
        this.chunks.shift();
        const dropped = this.chunkSampleCounts.shift() ?? 0;
        this.totalSampleCount -= dropped;
      }

      this.chunks.push(float32);
      this.chunkSampleCounts.push(sampleCount);
      this.totalSampleCount += sampleCount;
    } else if (data.type === 'reset') {
      this.chunks = [];
      this.chunkSampleCounts = [];
      this.totalSampleCount = 0;
      this.mode = 'starting';
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outputLength = output[0].length;

    // 起步缓冲：攒够 STARTING_THRESHOLD 才开播，避免 WebUSB 抖动导致启动即欠载
    if (this.mode === 'starting') {
      if (this.totalSampleCount < STARTING_THRESHOLD * SAMPLE_RATE) {
        for (let ch = 0; ch < this.channelCount; ch++) {
          if (output[ch]) output[ch].fill(0);
        }
        return true;
      }
      this.mode = 'normal';
    }

    // 顺序拷贝；无数据（underrun）时输出静音帧
    this.processNormal(output, outputLength);

    return true;
  }

  processNormal(output, outputLength) {
    let outputIndex = 0;

    while (this.chunks.length > 0 && outputIndex < outputLength) {
      const chunk = this.chunks[0];
      const chunkFrames = this.chunkSampleCounts[0];
      let readIndex = 0;

      while (readIndex < chunkFrames && outputIndex < outputLength) {
        for (let ch = 0; ch < this.channelCount; ch++) {
          output[ch][outputIndex] = chunk[readIndex * this.channelCount + ch];
        }
        readIndex++;
        outputIndex++;
      }

      if (readIndex >= chunkFrames) {
        this.chunks.shift();
        this.chunkSampleCounts.shift();
        this.totalSampleCount -= chunkFrames;
      } else {
        this.chunks[0] = chunk.subarray(readIndex * this.channelCount);
        this.chunkSampleCounts[0] = chunkFrames - readIndex;
        this.totalSampleCount -= readIndex;
      }
    }

    while (outputIndex < outputLength) {
      for (let ch = 0; ch < this.channelCount; ch++) {
        output[ch][outputIndex] = 0;
      }
      outputIndex++;
    }
  }
}

registerProcessor('float32-source-processor', Float32SourceProcessor);
