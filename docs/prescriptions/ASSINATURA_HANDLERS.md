# Edge Functions da assinatura digital (D17): desenho para revisão

Status: **proposta, sem código**. Revisão do Codex antes de qualquer handler.

Versões:
- **v1** (`690df17`): o Codex recebeu às 22:38, sem aprovar.
- **v2** (`1c02436`): o Codex revisou às 22:53 e pediu quatro ajustes.
- **v3** (esta): incorpora os quatro ajustes:
  - barreira comum e cerca separadas;
  - efeito devolvido em vez de exceção depois de um UPDATE, e só sobre a tentativa pertinente;
  - promessa do fator limitada ao que é cercado;
  - `consume_authorization` no inventário;

  e também a regra de `stored` com `stored_at`.

- **v3.1:** inclui os dois casos de 23:29 (tentativa observada em `psc_requested` e reserva terminal sem cerca).

**Implementação SQL (05/11), na própria migration `20261105100000`, sem migration nova.** Entrou o que Codex liberou às 00:32:
- a cerca de sessão (`signature_auth_shape`, `signature_session_fence` e `signature_session_live`);
- a divisão entre `signature_advance` e `signature_close`;
- a tentativa observada em `psc_requested` e o retorno terminal da reserva;
- o objeto conferido na conclusão;
- `stored_at`;
- `signature_reconcile`.

**Handlers (05/11, depois do reteste do Codex de 04:09):**
- `supabase/functions/sign-document` e `supabase/functions/signature-session`, finos, sobre `_shared/signatureHandlers.ts` (lógica testável com dependências injetadas) e `_shared/signatureDeps.ts` (ligação com `requireUserContext`, o cliente de serviço, o Storage e o cliente do PSC).
- O contexto verificado vira `p_auth` só nas funções produtivas.
- O corpo tem formato estrito: chave a mais dá 400.
- Exigências de entrada: AAL2 em todas as rotas; margem de 120 segundos do JWT para assinar e abrir sessão.
- Testes em `src/lib/signatureHandlers.test.ts`: as nove proteções foram mutadas e pegas.

**Correções da revisão do Codex de 05/11, 05:09:**
- **R1, retomada com a sessão PSC encerrada:** o fluxo não manda mais `advance('prepared', {})`. Com P4031 no token, ele chama `signature_close(…, 'cancelled_by_revocation', {expectedState, attempt})`:
  - é um passo de fechamento, sem `p_auth`;
  - o banco decide pela linha da sessão: encerrada, substituída ou vencida nunca volta a valer, e a geração só cresce;
  - fecha só no estado e na tentativa observados (CAS); fora disso, ou com a sessão viva, devolve a operação como está;
  - conserva os dados preparados e agenda a limpeza quando o PSC já foi chamado.

  `signature_reserve` de uma operação nova também fecha, logo antes do INSERT, uma operação aberta do mesmo documento cuja sessão PSC acabou. A linha é travada NOWAIT. Uma operação aberta na sessão viva continua bloqueando (P4093).
- **R2, certificado:** `signerCertificateProblem` (`pades.ts`) exige:
  - um certificado DER X.509 completo, sem bytes a mais;
  - chave RSA de pelo menos 2048 bits, importável para RSASSA-PKCS1-v1_5;
  - o instante dentro da validade.

  `complete` ativa o primeiro certificado descoberto que passa. Sem nenhum, responde 409 `no_certificate`, `certificate_invalid` ou `certificate_expired`, sem chamar `signature_activate_session`. O fluxo confere de novo na hora da assinatura (`signing_time`) e falha com o mesmo código antes do PSC.
- **R3, `state` e `revoke`:** passam a exigir AAL2, como todas as rotas. É a exigência efetiva do gate de MFA de `requireUserContext`, sem caminho mais fraco e sem mudar o helper. A margem do JWT continua só para abrir sessão e assinar.
- **R4, Storage:** `storageErrorKind` classifica só pela resposta estruturada do storage-js:
  - **ausente:** HTTP 400 ou 404 com `statusCode` 404;
  - **já existe:** HTTP 400 ou 409 com `statusCode` 409;
  - **indisponível:** todo o resto, qualquer que seja o texto. O adaptador lança, e nada é fechado nem removido por isso.

  Erro de leitura do banco (receita, CPF) também lança, em vez de virar "ausente".
- **Bordas do reteste de 06:35 (Codex):**
  - **R2, forma X.509 completa** (RFC 5280 §4.1, DER estrito), conferida antes de qualquer confiança:
    - todo cabeçalho com o comprimento mínimo, e todo nó construído preenchido exatamente pelos filhos;
    - `signatureAlgorithm` externo igual ao campo `signature` do TBS;
    - `signatureValue` com pelo menos 1 byte e sem bits sobrando;
    - versão 1 a 3, serial e OIDs mínimos;
    - nomes com valores de tipo string;
    - extensões únicas;
    - só `[1]`, `[2]` e `[3]` depois da chave, nessa ordem.

    Um teste diferencial gera centenas de variantes corrompidas e confere que nenhuma recusada pelo OpenSSL (`node:crypto.X509Certificate`) passa aqui.
  - **R2, conteúdo dos valores (07:36):** todo valor primitivo universal, onde quer que esteja (parâmetros de algoritmo, nomes), tem conteúdo válido para o tipo:
    - BOOLEAN `00`/`FF`;
    - INTEGER mínimo;
    - BIT STRING com bits sobrando zerados;
    - NULL vazio;
    - OID mínimo;
    - UTF8String válida;
    - horários estritos;
    - BMPString par e UniversalString múltipla de 4.

    String construída (BER) é recusada. O conjunto de caracteres de PrintableString e IA5String não é imposto, como no OpenSSL.
  - **R2, lista explícita (08:30):** um valor primitivo universal fora da lista conferida é recusado, inclusive SEQUENCE ou SET em forma primitiva. A lista:
    - BOOLEAN, INTEGER e ENUMERATED;
    - BIT STRING, OCTET STRING, NULL e OID;
    - UTF8String;
    - as strings de byte dos nomes;
    - os horários;
    - BMPString e UniversalString, que só aceitam pontos de código inteiros, sem surrogate e até U+10FFFF.
  - **R4, download real:** o storage-js 2.86 devolve a ausência no download como `StorageUnknownError` com a `Response` crua (`noResolveJson`). `storageErrorKind` lê esse corpo até 4 KiB e só aceita JSON com `statusCode` 404 em HTTP 400/404 como ausência. Gateway sem `statusCode`, HTML, 5xx e rede são indisponibilidade. `storageAdapter(bucket)` saiu de `signatureDeps.ts` para ser testado com o `StorageClient` real.
- **R5, corpo:** o limite de 8 KiB é aplicado na leitura:
  - um `Content-Length` maior é recusado antes de ler;
  - sem ele, o stream é lido em pedaços e cancelado ao passar do limite;
  - UTF-8 inválido dá 400.

  Nenhuma RPC nem chamada ao PSC acontece depois da recusa.

**Tela (05/11, decisão do usuário de priorizar entregas):**
- **Lista de documentos (`PrescriptionList`):**
  - no cabeçalho, "Abrir sessão de assinatura", ou "Assinatura digital ativa até HH:MM · Encerrar";
  - em cada documento gerado, verificado, não vencido e de tipo da Fase 1, o botão "Assinar digitalmente".
- **Sem resposta do PSC:** o botão vira "Tentar de novo", que pede confirmação e reenvia a mesma operação com `humanRetry`.
- **Em andamento:** "Verificar assinatura" reenvia a mesma operação sem `humanRetry`.
- **Id da operação:** fica neste aparelho (`localStorage`, só o uuid) até a operação terminar.
- **Retorno do PSC:** `/assinatura/retorno` (o `SIGNATURE_PSC_REDIRECT_URI` aponta para cá) consome o código uma vez e volta à página de origem, só um caminho deste app.
- **`GET state`** devolve `configured`: sem os `SIGNATURE_*`, a tela não mostra nada de assinatura.
- **Arquivos:**
  - `src/lib/signatureClient.ts` (mapeamento de cada resposta);
  - `src/hooks/useSignatureSession.ts`;
  - `src/components/SignatureControls.tsx`;
  - `src/pages/SignatureReturn.tsx`.
- **"Gerar e assinar"** no compositor, ao lado de "Gerar documento", que fica como estava:
  - só aparece com a assinatura configurada e para tipo da Fase 1;
  - só fica habilitado com a sessão aberta.
- **No `ChatPanel`** (escopo delimitado pelo Codex em 05/11 09:59), depois de gerar uma vez:
  - assina o documento persistido, pelo `prescriptionId` e pelo `pdfSha256` que o `generate-prescription` agora devolve;
  - só assina se o médico e o paciente ainda forem os mesmos;
  - usa a operação mantida, como a lista;
  - não abre a prévia sem assinatura como se fosse a assinada;
  - assinatura não concluída não é falha de geração: o documento fica, e a lista oferece "Tentar de novo" ou "Assinar".
- **Falta:** a homologação real com o PSC (Fase 0).

**Configuração (Fase 0).** Sem ela, a resposta é 503 `not_configured`:
- `SIGNATURE_PSC_BASE_URL` (origem https, sem caminho);
- `SIGNATURE_PSC_CLIENT_ID` e `SIGNATURE_PSC_CLIENT_SECRET`;
- `SIGNATURE_PSC_REDIRECT_URI` (https);
- `SIGNATURE_TOKEN_KEYS`;
- `SIGNATURE_POLICY_SHA256`: o SHA-256 do artefato oficial da política AD-RB v1.1. Nunca é adivinhado.

**[não verificado] Prefixo de caminho do VIDaaS** (por exemplo, `/v0`). `psc.ts` aceita só uma origem. Se a homologação exigir prefixo, o cliente muda antes do piloto.

**Fora do escopo:** provedor real, certificado, cron e deploy.

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

**Contexto tipado validado.** O Codex faz um helper compartilhado (posição de 22:38). Eu não edito `auth.ts` nem o bootstrap.
- O helper devolve o que já validou:

  ```ts
  { userId: string; sessionId: string; aal: 'aal1' | 'aal2'; exp: number /* segundos, do JWT verificado */ }
  ```

- Os handlers não fazem parsing próprio de claims.
- O próprio helper, com testes do Codex, garante:
  - a compatibilidade das chamadas existentes;
  - a validação estrita de `session_id` (UUID), `aal` e `exp` (inteiro positivo).

**Regras da assinatura no handler, antes de qualquer RPC:**
- conta clínica, não recepção (já está em `requireUser`);
- `aal = 'aal2'` **sempre**. Sem fator verificado não há assinatura, como diz o contrato v2 ("JWT, clínico e MFA");
- margem do token: `exp − agora ≥ 120 s`. Com menos que isso, a resposta é 401 "renove a sessão", e o cliente renova antes de começar. Isso só evita trabalho inútil: a cerca de verdade fica no banco (§3).

O handler passa ao banco `p_auth = {sessionId, aal, exp}`, montado só desse contexto.

A validação estrita de `p_auth` no banco e as assinaturas das funções estão nas §3.1 e §3.5.

## 3. Cerca de sessão do Cortex no ponto autorizativo

Uma consulta HTTP ao Auth antes do RPC não fecha um logout que aconteça entre os dois (Codex, 20:55). A cerca fica na mesma transação que decide.

### 3.1 Barreira comum e cerca de sessão, separadas (Codex, 22:53)

- **`signature_lock(p_user)`: barreira comum, sem mudança.**
  - Trava 125 → 123 → `auth.users` FOR SHARE NOWAIT → epochs da conta, e confere a conta.
  - Serve a todas as funções, inclusive `revoke` e limpeza.
  - Não recebe nem confere sessão.
- **`signature_session_fence(p_user, p_auth)`: cerca nativa, nova.**
  - É chamada **explicitamente**, logo depois de `signature_lock`, em cada ramo que leva ao PSC ou publica: os ramos produtivos e os retornos idempotentes que entregam algo para continuar (§3.4).
  - Não existe contexto opcional: as funções produtivas exigem `p_auth`, e as de fechamento não o recebem.
- **O que a cerca faz:**
  1. **Valida `p_auth`** antes de qualquer trava: exatamente `sessionId` (texto UUID), `aal` (`'aal2'`) e `exp` (inteiro positivo, em segundos). Chave a mais, chave faltando, `null` ou tipo errado leva a 22023.
  2. `auth.sessions` FOR SHARE NOWAIT, pela linha `id = sessionId and user_id = p_user`.
  3. `auth.mfa_factors` FOR SHARE NOWAIT, pelo `factor_id` da sessão.
  4. Devolve o estado encontrado para a função decidir depois das travas: `ok`, `ended` ou `aal_insufficient`.
- **Em que a cerca resulta:**
  - **Contenção** (`lock_not_available` em sessão ou fator): aborta com 40001, **sem nenhum efeito**. Nada é cancelado por contenção.
  - **`ended`** (sessão ausente, de outro usuário, fator ausente ou não `verified`, `aal` da linha diferente de `aal2`) e **prazo vencido** (§3.2) são **confirmados**. O efeito vem na §3.3.

**O que a cerca do fator promete:** só que, no momento da decisão, a sessão aponta para um fator **atual e verificado** do mesmo usuário. Ela não detecta uma troca histórica de fator e não compara com o fator do início da sessão de assinatura. Não há vínculo inicial: a sessão do PSC dura até 12 horas e sobrevive a um novo login no Cortex. Nenhuma política administrativa é importada.

### 3.2 O relógio por último

- Depois da última trava de cada função, e de novo logo antes de escrever o efeito, a função lê `clock_timestamp()` e exige:
  - `agora < to_timestamp(p_auth.exp)`, do JWT verificado;
  - `not_after is null or agora < not_after`.
- Travar a linha da sessão não para o relógio. Um `not_after` que vence dentro da cerca final recusa mesmo com o JWT e a intenção ainda válidos (Codex, 22:38).
- `now()` não guarda nenhum prazo destes caminhos. Isso inclui o prazo do estado OAuth (§3.4) e o da sessão de assinatura, que hoje usa `now()` em `signature_session_usable` e passa a usar `clock_timestamp()` depois das travas.

**Correções da revisão do Codex de 05/11 03:24:**
- **R1 — nada espera depois da cerca:**
  - `begin_authorization` deixou de apagar estados vencidos; quem apaga é `signature_expire_sessions`;
  - `activate_session` trava a sessão que substitui com FOR UPDATE NOWAIT antes do relógio final.

  Toda linha é obtida com recusa por contenção antes da última leitura do relógio.
- **R2 — a pertinência vem primeiro:** em `advance`, a pertinência (estado e tentativa) é decidida **antes** da sessão do PSC e da sessão do Cortex. Um passo antigo recebe P4094 mesmo com a sessão do PSC revogada, e a tentativa mais nova não é tocada. A revogação só encerra um passo pertinente.
- **R3 — passo que deixou de valer devolve a operação como está:**
  - `prepared` fora de `reserved`/`prepared`;
  - `psc_requested` sobre `stored` ou sobre uma operação terminal;
  - `complete` sobre uma operação terminal.

  Nenhum deles muda nada. Um passo de tentativa com tentativa diferente continua com P4094; um pedido fora de ordem antes do tempo (por exemplo, `complete` antes de `stored`) continua com P4093.
- **R4 — corridas observam a espera:** as corridas de contenção acompanham a espera (`watchCall`). Três controles retiram só uma proteção e precisam ser vistos esperando: a limpeza depois da cerca, o NOWAIT de `auth.sessions` e o NOWAIT de `auth.mfa_factors`.
- **R5 — forma antes de qualquer trava:** a forma de `p_auth` é conferida antes de `signature_lock` nas sete funções produtivas.

### 3.3 Efeito de uma sessão encerrada ou vencida

**Nunca lançar depois de um UPDATE.** Uma exceção desfaz o efeito do próprio RPC (Codex, 22:53). Por isso:
- **Funções que só leem ou só criam** (`begin_authorization`, `consume_authorization`, `activate_session`, `session_token` e `reserve` sem operação existente) não escrevem nada quando a cerca falha. Elas lançam **P4011**, sem efeito.
- **Funções que movem uma operação existente** (`advance` produtivo e `complete`) **devolvem** a operação, sem lançar:
  - se o passo pedido **ainda é pertinente** àquela operação, ela vira `cancelled`, com o código `auth_session_ended` e a limpeza marcada pelo banco quando já houve chamada ao PSC. É pertinente quando:
    - `prepared` parte de `reserved`;
    - `psc_requested` parte de `prepared` ou de `ambiguous` **e o pedido traz a tentativa observada** (`p_data.attempt`), igual a `psc_attempts` sob a trava. Vale também para o sucesso, não só para a sessão encerrada (Codex, 23:29). Vale nos dois casos:
      - de `prepared`, a tentativa observada é 0;
      - de `ambiguous`, é a tentativa que ficou sem resposta.

      Uma tentativa diferente recebe P4094 sem mudar nada, inclusive quando o pedido vem com a sessão encerrada.
    - `stored` parte de `psc_requested`, com a tentativa igual a `psc_attempts`;
    - `complete` parte de `stored`;
  - se o passo **não é mais pertinente** (uma tentativa B mais nova avançou, ou a operação já terminou), nada muda. Para um passo de tentativa, a resposta é P4094, sem efeito; para os outros, a função devolve a operação como está;
  - uma operação terminal nunca é reescrita.
- **O handler mapeia:**
  - operação devolvida com `cancelled` e `auth_session_ended` → **401** "Entre de novo", com o corpo `{status: 'cancelled', code: 'auth_session_ended'}`;
  - P4011 → 401;
  - P4094 → 202 `in_progress`;
  - 40001 → 503.
- **Matriz:** A, com sessão encerrada, contra B atual com sessão válida (outro dispositivo do mesmo médico):
  - A em `stored` com a tentativa antiga recebe P4094 e não muda nada. B conclui;
  - A pedindo `psc_requested` quando B já está em `psc_requested` recebe P4093 e não muda nada;
  - A lê `ambiguous`/1 e prepara uma repetição. Enquanto isso, B faz a tentativa 2 e volta a `ambiguous`/2. A chega depois, com a sessão encerrada ou não, pedindo `psc_requested` com a tentativa 1: recebe P4094, e B continua `ambiguous`/2 (Codex, 23:29);
  - A com o passo pertinente e a sessão encerrada cancela a própria tentativa. B, que ainda não tinha começado, encontra a operação terminal na retomada e começa uma nova operação.

### 3.4 Inventário: o que cada função trava e afirma

**Ordem das travas, em todas as funções:**
1. 125 → 123 → `auth.users` (share) → epochs: barreira comum;
2. `auth.sessions` (share) → `auth.mfa_factors` (share): cerca de sessão, só nos ramos produtivos;
3. linhas, na ordem estado OAuth → sessão de assinatura → operação → receita → objeto do Storage;
4. relógio.

Sobre a ordem:
- A exclusão de conta apaga `auth.users` e, em cascata, `auth.sessions`, na mesma ordem.
- O logout apaga só a sessão. Todas as nossas travas são NOWAIT.
- Em RR, uma linha apagada ou alterada depois do snapshot dá 40001, e nada lido antes da trava serve de prova.

| Função | Cerca de sessão | Linhas travadas | Afirma vivo (conferido depois das travas) | Falha confirmada |
|---|---|---|---|---|
| `begin_authorization` | sim | — | conta, sessão, fator, prazo | P4011, sem efeito |
| `consume_authorization` | **sim (novo no inventário)** | estado OAuth FOR UPDATE NOWAIT | o estado é do usuário e do PSC, não foi usado e `expires_at > clock_timestamp()`; sessão e fator. Só então marca `used_at` e libera o verificador | P4011 ou estado vencido, sem marcar `used_at` |
| `activate_session` | sim | sessão de assinatura anterior (para substituir) | conta, sessão, fator, prazo | P4011, sem efeito |
| `session_token` | sim | sessão de assinatura FOR UPDATE NOWAIT | sessão de assinatura ativa, mesma `generation` e prazo; sessão do Cortex e fator | P4011, sem efeito |
| `reserve`, operação nova | sim | sessão de assinatura, receita (share) | receita dona, `generated`, hash, tipo, sem caminho assinado; pacientes pelos epochs; ritmo | P4011, sem efeito |
| `reserve`, retorno de operação existente **não terminal** | sim | sessão de assinatura, operação | dono e payload (`prescription_id`, `shown_pdf_sha256`) iguais | P4011, sem efeito |
| `reserve`, retorno de operação existente **terminal** (`completed`, `failed`, `cancelled`, `cancelled_by_revocation`) | **não** | — | só dono e payload iguais. Não confere receita `generated` nem caminho assinado, que uma receita assinada já não cumpre. Devolve histórico: não autoriza assinatura nova nem gera URL (Codex, 23:29) | 22023 para dono ou payload diferente |
| `advance` produtivo (`prepared`, `psc_requested`, `stored`) | sim | sessão de assinatura, operação, receita (share) | os da reserva, mais a tentativa (P4094) | §3.3: `cancelled` devolvido, ou P4094 |
| `complete` | sim (retorno de `completed` já existente: sem cerca, porque não leva a nada novo) | sessão de assinatura, operação, receita (update), **`storage.objects` (share, novo)** | os anteriores, mais o objeto existente no caminho da operação | §3.3: `cancelled` devolvido; objeto ausente vira `cancelled` com `stored_object_missing` |
| `close` (`ambiguous`, `failed`, `cancelled`) | **não** | operação | estado e tentativa (P4094) | — (só fecha) |
| `revoke`, `cleanup_done`, `expire_sessions`, `reconcile` (§9) | não | as próprias linhas | — | — (só fecha) |

### 3.5 Assinaturas das funções

- `signature_advance` hoje mistura passos produtivos e de fechamento, e tem `p_data jsonb default '{}'`. Por isso vira duas funções, sem default:
  - `signature_advance(p_user, p_operation, p_to, p_data, p_auth)`, só para `prepared`, `psc_requested` e `stored`. Outro valor de `p_to` dá 22023;
  - `signature_close(p_user, p_operation, p_to, p_data)`, só para `ambiguous`, `failed`, `cancelled` e `cancelled_by_revocation`. O último exige `p_data = {expectedState, attempt}` (R1 de 05:09).
- `begin_authorization`, `consume_authorization`, `activate_session`, `session_token`, `reserve` e `complete` ganham `p_auth jsonb` obrigatório.
- As assinaturas antigas desaparecem no próprio arquivo da migration, que ainda não foi aplicada em lugar nenhum. Não fica overload nem default.
- Um teste confere em `pg_proc` que não sobrou função pública de assinatura sem `p_auth` fora da lista de fechamento.
- Os tipos gerados continuam com o Codex.

## 4. `signature-session`

| Rota | Entrada | Faz | Saída |
|---|---|---|---|
| `POST start` | — | cerca da §2; cria `state` e PKCE; `signature_begin_authorization(…, p_auth)` | URL de autorização (só da lista fixa do servidor) |
| `POST complete` | `{code, state}` | `signature_consume_authorization(…, p_auth)` (CAS do estado sob a cerca, §3.4); troca o código; confere o CPF autorizado contra `prescriber_cpf`; descobre o certificado e só aceita um que possa assinar (R2 de 05:09); sela o token; `signature_activate_session(…, p_auth)` | `{active, expiresAt}`, ou 409 `no_certificate` / `certificate_invalid` / `certificate_expired` |
| `POST revoke` | — | `signature_revoke_session` (AAL2, sem margem do JWT) | `{revoked}` |
| `GET state` | — | `signature_session_state` (AAL2, sem margem do JWT) | `{active, expiresAt}`, nunca o token |

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
| P4011, ou operação devolvida `cancelled` com `auth_session_ended` (§3.3) | 401 | "Entre de novo" |
| P4094, tentativa substituída | 202 | `{status: 'in_progress'}` |
| P4031, sessão de assinatura encerrada | 409 | "Abra uma nova sessão de assinatura" |
| P4093 | 409 | mensagem do banco |
| 42501 | 403 | genérica |

## 6. `humanRetry`

- O banco só aceita repetir a partir de `ambiguous`, com até 5 tentativas por operação e o limite de 60 operações por hora. Toda repetição exige a cerca da §3 (sessão viva com AAL2).
- `humanRetry` vem da ação explícita "tentar de novo" na tela. Ele não é prova de anuência; a prova é o pedido autenticado e cercado.
- **Segundo fator recente:** não é exigido nesta rodada (Codex, 22:38). Vale o AAL2 do contrato existente, sem prazo novo de MFA por inferência. O risco de repetição está limitado pelo teto de tentativas e pela assinatura determinística, que produz os mesmos bytes.

## 7. Fixtures `auth.sessions` e `auth.mfa_factors` (bootstrap, dono: Codex)

Para o Codex incluir no bootstrap quando este desenho estiver alinhado, com a nulabilidade nativa do Auth:

| Coluna | Tipo | Nulo |
|---|---|---|
| `id` | uuid, PK | não |
| `user_id` | uuid → `auth.users(id) on delete cascade` | não |
| `aal` | `auth.aal_level` (`aal1`, `aal2`, `aal3`) | sim |
| `factor_id` | uuid | sim |
| `not_after` | timestamptz | sim |
| `created_at`, `updated_at`, `refreshed_at` | timestamps | sim |

A cerca do fator também precisa de `auth.mfa_factors`, no mínimo com:
- `id` uuid, PK;
- `user_id` uuid → `auth.users(id) on delete cascade`;
- `status` (`auth.factor_status`: `unverified` ou `verified`);
- `factor_type`.

O Codex confere a nulabilidade nativa ao montar as duas tabelas. O adaptador do Auth nativo omite essas tabelas mock, como o Codex descreveu. Eu não edito o bootstrap.

## 8. Provas, em vermelho antes do código

**SQL, numa conexão:**
- sessão ausente, `aal1`, sem fator, fator `unverified`, fator de outro usuário, `exp` vencido e `not_after` vencido, em cada função do inventário da §3.4;
- `p_auth` com chave a mais, chave faltando, `null`, tipo errado ou `aal1`;
- em `pg_proc`, nenhuma função de assinatura sem `p_auth` fora da lista de fechamento, e nenhum default;
- efeito da §3.3:
  - sessão encerrada com o passo pertinente: a função **devolve** `cancelled`/`auth_session_ended`, e o efeito persiste (não é desfeito por exceção);
  - passo não pertinente: P4094 ou operação devolvida igual;
  - terminal intacto;
  - contenção: 40001 sem efeito;
- `consume_authorization`: estado vencido pelo relógio lido depois das travas, sessão encerrada e `used_at` intacto em toda recusa;
- reconciliação: cada CAS da §9 com o estado ou a tentativa mudados não faz nada; `stored_at` não muda numa repetição de `stored`; `stored_expired` só depois de 24 horas de `stored_at`;
- `psc_requested` sem tentativa, com tentativa de outra rodada ou a partir de um `ambiguous` mais novo: P4094, e o estado e as tentativas ficam intactos. O fluxo passa a enviar a tentativa observada;
- replay de uma operação concluída pela reserva, com a receita já assinada e **sem sessão do Cortex**: devolve `completed`. Este caso já passa hoje e fica fixado em `digital-signature.test.sql`; continua obrigatório depois da cerca;
- logout entre a reserva e a conclusão leva a `cancelled` com `auth_session_ended` e limpeza;
- objeto assinado ausente na conclusão.

**Corridas, em duas conexões:**
- logout (DELETE de `auth.sessions`) contra `signature_complete`, nas duas ordens, em RC e em RR;
- exclusão de conta contra a cerca de sessão;
- `exp` vencendo enquanto a função espera o 123: a recusa vem pelo relógio lido depois das travas;
- `not_after` vencendo dentro da cerca final, com JWT e intenção ainda válidos: a conclusão recusa, sem publicar (Codex, 22:38);
- fator removido contra a conclusão, nas duas ordens;
- logout e vencimento durante as aquisições de `consume_authorization` e de `activate_session`;
- A, com sessão encerrada, contra B atual em outro dispositivo (matriz da §3.3);
- controle que retira a cerca na base descartável e precisa falhar.

**Fluxo:** portas com `p_auth`; o mapeamento HTTP da §5; os passos de fechamento funcionam sem sessão.

**Handlers:** clientes simulados, conferindo que nada do corpo vira ator, sessão ou `exp`, e o pedido sem AAL2 ou com margem curta.

## 9. Reconciliação sob a cerca

**Regras gerais:**
- `signature_pending_work` só **descobre**. O que ela lista não prova nada para uma mutação (Codex, 22:53).
- Cada fechamento é feito por uma função de serviço. Ela refaz a conferência como CAS, sob a barreira comum (`signature_lock`) e a trava da linha da operação, com o relógio lido por último.
- Se o estado ou a tentativa mudou, a função devolve a operação como está, sem efeito.
- O executor roda no Edge, sem sessão de usuário, e só pode **fechar**. Nunca publica, nunca conclui e nunca chama o PSC.
- Este desenho não inicia executor nem cron real.

| Descoberta | Função de fechamento (CAS) | Condição conferida sob as travas | Efeito |
|---|---|---|---|
| `remove_candidate` | remoção no Storage, depois `signature_cleanup_done` | a operação não é `completed` e `cleanup_pending` ou objeto órfão de operação terminal | objeto removido; flag limpa |
| `stuck` em `reserved` ou `prepared` | `signature_reconcile(p_user, p_operation, p_expected_state, p_expected_attempt)` | mesmo estado e mesma tentativa; `updated_at < clock_timestamp() − 15 min` | `failed` com o código `abandoned` |
| `stuck` em `psc_requested` | `signature_reconcile`, mesma assinatura | mesmo estado e mesma tentativa; `updated_at < clock_timestamp() − 15 min` | `ambiguous`. Só o médico repete |
| `stored` | `signature_reconcile`, mesma assinatura | estado `stored`, mesma tentativa; **`stored_at < clock_timestamp() − 24 h`** | `cancelled` com o código `stored_expired`; limpeza pelo banco |

**`stored` nunca conclui sem contexto humano.**
- A retomada é do médico, com o mesmo `operationId` e uma sessão do Cortex válida. A tela oferece "concluir assinatura" quando houver uma.
- O prazo técnico padrão é de 24 horas, contado de **`stored_at`**: coluna nova, gravada uma única vez na transição para `stored` e imutável depois. Uma repetição idempotente de `stored` não estende o prazo. `updated_at` não serve para isso.
- O encerramento por prazo só alcança o candidato temporário: a fonte, a auditoria e o arquivo de uma operação concluída nunca entram.

## 10. Ordem

1. Revisão deste desenho pelo Codex, incluindo o pedido sobre `requireUser` e a mudança de assinatura das funções.
2. Fixtures `auth.sessions` e `auth.mfa_factors` no bootstrap, e o helper de contexto validado (Codex).
3. Cerca SQL, divisão `advance`/`close`, conferência do objeto, `stored_at` e as funções de reconciliação, com as provas da §8 (Claude).
4. Handlers e testes (Claude).
5. Tela: sessão de assinatura e "Gerar e assinar" (Claude).
6. Homologação com a Valid, só na Fase 0, com o médico presente.
