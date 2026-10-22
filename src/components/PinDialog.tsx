import { useState, useCallback, useRef, useEffect } from 'react';
import { Lock } from 'lucide-react';
import { useDevicePin } from '../hooks/useDevicePin';

interface PinDialogProps {
  mode: 'verify' | 'setup';
  deviceId: string;
  deviceName: string;
  hasExistingPin: boolean;
  onSuccess: () => void;
  onForgot?: () => void;
  onCancel?: () => void;
}

const PIN_LENGTH = 6;

function DigitHoles({ digits, error }: { digits: string[]; error: boolean }) {
  return (
    <div className={`flex gap-2.5 justify-center my-6 ${error ? 'animate-shake' : ''}`}>
      {Array.from({ length: PIN_LENGTH }, (_, i) => (
        <div
          key={i}
          className={`w-10 h-12 rounded-xl border-2 flex items-center justify-center text-lg font-mono transition-colors ${
            digits[i]
              ? 'border-accent-500 bg-accent-500/20 text-accent-400'
              : error
                ? 'border-red-500 bg-red-500/20'
                : 'border-surface-card bg-surface-base/60 text-transparent'
          }`}
        >
          {digits[i] ? '●' : ''}
        </div>
      ))}
    </div>
  );
}

function NumberPad({ onDigit, onBackspace }: { onDigit: (n: string) => void; onBackspace: () => void }) {
  const keys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
  ];

  return (
    <div className="flex flex-col items-center gap-2.5 mt-4">
      {keys.map((row) => (
        <div key={row[0]} className="flex gap-2.5">
          {row.map((n) => (
            <button
              key={n}
              onClick={() => onDigit(n)}
              className="w-18 sm:w-20 h-12 rounded-xl bg-surface-card hover:bg-surface-elevated active:bg-surface-base text-content-primary border border-surface-card text-lg font-medium transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            >
              {n}
            </button>
          ))}
        </div>
      ))}
      <div className="flex gap-2.5">
        <div className="w-18 sm:w-20 h-12" />
        <button
          onClick={() => onDigit('0')}
          className="w-18 sm:w-20 h-12 rounded-xl bg-surface-card hover:bg-surface-elevated active:bg-surface-base text-content-primary border border-surface-card text-lg font-medium transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
        >
          0
        </button>
        <button
          onClick={onBackspace}
          className="w-18 sm:w-20 h-12 rounded-xl bg-surface-card hover:bg-surface-elevated active:bg-surface-base text-content-primary border border-surface-card text-sm font-medium transition-all active:scale-95 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
        >
          删除
        </button>
      </div>
    </div>
  );
}

export function PinDialog({ mode, deviceId, deviceName, hasExistingPin, onSuccess, onForgot, onCancel }: PinDialogProps) {
  const { verifyPin, setPin, removePin } = useDevicePin();
  const [step, setStep] = useState<'old-pin' | 'input' | 'confirm'>(
    hasExistingPin ? 'old-pin' : 'input'
  );
  const [digits, setDigits] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [newPin, setNewPin] = useState<string>('');
  const submittingRef = useRef(false);

  const triggerShake = useCallback((msg: string) => {
    setError(msg);
    setShake(true);
    setTimeout(() => setShake(false), 300);
  }, []);

  const clearDigits = useCallback(() => {
    setDigits([]);
    setError(null);
    setShake(false);
  }, []);

  const handleDigit = useCallback((n: string) => {
    if (submittingRef.current) return;
    setDigits(prev => {
      if (prev.length >= PIN_LENGTH) return prev;
      const next = [...prev, n];
      setError(null);
      setShake(false);
      return next;
    });
  }, []);

  const handleBackspace = useCallback(() => {
    if (submittingRef.current) return;
    setDigits(prev => {
      if (prev.length === 0) return prev;
      setError(null);
      setShake(false);
      return prev.slice(0, -1);
    });
  }, []);

  const handleVerify = useCallback(async (pin: string) => {
    submittingRef.current = true;
    const ok = await verifyPin(deviceId, pin);
    submittingRef.current = false;
    if (ok) {
      onSuccess();
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      if (newAttempts >= 3) {
        triggerShake('PIN 错误已达 3 次，已清除设备记忆');
        removePin(deviceId);
        setTimeout(() => onForgot?.(), 1000);
      } else {
        triggerShake(`PIN 错误（${newAttempts}/3）`);
      }
      clearDigits();
    }
  }, [deviceId, verifyPin, onSuccess, attempts, triggerShake, removePin, onForgot, clearDigits]);

  const handleSetupConfirm = useCallback(async (pin: string) => {
    await setPin(deviceId, pin);
    onSuccess();
  }, [deviceId, setPin, onSuccess]);

  // Auto-submit when digits reach PIN_LENGTH
  useEffect(() => {
    if (digits.length !== PIN_LENGTH || submittingRef.current) return;

    const pin = digits.join('');

    const run = async () => {
      submittingRef.current = true;
      try {
        if (mode === 'verify') {
          await handleVerify(pin);
        } else if (mode === 'setup') {
          if (step === 'old-pin') {
            const ok = await verifyPin(deviceId, pin);
            if (ok) {
              setStep('input');
              clearDigits();
              setNewPin('');
            } else {
              triggerShake('旧 PIN 错误');
              clearDigits();
            }
          } else if (step === 'input') {
            setNewPin(pin);
            setStep('confirm');
            clearDigits();
          } else if (step === 'confirm') {
            if (pin === newPin) {
              await handleSetupConfirm(newPin);
            } else {
              triggerShake('两次输入不一致');
              setStep('input');
              clearDigits();
            }
          }
        }
      } finally {
        submittingRef.current = false;
      }
    };

    run();
  }, [digits]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = mode === 'verify' ? '启动 PIN' : step === 'old-pin' ? '验证旧 PIN' : step === 'confirm' ? '确认 PIN' : '设置启动 PIN';
  const subtitle = mode === 'verify' ? deviceName : deviceName;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-surface-base/80 backdrop-blur-xl animate-fade-in p-4">
      <div className="bg-surface-elevated/95 border border-surface-card rounded-2xl p-7 w-88 max-w-[92vw] shadow-float animate-scale-in">
        <div className="w-12 h-12 rounded-full bg-accent-500/15 flex items-center justify-center mx-auto mb-3">
          <Lock className="w-6 h-6 text-accent-400" />
        </div>
        <h2 className="text-content-primary text-lg font-semibold text-center">{title}</h2>
        <p className="text-content-secondary text-sm text-center mt-1">{subtitle}</p>

        {mode === 'setup' && step === 'confirm' && (
          <p className="text-content-muted text-xs text-center mt-2">请再次输入 PIN 以确认</p>
        )}

        <DigitHoles digits={digits} error={shake} />

        {error && <p className="text-red-400 text-sm text-center mb-2">{error}</p>}

        <NumberPad onDigit={handleDigit} onBackspace={handleBackspace} />

        {mode === 'verify' && onForgot && (
          <button
            onClick={() => {
              removePin(deviceId);
              onForgot();
            }}
            className="w-full mt-4 min-h-[48px] flex items-center justify-center text-sm font-medium text-content-secondary hover:text-content-primary transition-colors rounded-xl hover:bg-surface-card"
          >
            忘记 PIN？
          </button>
        )}

        {(mode === 'setup' || (mode === 'verify' && onCancel)) && (
          <button
            onClick={() => {
              if (mode === 'setup' && step === 'confirm') {
                setStep('input');
                clearDigits();
              } else if (mode === 'setup' && step === 'old-pin') {
                onCancel?.();
              } else {
                onCancel?.();
              }
            }}
            className="w-full mt-2 min-h-[48px] flex items-center justify-center text-sm font-medium text-content-secondary hover:text-content-primary transition-colors rounded-xl hover:bg-surface-card"
          >
            {mode === 'setup' && step === 'confirm' ? '返回' : '取消'}
          </button>
        )}
      </div>
    </div>
  );
}
