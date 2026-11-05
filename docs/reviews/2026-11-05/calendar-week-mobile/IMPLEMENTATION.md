# T38 — Semana legível no celular

05/11/2026, implementação local Codex. Base `bb89491`. Sem mudança de API, banco, permissões, datas ou horários.

## Decisão e comportamento

A reprodução de390px confirmou sete cabeçalhos cortados e reservas pequenas demais para mostrar título/intervalo. Foram comparadas três opções antes da implementação: trocar a semana por Dia (perderia a escolha), forçar uma grade larga com rolagem horizontal (exigiria navegar nos dois eixos e ainda cortaria títulos longos) e preservar a grade com cabeçalhos concisos e uma lista de detalhes. Escolhida a terceira.

Cabeçalhos mostram dia abreviado/data em duas linhas, com a data completa acessível ao leitor de tela. O clique/Enter original de drilldown permanece. O padrão conciso vale em toda a visão semanal: o teste encontrou também corte no cabeçalho antigo logo acima do breakpoint móvel. Dia e Mês mantêm os componentes anteriores.

No celular, “Ver horários e títulos completos” leva à lista da semana selecionada. Ela mostra data e horário de início/fim, título inteiro, ordem cronológica e sinalização de cancelamento. Texto longo quebra linha; títulos são texto React, sem HTML. Reservas que atravessam meia-noite mostram ambas as datas. Intervalos apenas encostando no limite da semana ficam de fora. A lista reaproveita as reservas já autorizadas/carregadas; não consulta prontuários nem faz uma segunda leitura. Toque/Enter abre o mesmo AppointmentModal com o objeto exato; título/horário repetidos não substituem IDs. Nenhuma abertura salva ou reserva por conta própria.

Semana e período escolhidos sobrevivem aos resizes. Lista oculta em Dia/Mês e fora do layout móvel. Marca e escala raiz135% preservadas. A grade de sete colunas continua sendo uma visão de distribuição: o acesso ao título/intervalo completos em telas estreitas é pela lista, sem depender de hover.

## Evidências e correções durante verificação

- [RED original](RED.json) e [captura anterior](before-390.png): corte horizontal reproduzido em390px antes da mudança. RED unitário inicial por módulo ainda ausente.
- [RED dos cabeçalhos abreviados](HEADER_RED.json): abreviar sem tipografia explícita ainda cortava sete dias. Fonte local13,5px/dia e16,2px/data, preservando a raiz21,6px. Em375px, padding-inline3px herdado da biblioteca ainda cortava a primeira coluna: regra CSS restrita à grade semanal compacta libera sua largura. Um novo teste em1037px também cortou cabeçalhos antigos, motivando o padrão conciso em toda a semana.
- Revisão independente somente leitura, contexto novo, agente `calendar_week_mobile_review`. Apontou a fonte herdada e âncora com margem pequena frente ao cabeçalho fixo. Corrigidos com tipografia explícita/margem de rolagem suficiente. Ensaio passou a ter seis reservas e mede a posição do título após o salto; lista curta mascarava a sobreposição pelo limite de rolagem do documento. Última leitura sem regressão concreta. Sem revisão externa.
- [11 testes / dois arquivos aprovados](UNIT.json): sete do componente, quatro de breakpoint. Seleção humana exata (inclusive dois IDs com título/horário iguais), ordenação sem mutar entrada, cancelamento, limite/overlap da semana, mudança de período, vazio, título tratado como texto e nome acessível completo.
- [Cinco grupos de navegador](verification.json), páginas/modal reais, Edge isolado, loopback sintético: sete cabeçalhos sem corte em375/390/768/1036/1037/1280/1920px; breakpoint real1036,8px; semana35dias à frente mantida; lista móvel com título/intervalo completos; âncora fora do cabeçalho fixo; Enter abre consulta exata sem escrever; drilldown para domingo correto; Mês/Dia sem lista e sem troca de visão no resize; escala135%, zero pageerror/requests de escrita ou funções/contadores de IA. Oito fontes congeladas e recursos encerrados antes da prova.
- [13 verificações de regressão T37](header-regression/verification.json): oito larguras semanais, cinco mensais, domingo correto por teclado, data/período/evento09:00–09:30 preservados. `--t38` grava em nova pasta sem sobrescrever provas históricas. Medição ajustada para texto visual, excluindo o span sr-only da data completa. Seu monitor de efeitos inclui montagem e login; contadores/requests proibidos zero. Nenhuma nova sonda externa.
- ESLint dos três TSX/dois harnesses, sintaxe Node, tipos app/Node e build com variáveis sintéticas explícitas aprovados. As expectativas do ensaio foram alinhadas aos labels reais do modal (`Data`/`Início`, separados de título), sem alterar o modal para o teste.

[Cabeçalhos novos](after-390.png), [lista legível](week-details-390.png) e capturas da regressão inspecionados visualmente. DevTools MCP indisponível: usado Playwright existente com perfil isolado. Sem SQL/Native/D17 novos, banco hospedado, chamadas pagas, dados reais, push ou deploy. PersonalMed/SaaS/arquivos Claude preservados. Não se afirma cobertura de todas as fontes, motores ou uso de hover.

T38 concluída localmente. M2/corte/piloto continuam separados. Próximo candidato independente é T08: conferir regras de sugestão administrativa já existentes e suas pendências, sem diagnóstico, encaminhamento automático ou inferência de identidade.
