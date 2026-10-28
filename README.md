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
- `/seguranca`: inscrição/verificação de aplicativo autenticador. Uma conta com fator verificado precisa de sessão `aal2` para dados clínicos e operações protegidas.
- `/privacidade`: exportação consistente, recibos de exclusão e limites de retenção.

Gravações e trabalho em andamento permanecem vinculados ao paciente de origem. Uma consulta manual confirma o texto exato do médico por operação SQL atômica. A conclusão de uma consulta só conclui o agendamento explicitamente vinculado.

## IA e integrações

**Mantenha `AI_ENABLED=false` nas Edge Functions.** IA é desabilitada por padrão; a escolha do provedor e a avaliação clínica serão discutidas separadamente. A integração existente permanece no código, protegida por um bloqueio antes da reserva de quota e da chamada externa. Documentação manual funciona sem provedor. Nenhum teste automatizado deve usar dados reais ou chaves de provedor.

Os nomes das Edge Functions seguem as pastas em `supabase/functions/`. O fluxo atual usa `transcribe-consultation` e `finalize-consultation`, não o antigo `process-consultation`. Verifique todos os handlers com `npm run typecheck:edge`.

Configure explicitamente no ambiente de implantação: Supabase, origem permitida, URLs de retorno e, apenas para integrações autorizadas, credenciais externas. Credenciais secretas nunca devem ter prefixo `VITE_`. O atalho de desenvolvimento usa uma conta de teste real apenas em DEV; produção não inclui o atalho.

## Verificação e implantação

[Revisão original](docs/reviews/2026-10-28/APP_REVIEW.md), [roadmap](docs/reviews/2026-10-28/ROADMAP.md) e resultados em `docs/reviews/2026-10-28/remediation/`.

O código e as migrations são preparados localmente. Implantação exige ensaio em staging com Auth/Storage nativos, MFA, revogação durante operações, exportação/exclusão e restauração de banco **e arquivos**. Testes com mocks e PostgreSQL descartável não demonstram a configuração do serviço hospedado. Ver [runbook](docs/reviews/2026-10-28/remediation/RUNBOOK.md).

A migração de PersonalMed 2005 é uma tarefa posterior. Não execute importação, corte de sistema ou alterações nos arquivos originais como parte desta implementação.
