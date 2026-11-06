# T39/2h — Trabalho e Linha do tempo no celular

O recorte anterior de datas revelou que a Linha do tempo preenchida ficava cortada. O documento media 320 px, mas o contêiner da subpágina acumulava conteúdo de até 391 px; ao clicar em Comparar revisões, ele rolava 50 px horizontalmente e escondia a margem esquerda.

Duas causas foram reproduzidas:

- O botão `Registros e acompanhamento` mantinha o texto em uma linha: 334 px para 277 px disponíveis em 320 px de viewport. Agora ele permite quebra de linha, respeita a largura do pai e mantém a altura mínima anterior.
- O cabeçalho da consulta mantinha título e Comparar revisões na mesma linha, mesmo sem espaço. Agora a linha pode quebrar e alinha os elementos pelo topo. Em 1280 px, ambos continuam na mesma linha.

São apenas dois ajustes de classes em `ClinicalWorkspace.tsx`. Fonte/escala de 135%, nomes acessíveis, labels, objetos, filtros, queries, revisão selecionada e callbacks permanecem iguais. Nenhum CSS global ou arquivo médico do Claude muda.

## Evidências

- [RED](workspace-layout-red/AUDIT.json): base `a94c67426f31744f36d38e8c75f2d212eb20a9b5`, sem overlay. Os 15 estados são capturados e os testes de datas/dados passam; a nova verificação de layout recusa quatro estados — versões do trabalho e da consulta em 320/375 px.
- [GREEN](workspace-layout-verified-green/AUDIT.json): os mesmos 15 estados em 320/375/1280 px, com overlay somente de `ClinicalWorkspace.tsx`. Doze estados pertencem a Trabalho; os outros três verificam o aviso de gravação. Os quatro cenários de Trabalho passam sem overflow do contêiner principal, do shell ou dos contêineres internos, sem controles cortados ou deslocamento horizontal.
- Em 320 px, a Linha do tempo passa de shell com largura útil 320 px, conteúdo 391 px e deslocamento 50 px para 320/320/0. A lista de trabalho preenchida também fica em 320/320/0.
- Tipos e lint da aplicação, sintaxe/lint do runner, hashes, fontes servidas e limpeza aprovados. Três combinações inválidas da flag são recusadas antes de criar uma execução. Não foram adicionados testes unitários que repetem classes CSS.
- Dados sintéticos e timestamp da gravação no IndexedDB preservados; todos os contadores de IA e escrita continuam em zero. Os controles reais Ver versões, Linha do tempo e Comparar revisões são usados nos cenários, sem salvar, concluir, gravar, processar ou descartar.
- [Validação consolidada](WORKSPACE_LAYOUT_VALIDATION.json). Revisão independente delimitada; revisão externa já dispensada pelo usuário.

Capturas inspecionadas: [Linha do tempo em 320 px](workspace-layout-verified-green/clinical--trabalho-patient-22222222-2222-4222-8222-222222222222-clinical-versions-320.png), [trabalho em 320 px](workspace-layout-verified-green/clinical--trabalho-patient-22222222-2222-4222-8222-222222222222-work-versions-320.png) e [Linha do tempo em 1280 px](workspace-layout-verified-green/clinical--trabalho-patient-22222222-2222-4222-8222-222222222222-clinical-versions-1280.png).

## Escopo da verificação

O modo existente de datas ganha a flag opcional `--check-workspace-layout`. A captura registra também o shell interno, suas larguras e deslocamento, contêineres com overflow e controles fora dos limites horizontais. A asserção ocorre depois de capturar todos os cenários, para que um RED retenha o conjunto completo de medições. O scanner antigo do documento continua registrado; ele sozinho não comprovava esse layout.

Somente API de loopback com dados sintéticos e Edge isolado. Fontes/classes congeladas, cache temporário próprio e descartado. Eventos `HEAD /rest/v1/patients`, HTTP 200 com `net::ERR_ABORTED`, estão preservados; só essa tupla já conhecida é aceita na validação, sem inferir causa ou declarar rede limpa. Nenhum outro erro de rede/HTTP/página/console é aceito.

O ensaio cobre esta fixture preenchida e estas larguras, sem aprovar todo conteúdo clínico possível, backend ou piloto. Não houve build global, API/SQL/Auth de produção, carga, chamada paga, hosted, deploy, push ou mudança Claude/SaaS.

T39/2h fica concluída. Falta o reteste independente dos cinco arquivos médicos de `f2eb189`; T39/2 inteira, T39/3 e decisões de produto/piloto continuam abertas.

## Reexecutar

Use nomes de execução novos:

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=a94c67426f31744f36d38e8c75f2d212eb20a9b5 --run=workspace-recheck-red --only=short-timestamps --check-workspace-layout
node scripts/reception-app-audit-browser.mjs --baseline=a94c67426f31744f36d38e8c75f2d212eb20a9b5 --overlay=src/pages/ClinicalWorkspace.tsx --run=workspace-recheck-green --only=short-timestamps --check-workspace-layout
```
