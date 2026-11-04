# Revisão técnica cruzada do prescritor

04/11/2026, Codex. Artefato do Claude: `7427926`. Nenhum arquivo de implementação do domínio foi alterado nesta revisão.

## Resultado

Sem novo achado técnico bloqueador no incremento. Telefone/RQE permanecem opcionais no cadastro; o servidor exige os campos adicionais no tipo de documento indicado pelo contrato. A recusa ocorre antes da construção/upload do PDF. O snapshot guarda a identidade da emissão e a versão do modelo.

`update_user_settings` preserva as duas guardas de ator/sessão, o contrato de patch dos campos anteriores, o acesso ao modelo e os privilégios. A migration de custódia `20261104001000` não redefine essa função. A inclusão de CPF/sexo no snapshot não acrescenta esses campos à projeção JSON de `validate-prescription`, que continua explícita.

Regeneração em banco descartável produziu somente seis linhas em `src/integrations/supabase/types.ts`: telefone/RQE nos tipos de leitura, inserção e atualização de `user_settings`. Nenhuma assinatura de RPC mudou.

## Evidências locais

- `npx vitest run src/lib/prescriptionDocuments.test.ts src/lib/clinicalHandlers.test.ts`: 19 testes aprovados em dois arquivos, incluindo os cinco novos testes do Claude.
- `npx vitest run src/lib/securityHandlers.test.ts`: 26 testes aprovados; cobre recusa por custódia antes de efeitos de exclusão.
- `node scripts/generate-database-types.mjs`: regeneração com todas as migrations locais em PostgreSQL descartável.
- `npm run typecheck`: aprovado com os tipos regenerados.

Os testes dos handlers verificam texto/snapshot e recusas com dependências simuladas; não constituem um novo ensaio visual do PDF nem uma emissão real. A interface de telefone/RQE e sua verificação visual ficam com Claude, conforme a delegação de 00:35.
