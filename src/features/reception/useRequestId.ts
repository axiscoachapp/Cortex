import { useRef } from 'react';

/** Keep the same operation ID on retries; edited input starts a distinct operation. */
export function useRequestId() {
  const current = useRef<{ body: string; id: string } | null>(null);
  return Object.assign(
    (body: unknown) => {
      const serialized = JSON.stringify(body);
      if (current.current?.body !== serialized) current.current = { body: serialized, id: crypto.randomUUID() };
      return current.current.id;
    },
    {
      reset: () => {
        current.current = null;
      },
    },
  );
}
