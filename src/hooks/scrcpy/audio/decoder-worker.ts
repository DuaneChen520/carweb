/// <reference lib="webworker" />

import type { WorkerInMessage, WorkerOutMessage } from './types';

let decoder: AudioDecoder | null = null;
let retryCount = 0;
const MAX_RETRIES = 3;

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

function handleConfigure(codec: string, description?: ArrayBuffer) {
  if (decoder) {
    try { decoder.close(); } catch {}
  }
  retryCount = 0;

  try {
    decoder = new AudioDecoder({
      output: (audioData: AudioData) => {
        try {
          const { numberOfChannels, numberOfFrames, sampleRate } = audioData;
          const pcm = new Float32Array(numberOfFrames * numberOfChannels);

          for (let ch = 0; ch < numberOfChannels; ch++) {
            const channel = new Float32Array(numberOfFrames);
            audioData.copyTo(channel, { planeIndex: ch });
            pcm.set(channel, ch * numberOfFrames);
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
      },
      error: (e: DOMException | unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        console.warn('[audio worker] Decoder error:', message);
        postOut({ type: 'error', message });

        if (retryCount < MAX_RETRIES) {
          retryCount++;
        }
      },
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
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    postOut({ type: 'error', message });
  }
}

function handleData(chunk: { type: 'key' | 'delta'; data: ArrayBuffer; timestamp: number }) {
  if (!decoder || decoder.state === 'closed') return;

  try {
    decoder.decode(
      new EncodedAudioChunk({
        type: chunk.type,
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
    try { decoder.reset(); } catch {}
  }
  retryCount = 0;
}
