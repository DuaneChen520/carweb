const STARTING_THRESHOLD = 0.1;
const SPEED_UP_THRESHOLD = 0.25;
const RECOVER_THRESHOLD = 0.15;
const MAX_BUFFER = 0.35;
const SAMPLE_RATE = 48000;

const INPUT_HOP_SIZE = 3000;
const SCALE = 0.9;
const OUTPUT_HOP_SIZE = (INPUT_HOP_SIZE * SCALE) | 0;
const WINDOW_SIZE = 6000;

const WINDOW_WEIGHT_TABLE = new Float32Array(WINDOW_SIZE);
for (let i = 0; i < WINDOW_SIZE / 2; i++) {
  const value = Math.sin((i / WINDOW_SIZE) * Math.PI);
  WINDOW_WEIGHT_TABLE[i] = value;
  WINDOW_WEIGHT_TABLE[WINDOW_SIZE - i - 1] = value;
}

class Float32SourceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channelCount = options.outputChannelCount?.[0] ?? 2;
    this.readBuffer = new Float32Array(this.channelCount);
    this.chunks = [];
    this.chunkSampleCounts = [];
    this.totalSampleCount = 0;
    this.mode = 'starting';
    this.readOffset = 0;
    this.inputOffset = 0;
    this.outputOffset = 0;

    this.port.onmessage = this.handleMessage.bind(this);
  }

  handleMessage(event) {
    const data = event.data;

    if (data.type === 'pcm') {
      const float32 = new Float32Array(data.buffer);
      const sampleCount = float32.length / this.channelCount;

      while (this.totalSampleCount > MAX_BUFFER * SAMPLE_RATE) {
        this.chunks.shift();
        this.chunkSampleCounts.shift();
        this.totalSampleCount = this.chunkSampleCounts.reduce((a, b) => a + b, 0);
      }

      this.chunks.push(float32);
      this.chunkSampleCounts.push(sampleCount);
      this.totalSampleCount += sampleCount;
    } else if (data.type === 'reset') {
      this.chunks = [];
      this.chunkSampleCounts = [];
      this.totalSampleCount = 0;
      this.mode = 'starting';
      this.readOffset = 0;
      this.inputOffset = 0;
      this.outputOffset = 0;
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outputLength = output[0].length;

    if (this.mode === 'starting') {
      if (this.totalSampleCount < STARTING_THRESHOLD * SAMPLE_RATE) {
        for (let ch = 0; ch < this.channelCount; ch++) {
          if (output[ch]) output[ch].fill(0);
        }
        return true;
      }
      this.mode = 'normal';
    }

    if (this.mode === 'speedUp' && this.totalSampleCount < RECOVER_THRESHOLD * SAMPLE_RATE) {
      this.mode = 'normal';
      this.advanceInputOffset();
      this.readOffset = 0;
      this.inputOffset = 0;
      this.outputOffset = 0;
    }

    if (this.mode === 'normal' && this.totalSampleCount > SPEED_UP_THRESHOLD * SAMPLE_RATE) {
      this.mode = 'speedUp';
      this.readOffset = 0;
      this.inputOffset = 0;
      this.outputOffset = 0;
    }

    if (this.mode === 'speedUp') {
      this.processSpeedUp(output, outputLength);
    } else {
      this.processNormal(output, outputLength);
    }

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

  processSpeedUp(output, outputLength) {
    for (let i = 0; i < outputLength; i++) {
      let totalWeight = 0;

      const firstWindow = Math.max(0,
        Math.floor((this.outputOffset - WINDOW_SIZE) / OUTPUT_HOP_SIZE) + 1
      );

      let inWindowIndex = this.outputOffset - firstWindow * OUTPUT_HOP_SIZE;
      let inputIndex = firstWindow * INPUT_HOP_SIZE + inWindowIndex;

      for (let ch = 0; ch < this.channelCount; ch++) {
        output[ch][i] = 0;
      }

      while (inputIndex > 0 && inWindowIndex >= 0) {
        this.readSample(inputIndex - this.readOffset);
        const weight = WINDOW_WEIGHT_TABLE[inWindowIndex];

        for (let ch = 0; ch < this.channelCount; ch++) {
          output[ch][i] += this.readBuffer[ch] * weight;
        }
        totalWeight += weight;

        inputIndex += INPUT_HOP_SIZE - OUTPUT_HOP_SIZE;
        inWindowIndex -= OUTPUT_HOP_SIZE;
      }

      if (totalWeight > 0) {
        for (let ch = 0; ch < this.channelCount; ch++) {
          output[ch][i] /= totalWeight;
        }
      }

      this.outputOffset += 1;

      if (firstWindow > 0) {
        this.outputOffset -= OUTPUT_HOP_SIZE;
        this.readOffset -= INPUT_HOP_SIZE;
        this.inputOffset += (1 - SCALE) * INPUT_HOP_SIZE;
      }
    }

    this.inputOffset += outputLength;

    while (this.chunks.length > 0 && this.inputOffset >= this.chunkSampleCounts[0]) {
      this.inputOffset -= this.chunkSampleCounts[0];
      this.totalSampleCount -= this.chunkSampleCounts[0];
      this.chunks.shift();
      this.chunkSampleCounts.shift();
    }
  }

  advanceInputOffset() {
    let remaining = this.inputOffset;
    while (this.chunks.length > 0 && remaining >= this.chunkSampleCounts[0]) {
      remaining -= this.chunkSampleCounts[0];
      this.totalSampleCount -= this.chunkSampleCounts[0];
      this.chunks.shift();
      this.chunkSampleCounts.shift();
    }
    if (this.chunks.length > 0 && remaining > 0) {
      this.chunks[0] = this.chunks[0].subarray(remaining * this.channelCount);
      this.chunkSampleCounts[0] -= remaining;
      this.totalSampleCount -= remaining;
    }
  }

  readSample(offset) {
    let remaining = offset;
    for (let i = 0; i < this.chunks.length; i++) {
      const count = this.chunkSampleCounts[i];
      if (remaining < count) {
        const chunk = this.chunks[i];
        for (let ch = 0; ch < this.channelCount; ch++) {
          this.readBuffer[ch] = chunk[remaining * this.channelCount + ch];
        }
        return;
      }
      remaining -= count;
    }
    this.readBuffer.fill(0);
  }
}

registerProcessor('float32-source-processor', Float32SourceProcessor);
