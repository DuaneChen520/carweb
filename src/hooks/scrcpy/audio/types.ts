// Worker ↔ Main Thread
export interface ConfigureMessage {
  type: 'configure';
  codec: string;
  description?: Uint8Array;
}

export interface DataMessage {
  type: 'data';
  chunk: {
    type: 'key' | 'delta';
    data: ArrayBuffer;
    timestamp: number;
  };
}

export interface ResetMessage {
  type: 'reset';
}

export type WorkerInMessage = ConfigureMessage | DataMessage | ResetMessage;

export interface PcmMessage {
  type: 'pcm';
  buffer: ArrayBuffer;
  sampleRate: number;
  channels: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export interface ConfiguredMessage {
  type: 'configured';
}

export type WorkerOutMessage = PcmMessage | ErrorMessage | ConfiguredMessage;

// Main Thread ↔ AudioWorklet
export interface WorkletPcmMessage {
  type: 'pcm';
  buffer: ArrayBuffer;
  sampleRate: number;
  channels: number;
}

export interface WorkletMuteMessage {
  type: 'mute';
  value: boolean;
}

export interface WorkletResetMessage {
  type: 'reset';
}

export type WorkletMessage = WorkletPcmMessage | WorkletMuteMessage | WorkletResetMessage;

export type AudioRoute = 'browser' | 'phone';

export type AudioStatus = 'idle' | 'starting' | 'playing' | 'disabled' | 'errored';

export interface AudioState {
  status: AudioStatus;
  route: AudioRoute;
  muted: boolean;
}
