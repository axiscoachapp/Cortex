import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WorkspaceShell } from '@/components/WorkspaceShell';
import { PageHeading } from '@/components/PageHeading';
import { mfaErrorMessage, newFactorName } from '@/lib/mfa';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useClinicAccess } from '@/features/reception/accessContext';
import { ChangePasswordCard } from '@/features/settings/ChangePasswordCard';
export default function AccountSecurity() {
  const { user } = useAuth();
  // /seguranca renders outside the clinic gate: with access unknown the side menu is empty, so the page keeps its own way back.
  const access = useClinicAccess();
  const client = useQueryClient();
  const [setup, setSetup] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [factor, setFactor] = useState('');
  const [error, setError] = useState<{ message: string } | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    errorRef.current?.focus();
  }, [error]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const factors = useQuery({
    queryKey: ['mfa-factors', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      // The SDK's totp list excludes pending setups, which still need cleanup.
      return data.all.filter((factor) => factor.factor_type === 'totp');
    },
  });
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      await action();
    } catch (err) {
      setError({ message: mfaErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  const enroll = () =>
    run(async () => {
      // Abandoned, never-verified setups count toward the factor limit: clear them first.
      for (const stale of factors.data?.filter((f) => f.status !== 'verified') ?? []) {
        const { error: cleanupError } = await supabase.auth.mfa.unenroll({ factorId: stale.id });
        if (cleanupError) throw cleanupError;
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: newFactorName(factors.data?.filter((f) => f.status === 'verified').length ?? 0),
        issuer: 'Haddad Nicola',
      });
      if (error) throw error;
      setSetup({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      setFactor(data.id);
      setCode('');
      void client.invalidateQueries({ queryKey: ['mfa-factors', user?.id] });
    });
  const verify = () =>
    run(async () => {
      const factorId = setup?.id || factor || factors.data?.find((f) => f.status === 'verified')?.id || '';
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) throw error;
      setSetup(null);
      setCode('');
      const verifiedCount = (factors.data?.filter((f) => f.status === 'verified').length ?? 0) + (setup ? 1 : 0);
      setNotice(
        verifiedCount < 2
          ? 'Verificação concluída. Recomendamos adicionar um segundo autenticador (por exemplo, outro celular) como reserva: sem ele, perder o aparelho bloqueia o acesso aos prontuários.'
          : 'Verificação concluída. Sua sessão está protegida pelo segundo fator.',
      );
      void client.invalidateQueries({ queryKey: ['mfa-factors'] });
      void client.invalidateQueries({ queryKey: ['session-assurance'] });
    });
  const remove = (id: string) =>
    run(async () => {
      if (!window.confirm('Remover este autenticador da sua conta?')) return;
      const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
      if (error) throw error;
      const queryKey = ['mfa-factors', user?.id];
      await client.cancelQueries({ queryKey });
      client.setQueryData<typeof factors.data>(queryKey, (current) => current?.filter((f) => f.id !== id));
      setSetup(null);
      setFactor('');
      setCode('');
      void client.invalidateQueries({ queryKey });
      setNotice('Autenticador removido.');
    });
  return (
    <WorkspaceShell section="Segurança da conta">
      <PageHeading
        title="Segurança da conta"
        description="Sua senha e o aplicativo autenticador protegem seu acesso. Cada pessoa mantém a própria conta."
      />
      <div className="max-w-4xl space-y-6">
        {!access && (
          <Link to="/" className="inline-flex min-h-11 items-center gap-2 text-sm text-primary underline underline-offset-4">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />Voltar ao início
          </Link>
        )}
        <ChangePasswordCard />
        {error && (
          <p ref={errorRef} tabIndex={-1} role="alert" className="text-destructive text-sm">
            {error.message}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        <section className="rounded-xl border bg-card p-4 space-y-4 md:p-6" aria-labelledby="authenticators-heading">
          <div className="space-y-1">
            <h2 id="authenticators-heading" className="text-base font-semibold">
              Seus autenticadores
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Gerencie os dispositivos usados para confirmar sua identidade.
            </p>
          </div>
          {factors.isError ? (
            <div role="alert" className="space-y-3 text-sm">
              <p>Não foi possível carregar autenticadores.</p>
              <Button variant="outline" onClick={() => factors.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : factors.isLoading ? (
            <p role="status" className="text-sm text-muted-foreground">
              Carregando…
            </p>
          ) : (
            <ul className="space-y-3">
              {factors.data?.map((f) => (
                <li key={f.id} className="rounded-lg border p-4 flex flex-wrap justify-between items-center gap-3">
                  <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
                    {f.friendly_name || 'Aplicativo autenticador'} ·{' '}
                    {f.status === 'verified' ? 'Ativo' : 'Configuração pendente'}
                  </span>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => remove(f.id)}>
                    Remover
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {!factors.isLoading && !factors.isError && factors.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum autenticador cadastrado. Adicione um dispositivo para proteger sua conta.
            </p>
          )}
          {!setup && (
            <Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={busy || factors.isLoading || factors.isError} onClick={enroll}>
              Adicionar autenticador
            </Button>
          )}
        </section>
        {setup && (
          <section className="rounded-xl border bg-card p-5 space-y-4">
            <h2 className="font-semibold">Configurar aplicativo</h2>
            <p className="text-sm">
              Leia o QR code no seu aplicativo. Guarde sua configuração em um local seguro e confirme o código abaixo.
            </p>
            <img
              src={
                setup.qr.startsWith('data:')
                  ? setup.qr
                  : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(setup.qr)
              }
              alt="QR code para configurar seu autenticador"
              className="w-52 max-w-full h-auto"
            />
            <details>
              <summary className="cursor-pointer text-sm">Inserir chave manualmente</summary>
              <code className="block break-all py-3 select-all">{setup.secret}</code>
            </details>
            <Button className="h-auto min-h-11 max-w-full whitespace-normal" variant="outline" disabled={busy} onClick={() => remove(setup.id)}>
              Cancelar configuração
            </Button>
          </section>
        )}
        {(setup || factors.data?.some((f) => f.status === 'verified')) && (
          <form
            className="space-y-4 rounded-xl border bg-card p-4 md:p-6"
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <h2 className="text-base font-semibold">Confirmar acesso</h2>
            {!setup && (
              <label className="block text-sm">
                Autenticador
                <select
                  aria-label="Autenticador"
                  className="mt-2 block min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={factor || factors.data?.find((f) => f.status === 'verified')?.id || ''}
                  disabled={busy}
                  onChange={(e) => {
                    setFactor(e.target.value);
                    setCode('');
                    setError(null);
                    setNotice('');
                  }}
                  required
                >
                  <option value="">Selecione</option>
                  {factors.data
                    ?.filter((f) => f.status === 'verified')
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.friendly_name || 'Aplicativo autenticador'}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label className="block text-sm space-y-2">
              <span>Código do aplicativo</span>
              <Input
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                disabled={busy}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
              />
            </label>
            <Button
              type="submit"
              disabled={
                busy || code.length !== 6 || (!setup && !(factor || factors.data?.some((f) => f.status === 'verified')))
              }
            >
              Verificar código
            </Button>
          </form>
        )}
        <p className="text-xs text-muted-foreground border-t pt-4">
          Se perder acesso ao autenticador, solicite recuperação ao responsável pelo ambiente. Desabilitar um fator
          exige uma sessão verificada.
        </p>
      </div>
    </WorkspaceShell>
  );
}
