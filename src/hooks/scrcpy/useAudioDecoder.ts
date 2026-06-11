import { useRef, useCallback, useMemo } from 'react';
import type { AdbScrcpyClient, AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy';

export function useAudioDecoder() {
  const decoderRef = useRef<AudioDecoder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioNextTimeRef = useRef(0);

  const setupAudioStream = useCallback(async (
    client: AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>,
  ) => {
    const audioStreamPromise = client.audioStream;
    if (!audioStreamPromise) return;

    audioStreamPromise.then(async (audioMeta) => {
      if (audioMeta.type !== 'success') {
        console.warn('[audio] 音频流不可用:', audioMeta.type);
        return;
      }

      const { codec, stream: audioStream } = audioMeta;

      const audioCtx = new AudioContext({ sampleRate: 48000 });
      audioContextRef.current = audioCtx;
      audioNextTimeRef.current = 0;

      let decoderConfigured = false;

      const decoder = new AudioDecoder({
        output: (audioData: AudioData) => {
          try {
            if (audioCtx.state === 'suspended') {
              audioCtx.resume();
            }

            const numberOfChannels = audioData.numberOfChannels;
            const sampleRate = audioData.sampleRate;
            const numberOfFrames = audioData.numberOfFrames;
            const channelData = new Float32Array(numberOfFrames * numberOfChannels);
            for (let ch = 0; ch < numberOfChannels; ch++) {
              const channel = new Float32Array(numberOfFrames);
              audioData.copyTo(channel, { planeIndex: ch });
              channelData.set(channel, ch * numberOfFrames);
            }
            audioData.close();

            const audioBuffer = audioCtx.createBuffer(numberOfChannels, numberOfFrames, sampleRate);
            for (let ch = 0; ch < numberOfChannels; ch++) {
              const channel = channelData.subarray(ch * numberOfFrames, (ch + 1) * numberOfFrames);
              audioBuffer.copyToChannel(channel, ch);
            }

            const source = audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioCtx.destination);

            const now = audioCtx.currentTime;
            const startTime = Math.max(now, audioNextTimeRef.current);
            source.start(startTime);
            audioNextTimeRef.current = startTime + audioBuffer.duration;
          } catch (e) {
            console.warn('[audio] 播放错误:', e);
          }
        },
        error: (e) => {
          console.error('[audio] 解码错误:', e);
        },
      });

      decoderRef.current = decoder;

      const audioReader = audioStream.getReader();
      const audioPump = async () => {
        try {
          while (true) {
            const { done, value } = await audioReader.read();
            if (done) break;

            if (value.type === 'configuration') {
              const codecStr = codec.webCodecId || 'opus';
              const config: AudioDecoderConfig = {
                codec: codecStr,
                sampleRate: 48000,
                numberOfChannels: 2,
              };
              if (value.data.byteLength > 0) {
                config.description = value.data;
              }
              decoder.configure(config);
              decoderConfigured = true;
              continue;
            }

            if (!decoderConfigured) {
              continue;
            }

            const packet: EncodedAudioChunkInit = {
              type: value.keyframe ? 'key' : 'delta',
              data: value.data,
              timestamp: value.pts != null ? Number(value.pts) : 0,
            };
            decoder.decode(new EncodedAudioChunk(packet));
          }
        } catch (error) {
          console.error('[audio] 流读取错误:', error);
        }
      };

      audioPump();
    }).catch((e: unknown) => {
      console.warn('[audio] 流获取失败:', e);
    });
  }, []);

  const resume = useCallback(() => {
    const ctx = audioContextRef.current;
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch((e: unknown) => {
        console.warn('[audio] AudioContext resume failed:', e);
      });
    }
  }, []);

  const dispose = useCallback(() => {
    if (decoderRef.current) {
      if (decoderRef.current.state !== 'closed') {
        decoderRef.current.close();
      }
      decoderRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, []);

  return useMemo(() => ({
    setupAudioStream,
    resume,
    dispose,
  }), [setupAudioStream, resume, dispose]);
}
