import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCaseDraft } from './useCaseDraft';
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn() }));
vi.mock('./api', () => ({ receptionApi: { saveDraft: mocks.save, case: mocks.read } }));
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
