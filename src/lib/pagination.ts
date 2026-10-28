interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/** Callers supply a stable order and inclusive Supabase range for every page.
 * Continue until an empty page, including when the server caps pages below 500.
 * https://supabase.com/docs/reference/javascript/range
 */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await fetchPage(rows.length, rows.length + 499);
    if (error) throw new Error(error.message);
    if (!Array.isArray(data)) throw new Error('Não foi possível carregar os dados completos.');
    if (data.length === 0) return rows;
    rows.push(...data);
  }
}
