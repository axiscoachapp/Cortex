# Cortex · Haddad Nicola

Ambiente clínico para contas individuais de médicos, com listas privadas, compartilhamento explícito de pacientes, documentação revisada, agenda e acompanhamento. A marca usa os arquivos oficiais do consultório, Montserrat e Source Serif, com fontes locais e controles em dourado escuro para leitura.

## Desenvolvimento

Requisitos: Node.js >=22.12, npm e Docker para os testes PostgreSQL. Use `npm ci`. Crie `.env.local` a partir de `.env.example`, com URL e chave pública explícitas do backend. Uma configuração ausente ou incompatível interrompe o início/build; não há projeto real escolhido automaticamente.

```sh
npm run dev
npm test
npm run lint
npm run build
npm run typecheck:edge
npm run test:db
node scripts/generate-database-types.mjs
node scripts/smoke-app.mjs http://127.0.0.1:8080
```

Os dois últimos scripts de banco criam e removem bancos descartáveis próprios. Não executam reset de um projeto vinculado. Tipos são gerados do esquema completo das migrations com postgres-meta. O build inclui TypeScript de app e ferramentas.

## Fluxos

- `/`: consulta, contexto do paciente, gravação e revisão de rascunhos.
- `/trabalho`: consulta manual sem IA, rascunhos recuperáveis, linha do tempo/revisões, tarefas, medidas, episódios gestacionais, medicações e orientações versionadas.
- `/compartilhamento`: membros da clínica e permissões explícitas de leitura/contribuição/download. Pertencer à clínica não revela prontuários. Contribuições têm autoria e são preservadas após revogação.
- `/agenda`: agenda local e sincronização de saída com Google; falhas e novas tentativas são visíveis. Não existe sincronização bidirecional completa.
- `/conhecimento`: originais e versões de fontes, revisão explícita, indexação/repetição e retirada do uso.
- `/aviso-de-privacidade` (público): aviso LGPD. Preencha os dados do controlador e do encarregado em `src/config/privacy.ts`.
- Contas: o cadastro público está desativado. O administrador da clínica cria a conta de cada médico em `/compartilhamento` (senha temporária trocada no primeiro acesso).
- `/seguranca`: inscrição/verificação de aplicativo autenticador. Uma conta com fator verificado precisa de sessão `aal2` para dados clínicos e operações protegidas.
- `/privacidade`: exportação consistente, recibos de exclusão e limites de retenção.

Gravações e trabalho em andamento permanecem vinculados ao paciente de origem. Uma consulta manual confirma o texto exato do médico por operação SQL atômica. A conclusão de uma consulta só conclui o agendamento explicitamente vinculado.

## IA e integrações

**IA (`AI_ENABLED`).** Em produção a IA está **ligada** por decisão do responsável, para a fase de testes (`AI_ENABLED=true`). Os termos da API Gemini restringem uso clínico: antes do lançamento definitivo, defina o provedor (ex.: Vertex com contrato adequado, sem uso dos dados para treino) e use uma chave com faturamento habilitado. Com `AI_ENABLED=false` tudo que é manual continua funcionando e comentários são salvos como anotação. Toda saída de IA que altera o prontuário passa por revisão do médico. Nenhum teste automatizado deve usar dados reais ou chaves de provedor.

Os nomes das Edge Functions seguem as pastas em `supabase/functions/`. O fluxo atual usa `transcribe-consultation` e `finalize-consultation`, não o antigo `process-consultation`. Verifique todos os handlers com `npm run typecheck:edge`.

Configure explicitamente no ambiente de implantação: Supabase, origem permitida, URLs de retorno e, apenas para integrações autorizadas, credenciais externas. Credenciais secretas nunca devem ter prefixo `VITE_`. O atalho de desenvolvimento usa uma conta de teste real apenas em DEV; produção não inclui o atalho.

## Verificação e implantação

[Revisão original](docs/reviews/2026-10-28/APP_REVIEW.md), [roadmap](docs/reviews/2026-10-28/ROADMAP.md) e resultados em `docs/reviews/2026-10-28/remediation/`.

**Ordem de implantação (obrigatória):** 1) aplicar as migrations no banco; 2) publicar as Edge Functions; 3) só então enviar o frontend para `main` (a Vercel publica automaticamente). O frontend novo depende de colunas e funções novas; inverter a ordem já derrubou a produção uma vez.

O código e as migrations são preparados localmente. Implantação exige ensaio em staging com Auth/Storage nativos, MFA, revogação durante operações, exportação/exclusão e restauração de banco **e arquivos**. Testes com mocks e PostgreSQL descartável não demonstram a configuração do serviço hospedado. Ver [runbook](docs/reviews/2026-10-28/remediation/RUNBOOK.md).

A migração de PersonalMed 2005 é uma tarefa posterior; a análise e o plano estão em [docs/migration/personalmed/ANALYSIS.md](docs/migration/personalmed/ANALYSIS.md). Não execute importação, corte de sistema ou alterações nos arquivos originais como parte desta implementação.
