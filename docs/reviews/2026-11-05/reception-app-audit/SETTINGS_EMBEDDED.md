# T41/K4/1 — equipe e permissões dentro de Configurações

Implementadas variantes `embedded` nos exports padrão de `DelegationPermissions` e `TeamSettings`, com [contrato para C5](../../../product/clinic-crm/SETTINGS_EMBEDDED_CONTRACT.md). O default mantém as páginas existentes. A variante usa região nomeada e títulos h2/h3/h4, sem main duplicado ou navegação Voltar própria. Os handlers, contratos de servidor e confirmações continuam os mesmos.

A revisão encontrou uma lacuna para o novo host: manter Equipe montada ao trocar ator/clínica preservava credenciais temporárias e rascunho. Cinco testes reproduziram isso. O estado agora fica num componente interno com chave por ator/clínica; perder a capacidade administrativa desmonta esse conteúdo. O pai não precisa adicionar uma chave para proteger essa transição. O diálogo de credenciais ganhou descrição acessível. Isso também protege o modo standalone.

## Evidências

- [RED de navegador](settings-embedded-red-verified/AUDIT.json): uma captura em375px, duas h1 no host de Configurações, fonte baseline `2d9a9925183125c5433a7e313b71b1a1d8299ef1`. Dois novos testes de apresentação falharam;18 existentes passaram. Cinco testes adicionais falharam por retenção de credenciais/rascunho na troca de contexto.
- [GREEN final](settings-embedded-final/AUDIT.json):12estados em375/1280/1920px a135%, incluindo equipe de administrador, bloqueio de recepção, permissões do médico e abertura/fechamento de confirmação sem enviar decisão. Nove observações de região/main/h1, sem corte ou rótulo ausente, ações alcançáveis, fixtures preservadas e nenhuma escrita/consulta clínica/IA/recurso externo. Recepção não consulta o diretório administrativo.
- Quarenta e oito testes/4arquivos passaram: componentes, troca de contexto, consultas e decisões. A primeira execução sem isolamento entre arquivos misturou mocks de API e foi rejeitada; a reprodução válida e o GREEN usam isolamento por arquivo. Nenhum teste foi removido ou desabilitado.
- Tipagem do grafo versionado do app (290 raízes) e prévia aprovada; lint de4arquivos UI/testes, prévia e runner sem avisos, sintaxe/três opções inválidas/hashes/limpeza aprovados. A checagem global por glob incluiu rascunhos C4 não versionados e encontrou4erros em andamento, comunicados ao Claude na mensagem1957; esses caminhos não foram alterados nem incluídos no commit K4.
- Revisão corrigiu a lacuna de troca de contexto e a informação de relógio no relatório; removeu retorno de helper inalcançável. Leitura final sem outro achado acionável. Captura375px inspecionada. [Validação consolidada](SETTINGS_EMBEDDED_VALIDATION.json).

## Limites da prévia

A entrada `scripts/fixtures/settings-embedded-preview.tsx` é somente de teste. Ela usa os componentes, SDK, AuthProvider, Router, QueryClient e contextos reais, com servidores sintéticos em loopback. Não é a rota C5 de produção e não exercita App/SessionAssurance/ClinicAccessGate. O snapshot fornece o grafo de fontes versionadas e dois overlays explícitos dos componentes; a entrada de teste tem hash próprio. A troca de contexto é provada nos testes de componente, não por login real no navegador.

O inventário do navegador aceita somente login sintético, GETuser e três RPCs de leitura/acesso/diretório/pedidos. Nenhuma criação de conta, alteração de permissão ou envio real é acionado. Os testes unitários usam callbacks simulados para os comandos. Nenhum resultado homologa Auth/MFA, RLS/grants, provisionamento M2, WhatsApp ou operação de produção.

Relatórios preliminares fora do commit: `settings-embedded-red` teve SHA inválido e nenhuma prova; `settings-embedded-green` antecede isolamento de estado/correção da informação de relógio. Os RED válidos e a passagem final permanecem separados.

O usuário reativou a tarefa e solicitou a continuação; status ACTIVE conferido. O lease de App/menus/engrenagem do Claude foi preservado. C4 ainda aguarda contrato/simulador fechado e SHA para revisão. Compartilhamento/Privacidade embutidos, Usuários unificados/perfil da clínica, marca e K1–K3/K6 permanecem pendentes. Sem migration, banco hospedado, chamada paga, envio externo, push, deploy, carga ou arquivo Claude/SaaS/PersonalMed.

```powershell
node_modules/.bin/vitest.cmd run src/features/reception/DelegationPermissions.test.tsx src/features/reception/TeamSettings.test.tsx src/features/reception/delegationApi.test.ts src/features/reception/teamApi.test.ts --pool=forks --maxWorkers=1 --testTimeout=30000
node scripts/reception-app-audit-browser.mjs --baseline=2d9a9925183125c5433a7e313b71b1a1d8299ef1 --overlay=src/features/reception/DelegationPermissions.tsx --overlay=src/features/reception/TeamSettings.tsx --run=settings-recheck --only=settings-embedded
```

Use um nome novo de execução e variáveis de Supabase sintéticas/loopback para os testes.
