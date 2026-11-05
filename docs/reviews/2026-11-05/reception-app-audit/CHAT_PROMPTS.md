# T39/2f — textos do campo de Pergunta e Comentário

Item 5 da entrega médica de 18:43, já recebido pela resposta de 18:58. O campo passa a mostrar `Faça uma pergunta` ou `Comentário clínico`. Os exemplos completos continuam no atributo `title`, incluindo a variante de comentário durante gravação. Os nomes acessíveis, o valor digitado e os handlers permanecem iguais.

Em 320 px, com escala de 135%, o texto antigo de Pergunta media 619,63 px para 209,8 px úteis. A primeira tentativa, `Pergunte ao assistente`, ainda media 216,29 px e foi rejeitada. O texto final mede 186,76 px; Comentário mede 177,68 px. Não foi necessário reduzir a escala ou o tamanho da fonte.

## Evidências

- [RED final](chat-prompts-final-red/AUDIT.json): base `74a0880c969560cc11ead1a2878ee25305fd6af1`, sem overlay. Falha por corte do placeholder de Pergunta em 320 px; a execução para nesse primeiro estado. Não comprova os demais estados da base.
- [GREEN final](chat-prompts-verified/AUDIT.json): seis estados, Pergunta e Comentário em 320, 375 e 1280 px. Cada captura exige o botão do modo ativo e o textbox com o nome correspondente antes de medir. Textos cabem no campo, os exemplos longos continuam no `title` e os dois modos preservam o rascunho ao alternar, sem enviá-lo.
- Oito testes existentes de `ChatPanel.test.tsx` aprovados, incluindo descarte da resposta tardia do paciente anterior nos dois modos. O seletor desse teste passa a usar o nome acessível, em vez de depender do placeholder longo.
- [Regressão de legendas](chat-prompts-week-regression/AUDIT.json): modo anterior de semana, Dia, próximo Dia e Mês, em 320/375/1280 px.
- [Validação consolidada](CHAT_PROMPTS_VALIDATION.json): tipos, lint da aplicação e do runner, sintaxe, hashes, limpeza e contadores da fixture. A revisão local identificou a falta de confirmação do modo em cada captura; o runner foi corrigido e a leitura final não encontrou outro defeito substancial. Revisão externa dispensada pelo usuário.

Capturas inspecionadas: [Pergunta em 320 px](chat-prompts-verified/clinical---patient-22222222-2222-4222-8222-222222222222-question-320.png) e [Comentário em 320 px](chat-prompts-verified/clinical---patient-22222222-2222-4222-8222-222222222222-comment-320.png).

## Limites

Código e classes congelados na base indicada, com overlay somente de `ChatPanel.tsx`; API sintética em loopback e navegador Edge isolado. Contadores de chat, novas fontes, pacientes e agenda permanecem em zero. A variante de gravação foi conferida no diff, sem iniciar microfone ou transcrição; os seis estados do navegador são sem gravação. A dica usa `title` nativo, sem novo mecanismo de ajuda para toque.

Eventos `HEAD /rest/v1/patients`, HTTP 200 com `net::ERR_ABORTED`, aparecem tanto na base quanto no GREEN. Os eventos brutos estão preservados, e a validação aceita somente essa tupla exata, sem inferir sua causa ou declarar rede limpa. Não há outros erros HTTP, de página ou de console nos relatórios finais.

Nenhuma alteração de API, SQL, Auth, regra clínica, assinatura ou trabalho Claude/SaaS. Sem build global, submissão, chamada paga, carga, banco hospedado, deploy ou push. T39/2 continua aberta para o item 4 (datas curtas) e o reteste médico independente; T39/3 e piloto permanecem separados.

## Reexecutar

Use nomes de execução novos:

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=74a0880c969560cc11ead1a2878ee25305fd6af1 --run=chat-recheck-red --only=chat-prompts
node scripts/reception-app-audit-browser.mjs --baseline=74a0880c969560cc11ead1a2878ee25305fd6af1 --overlay=src/components/ChatPanel.tsx --run=chat-recheck-green --only=chat-prompts
```
