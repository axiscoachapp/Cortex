import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECORDING_BITS_PER_SECOND, RECORDING_STOP_BYTES, RECORDING_WARN_BYTES, useRecording } from './useRecording';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const recorders: Recorder[] = [];
const latest = () => recorders[recorders.length - 1];
let refuseBitrate = false;
class Recorder {
  static isTypeSupported = (type: string) => type === 'audio/webm';
  state = 'inactive';
  options: MediaRecorderOptions | undefined;
  onstop: (() => void) | null = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  requestData = vi.fn();
  constructor(_stream: unknown, options?: MediaRecorderOptions) {
    if (refuseBitrate && options?.audioBitsPerSecond) throw new Error('NotSupportedError');
    this.options = options;
    recorders.push(this);
  }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.onstop?.(); }
  emitBytes(size: number) { this.ondataavailable?.({ data: new Blob([new Uint8Array(size)]) }); }
}

const getUserMedia = vi.fn();
beforeEach(() => {
  recorders.length = 0;
  refuseBitrate = false;
  toast.mockReset();
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('AudioContext', class {
    state = 'running';
    createAnalyser() { return { frequencyBinCount: 8, getByteTimeDomainData: (bytes: Uint8Array) => bytes.fill(128) }; }
    createMediaStreamSource() { return { connect: vi.fn() }; }
    close() { return Promise.resolve(); }
  });
  const track = { stop: vi.fn() };
  getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [] });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup() {
  const onStop = vi.fn();
  const view = renderHook(() => useRecording({ onStop, consultationCommentsRef: { current: [] }, onCommentsReset: vi.fn() }));
  return { view, onStop };
}

describe('recording size', () => {
  it('records mono speech at a low explicit bitrate', async () => {
    const { view } = setup();
    await act(async () => { await view.result.current.start('presencial'); });
    expect(latest().options).toEqual({ mimeType: 'audio/webm', audioBitsPerSecond: RECORDING_BITS_PER_SECOND });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { channelCount: { ideal: 1 } } });
  });

  it('falls back to the browser default when the bitrate option is refused', async () => {
    refuseBitrate = true;
    const { view } = setup();
    await act(async () => { await view.result.current.start('presencial'); });
    expect(view.result.current.isRecording).toBe(true);
    expect(latest().options).toEqual({ mimeType: 'audio/webm' });
  });

  it('counts the bytes, warns once near the limit and stops cleanly at the limit keeping the audio', async () => {
    const { view, onStop } = setup();
    await act(async () => { await view.result.current.start('presencial'); });
    act(() => latest().emitBytes(1000));
    expect(view.result.current.recordedBytes).toBe(1000);
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Gravação perto do limite' }));

    act(() => latest().emitBytes(RECORDING_WARN_BYTES));
    act(() => latest().emitBytes(10));
    expect(toast.mock.calls.filter(([t]) => t.title === 'Gravação perto do limite')).toHaveLength(1);
    expect(view.result.current.isRecording).toBe(true);
    expect(onStop).not.toHaveBeenCalled();

    act(() => latest().emitBytes(RECORDING_STOP_BYTES - RECORDING_WARN_BYTES));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Gravação encerrada no limite de tamanho' }));
    expect(view.result.current.isRecording).toBe(false);
    expect(onStop).toHaveBeenCalledTimes(1);
    const blob = onStop.mock.calls[0][0] as Blob;
    expect(blob.size).toBe(1000 + RECORDING_WARN_BYTES + 10 + RECORDING_STOP_BYTES - RECORDING_WARN_BYTES);
  });
});
