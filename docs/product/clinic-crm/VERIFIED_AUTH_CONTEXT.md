# Contexto de sessão verificado para Edge

04/11/2026. Interface compartilhada alinhada com o contrato D17 v3 (`fb76627`), sem handler de assinatura novo.

`requireUserContext(req, options?)` em `_shared/auth.ts` devolve `VerifiedUserContext` readonly: `{ userId, sessionId, aal, exp }`. Usa a mesma autenticação de `requireUser`: uma chamada `getUser` com o Authorization da Request, seguida da conferência de sub e das regras existentes de MFA/recepção. Somente então extrai os claims daquele bearer.

O modo estrito exige usuário e session_id em formato UUID, papel authenticated, aal1/aal2 conhecidos e exp numérico inteiro seguro, positivo e ainda futuro depois do await. Não usa corpo/query como prova e não devolve token, refresh ou metadata. `requireUser` continua devolvendo somente `{userId}`, com sua compatibilidade anterior.

Essa é extração autenticada de contexto, **não autorização atômica**. O handler D17 ainda exige AAL2 e sua margem operacional; SQL ainda deve cercar sessão/fator atuais, conta/recursos e relógio no ponto autorizativo. Um contexto que era válido pode expirar ou ser revogado depois do retorno. Não confiar em valores reenviados pelo cliente.

Nesta fatia o helper foi entregue e testado; fixtures `auth.sessions`/MFA e adaptação do bootstrap nativo são o incremento seguinte, juntos. Nenhum schema, migration ou tipo Supabase gerado mudou. Os dois casos de CAS/replay enviados ao Claude às 23:29 continuam exigidos nos testes SQL da assinatura.
