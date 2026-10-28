import { describe, expect, it } from 'vitest';
import { fetchAllRows } from './pagination';

describe('complete paginated reads', () => {
  it('retains every row across multiple inclusive pages', async () => {
    const source = Array.from({ length: 1201 }, (_, id) => ({ id }));
    const rows = await fetchAllRows((from, to) => Promise.resolve({ data: source.slice(from, to + 1), error: null }));
    expect(rows).toEqual(source);
  });
  it('does not report partial results as a successful export', async () => {
    await expect(fetchAllRows((from) => Promise.resolve(from === 0
      ? { data: Array.from({ length: 500 }, (_, id) => ({ id })), error: null }
      : { data: null, error: { message: 'Access denied' } }))).rejects.toThrow('Access denied');
  });
});
