import { useCallback, useEffect, useRef, useState } from 'react';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { receptionApi } from './api';

export function useCaseDraft(caseId: string, initial: { body: string; revision: number }, owner?: string) {
  const [body, setValue] = useState(initial.body);
  const [savedBody, setSavedBody] = useState(initial.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(initial.body);
  const saved = useRef(initial.body);
  const version = useRef(initial.revision);
  const pending = useRef<Promise<void> | null>(null);
  const failed = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // Leaving the case (unmount or another case) saves text still waiting for the
  // debounce. Only for the same signed-in owner: after an actor change the
  // previous actor's text must never travel with the next actor's session.
  useEffect(() => () => {
    if (!owner || failed.current) return;
    const text = latest.current;
    const send = async () => {
      if (failed.current || text === saved.current) return;
      if (await receptionApi.sessionActor() !== owner || failed.current || text === saved.current) return;
      const next = await receptionApi.saveDraft(caseId, text, version.current);
      version.current = next;
      saved.current = text;
    };
    if (text === saved.current && !pending.current) return;
    void (pending.current ?? Promise.resolve()).catch(() => {}).then(send).catch(() => {});
  }, [caseId, owner]);
  const setBody = useCallback((text: string) => {
    latest.current = text;
    setValue(text);
  }, []);
  const flush = useCallback(
    async function persist(): Promise<void> {
      if (pending.current) {
        await pending.current;
        if (alive.current && latest.current !== saved.current) return persist();
        return;
      }
      if (latest.current === saved.current) return;
      const text = latest.current;
      const expected = version.current;
      if (alive.current) {
        setSaving(true);
        setError(null);
      }
      failed.current = false;
      const task = receptionApi
        .saveDraft(caseId, text, expected)
        .then((next) => {
          version.current = next;
          saved.current = text;
          if (alive.current) setSavedBody(text);
        })
        .catch((err) => {
          failed.current = true;
          if (alive.current) setError(err);
          throw err;
        })
        .finally(() => {
          pending.current = null;
          if (alive.current) setSaving(false);
        });
      pending.current = task;
      await task;
      if (alive.current && latest.current !== saved.current) return persist();
    },
    [caseId],
  );
  useEffect(() => {
    if (initial.revision > version.current && !pending.current && latest.current === saved.current) {
      version.current = initial.revision;
      saved.current = initial.body;
      latest.current = initial.body;
      setValue(initial.body);
      setSavedBody(initial.body);
    }
  }, [initial.body, initial.revision]);
  useEffect(() => {
    if (body === savedBody || failed.current) return;
    const timer = setTimeout(() => {
      void flush().catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [body, savedBody, flush]);
  const dirty = body !== savedBody;
  useUnsavedChanges(dirty, 'O rascunho administrativo ainda não foi salvo. Deseja sair e descartar o texto local?');
  const reload = async () => {
    if (
      dirty &&
      !window.confirm(
        'Substituir o texto desta aba pelo rascunho salvo no servidor? Copie o texto antes se quiser preservá-lo.',
      )
    )
      return;
    if (pending.current) await pending.current.catch(() => {});
    const current = await receptionApi.case(caseId);
    version.current = current.draft.revision;
    saved.current = current.draft.body;
    latest.current = current.draft.body;
    failed.current = false;
    if (alive.current) {
      setValue(current.draft.body);
      setSavedBody(current.draft.body);
      setError(null);
    }
  };
  const acceptSaved = (draft: { body: string; revision: number }) => {
    version.current = draft.revision;
    saved.current = draft.body;
    latest.current = draft.body;
    failed.current = false;
    setValue(draft.body);
    setSavedBody(draft.body);
    setError(null);
  };
  return { body, setBody, dirty, saving, error, flush, reload, acceptSaved };
}
