# Experiência por perfil — início, recepção e financeiro

Pedido direto do usuário em10/11/2026: revisar o aplicativo inteiro, pesquisar produtos equivalentes e melhorar início/recepção/financeiro. Esclarecimento: cada pessoa tem seu login e sua tela; a conta de teste usa a visão de administrador, com acesso aos ambientes. Retomada manual, sem reativar automação.

## Objetivo e limites

O médico deve encontrar seu dia, abrir o paciente certo e retomar o trabalho. A secretaria deve encontrar demandas, agenda, contatos e pré-consulta. O financeiro deve distinguir faturar, cobrar, receber e conferir. Administrador alterna ambientes explicitamente. Não implementar exceção por email, novo papel de banco ou acesso a prontuários de terceiros por ser administrador. Mantêm-se os papéis/capacidades e gates existentes; esta entrega organiza as telas autorizadas.

Não mudar APIs/SQL, valores/status financeiros, critérios de cobrança, emissão fiscal, assinatura, conteúdo médico, identidade de pacientes ou confirmações humanas. Sem operação real, push/deploy, chamada paga ou dados reais em teste. A autorização direta de UI abrange a apresentação de billing; o domínio dos produtores permanece com Claude.1300/1640 lidas sem aceite global por relato.

## Pesquisa — fontes primárias

| Produto | Observação útil | Aplicação no Cortex |
|---|---|---|
| [Cliniko](https://www.cliniko.com/features/) | Agenda, registros e finanças aparecem como capacidades distintas do consultório. | Estruturar ambientes por tarefa, mantendo atalhos de continuidade. |
| [Jane — acesso da equipe](https://jane.app/guide/staff-access-levels) | Profissional, recepção e administração possuem acessos diferentes, inclusive financeiro e prontuário. | Navegação por permissão; administrador alterna áreas sem transformar a página clínica em painel administrativo. |
| [Feegow — agendas](https://ajuda.feegow.com/support/solutions/articles/67000663486-quais-os-tipos-de-agenda-que-o-sistema-disponibiliza-) | A agenda operacional oferece visões diária/semanal/múltipla. | Agenda da equipe permanece na recepção; a agenda do médico tem prioridade em seu início. |
| [Feegow — recebimento](https://ajuda.feegow.com/support/solutions/articles/67000754729) | Receber pagamento envolve revisão de valor, forma e confirmação explícita. | Formulários largos, rótulos claros e ações bem separadas, preservando a confirmação já implementada. |
| [iClinic — financeiro](https://site.iclinic.com.br/funcionalidades/gestao-financeira/) | A página pública descreve recebimentos/despesas/extrato e vínculo com agenda. A leitura direta falhou502 nesta pesquisa; resultado público consultado, sem usar como única fonte. | Orientação corroborada pelas outras fontes; nenhuma métrica inventada. |

As decisões de interface abaixo são síntese própria; não cópia de telas nem alegação de que um produto garante melhor resultado clínico.

## Diagnóstico do aplicativo atual

Auditoria inicial sintética de início/recepção/financeiro:42estados em375/1280/1920, inclusive abas e formulários financeiros, sem JS/console falho. Isso não certifica qualidade de UX. Evidências em docs/reviews/2026-11-10/product-ux/before.

- Início: coluna de paciente vazia consome largura mesmo sem consulta; centro limitado a max-w-2xl; dois botões Nova Consulta; agenda principal só visível no celular; dados cadastrais ocupam posição mais alta que o trabalho do dia.
- Navegação: recepção/financeiro/pré-consultas misturados com ferramentas clínicas; entradas variam entre sidebar, rodapé e páginas isoladas. Recepção tem faixa de oito links que quebra em linhas; celular pode ter seis destinos no rodapé.
- Financeiro: moldura/cor de fundo próprias, sem indicação consistente de ambiente; seis abas sem explicação de tarefa; mês pouco hierárquico; formulários com larguras e alinhamentos diferentes; números longos não podem depender de nowrap.
- Auditoria geral: manter links de ferramentas/configurações, rotas diretas, segurança, privacidade, guardas de rascunho, contexto do paciente e gravação montada. Revisar outras rotas no navegador após as alterações compartilhadas.

## Direção de design

Clareza editorial, fundo quente e dourado/ink da marca existente. Tipografia local preservada, contraste legível, bordas suaves, espaço consistente e conteúdo com largura útil. Nenhum gráfico ilustrativo, KPI fictício ou decoração que concorra com o atendimento. Escala135% preservada.

1. **Áreas de trabalho:** seletor consistente Consultório/Recepção/Financeiro conforme capacidades atuais; administrador vê as três, secretaria não recebe entrada clínica. Financeiro de recepção usa /recepcao/financeiro, preservando o gate.
2. **Início clínico:** agenda de hoje visível também no desktop; nova consulta e retomada claramente priorizadas; recentes/retornos cadastrais em nível secundário; configuração inicial recolhível. Ocultar por CSS o painel de paciente vazio/no início, mantendo componentes de trabalho montados e guardas existentes.
3. **Navegação clínica:** início/agenda/pacientes separados de ferramentas, configuração e troca de área. Não colocar recepção/financeiro como ações principais do médico.
4. **Recepção:** navegação lateral agrupada no desktop; cabeçalho compacto e quatro destinos no rodapé móvel com Mais. Conteúdo operacional com espaço, filtros alinhados e páginas atuais preservadas.
5. **Financeiro:** moldura consistente, explicação de seção, período claro e abas por papel preservadas. Largura útil, formulários/rótulos alinhados, estados vazios/erros claros e valores sem corte. Não somar dados parciais ou inferir saldo sem fonte.

## Implementação e verificação

React/TypeScript/Tailwind/Radix existentes, sem dependência nova. Componentes de contexto de trabalho compartilhados em src/components e lógica de opções em src/lib. Alterações focadas em WelcomeDashboard/Index/PatientSidebar/MobileSubpageNavigation/ReceptionLayout/ReceptionQueue e apresentação de billing.

- Testes de navegação/capacidades e rotas de cada perfil; administrador com três áreas, médico sem recepção indevida, secretaria sem consultório. Nenhuma comparação de email concede acesso.
- Regressão de abertura de paciente/agendamento, retomada e rascunhos, lembrantes e formulários financeiros. Não substituir teste funcional por snapshots de classes.
- Tipos: node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json. Testes: node node_modules/vitest/vitest.mjs run nos módulos afetados, maxWorkers2. Build: node node_modules/vite/bin/vite.js build. Lint dos caminhos alterados.
- Navegador Edge isolado, backend sintético e destinos externos bloqueados. Comparar375/1280/1920 e conferir320; abrir formulários e menus, testar navegação e estados. Nenhum envio/faturamento real. Registrar limitações da fixture, não ampliar métricas para obter aceite.
- Revisão fresh-context de navegação por papel e preservação de comportamento, conforme DDD. Registrar evidências e alterações coordenadas. Commit local só dos caminhos próprios em main/axiscoachapp; SaaS preservado.

Sucesso: cada perfil reconhece seu ambiente e próximo passo; administrador encontra todas as áreas por um seletor; início aproveita a largura; recepção evita menus empilhados; financeiro comunica contexto/etapa/período e tem formulários legíveis; fluxos e permissões anteriores continuam válidos.
