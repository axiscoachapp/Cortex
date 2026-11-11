import { useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  AUDIO_UPLOAD_LIMIT_BYTES,
  RECORDING_BITS_PER_SECOND,
  RECORDING_STOP_BYTES,
  RECORDING_WARN_BYTES,
} from '@/lib/recordingLimits';

/** 'presencial' = in-person, microphone only.
 *  'online'     = teleconsultation: microphone + computer/tab audio mixed. */
export type ConsultationMode = 'presencial' | 'online';

export interface RecordingState {
  isStarting: boolean;
  isStopping: boolean;
  isRecording: boolean;
  isPaused: boolean;
  stopConfirming: boolean;
  recordingSeconds: number;
  audioLevel: number;
  /** Mode of the recording currently in progress (null when idle). */
  mode: ConsultationMode | null;
  /** Bytes of audio captured so far in the current recording. */
  recordedBytes: number;
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

/** Identifies one capture. Its checkpoints, the final audio and the rescue
 *  all carry the same id, so the draft can reuse it. */
export interface CaptureInfo {
  captureId: string;
  startedAt: string;
}

/** The audio captured so far, for crash recovery. */
export interface RecordingCheckpoint extends CaptureInfo {
  blob: Blob;
  mimeType: string;
  consultationComments: string[];
}

interface UseRecordingOptions {
  /** Called with the finished audio blob once the user confirms stop. */
  onStop: (blob: Blob, mimeType: string, consultationComments: string[], capture: CaptureInfo) => void;
  consultationCommentsRef: React.RefObject<string[]>;
  onCommentsReset: () => void;
  /** Optional live-copilot feed: called every ~30s with a SELF-CONTAINED audio
   *  chunk of the last interval. The main recording is unaffected. */
  onLiveChunk?: (blob: Blob, mimeType: string) => void;
  /** Called when the component unmounts mid-recording (session ended, crash).
   *  Receives the audio captured so far so it can be parked for recovery
   *  instead of being dropped. Captured at start, like onStop. */
  onRescue?: (blob: Blob, mimeType: string, consultationComments: string[], capture: CaptureInfo) => void;
  /** Called every CHECKPOINT_MS while new audio arrives, when the page is
   *  hidden or unloaded, and once with the full audio just before onStop, so an
   *  abrupt end (crash, tab discard, screen lock) leaves a recoverable copy.
   *  Captured at start, like onStop. */
  onCheckpoint?: (checkpoint: RecordingCheckpoint) => void;
  /** The doctor discarded the capture: its checkpoint must go too. */
  onCheckpointDiscard?: (capture: CaptureInfo) => void;
}

/** How often the audio captured so far is checkpointed. */
export const CHECKPOINT_MS = 5_000;

export { AUDIO_UPLOAD_LIMIT_BYTES, RECORDING_BITS_PER_SECOND, RECORDING_STOP_BYTES, RECORDING_WARN_BYTES };

/** A recorder with a low, explicit bitrate; browsers that refuse the option record with their default. */
export function createRecorder(stream: MediaStream, mimeType: string): MediaRecorder {
  try {
    return new MediaRecorder(stream, { mimeType, audioBitsPerSecond: RECORDING_BITS_PER_SECOND });
  } catch {
    return new MediaRecorder(stream, { mimeType });
  }
}

interface WakeLockHandle { release: () => Promise<void> }
type WakeLockApi = { request: (type: 'screen') => Promise<WakeLockHandle> };

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
  onRescue,
  onCheckpoint,
  onCheckpointDiscard,
}: UseRecordingOptions): RecordingState & RecordingActions {
  // Store callbacks in refs so recorder.onstop always calls the latest version,
  // avoiding stale-closure issues and forward-reference problems at call sites.
  const onStopRef = useRef(onStop);
  const onCommentsResetRef = useRef(onCommentsReset);
  const onLiveChunkRef = useRef(onLiveChunk);
  const onRescueRef = useRef(onRescue);
  /** Unmount path for the active recorder: hands its audio to onRescue. */
  const rescueActiveRef = useRef<(() => void) | null>(null);
  const freezeCommentsRef = useRef<() => void>(() => {});
  const onCheckpointRef = useRef(onCheckpoint);
  const onCheckpointDiscardRef = useRef(onCheckpointDiscard);
  /** Per-capture extras of the active recorder (checkpoint timer, page and
   *  microphone listeners, wake lock). Each capture owns its own. */
  const activeCaptureRef = useRef<{ teardown: () => void; discardCheckpoint: () => void } | null>(null);
  useEffect(() => { onStopRef.current = onStop; });
  useEffect(() => { onRescueRef.current = onRescue; });
  useEffect(() => { onCheckpointRef.current = onCheckpoint; });
  useEffect(() => { onCheckpointDiscardRef.current = onCheckpointDiscard; });
  useEffect(() => { onCommentsResetRef.current = onCommentsReset; });
  useEffect(() => { onLiveChunkRef.current = onLiveChunk; });

  const [isRecording, setIsRecording] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [pendingStops, setPendingStops] = useState(0);
  const startingRef = useRef(false);
  const captureGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const invalidateCapture = useCallback(() => { captureGenerationRef.current++; }, []);
  const [isPaused, setIsPaused] = useState(false);
  const [stopConfirming, setStopConfirming] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [mode, setMode] = useState<ConsultationMode | null>(null);
  const [recordedBytes, setRecordedBytes] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  /** Every stream we opened (mic, and in online mode the display capture) so
   *  cleanup can release them all — a missed track leaves the mic/share live. */
  const streamsRef       = useRef<MediaStream[]>([]);
  const timerRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const animFrameRef     = useRef<number>(0);

  // ── Live-copilot chunk recorder (independent of the main recording) ──────────
  const liveRecorderRef  = useRef<MediaRecorder | null>(null);
  const liveGenerationRef = useRef<symbol | null>(null);
  const liveTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveStreamRef    = useRef<MediaStream | null>(null);

  const { toast } = useToast();

  // ── Internal helpers ───────────────────────────────────────────────────────

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current); // never run two timers
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
    const consume = onLiveChunkRef.current;
    const generation = Symbol('live recording');
    liveGenerationRef.current = generation;

    const spawn = () => {
      // Guard: main recording may have ended between interval ticks.
      if (!liveStreamRef.current || liveGenerationRef.current !== generation) return;
      const chunks: Blob[] = [];
      const rec = createRecorder(stream, mimeType);
      liveRecorderRef.current = rec;
      rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size >= MIN_LIVE_CHUNK_BYTES) consume?.(blob, mimeType);
        // Immediately begin the next window if we're still recording.
        if (liveStreamRef.current && liveGenerationRef.current === generation) spawn();
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
    liveGenerationRef.current = null;
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

  const start = async (selectedMode: ConsultationMode) => {
    if (startingRef.current || (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive')) return;
    const generation = ++captureGenerationRef.current;
    startingRef.current = true;
    setIsStarting(true);
    let micStream: MediaStream | null = null;
    let displayStream: MediaStream | null = null;
    let teardownThisCapture: (() => void) | null = null;
    const stillActive = () => mountedRef.current && generation === captureGenerationRef.current;
    const releaseAttempt = () => {
      const owned = [micStream, displayStream].filter((stream): stream is MediaStream => !!stream);
      owned.forEach(stream => stream.getTracks().forEach(track => track.stop()));
      streamsRef.current = streamsRef.current.filter(stream => !owned.includes(stream));
    };

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
        if (!stillActive()) { releaseAttempt(); return; }

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
      // Mono is enough for speech and halves the size where the browser honours it.
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 1 } } });
      streamsRef.current.push(micStream);
      if (!stillActive()) { releaseAttempt(); return; }

      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
        .find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('Nenhum formato de gravação compatível.');

      // Build the audio graph. Presencial records the mic stream directly
      // (unchanged behaviour); online mixes mic + system audio into one track.
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      if (!stillActive()) { releaseAttempt(); await ctx.close().catch(() => {}); return; }

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;

      let recordStream: MediaStream;

      if (selectedMode === 'online' && displayStream) {
        const mixBus = ctx.createGain();
        const destination = ctx.createMediaStreamDestination();
        // One channel for the mix as well: the call and the doctor are speech.
        try { destination.channelCount = 1; destination.channelCountMode = 'explicit'; } catch { /* keep the default */ }

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

      const recorder = createRecorder(recordStream, mimeType);
      mediaRecorderRef.current = recorder;

      // Native stop/dataavailable events can arrive after another recording
      // starts. Each recorder owns its chunks, streams, comments and callbacks.
      const recordingChunks: Blob[] = [];
      const ownedStreams = [...streamsRef.current];
      // The server cannot process audio above AUDIO_UPLOAD_LIMIT_BYTES, so the
      // size is watched while recording: a warning first, then a clean stop
      // that keeps (and processes) everything recorded until then.
      let capturedBytes = 0;
      let sizeWarned = false;
      let stoppedAtLimit = false;
      recorder.ondataavailable = e => {
        if (e.data.size <= 0) return;
        recordingChunks.push(e.data);
        capturedBytes += e.data.size;
        if (mediaRecorderRef.current !== recorder) return;
        if (mountedRef.current) setRecordedBytes(capturedBytes);
        if (!sizeWarned && capturedBytes >= RECORDING_WARN_BYTES) {
          sizeWarned = true;
          toast({
            title: 'Gravação perto do limite',
            description: 'Esta gravação está chegando ao tamanho máximo que a IA processa. Finalize a consulta em breve; no limite, a gravação para sozinha e o áudio é guardado.',
            variant: 'destructive',
          });
        }
        if (!stoppedAtLimit && capturedBytes >= RECORDING_STOP_BYTES) {
          stoppedAtLimit = true;
          toast({
            title: 'Gravação encerrada no limite de tamanho',
            description: 'O áudio gravado até aqui foi guardado e será processado. Revise e salve esta parte; para continuar a consulta, grave o restante em uma nova gravação depois.',
            variant: 'destructive',
          });
          confirmStop();
        }
      };
      let finalComments: string[] | null = null;
      freezeCommentsRef.current = () => { finalComments = [...(consultationCommentsRef.current ?? [])]; };
      const finishForOriginalPatient = onStopRef.current;
      const resetOriginalComments = onCommentsResetRef.current;
      const rescueForOriginalPatient = onRescueRef.current;
      const checkpointForOriginalPatient = onCheckpointRef.current;
      const discardForOriginalPatient = onCheckpointDiscardRef.current;
      const capture: CaptureInfo = { captureId: crypto.randomUUID(), startedAt: new Date().toISOString() };

      // ── Crash safety: checkpoints, wake lock, microphone watch ──────────────
      let checkpointedChunks = 0;
      const checkpoint = (comments?: string[], force = false) => {
        if (!checkpointForOriginalPatient || recordingChunks.length === 0) return;
        if (!force && recordingChunks.length === checkpointedChunks) return;
        checkpointedChunks = recordingChunks.length;
        try {
          checkpointForOriginalPatient({
            ...capture,
            blob: new Blob(recordingChunks, { type: mimeType }),
            mimeType,
            consultationComments: comments ?? [...(consultationCommentsRef.current ?? [])],
          });
        } catch { /* a checkpoint must never break the recording */ }
      };
      const checkpointTimer = setInterval(() => checkpoint(), CHECKPOINT_MS);

      let wakeLock: WakeLockHandle | null = null;
      let wakeWanted = true;
      const requestWakeLock = () => {
        const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
        if (!api?.request || !wakeWanted || wakeLock) return;
        api.request('screen').then(
          (lock) => { if (wakeWanted) wakeLock = lock; else lock.release().catch(() => {}); },
          () => { /* not allowed now (battery saver, hidden page): recording goes on */ },
        );
      };
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') {
          // The page may be frozen or discarded next: save what we have now.
          try { recorder.requestData(); } catch { /* not supported */ }
          checkpoint(undefined, true);
        } else {
          // The browser drops the wake lock whenever the page is hidden.
          wakeLock = null;
          requestWakeLock();
        }
      };
      const onPageHide = () => checkpoint(undefined, true);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', onPageHide);
      requestWakeLock();

      // A microphone that ends or is muted by the system would otherwise record
      // silence (or, online, only the call) without the doctor noticing.
      const micTracks = typeof micStream.getAudioTracks === 'function' ? micStream.getAudioTracks() : [];
      const isCurrent = () => mediaRecorderRef.current === recorder;
      const onMicEnded = () => {
        if (!isCurrent()) return;
        toast(selectedMode === 'online'
          ? { title: 'Microfone desconectado', description: 'Sua voz parou de ser gravada; a gravação continua só com o áudio da chamada. Verifique o microfone.', variant: 'destructive' }
          : { title: 'Microfone desconectado', description: 'A gravação parou. O áudio gravado até aqui será processado. Verifique o microfone antes de gravar de novo.', variant: 'destructive' });
      };
      const onMicMute = () => {
        if (!isCurrent()) return;
        toast({ title: 'Microfone sem som', description: 'O microfone foi silenciado pelo sistema ou por outro aplicativo. Verifique-o para não gravar silêncio.', variant: 'destructive' });
      };
      micTracks.forEach(track => {
        track.addEventListener?.('ended', onMicEnded);
        track.addEventListener?.('mute', onMicMute);
      });

      let tornDown = false;
      const teardown = () => {
        if (tornDown) return;
        tornDown = true;
        clearInterval(checkpointTimer);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', onPageHide);
        micTracks.forEach(track => {
          track.removeEventListener?.('ended', onMicEnded);
          track.removeEventListener?.('mute', onMicMute);
        });
        wakeWanted = false;
        wakeLock?.release().catch(() => {});
        wakeLock = null;
        if (activeCaptureRef.current?.teardown === teardown) activeCaptureRef.current = null;
      };
      teardownThisCapture = teardown;
      activeCaptureRef.current = {
        teardown,
        discardCheckpoint: () => { try { discardForOriginalPatient?.(capture); } catch { /* best effort */ } },
      };

      rescueActiveRef.current = () => {
        // Replace the normal handler: there is no mounted UI to process it.
        recorder.onstop = () => {
          teardown();
          ownedStreams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
          const audioBlob = new Blob(recordingChunks, { type: mimeType });
          if (audioBlob.size > 0) rescueForOriginalPatient?.(audioBlob, mimeType, [...(consultationCommentsRef.current ?? [])], capture);
        };
      };

      recorder.onstop = () => {
        teardown();
        ownedStreams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
        streamsRef.current = streamsRef.current.filter(stream => !ownedStreams.includes(stream));
        const audioBlob = new Blob(recordingChunks, { type: mimeType });
        const comments = finalComments ?? [...(consultationCommentsRef.current ?? [])];
        // The full audio is checkpointed before processing starts, so the copy
        // in this browser stays complete until the upload confirms.
        checkpoint(comments, true);
        resetOriginalComments();
        finishForOriginalPatient(audioBlob, mimeType, comments, capture);
        if (mountedRef.current) setPendingStops(count => Math.max(0, count - 1));
        if (mediaRecorderRef.current === recorder) {
          mediaRecorderRef.current = null;
          rescueActiveRef.current = null;
          // The recorder can also stop on its own (mic unplugged, permission
          // revoked): release the timer, level meter and live recorder too.
          stopTimer();
          stopAudioLevel();
          stopLiveRecorder(false);
          if (mountedRef.current) { setIsRecording(false); setIsPaused(false); setMode(null); setStopConfirming(false); }
        }
      };

      recorder.start(500);
      // Live copilot feeds off the SAME recorded stream (mic, or mixed bus in
      // online mode), so its chunks match what the final SOAP will hear.
      startLiveRecorder(recordStream, mimeType);
      setMode(selectedMode);
      setIsRecording(true);
      setIsPaused(false);
      setRecordingSeconds(0);
      setRecordedBytes(0);
      startTimer();
      toast({
        title: selectedMode === 'online' ? 'Gravação online iniciada' : 'Gravação iniciada',
        description: selectedMode === 'online'
          ? 'Capturando seu microfone e o áudio da chamada.'
          : 'A consulta está sendo gravada.',
      });
    } catch {
      // Release anything already opened so no device stays live on failure.
      teardownThisCapture?.();
      releaseAttempt();
      if (!stillActive()) return;
      stopAudioLevel();
      toast({
        title: 'Erro ao iniciar gravação',
        description: 'Verifique se o microfone está disponível e permitido.',
        variant: 'destructive',
      });
    } finally {
      if (generation === captureGenerationRef.current) {
        startingRef.current = false;
        if (mountedRef.current) setIsStarting(false);
      }
    }
  };

  const stop = useCallback(() => {
    setStopConfirming(true);
  }, []);

  const confirmStop = useCallback(() => {
    freezeCommentsRef.current();
    setStopConfirming(false);
    stopAudioLevel();
    stopLiveRecorder(true);   // emit the trailing partial chunk for a last refresh
    rescueActiveRef.current = null; // a confirmed stop processes the audio normally
    // Stop the periodic checkpoints and release the wake lock now; the final
    // checkpoint is written by this recorder's own stop event.
    activeCaptureRef.current?.teardown();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      setPendingStops(count => count + 1);
      try { recorder.stop(); } catch { setPendingStops(count => Math.max(0, count - 1)); }
    }
    setIsRecording(false);
    setIsPaused(false);
    setMode(null);
    stopTimer();
  }, []);

  const cancelStop = useCallback(() => {
    setStopConfirming(false);
  }, []);

  const discard = useCallback(() => {
    invalidateCapture();
    startingRef.current = false;
    setIsStarting(false);
    stopLiveRecorder(false);   // drop trailing chunk — this recording is abandoned
    rescueActiveRef.current = null; // explicit discard: nothing to rescue
    const discarded = activeCaptureRef.current;
    discarded?.teardown();
    discarded?.discardCheckpoint();
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      // Detach the handler first so the audio is dropped, not processed.
      rec.onstop = null;
      try { rec.stop(); } catch { /* already stopped */ }
    }
    mediaRecorderRef.current = null;
    releaseStreams();
    stopAudioLevel();
    stopTimer();
    setIsRecording(false);
    setIsPaused(false);
    setStopConfirming(false);
    setRecordingSeconds(0);
    setRecordedBytes(0);
    setMode(null);
  }, [invalidateCapture]);

  // Unmount safety net: release the microphone/screen share and timers if the
  // consuming component unmounts mid-recording (e.g. sign-out or route change).
  // Without this the capture indicators stay lit and the browser keeps recording.
  useEffect(() => { mountedRef.current = true; return () => {
    mountedRef.current = false;
    invalidateCapture();
    stopLiveRecorder(false);
    // Timers, listeners and the wake lock go; the checkpoint stays for recovery.
    activeCaptureRef.current?.teardown();
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      // Unmount is not a user decision to discard: park the audio for recovery.
      if (rescueActiveRef.current) rescueActiveRef.current();
      else rec.onstop = null;
      try { rec.stop(); } catch { /* already stopped */ }
    }
    rescueActiveRef.current = null;
    streamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
    streamsRef.current = [];
    cancelAnimationFrame(animFrameRef.current);
    audioCtxRef.current?.close().catch(() => {});
    if (timerRef.current) clearInterval(timerRef.current);
  }; }, [invalidateCapture]);

  const pauseToggle = () => {
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
  };

  return {
    // state
    isRecording,
    isStarting,
    isStopping: pendingStops > 0,
    isPaused,
    stopConfirming,
    recordingSeconds,
    audioLevel,
    mode,
    recordedBytes,
    // actions
    start,
    stop,
    confirmStop,
    cancelStop,
    pauseToggle,
    discard,
  };
}
