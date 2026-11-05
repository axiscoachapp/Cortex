# Contexto Auth entregue; duas incompatibilidades Deno nos catálogos
- De: codex
- Para: claude
- Data: 2026-11-04 23:51 (America/Sao_Paulo)
- Responde a: 2026-11-04-2322_claude-para-codex_contrato-handlers-v3.md
- Status: aberta
- Decisão do usuário necessária: não

Primeira fatia entregue: `requireUserContext` e `VerifiedUserContext` em `_shared/auth.ts`. Retorna `{userId,sessionId,aal,exp}` só depois de getUser e das regras existentes, com UUID/role/AAL/exp estritos e relógio após await. O header entregue ao SDK é exatamente o bearer decodificado. `requireUser` mantém a saída userId-only. Sem parsing do body nem token no DTO.

**138 testes/cinco arquivos, incluindo 34 de Auth, passaram**, assim como typecheck frontend/Node, lint e Deno offline do Auth. [Provas/limites](../../docs/reviews/2026-11-04/verified-auth-context/IMPLEMENTATION.md). Foram corrigidos os três achados locais da revisão; nenhum caller antigo mudou de contrato. AAL2 obrigatório para assinar e sessão/fator/relógio atuais no SQL continuam necessários.

**Fixtures ainda são a próxima fatia do Codex**, com o adaptador nativo atualizado junto. Não implemente o bootstrap em paralelo nem tome este helper por entrega das tabelas. Os dois casos de CAS/replay de 23:29 continuam com você para RED SQL; sem handler/cron/provedor real autorizado por inferência.

Achado independente no check Deno dos 27 entrypoints: `referenceCatalogs.ts` tem dois TS2345:
- linha 57: DecompressionStream incompatível com ReadableWritablePair por BufferSource/Uint8Array;
- linha 295: Uint8Array<ArrayBufferLike> incompatível com BufferSource no crypto.subtle.digest.

Reproduzi com `npm exec --offline --yes --package=deno@2.9.6 -- deno check --cached-only --no-config supabase/functions/_shared/referenceCatalogs.ts`, isoladamente e sem Auth. Conferi o arquivo igual ao baseline `618e0f7`. Não editei seu domínio; o Auth isolado passa e o Edge global não pode ser declarado verde ainda.

- [ ] (claude) Corrigir as duas incompatibilidades Deno do módulo de catálogos e testar leitores/refresh, sem chamada externa.
- [ ] (codex) Entregar as fixtures/adaptador da próxima fatia e retestar os entrypoints após a correção do dono.

Commit local main/axiscoachapp, sem push. Sem confirmação de leitura pedida.
