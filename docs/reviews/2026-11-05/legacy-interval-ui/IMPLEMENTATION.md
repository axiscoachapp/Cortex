# T32/1b — Apresentação segura dos horários inválidos

05/11/2026, Codex. Base `906bade`; implementação somente local da interface da recepção, sobre a API existente. Sem migration, mudança de DTO/grant, escrita de dados reais ou importação.

## Resultado

Um início não finito, como `-infinity`, causava RangeError em `clinicDay` durante o agrupamento e derrubava a lista. Fim não finito mostrava Invalid Date, enquanto intervalo zero/invertido não tinha aviso. A tela também permitia tentar abrir remarcação com esses dados.

Agora a projeção administrativa confere formato ISO com fuso explícito, data civil real e precisão de microssegundos. Intervalos inválidos mostram “Horário cadastrado inválido”, sem reescrever os valores. Quando o início não tem data válida, o item fica em uma seção própria, sem herdar o dia escolhido no filtro. Quando o início é conhecido, permanece no dia original, mesmo que o fim seja inválido.

Confirmar presença, chegada/desfazer e remarcação ficam indisponíveis para intervalo inválido. O cancelamento continua humano, com consentimento e o mesmo ID/revisão, sem enviar datas substitutas; usa a correção do banco entregue em906bade. Fechados/cancelados mantêm o histórico sem oferecer novo cancelamento. Reservas válidas conservam ações, dados e modal de remarcação anteriores. A extração do cartão evita duplicar sua implementação entre listas datadas e sem data.

Não há leitura extra nem busca geral do legado: são somente itens já devolvidos pelo RPC autorizado para a janela/filtro atual. Não se atribui uma pessoa ou origem de migração por telefone, horário ou conteúdo clínico. Datas/formulários compartilhados mantêm seus contratos estritos anteriores.

## Evidências

- [RED de interface](RED.json): RangeError na lista com início não finito e falhas dos avisos/ações esperados antes da implementação.
- [RED de precisão](PRECISION_RED.json): uma revisão independente identificou que Date.parse em milissegundos confundia um intervalo PostgreSQL válido de1microssegundo com igualdade. Teste reproduzido; comparação passou a usar BigInt de microssegundos, mantendo o formato original para exibição. Não se arredonda nem corrige o cadastro.
- [25 testes / três arquivos aprovados](UNIT.json): nove da agenda, doze da projeção temporal e quatro contratos anteriores. Zero/invertido/não finito, data impossível/ambígua/sem fuso/24h, fuso estrangeiro/microssegundos, seção sem data, consentimento/payload exato, pendência/erro preservados, histórico cancelado/realizado e remarcação válida.
- [Seis verificações de navegador](browser/verification.json): ReceptionCalendar, cartão/modal e API reais com HTTP sintético loopback; Edge isolado em Asia/Tokyo, horários e data de São Paulo. Oito reservas sintéticas incluindo intervalo válido de1microssegundo. Sem crash, sem Invalid Date, sem data inferida; consentimento recusado não escreve; conflito recupera revisão sem retry automático; novo clique envia o ID/revisão atuais com `p_start/p_end=null`; pendência bloqueia ações; cancelados/realizados permanecem; modal válido mantém13:00–13:30. Layout375/768/1280/1920px sem overflow. Nove fontes congeladas por SHA-256, zero pageerror/contadores da fixture, apenas três comandos de cancelamento explicitamente acionados interceptados; recursos encerrados antes da prova.
- Revisão independente somente leitura, contexto novo, agente `legacy_interval_ui_review`; encontrou a precisão de microssegundos, corrigida/provada. Última leitura sem novo achado concreto. Nenhum teste/edição pelo revisor ou revisão externa.
- ESLint dos cinco arquivos de produção/teste e fixture/harness (sete), sintaxe Node, typecheck app/Node e build com variáveis sintéticas explícitas aprovados. Avisos HMR da fixture resolvidos exportando os componentes do ensaio, sem mudar fluxo do produto. Marca/escala135% preservadas; [aviso/cancelamento](browser/invalid-375.png) e [histórico cancelado](browser/cancelled-375.png) inspecionados visualmente. DevTools MCP indisponível; usado Playwright existente em perfil isolado.

O ensaio HTTP não é PostgREST/SQL real: a guarda inalterada tem [provas próprias75migrations/noveSQL](../legacy-cancellation/IMPLEMENTATION.md). Nenhum SQL/Native/D17 novo, banco hospedado, envio externo, chamada paga, push ou deploy. PersonalMed/SaaS/arquivos Claude/três helpers de custódia intactos. Status desconhecidos não são normalizados por esta interface.

## Continuação

T32/1b concluída localmente; T32 inteira/M2/corte/piloto continuam abertos. Próxima candidata T32/1c: conferir os limites da consulta SQL por período para intervalos zero/invertidos nas bordas, pois esta fatia não amplia a leitura atual nem garante a descoberta de todos os registros antigos. Reproduzir e definir um recorte autorizado limitado antes de qualquer nova migration; sem inferir datas/identidades ou carregar dados PersonalMed.
