/// <reference lib="webworker" />

import type { WorkerInMessage, WorkerOutMessage } from './types';

let decoder: AudioDecoder | null = null;
let retryCount = 0;
const MAX_RETRIES = 3;
let lastCodec = '';
let lastDescription: Uint8Array | undefined;
let pendingData: Array<{ type: 'key' | 'delta'; data: ArrayBuffer; timestamp: number }> = [];

function postOut(msg: WorkerOutMessage, transfer?: Transferable[]) {
  if (transfer) {
    postMessage(msg, transfer);
  } else {
    postMessage(msg);
  }
}

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'configure':
      handleConfigure(msg.codec, msg.description);
      break;
    case 'data':
      handleData(msg.chunk);
      break;
    case 'reset':
      handleReset();
      break;
  }
};

function pcmOutputHandler(audioData: AudioData) {
  try {
    const { numberOfChannels, numberOfFrames, sampleRate, format } = audioData;
    const pcm = new Float32Array(numberOfFrames * numberOfChannels);

    if (format === 'f32-planar') {
      for (let ch = 0; ch < numberOfChannels; ch++) {
        const channel = new Float32Array(numberOfFrames);
        audioData.copyTo(channel, { planeIndex: ch });
        pcm.set(channel, ch * numberOfFrames);
      }
    } else {
      audioData.copyTo(pcm, { planeIndex: 0 });
    }

    audioData.close();

    postOut(
      {
        type: 'pcm',
        buffer: pcm.buffer as ArrayBuffer,
        sampleRate,
        channels: numberOfChannels,
      },
      [pcm.buffer]
    );
  } catch (e) {
    console.warn('[audio worker] PCM conversion error:', e);
  }
}

function errorHandler(e: DOMException | unknown) {
  const message = e instanceof Error ? e.message : String(e);
  console.warn('[audio worker] Decoder error:', message);

  if (retryCount < MAX_RETRIES) {
    retryCount++;
    console.warn(`[audio worker] 重试 ${retryCount}/${MAX_RETRIES}`);
    try { decoder?.close(); } catch { /* ignore */ }
    decoder = null;
    rebuildDecoder();
  } else {
    postOut({ type: 'error', message });
  }
}

function rebuildDecoder() {
  try {
    decoder = new AudioDecoder({
      output: pcmOutputHandler,
      error: errorHandler,
    });

    const config: AudioDecoderConfig = {
      codec: lastCodec,
      sampleRate: 48000,
      numberOfChannels: 2,
    };

    if (lastDescription && lastDescription.byteLength > 0) {
      config.description = new Uint8Array(lastDescription);
    }

    decoder.configure(config);
    postOut({ type: 'configured' });

    const pending = pendingData;
    pendingData = [];
    for (const chunk of pending) {
      if (decoder && decoder.state !== 'closed') {
        decoder.decode(
          new EncodedAudioChunk({
            type: 'key',
            data: new Uint8Array(chunk.data),
            timestamp: chunk.timestamp,
          })
        );
      }
    }
  } catch (e) {
    postOut({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

function handleConfigure(codec: string, description?: Uint8Array) {
  if (decoder) {
    try { decoder.close(); } catch { /* decoder may already be closed */ }
  }
  retryCount = 0;
  lastCodec = codec;
  lastDescription = description;

  try {
    decoder = new AudioDecoder({
      output: pcmOutputHandler,
      error: errorHandler,
    });

    const config: AudioDecoderConfig = {
      codec,
      sampleRate: 48000,
      numberOfChannels: 2,
    };

    if (description && description.byteLength > 0) {
      config.description = new Uint8Array(description);
    }

    decoder.configure(config);
    postOut({ type: 'configured' });

    const pending = pendingData;
    pendingData = [];
    for (const chunk of pending) {
      if (decoder && decoder.state !== 'closed') {
        decoder.decode(
          new EncodedAudioChunk({
            type: 'key',
            data: new Uint8Array(chunk.data),
            timestamp: chunk.timestamp,
          })
        );
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    postOut({ type: 'error', message });
  }
}

function handleData(chunk: { type: 'key' | 'delta'; data: ArrayBuffer; timestamp: number }) {
  if (!decoder || decoder.state === 'closed') {
    pendingData.push(chunk);
    return;
  }

  if (chunk.data.byteLength === 0) {
    return;
  }

  try {
    decoder.decode(
      new EncodedAudioChunk({
        type: 'key',
        data: new Uint8Array(chunk.data),
        timestamp: chunk.timestamp,
      })
    );
  } catch (e) {
    console.warn('[audio worker] Decode error:', e);
  }
}

function handleReset() {
  if (decoder) {
    try { decoder.reset(); } catch { /* decoder may be closed */ }
  }
  retryCount = 0;
  pendingData = [];
}
