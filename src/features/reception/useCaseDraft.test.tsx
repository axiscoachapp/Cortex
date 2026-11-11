import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCaseDraft } from './useCaseDraft';
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), sessionActor: vi.fn() }));
vi.mock('./api', () => ({ receptionApi: { saveDraft: mocks.save, case: mocks.read, sessionActor: mocks.sessionActor } }));
describe('draft flush when leaving the case', () => {
  const owner = '11111111-1111-4111-8111-111111111111';
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    mocks.save.mockResolvedValue(1);
    mocks.sessionActor.mockResolvedValue(owner);
  });
  afterEach(() => vi.useRealTimers());
  it('saves text still inside the debounce when the hook unmounts', async () => {
    const { result, unmount } = renderHook(() => useCaseDraft('case-a', { body: '', revision: 3 }, owner));
    act(() => result.current.setBody('Digitado antes de sair'));
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith('case-a', 'Digitado antes de sair', 3);
  });
  it('saves the pending text of the previous case when the case changes', async () => {
    const { result, rerender } = renderHook(({ id }) => useCaseDraft(id, { body: '', revision: 0 }, owner), { initialProps: { id: 'case-a' } });
    act(() => result.current.setBody('Texto do caso A'));
    rerender({ id: 'case-b' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(mocks.save).toHaveBeenCalledWith('case-a', 'Texto do caso A', 0);
  });
  it('waits for an in-flight save and then saves the newer text once', async () => {
    let resolve!: (value: number) => void;
    mocks.save.mockImplementationOnce(() => new Promise<number>(r => { resolve = r; })).mockResolvedValueOnce(5);
    const { result, unmount } = renderHook(() => useCaseDraft('case-a', { body: '', revision: 0 }, owner));
    act(() => result.current.setBody('Primeiro'));
    await act(() => vi.advanceTimersByTimeAsync(700));
    act(() => result.current.setBody('Primeiro e segundo'));
    unmount();
    await act(async () => { resolve(4); await vi.advanceTimersByTimeAsync(0); });
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save).toHaveBeenNthCalledWith(2, 'case-a', 'Primeiro e segundo', 4);
  });
  it.each([
    ['another actor now holds the session', '66666666-6666-4666-8666-666666666666'],
    ['the session ended', null],
  ])('does not send the previous actor text when %s', async (_label, current) => {
    mocks.sessionActor.mockResolvedValue(current);
    const { result, unmount } = renderHook(() => useCaseDraft('case-a', { body: '', revision: 0 }, owner));
    act(() => result.current.setBody('Texto do primeiro usuário'));
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('does not flush without a known owner, nor after a conflicting save', async () => {
    const anonymous = renderHook(() => useCaseDraft('case-a', { body: '', revision: 0 }));
    act(() => anonymous.result.current.setBody('Sem dono'));
    anonymous.unmount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.save.mockRejectedValue(new Error('Outra aba alterou o rascunho'));
    const conflicted = renderHook(() => useCaseDraft('case-a', { body: '', revision: 0 }, owner));
    act(() => conflicted.result.current.setBody('Em conflito'));
    await act(() => vi.advanceTimersByTimeAsync(700));
    act(() => conflicted.result.current.setBody('Em conflito, editado'));
    conflicted.unmount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
});
describe('administrative draft recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
  });
  afterEach(() => vi.useRealTimers());
  it('serializes saves and retains text typed during an in-flight save', async () => {
    let resolve!: (value: number) => void;
    mocks.save
      .mockImplementationOnce(
        () =>
          new Promise<number>((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce(2);
    const { result } = renderHook(() => useCaseDraft('case-a', { body: '', revision: 0 }));
    act(() => result.current.setBody('Primeiro'));
    await act(() => vi.advanceTimersByTimeAsync(700));
    act(() => result.current.setBody('Texto mais recente'));
    await act(async () => {
      resolve(1);
      await Promise.resolve();
    });
    expect(mocks.save).toHaveBeenNthCalledWith(1, 'case-a', 'Primeiro', 0);
    expect(mocks.save).toHaveBeenNthCalledWith(2, 'case-a', 'Texto mais recente', 1);
    expect(result.current.body).toBe('Texto mais recente');
    expect(result.current.dirty).toBe(false);
  });
  it('keeps local text and stops automatic retries after a conflicting save', async () => {
    mocks.save.mockRejectedValue(new Error('Outra aba alterou o rascunho'));
    const { result } = renderHook(() => useCaseDraft('case-a', { body: 'Recuperado', revision: 2 }));
    act(() => result.current.setBody('Não perder este texto'));
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(result.current.body).toBe('Não perder este texto');
    expect(result.current.error).toBeInstanceOf(Error);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
});
