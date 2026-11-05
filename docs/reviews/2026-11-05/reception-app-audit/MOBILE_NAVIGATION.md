# T39/2a — rótulos separados na navegação inferior

Item 8 da entrega do Claude de 05/11 às 18:43. Em 375 px, os rótulos Pacientes, Agenda e Pendências ficavam encostados. A base `2dd77a045232585bb3bbbfc787a46f2622d96e9d` reproduz separações de apenas 4,86/4,88 px.

A correção altera três classes em `MobileSubpageNavigation.tsx`: fonte de `0.6875rem` para `0.625rem` nos destinos e no botão Mais, e `gap-1` no contêiner. A raiz continua em 21,6 px, ou 135%; a fonte do rótulo passa de 14,85 para 13,5 px. São utilitários existentes do Tailwind, conforme a documentação de [tamanhos arbitrários de fonte](https://v3.tailwindcss.com/docs/font-size#arbitrary-values) e [gap](https://v3.tailwindcss.com/docs/gap).

Destinos, nomes, ícones, estado ativo, menu e escolha de itens por perfil permanecem iguais. Nenhuma regra de autenticação, permissão, prontuário ou agenda é alterada. A proposta de unificar as barras (item 7) continua separada.

## Contrato do ensaio

- Texto completo dentro do alvo de toque, com largura e altura mínimas de 44 px.
- Separação textual mínima de 8 px em 375 px ou mais, e 4 px em 320 px.
- Cinco destinos para clínico/admin; quatro para recepção sem administração.
- Navegação por teclado: Pendências recebe foco/Enter e fica ativo; Mais abre por Enter, setas passam por Modelos até Conhecimento e Enter abre o destino correto, fechando o menu.
- Fonte, código e estilos congelados na base, com apenas o componente corrigido como overlay. As mesmas garantias de isolamento da [passagem inicial](README.md) continuam em vigor.

O runner rejeita a combinação de verificação da navegação com `--only=time-dialogs`; não pode declarar esse fluxo concluído sem executá-lo. Também exige que o overlay tenha sido servido pelo loader e que a sequência de teclado termine antes de marcar a passagem completa.

## Resultado

[RED final](nav-final-red/AUDIT.json): falha esperada no espaçamento, três estados capturados, nenhum erro de execução/console e limpeza confirmada. [GREEN final](nav-final-green/AUDIT.json): 37 estados completos, dos quais 23 medem a navegação sem dialog; teclado concluído, zero erros de execução/console/rede, fontes/hash/limpeza conferidos. [Validação consolidada](NAVIGATION_VALIDATION.json), sintaxe Node, lint do componente e do runner, e recusa das flags incompatíveis aprovados.

| Largura | Estados com navegação | Menor separação entre textos | Menor alvo de toque (largura × altura) |
|---:|---:|---:|---:|
| 320 px | 1 | 5,39 px | 44,81 × 86,39 px |
| 375 px | 10 | 11,73 px | 65,92 × 86,39 px |
| 390 px | 1 | 13,61 px | 69,67 × 86,39 px |
| 768 px | 1 | 86,44 px | 147,13 × 86,39 px |
| 1280 px | 10 | 188,83 px | 249,53 × 86,39 px |

Capturas inspecionadas: [antes em375](nav-final-red/clinical--agenda-375.png), [depois em375](nav-final-green/clinical--agenda-375.png), [depois em320](nav-final-green/clinical--agenda-320.png) e [recepção administrativa](nav-final-green/admin--recepcao-equipe-375.png). Os nomes aparecem completos; a escala geral permanece em135%.

## Revisão e limites

A revisão local encontrou uma omissão: o primeiro ensaio abria Mais por clique. Isso foi corrigido para abertura, seleção e chegada por teclado. Uma execução posterior revelou que as duas setas eram enviadas sem observar o foco intermediário. O ensaio passou a aguardar Modelos antes da segunda seta; não usa espera fixa. A biblioteca instalada agenda a movimentação de foco, e esse passo é observado no DOM.

Não houve achado concreto novo na última revisão do delta. Revisão externa dispensada pelo usuário; nenhum outro CLI ou serviço foi chamado.

Os estados de erro da fixture em `/permissoes-recepcao` continuam sendo erro de DTO conhecido, sem validar o fluxo positivo. MFA só é visitado no estado inicial, e nenhuma reserva, gravação clínica, exclusão ou envio é submetido. Não há teste SQL/Auth nativo, build global ou aprovação de piloto neste recorte. Não foram criados testes que apenas espelham classes CSS.

A captura de 320 px também mostrou o título Agenda encostando nos botões do cabeçalho; esse achado foi reproduzido e [corrigido em T39/2b](CALENDAR_HEADER.md). Essa região não é modificada por T39/2a. Restam os itens 1–6 e o reteste independente dos cinco arquivos médicos da entrega `f2eb189`.

## Reexecutar

Diretórios de execução são exclusivos. Use nomes novos:

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=2dd77a045232585bb3bbbfc787a46f2622d96e9d --run=nav-recheck-red --check-mobile-navigation
node scripts/reception-app-audit-browser.mjs --baseline=2dd77a045232585bb3bbbfc787a46f2622d96e9d --overlay=src/components/MobileSubpageNavigation.tsx --run=nav-recheck-green --check-mobile-navigation
```

A primeira chamada deve falhar no espaçamento da base. A segunda precisa completar os estados e a sequência de teclado. A validação consolidada confere os relatórios e os hashes dos arquivos efetivamente executados.
