# Edge Functions da assinatura digital (D17): desenho para revisão

Status: **proposta, sem código**. Revisão do Codex antes de qualquer handler.

Não inclui provedor real, deploy, certificado nem migration aplicada em banco hospedado.

Base:
- [ASSINATURA_DIGITAL.md](ASSINATURA_DIGITAL.md) (contrato v2 e correções 1–17);
- `_shared/signatureFlow.ts` (`signDocument`);
- `_shared/psc.ts`;
- revisões do Codex de 04/11, 19:42, 20:55 e 22:12.

## 1. O que muda e o que não muda

- **Funções novas:** `signature-session` e `sign-document`. As duas são finas: autenticam, montam as portas e chamam `signDocument` ou as funções de sessão. Toda decisão de estado fica no banco.
- **O corpo do pedido nunca prova nada.** Ator, sessão do Cortex, prazo, nível de autenticação e anuência vêm só do contexto que o servidor verificou. O corpo leva apenas `prescriptionId`, `operationId`, `shownPdfSha256` e `humanRetry`.
  - `humanRetry` só escolhe o ramo de repetição a partir de `ambiguous` (ver a §6).
  - Não substitui a sessão nem o segundo fator.
- **Fora deste desenho:** a política de MFA do produto e o `requireUser` compartilhado continuam com o Codex. A geração de autoridade administrativa da clínica não se aplica à assinatura.

## 2. Contexto de autenticação (só do servidor)

`requireUser` já verifica o bearer no Auth (`getUser`) e só então lê os claims assinados.

**Pedido ao Codex** (arquivo compartilhado, mudança aditiva): `requireUser` passa a devolver também o que já validou:

```ts
{ userId: string; sessionId: string; aal: 'aal1' | 'aal2'; exp: number /* segundos, do JWT verificado */ }
```

As chamadas atuais continuam iguais. Se o Codex preferir não mexer, um `requireSignatureUser` no meu domínio chama `requireUser` e relê os claims do mesmo token já verificado. Prefiro a mudança no lugar certo.

**Regras da assinatura no handler, antes de qualquer RPC:**
- conta clínica, não recepção (já está em `requireUser`);
- `aal = 'aal2'` **sempre**. Sem fator verificado não há assinatura, como diz o contrato v2 ("JWT, clínico e MFA");
- margem do token: `exp − agora ≥ 120 s`. Com menos que isso, a resposta é 401 "renove a sessão", e o cliente renova antes de começar. Isso só evita trabalho inútil: a cerca de verdade fica no banco (§3).

O handler passa ao banco `p_auth = {sessionId, aal, exp}`, montado só desse contexto.

## 3. Cerca de sessão do Cortex no ponto autorizativo

Uma consulta HTTP ao Auth antes do RPC não fecha um logout que aconteça entre os dois (Codex, 20:55). A cerca fica na mesma transação que decide.

**Nova função privada `cortex_private.signature_auth_fence(p_user, p_auth)`.** Ela é chamada dentro de `signature_lock`, logo depois de `auth.users FOR SHARE NOWAIT`:

1. `select … from auth.sessions where id = p_auth.sessionId and user_id = p_user for share nowait`.
   - Linha ocupada (logout ou exclusão em andamento) vira 40001.
   - Linha ausente (logout já feito) vira **P4011** ("sessão do Cortex encerrada").
2. A sessão precisa de `aal = 'aal2'` e `factor_id is not null`, e o `aal` informado precisa ser `aal2`.
3. **Depois de todas as travas da função** (contas, epochs e linhas), com `clock_timestamp()`:
   - `agora < to_timestamp(p_auth.exp)`, do JWT verificado: `not_after` sozinho não limita o token (prova do Codex com bearer de oito segundos);
   - `not_after is null or agora < not_after`.

**Ordem das travas** (inventário completo na migration):
125 → 123 → `auth.users` (share) → **`auth.sessions` (share)** → epochs → linhas, na ordem sessão de assinatura → operação → receita → objeto do Storage.

Sobre essa ordem:
- **Exclusão de conta:** apaga `auth.users` e, em cascata, `auth.sessions`, na mesma ordem.
- **Logout:** apaga só a linha da sessão. Como toda trava nossa é NOWAIT, não há espera em ciclo.
- **Em RR:** uma linha apagada ou alterada depois do snapshot dá falha de serialização (40001), a mesma disciplina das outras cercas. Nenhum dado lido antes da trava é usado como prova.

### Referências que cada ponto afirma estarem vivas

Cada uma é travada e conferida na mesma transação, com o relógio lido depois de todas as travas.

| Referência | Trava | Conferência | `reserve` | `session_token` | `advance` prepared/psc_requested/stored | `complete` |
|---|---|---|---|---|---|---|
| Conta do médico | `auth.users` FOR SHARE NOWAIT, 123 | existe, não é recepção, sem pedido de exclusão | ✓ | ✓ | ✓ | ✓ |
| Sessão do Cortex | `auth.sessions` FOR SHARE NOWAIT | existe, AAL2, fator, `exp` e `not_after` depois das travas | ✓ | ✓ | ✓ | ✓ |
| Sessão de assinatura (PSC) | linha FOR UPDATE NOWAIT | ativa, mesma `generation`, `expires_at` | ✓ | ✓ | ✓ | ✓ |
| Operação | linha FOR UPDATE NOWAIT | estado e tentativa (P4094) | — | — | ✓ | ✓ |
| Receita | linha NOWAIT (share; update na conclusão) | dona, `generated`, hash do snapshot, sem caminho assinado | ✓ | — | ✓ | ✓ |
| Paciente e paciente da consulta | epochs T33 | sem intenção de exclusão | ✓ | — | ✓ | ✓ |
| Objeto assinado | `storage.objects` FOR SHARE NOWAIT | **novo:** existe no caminho da operação | — | — | — | ✓ |

**Falha da cerca:**
- **Na reserva, no token e na ativação:** recusa sem efeito.
- **Em `advance` e `complete`:** a operação é encerrada como `cancelled`, com o código `auth_session_ended` e a limpeza marcada pelo banco. Isso evita deixar uma operação aberta que bloqueie o documento.
  - Um logout no meio da assinatura vence, como a revogação.
  - Nada é publicado depois de um logout.

**Passos de fechamento sem cerca de sessão:**
- `ambiguous`, `failed`, `cancelled`, `revoke`, `cleanup_done`, `pending_work` e `expire_sessions`.
- Registrar uma resposta perdida, desistir ou limpar precisa funcionar depois do logout.
- Esses passos só podem fechar, nunca publicar.

**Funções de sessão do PSC:** `begin_authorization` e `activate_session` também recebem `p_auth` com a mesma cerca. `revoke` não recebe: encerrar precisa funcionar sempre que houver um JWT válido.

### Assinatura das funções

As funções públicas existentes ganham `p_auth jsonb` no fim. Os tipos gerados mudam, então combino com o Codex antes.

Esta é a única mudança de contrato do banco neste desenho, junto com a conferência do objeto na conclusão.

## 4. `signature-session`

| Rota | Entrada | Faz | Saída |
|---|---|---|---|
| `POST start` | — | cerca da §2; cria `state` e PKCE; `signature_begin_authorization(…, p_auth)` | URL de autorização (só da lista fixa do servidor) |
| `POST complete` | `{code, state}` | consome o `state` (CAS); troca o código; confere o CPF autorizado contra `prescriber_cpf`; descobre o certificado; sela o token; `signature_activate_session(…, p_auth)` | `{active, expiresAt}` |
| `POST revoke` | — | `signature_revoke_session` (só JWT válido) | `{revoked}` |
| `GET state` | — | `signature_session_state` | `{active, expiresAt}`, nunca o token |

## 5. `sign-document`

- **Entrada:** `POST {prescriptionId, operationId, shownPdfSha256, humanRetry?}`. Os formatos são validados: UUID e hex de 64 caracteres.
- **Portas:**
  - RPC service-role com `p_auth` injetado pelo handler;
  - Storage service-role no bucket `prescriptions` (upload sem sobrescrever; download; remoção só pelo `finish` do fluxo);
  - cliente PSC da configuração fixa do servidor;
  - `SIGNATURE_TOKEN_KEYS`.
- **Logs:** só ids e códigos, nunca token, CPF, hash do documento ou conteúdo.

**Resposta HTTP:**

| Resultado | HTTP | Corpo |
|---|---|---|
| `completed` | 200 | `{status, signedPath}`. O link é emitido por `validate-prescription`, não aqui |
| `in_progress` / `ambiguous` | 202 | `{status}`. A tela oferece "tentar de novo" só em `ambiguous` |
| `failed` / `cancelled` / `cancelled_by_revocation` | 409 | `{status, code}` |
| `rate_limited` | 429 | sessão suspensa pelo banco |
| 40001 | 503 | `Retry-After: 1` |
| P4011, sessão do Cortex encerrada | 401 | "Entre de novo" |
| P4031, sessão de assinatura encerrada | 409 | "Abra uma nova sessão de assinatura" |
| P4093 | 409 | mensagem do banco |
| 42501 | 403 | genérica |

## 6. `humanRetry`

- O banco só aceita repetir a partir de `ambiguous`, com até 5 tentativas por operação e o limite de 60 operações por hora. Toda repetição exige a cerca da §3 (sessão viva com AAL2).
- `humanRetry` vem da ação explícita "tentar de novo" na tela. Ele não é prova de anuência; a prova é o pedido autenticado e cercado.
- **A decidir com o Codex** (política de MFA): exigir segundo fator recente, por exemplo 5 minutos, para cada repetição. **Proposta: não exigir agora.** O risco de repetição está limitado pelo teto de tentativas e pela assinatura determinística, que produz os mesmos bytes. Se a política mudar, muda só o handler.

## 7. Fixture `auth.sessions` (bootstrap, dono: Codex)

Para o Codex incluir no bootstrap quando este desenho estiver alinhado, com a nulabilidade nativa do Auth:

| Coluna | Tipo | Nulo |
|---|---|---|
| `id` | uuid, PK | não |
| `user_id` | uuid → `auth.users(id) on delete cascade` | sim no Auth nativo; os testes sempre preenchem |
| `aal` | `auth.aal_level` (`aal1`, `aal2`, `aal3`) | sim |
| `factor_id` | uuid | sim |
| `not_after` | timestamptz | sim |
| `created_at`, `updated_at`, `refreshed_at` | timestamps | sim |

O adaptador do Auth nativo omite essa tabela mock, como o Codex descreveu. Eu não edito o bootstrap.

## 8. Provas, em vermelho antes do código

**SQL, numa conexão:**
- sessão ausente, `aal1`, sem fator, `exp` vencido e `not_after` vencido, em cada função da tabela da §3;
- logout entre a reserva e a conclusão leva a `cancelled` com `auth_session_ended` e limpeza;
- objeto assinado ausente na conclusão.

**Corridas, em duas conexões:**
- logout (DELETE de `auth.sessions`) contra `signature_complete`, nas duas ordens, em RC e em RR;
- exclusão de conta contra a cerca de sessão;
- `exp` vencendo enquanto a função espera o 123: a recusa vem pelo relógio lido depois das travas;
- controle que retira a cerca na base descartável e precisa falhar.

**Fluxo:** portas com `p_auth`; o mapeamento HTTP da §5; os passos de fechamento funcionam sem sessão.

**Handlers:** clientes simulados, conferindo que nada do corpo vira ator, sessão ou `exp`, e o pedido sem AAL2 ou com margem curta.

## 9. Ordem

1. Revisão deste desenho pelo Codex, incluindo o pedido sobre `requireUser` e a mudança de assinatura das funções.
2. Fixture `auth.sessions` no bootstrap (Codex).
3. Cerca SQL e conferência do objeto, com as provas da §8 (Claude).
4. Handlers e testes (Claude).
5. Tela: sessão de assinatura e "Gerar e assinar" (Claude).
6. Homologação com a Valid, só na Fase 0, com o médico presente.
