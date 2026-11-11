import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKPOINT_MS, useRecording } from './useRecording';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

// A recorder whose chunks the test emits by hand.
const recorders: Recorder[] = [];
const latest = () => recorders[recorders.length - 1];
class Recorder {
  static isTypeSupported = (type: string) => type === 'audio/webm';
  state = 'inactive';
  onstop: (() => void) | null = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  requestData = vi.fn();
  constructor() { recorders.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.onstop?.(); }
  emit(text: string) { this.ondataavailable?.({ data: new Blob([text]) }); }
}

class Track extends EventTarget { stop = vi.fn(); }
let micTrack: Track;
let wakeLock: { release: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  toast.mockReset();
  micTrack = new Track();
  wakeLock = { release: vi.fn().mockResolvedValue(undefined) };
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('AudioContext', class {
    state = 'running';
    createAnalyser() { return { frequencyBinCount: 8, getByteTimeDomainData: (bytes: Uint8Array) => bytes.fill(128) }; }
    createMediaStreamSource() { return { connect: vi.fn() }; }
    close() { return Promise.resolve(); }
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [micTrack], getAudioTracks: () => [micTrack] }) },
  });
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: vi.fn().mockResolvedValue(wakeLock) } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (navigator as { wakeLock?: unknown }).wakeLock;
});

function setup() {
  const onStop = vi.fn(), onCheckpoint = vi.fn(), onCheckpointDiscard = vi.fn(), onRescue = vi.fn();
  const comments = { current: ['Comentário'] };
  const view = renderHook(() => useRecording({ onStop, onCheckpoint, onCheckpointDiscard, onRescue, consultationCommentsRef: comments, onCommentsReset: vi.fn() }));
  return { view, onStop, onCheckpoint, onCheckpointDiscard, onRescue, comments };
}
const sizes = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.map(([checkpoint]) => checkpoint.blob.size);

describe('recording checkpoints', () => {
  it('checkpoints the audio captured so far while recording, only when new audio arrived', async () => {
    const { view, onCheckpoint } = setup();
    await act(async () => { await view.result.current.start('presencial'); });
    act(() => { latest().emit('aaa'); vi.advanceTimersByTime(CHECKPOINT_MS); });
    act(() => { vi.advanceTimersByTime(CHECKPOINT_MS); }); // nothing new
    act(() => { latest().emit('bb'); vi.advanceTimersByTime(CHECKPOINT_MS); });
    expect(sizes(onCheckpoint)).toEqual([3, 5]);
    const ids = new Set(onCheckpoint.mock.calls.map(([checkpoint]) => checkpoint.captureId));
    expect(ids.size).toBe(1);
    expect(onCheckpoint.mock.calls[0][0]).toMatchObject({ mimeType: 'audio/webm', consultationComments: ['Comentário'] });
  });

  it('writes the full audio as a last checkpoint before processing it, under the same capture id', async () => {
    const { view, onStop, onCheckpoint } = setup();
    await act(async () => { await view.result.current.start('presencial'); });
    act(() => { latest().emit('aaa'); vi.advanceTimersByTime(CHECKPOINT_MS); latest().emit('bbbb'); });
    act(() => view.result.current.confirmStop());
    expect(sizes(onCheckpoint)).toEqual([3, 7]);
    expect(onCheckpoint.mock.invocationCallOrder[1]).toBeLessThan(onStop.mock.invocationCallOrder[0]);
    const captureId = onCheckpoint.mock.calls[0][0].captureId;
    expect(onStop).toHaveBeenCalledWith(expect.any(Blob), 'audio/webm', ['Comentário'], expect.objectContaining({ captureId }));
    // No further checkpoints after the stop.
    act(() => { vi.advanceTimersByTime(CHECKPOINT_MS * 3); });
    expect(onCheckpoint).toHaveBeenCalledTimes(2);
  });

  it('checkpoints at once when the page is hidden (tab switch, screen lock)', async () => {
    const { view, onCheckpoint } = setup();
    await act(async () => { await view.result.current.start('presencial'); });
    act(() => latest().emit('aaa'));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    visibility.mockRestore();
    expect(latest().requestData).toHaveBeenCalled();
    expect(sizes(onCheckpoint)).toEqual([3]);
  });

  it('an abrupt end leaves the last checkpoint; an unmount rescues the full audio under the same id', async () => {
    const { view, onCheckpoint, onRescue, onStop, onCheckpointDiscard } = setup();
    await act(async () => { await view.result.current.start('presencial'); });
    act(() => { latest().emit('aaa'); vi.advanceTimersByTime(CHECKPOINT_MS); latest().emit('b'); });
    const captureId = onCheckpoint.mock.calls[0][0].captureId;
    view.unmount();
    expect(onRescue).toHaveBeenCalledWith(expect.any(Blob), 'audio/webm', ['Comentário'], expect.objectContaining({ captureId }));
    expect(onRescue.mock.calls[0][0].size).toBe(4);
    expect(onStop).not.toHaveBeenCalled();
    expect(onCheckpointDiscard).not.toHaveBeenCalled();
  });

  it('drops the checkpoint when the doctor discards the recording', async () => {
    const { view, onCheckpoint, onCheckpointDiscard, onStop } = setup();
    await act(async () => { await view.result.current.start('presencial'); });
    act(() => { latest().emit('aaa'); vi.advanceTimersByTime(CHECKPOINT_MS); });
    act(() => view.result.current.discard());
    expect(onCheckpointDiscard).toHaveBeenCalledWith(expect.objectContaining({ captureId: onCheckpoint.mock.calls[0][0].captureId }));
    act(() => { latest().emit('bb'); vi.advanceTimersByTime(CHECKPOINT_MS); });
    expect(onCheckpoint).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });
});

describe('device safety while recording', () => {
  it('holds a screen wake lock while recording and releases it on stop', async () => {
    const { view } = setup();
    await act(async () => { await view.result.current.start('presencial'); });
    expect((navigator as unknown as { wakeLock: { request: ReturnType<typeof vi.fn> } }).wakeLock.request).toHaveBeenCalledWith('screen');
    act(() => view.result.current.confirmStop());
    expect(wakeLock.release).toHaveBeenCalled();
  });

  it('records normally where the Wake Lock API does not exist', async () => {
    delete (navigator as { wakeLock?: unknown }).wakeLock;
    const { view, onStop } = setup();
    await act(async () => { await view.result.current.start('presencial'); });
    expect(view.result.current.isRecording).toBe(true);
    act(() => { latest().emit('aaa'); view.result.current.confirmStop(); });
    expect(onStop).toHaveBeenCalled();
  });

  it('tells the doctor when the microphone ends or is muted, and stops listening after the recording', async () => {
    const { view } = setup();
    await act(async () => { await view.result.current.start('presencial'); });
    toast.mockReset();
    act(() => { micTrack.dispatchEvent(new Event('mute')); });
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Microfone sem som' }));
    act(() => { micTrack.dispatchEvent(new Event('ended')); });
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Microfone desconectado' }));
    act(() => view.result.current.confirmStop());
    toast.mockReset();
    act(() => { micTrack.dispatchEvent(new Event('ended')); });
    expect(toast).not.toHaveBeenCalled();
  });
});
