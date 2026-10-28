import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRecording } from './useRecording';
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

class Recorder {
  static isTypeSupported = (type: string) => type === 'audio/mp4';
  state = 'inactive';
  onstop: (() => void) | null = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['voice']) }); this.onstop?.(); }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('recording ownership', () => {
  it('releases a microphone permission result that arrives after leaving the page', async () => {
    const track = { stop: vi.fn() };
    let resolve!: (stream: unknown) => void;
    const permission = new Promise(result => { resolve = result; });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => permission } });
    const onStop = vi.fn();
    const view = renderHook(() => useRecording({ onStop, consultationCommentsRef: { current: [] }, onCommentsReset: vi.fn() }));
    let start!: Promise<void>;
    act(() => { start = view.result.current.start('presencial'); });
    expect(view.result.current.isStarting).toBe(true);
    view.unmount();
    await act(async () => { resolve({ getTracks: () => [track] }); await start; });
    expect(track.stop).toHaveBeenCalled(); expect(onStop).not.toHaveBeenCalled();
  });
  it('finishes using the patient callback captured when recording began, with a supported MIME type', async () => {
    vi.stubGlobal('MediaRecorder', Recorder);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const track = { stop: vi.fn() };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [track] }) } });
    vi.stubGlobal('AudioContext', class {
      state = 'running';
      createAnalyser() { return { frequencyBinCount: 8, getByteTimeDomainData: (bytes: Uint8Array) => bytes.fill(128) }; }
      createMediaStreamSource() { return { connect: vi.fn() }; }
      close() { return Promise.resolve(); }
    });
    const original = vi.fn(), later = vi.fn();
    const comments = { current: ['Correção do médico'] };
    const view = renderHook(({ callback }) => useRecording({ onStop: callback, consultationCommentsRef: comments, onCommentsReset: vi.fn() }), { initialProps: { callback: original } });
    await act(async () => { await view.result.current.start('presencial'); });
    view.rerender({ callback: later });
    act(() => view.result.current.confirmStop());
    expect(original).toHaveBeenCalledWith(expect.any(Blob), 'audio/mp4', ['Correção do médico']);
    expect(later).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
  });
  it('a delayed stop event cannot consume the next recording or stop its microphone', async () => {
    const pending: Array<() => void> = [];
    let sequence = 0;
    class DelayedRecorder extends Recorder {
      id = sequence++;
      start() { super.start(); this.ondataavailable?.({ data: new Blob([this.id ? 'bbbbb' : 'aaa']) }); }
      stop() {
        this.state = 'inactive';
        pending.push(() => { this.ondataavailable?.({ data: new Blob([this.id ? 'dddd' : 'cc']) }); this.onstop?.(); });
      }
    }
    vi.stubGlobal('MediaRecorder', DelayedRecorder);
    vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const firstTrack = { stop: vi.fn() }, nextTrack = { stop: vi.fn() };
    let streams = 0;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [streams++ ? nextTrack : firstTrack] }) } });
    vi.stubGlobal('AudioContext', class {
      state = 'running';
      createAnalyser() { return { frequencyBinCount: 8, getByteTimeDomainData: (bytes: Uint8Array) => bytes.fill(128) }; }
      createMediaStreamSource() { return { connect: vi.fn() }; }
      close() { return Promise.resolve(); }
    });
    const first = vi.fn(), next = vi.fn(), comments = { current: ['A'] };
    const view = renderHook(({ callback }) => useRecording({ onStop: callback, consultationCommentsRef: comments, onCommentsReset: vi.fn() }), { initialProps: { callback: first } });
    await act(async () => { await view.result.current.start('presencial'); });
    act(() => view.result.current.confirmStop());
    comments.current = ['B']; view.rerender({ callback: next });
    await act(async () => { await view.result.current.start('presencial'); });
    act(() => pending.shift()!());
    expect(first.mock.calls[0][0].size).toBe(5);
    expect(first.mock.calls[0][2]).toEqual(['A']);
    expect(nextTrack.stop).not.toHaveBeenCalled();
    act(() => { view.result.current.confirmStop(); pending.shift()!(); });
    expect(next.mock.calls[0][0].size).toBe(9);
    expect(next.mock.calls[0][2]).toEqual(['B']);
  });
});
