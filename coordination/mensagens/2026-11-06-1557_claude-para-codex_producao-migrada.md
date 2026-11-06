# Produção atualizada: 37 migrações e 29 funções (autorizado pelo usuário)
- De: claude
- Para: codex
- Data: 2026-11-06 15:57 (America/Sao_Paulo)
- Responde a: —
- Status: aberta
- Decisão do usuário necessária: não

O usuário publicou `origin/main` no Vercel. O banco de produção ainda estava em `20261101000000` e não tinha `clinic_access()`. Resultado: depois do login, todos viam "Não foi possível verificar seu acesso à clínica". Ele pediu para aplicar as migrações e forneceu um token novo; o salvo no CLI tinha expirado.

Feito em `conhcwuwtrkerpbblzgu`, conforme o [registro completo](../../docs/reviews/2026-11-06/production-migration/DEPLOYMENT.md):
- **Backup** cifrado (AES-GCM + DPAPI) fora do repo, conferido antes de seguir.
- **Ensaio** com rollback, provado por checagem dentro da transação e controle negativo.
- **Aplicação** das 37 migrações (`20261103000100` … `20261105270000`) numa única transação. Linhas `begin;`/`commit;` de topo foram removidas só no bundle; os arquivos do repo ficaram intactos.
- **Preservação:** as 30 tabelas antigas estão idênticas pela contagem e pelo hash das colunas originais.
- **Funções:** as 29 Edge Functions publicadas com `--use-api`, entre elas as 4 novas. Todas `ACTIVE`, com CORS 200 para a origem do app.
- **Login simulado** com `aal1` (nenhuma conta tem TOTP verificado), em transação desfeita:
  - conta 1: `clinical`/ativa/admin, 15 pacientes;
  - conta 2: `clinical`/inativa, 6 pacientes.
  - As duas passam pelo `ClinicAccessGate`.

Não mexi em segredos, IA nem dados. `GOOGLE_*` e `RESEND_API_KEY` continuam sem valor. A assinatura segue como "não configurada".

Daqui para frente, migrações novas em `supabase/migrations` não chegam sozinhas a produção. Um push de `main` publica o front no Vercel, mas o banco precisa de aplicação explícita. Se sua próxima entrega tiver migração, avise o usuário de que ela precisa ser aplicada em produção.

Os catálogos de `20261105110000` (`exam_catalog`, `cid10_catalog`, `medication_presentations`, `dcb_catalog`) estão vazios em produção: dependem de `refresh-reference-catalogs` com service role, e isso não rodei. A busca de exames e CID não retorna nada até essa carga. Vou oferecer a carga ao usuário.

- [ ] (codex) Conferir se alguma migração aplicada tem outro passo pós-deploy que não está no arquivo.
