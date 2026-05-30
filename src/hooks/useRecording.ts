import { useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  stopConfirming: boolean;
  recordingSeconds: number;
  audioLevel: number;
}

export interface RecordingActions {
  start: () => Promise<void>;
  /** First press: ask for confirmation. Second press (confirm): actually stop. */
  stop: () => void;
  confirmStop: () => void;
  cancelStop: () => void;
  pauseToggle: () => void;
}

interface UseRecordingOptions {
  /** Called with the finished audio blob once the user confirms stop. */
  onStop: (blob: Blob, mimeType: string, consultationComments: string[]) => void;
  consultationCommentsRef: React.RefObject<string[]>;
  onCommentsReset: () => void;
}

export function useRecording({
  onStop,
  consultationCommentsRef,
  onCommentsReset,
}: UseRecordingOptions): RecordingState & RecordingActions {
  // Store callbacks in refs so recorder.onstop always calls the latest version,
  // avoiding stale-closure issues and forward-reference problems at call sites.
  const onStopRef = useRef(onStop);
  const onCommentsResetRef = useRef(onCommentsReset);
  useEffect(() => { onStopRef.current = onStop; });
  useEffect(() => { onCommentsResetRef.current = onCommentsReset; });

  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [stopConfirming, setStopConfirming] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef   = useRef<Blob[]>([]);
  const streamRef        = useRef<MediaStream | null>(null);
  const timerRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const analyserRef      = useRef<AnalyserNode | null>(null);
  const animFrameRef     = useRef<number>(0);

  const { toast } = useToast();

  // ── Internal helpers ───────────────────────────────────────────────────────

  const startTimer = () => {
    timerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startAudioLevel = (stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source  = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        const rms = Math.sqrt(
          data.reduce((s, v) => s + ((v - 128) / 128) ** 2, 0) / data.length,
        );
        setAudioLevel(Math.min(rms * 6, 1));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* AudioContext not available */ }
  };

  const stopAudioLevel = () => {
    cancelAnimationFrame(animFrameRef.current);
    analyserRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setAudioLevel(0);
  };

  // ── Public actions ─────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current  = stream;
      audioChunksRef.current = [];
      startAudioLevel(stream);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stopTimer();
        streamRef.current?.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const comments  = consultationCommentsRef.current ?? [];
        onCommentsResetRef.current();
        onStopRef.current(audioBlob, mimeType, comments);
      };

      recorder.start(500);
      setIsRecording(true);
      setIsPaused(false);
      setRecordingSeconds(0);
      startTimer();
      toast({ title: 'Gravação iniciada', description: 'A consulta está sendo gravada.' });
    } catch {
      toast({
        title: 'Erro ao iniciar gravação',
        description: 'Verifique se o microfone está disponível e permitido.',
        variant: 'destructive',
      });
    }
  }, [consultationCommentsRef, toast]);

  const stop = useCallback(() => {
    setStopConfirming(true);
  }, []);

  const confirmStop = useCallback(() => {
    setStopConfirming(false);
    stopAudioLevel();
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    setIsPaused(false);
    stopTimer();
  }, []);

  const cancelStop = useCallback(() => {
    setStopConfirming(false);
  }, []);

  const pauseToggle = useCallback(() => {
    if (!mediaRecorderRef.current) return;
    if (isPaused) {
      mediaRecorderRef.current.resume();
      startTimer();
      toast({ title: 'Gravação retomada' });
    } else {
      mediaRecorderRef.current.pause();
      stopTimer();
      toast({ title: 'Gravação pausada' });
    }
    setIsPaused(p => !p);
  }, [isPaused, toast]);

  return {
    // state
    isRecording,
    isPaused,
    stopConfirming,
    recordingSeconds,
    audioLevel,
    // actions
    start,
    stop,
    confirmStop,
    cancelStop,
    pauseToggle,
  };
}
