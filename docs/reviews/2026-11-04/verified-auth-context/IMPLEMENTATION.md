# Contexto Auth tipado, preservando os chamadores existentes

04/11/2026. Primeira fatia da interface [contexto verificado](../../../product/clinic-crm/VERIFIED_AUTH_CONTEXT.md). `_shared/auth.ts` compartilha a autenticação entre o `requireUser` anterior e o novo `requireUserContext`. O helper novo devolve somente userId/sessionId/aal/exp; regras de operação e cercas transacionais permanecem com os chamadores/SQL.

## Provas e revisão

RED observado antes da implementação: 28 testes novos falharam porque o helper não existia; seis controles/legado passaram. GREEN final: **138 testes aprovados em cinco arquivos**, incluindo os **34 testes de Auth**, identidade divergente/assinatura rejeitada, UUID/AAL/role/exp inválidos, expiração depois do await, corpo sem autoridade e sem consumo, bearer exato entregue ao SDK, retorno legado e políticas MFA/recepção.

Auth é simulado nesses testes; não são novas provas Native Auth. `npm run typecheck`, ESLint dos dois arquivos e Deno check offline/cached-only do módulo Auth passaram. A leitura local independente encontrou dois erros iniciais de compilação do teste (import type trouxe Deno para o frontend; replaceAll excedia ES2020) e a falta de assert do header do SDK. Todos corrigidos; leitura final sem outro achado concreto. Revisão externa dispensada.

**Verificação Edge global pendente em outro domínio:** os 27 entrypoints foram enviados ao Deno check, que recusou duas incompatibilidades TS2345 em `referenceCatalogs.ts:57` e `:295`, relativas a DecompressionStream/BufferSource. O módulo foi conferido igual ao baseline anterior `618e0f7`; o check isolado dele reproduz os dois erros sem importar Auth. Esse arquivo não foi editado. Pendência enviada ao Claude, dono dos catálogos; não alegar GREEN global dos Edge.

```text
npx vitest run src/lib/authAssurance.test.ts src/lib/securityHandlers.test.ts src/lib/clinicalBoundaryHandlers.test.ts src/lib/prescriptionDocuments.test.ts src/lib/privacyHandlers.test.ts
npm run typecheck
npx eslint supabase/functions/_shared/auth.ts src/lib/authAssurance.test.ts
npm exec --offline --yes --package=deno@2.9.6 -- deno check --cached-only --no-config supabase/functions/_shared/auth.ts
```

[verification.json](verification.json) registra contagens, hashes das fontes finais e limites. Não foram repetidos SQL, Auth nativo, testes D17 de PKI ou build/interface; o módulo e a compatibilidade TS foram conferidos separadamente. Nenhuma consulta a dados reais, envio, serviço pago, hosted ou deploy. Próxima fatia: fixtures de sessões/MFA com tipos/nulabilidade conferidos e adaptador nativo atualizado junto, antes da integração SQL do Claude.
