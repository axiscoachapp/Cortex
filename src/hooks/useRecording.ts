import { useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

/** 'presencial' = in-person, microphone only.
 *  'online'     = teleconsultation: microphone + computer/tab audio mixed. */
export type ConsultationMode = 'presencial' | 'online';

export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  stopConfirming: boolean;
  recordingSeconds: number;
  audioLevel: number;
  /** Mode of the recording currently in progress (null when idle). */
  mode: ConsultationMode | null;
}

export interface RecordingActions {
  start: (mode: ConsultationMode) => Promise<void>;
  /** First press: ask for confirmation. Second press (confirm): actually stop. */
  stop: () => void;
  confirmStop: () => void;
  cancelStop: () => void;
  pauseToggle: () => void;
  /** Abort the recording WITHOUT processing: releases the mic, drops the audio. */
  discard: () => void;
}

interface UseRecordingOptions {
  /** Called with the finished audio blob once the user confirms stop. */
  onStop: (blob: Blob, mimeType: string, consultationComments: string[]) => void;
  consultationCommentsRef: React.RefObject<string[]>;
  onCommentsReset: () => void;
  /** Optional live-copilot feed: called every ~30s with a SELF-CONTAINED audio
   *  chunk of the last interval. The main recording is unaffected. */
  onLiveChunk?: (blob: Blob, mimeType: string) => void;
}

/** Rotation interval for live chunks. Each chunk is an independent WebM file
 *  (MediaRecorder slices share one header, so we restart a second recorder
 *  instead of using timeslice). */
const LIVE_CHUNK_MS = 30_000;
/** Chunks smaller than this are near-silence (opus compresses silence hard) —
 *  skip them instead of paying a Gemini call for nothing. */
const MIN_LIVE_CHUNK_BYTES = 12_000;

/** True when the browser can capture system/tab audio at all. */
export function supportsSystemAudio(): boolean {
  return typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

export function useRecording({
  onStop,
  consultationCommentsRef,
  onCommentsReset,
  onLiveChunk,
}: UseRecordingOptions): RecordingState & RecordingActions {
  // Store callbacks in refs so recorder.onstop always calls the latest version,
  // avoiding stale-closure issues and forward-reference problems at call sites.
  const onStopRef = useRef(onStop);
  const onCommentsResetRef = useRef(onCommentsReset);
  const onLiveChunkRef = useRef(onLiveChunk);
  useEffect(() => { onStopRef.current = onStop; });
  useEffect(() => { onCommentsResetRef.current = onCommentsReset; });
  useEffect(() => { onLiveChunkRef.current = onLiveChunk; });

  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [stopConfirming, setStopConfirming] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [mode, setMode] = useState<ConsultationMode | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef   = useRef<Blob[]>([]);
  /** Every stream we opened (mic, and in online mode the display capture) so
   *  cleanup can release them all — a missed track leaves the mic/share live. */
  const streamsRef       = useRef<MediaStream[]>([]);
  const timerRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const animFrameRef     = useRef<number>(0);

  // ── Live-copilot chunk recorder (independent of the main recording) ──────────
  const liveRecorderRef  = useRef<MediaRecorder | null>(null);
  const liveChunksRef    = useRef<Blob[]>([]);
  const liveTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveStreamRef    = useRef<MediaStream | null>(null);

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

  const releaseStreams = () => {
    streamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
    streamsRef.current = [];
  };

  // ── Live chunk recorder ─────────────────────────────────────────────────────
  // A SECOND MediaRecorder on the same stream, restarted every LIVE_CHUNK_MS.
  // Each start→stop cycle produces a complete, independently-decodable WebM
  // (unlike timeslicing, where only the first slice carries the header). Feeds
  // onLiveChunk; the primary recording is never touched.

  const flushLiveChunk = () => {
    const rec = liveRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try { rec.stop(); } catch { /* already stopped */ }
    }
  };

  const startLiveRecorder = (stream: MediaStream, mimeType: string) => {
    if (!onLiveChunkRef.current) return;   // no consumer → don't record chunks
    liveStreamRef.current = stream;

    const spawn = () => {
      // Guard: main recording may have ended between interval ticks.
      if (!liveStreamRef.current) return;
      liveChunksRef.current = [];
      const rec = new MediaRecorder(stream, { mimeType });
      liveRecorderRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size > 0) liveChunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(liveChunksRef.current, { type: mimeType });
        liveChunksRef.current = [];
        if (blob.size >= MIN_LIVE_CHUNK_BYTES) onLiveChunkRef.current?.(blob, mimeType);
        // Immediately begin the next window if we're still recording.
        if (liveStreamRef.current) spawn();
      };
      rec.start();
    };

    spawn();
    liveTimerRef.current = setInterval(flushLiveChunk, LIVE_CHUNK_MS);
  };

  const stopLiveRecorder = (emitFinal: boolean) => {
    if (liveTimerRef.current) { clearInterval(liveTimerRef.current); liveTimerRef.current = null; }
    const rec = liveRecorderRef.current;
    // Prevent onstop from re-spawning a new window after we've torn down.
    liveStreamRef.current = null;
    if (rec && rec.state !== 'inactive') {
      if (!emitFinal) rec.onstop = null;   // discard: drop the trailing partial
      try { rec.stop(); } catch { /* already stopped */ }
    }
    liveRecorderRef.current = null;
  };

  const pauseLiveRecorder = () => {
    if (liveTimerRef.current) { clearInterval(liveTimerRef.current); liveTimerRef.current = null; }
    const rec = liveRecorderRef.current;
    if (rec && rec.state === 'recording') { try { rec.pause(); } catch { /* noop */ } }
  };

  const resumeLiveRecorder = () => {
    const rec = liveRecorderRef.current;
    if (rec && rec.state === 'paused') { try { rec.resume(); } catch { /* noop */ } }
    if (liveStreamRef.current && !liveTimerRef.current) {
      liveTimerRef.current = setInterval(flushLiveChunk, LIVE_CHUNK_MS);
    }
  };

  /** Drive the level meter from an already-built analyser node. */
  const runAudioLevel = (analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.frequencyBinCount);
    // Throttle state updates to ~10fps — a 60fps setState re-renders the
    // whole consuming component (messages list included) for every frame.
    let lastUpdate = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      const rms = Math.sqrt(
        data.reduce((s, v) => s + ((v - 128) / 128) ** 2, 0) / data.length,
      );
      const now = performance.now();
      if (now - lastUpdate >= 100) {
        lastUpdate = now;
        setAudioLevel(Math.min(rms * 6, 1));
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const stopAudioLevel = () => {
    cancelAnimationFrame(animFrameRef.current);
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setAudioLevel(0);
  };

  // ── Public actions ─────────────────────────────────────────────────────────

  const start = useCallback(async (selectedMode: ConsultationMode) => {
    let micStream: MediaStream | null = null;
    let displayStream: MediaStream | null = null;

    try {
      if (selectedMode === 'online') {
        if (!supportsSystemAudio()) {
          toast({
            title: 'Navegador sem suporte',
            description: 'A captura de áudio do computador exige Chrome ou Edge. Use o modo Presencial ou troque de navegador.',
            variant: 'destructive',
          });
          return;
        }

        // Ask for the screen/tab share FIRST: getDisplayMedia must run while the
        // user activation from the click is still fresh. Chrome only offers the
        // "share audio" checkbox when video is requested too, so we ask for both
        // and simply never read the video track.
        try {
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          } as MediaStreamConstraints);
        } catch {
          // User dismissed the picker, or the browser refused.
          toast({
            title: 'Compartilhamento cancelado',
            description: 'Para gravar uma teleconsulta é necessário compartilhar a aba da chamada com o áudio.',
            variant: 'destructive',
          });
          return;
        }
        streamsRef.current.push(displayStream);

        // No audio track => the "compartilhar áudio" box was left unticked.
        // Abort loudly: recording only the doctor's side would silently produce
        // an incomplete medical record.
        if (displayStream.getAudioTracks().length === 0) {
          releaseStreams();
          toast({
            title: 'Áudio da chamada não capturado',
            description: 'Reinicie e marque "Compartilhar áudio da guia" (ou "do sistema") na janela de seleção. Sem isso, a voz do paciente não é gravada.',
            variant: 'destructive',
          });
          return;
        }
      }

      // Microphone (both modes). Echo cancellation stays ON so the patient's
      // voice coming out of the speakers isn't captured a second time.
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamsRef.current.push(micStream);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      // Build the audio graph. Presencial records the mic stream directly
      // (unchanged behaviour); online mixes mic + system audio into one track.
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;

      let recordStream: MediaStream;

      if (selectedMode === 'online' && displayStream) {
        const mixBus = ctx.createGain();
        const destination = ctx.createMediaStreamDestination();

        ctx.createMediaStreamSource(micStream).connect(mixBus);
        ctx.createMediaStreamSource(displayStream).connect(mixBus);
        // Never connect to ctx.destination — that would loop the call audio
        // back out of the speakers.
        mixBus.connect(destination);
        mixBus.connect(analyser);

        recordStream = destination.stream;

        // Chrome's "Parar compartilhamento" bar ends the capture independently
        // of our UI. Warn instead of dying: the mic half keeps recording.
        const [videoTrack] = displayStream.getVideoTracks();
        videoTrack?.addEventListener('ended', () => {
          toast({
            title: 'Compartilhamento encerrado',
            description: 'O áudio da chamada parou de ser capturado. A gravação continua apenas com o seu microfone.',
            variant: 'destructive',
          });
        });
      } else {
        ctx.createMediaStreamSource(micStream).connect(analyser);
        recordStream = micStream;
      }

      runAudioLevel(analyser);

      const recorder = new MediaRecorder(recordStream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      audioChunksRef.current = [];

      recorder.onstop = () => {
        stopTimer();
        releaseStreams();
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const comments  = consultationCommentsRef.current ?? [];
        onCommentsResetRef.current();
        onStopRef.current(audioBlob, mimeType, comments);
      };

      recorder.start(500);
      // Live copilot feeds off the SAME recorded stream (mic, or mixed bus in
      // online mode), so its chunks match what the final SOAP will hear.
      startLiveRecorder(recordStream, mimeType);
      setMode(selectedMode);
      setIsRecording(true);
      setIsPaused(false);
      setRecordingSeconds(0);
      startTimer();
      toast({
        title: selectedMode === 'online' ? 'Gravação online iniciada' : 'Gravação iniciada',
        description: selectedMode === 'online'
          ? 'Capturando seu microfone e o áudio da chamada.'
          : 'A consulta está sendo gravada.',
      });
    } catch {
      // Release anything already opened so no device stays live on failure.
      releaseStreams();
      stopAudioLevel();
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
    stopLiveRecorder(true);   // emit the trailing partial chunk for a last refresh
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    setIsPaused(false);
    setMode(null);
    stopTimer();
  }, []);

  const cancelStop = useCallback(() => {
    setStopConfirming(false);
  }, []);

  const discard = useCallback(() => {
    stopLiveRecorder(false);   // drop trailing chunk — this recording is abandoned
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      // Detach the handler first so the audio is dropped, not processed.
      rec.onstop = null;
      try { rec.stop(); } catch { /* already stopped */ }
    }
    mediaRecorderRef.current = null;
    releaseStreams();
    audioChunksRef.current = [];
    stopAudioLevel();
    stopTimer();
    setIsRecording(false);
    setIsPaused(false);
    setStopConfirming(false);
    setRecordingSeconds(0);
    setMode(null);
  }, []);

  // Unmount safety net: release the microphone/screen share and timers if the
  // consuming component unmounts mid-recording (e.g. sign-out or route change).
  // Without this the capture indicators stay lit and the browser keeps recording.
  useEffect(() => () => {
    stopLiveRecorder(false);
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null;
      try { rec.stop(); } catch { /* already stopped */ }
    }
    streamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
    streamsRef.current = [];
    cancelAnimationFrame(animFrameRef.current);
    audioCtxRef.current?.close().catch(() => {});
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const pauseToggle = useCallback(() => {
    if (!mediaRecorderRef.current) return;
    if (isPaused) {
      mediaRecorderRef.current.resume();
      resumeLiveRecorder();
      startTimer();
      toast({ title: 'Gravação retomada' });
    } else {
      mediaRecorderRef.current.pause();
      pauseLiveRecorder();
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
    mode,
    // actions
    start,
    stop,
    confirmStop,
    cancelStop,
    pauseToggle,
    discard,
  };
}
