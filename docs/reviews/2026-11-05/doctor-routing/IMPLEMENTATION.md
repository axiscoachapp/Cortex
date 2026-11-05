# T08/1 — Sugestão administrativa com escolha humana

05/11/2026, Codex. Base `79bf56b`, implementação local. Incremento sobre as regras existentes de pedido/vínculo; não cria catálogo de serviços, regra de especialidade, DTO/RPC, migration ou grant.

## Resultado

O caso podia indicar um médico já ausente das agendas autorizadas e ainda oferecer outro profissional por vínculo, sem destacar que o indicado estava indisponível. Agora esse ramo informa a indisponibilidade e não sugere substituto: a pessoa deve conferir o pedido e escolher manualmente uma agenda autorizada.

Quando há vários médicos vinculados, a tela mostra as opções autorizadas com motivo e sem ordem de preferência, mantendo a decisão em aberto. Um único vínculo mantém a orientação de confirmar beneficiário/continuidade; pessoa nova não gera inferência por especialidade ou mensagem. Ausência de agendas explica a limitação de permissão. Nenhuma evolução, documento clínico, transcrição ou campo legal é consultado.

Selecionar uma opção somente preenche o campo. A ação Encaminhar continua distinta e usa o comando existente por revisão do caso, sem agendar automaticamente. Durante a gravação, sugestões/campo/envio ficam bloqueados. Se a agenda escolhida sai da lista autorizada antes do envio, o rascunho fica identificado como indisponível e não pode ser enviado; a pessoa pode escolher outra opção. Caso fechado ou de outro responsável mantém as barreiras anteriores. O banco continua sendo a autoridade de sessão/escopo/CAS; esta melhoria visual não substitui suas verificações.

`suggestDoctor` conserva `doctorId`/`reason` e acrescenta `candidateIds` somente em seu retorno interno. Caso, beneficiário e médico não são remapeados por essa lista. Contratos Supabase e leitura dos vínculos ativos permanecem iguais. Não se escolhe uma pessoa a partir de telefone ou de texto clínico.

## Verificação

- [RED de regras/interface](RED.json): seis falhas de13 testes antes da correção, incluindo substituição silenciosa e opções/trava ausentes. [RED do formulário](WORKSPACE_RED.json): duas falhas de quatro, agenda removida ainda habilitada e campo livre durante write.
- [17 testes / três arquivos aprovados](UNIT.json): oito regras, cinco interface de sugestão e quatro CaseWorkspace. Casos novo/continuidade/dois médicos/indicado indisponível/sem agenda, escolha manual, seleção removida, write pendente, caso alheio/fechado e payload exato. O primeiro typecheck encontrou uso indevido da opção `exact` do Playwright em Testing Library; opção removida (RTL já usa nome exato por padrão) e testes/build repetidos.
- Revisão independente somente leitura, contexto novo, agente `doctor_routing_review`: diff, três testes e barreiras de contexto em ReceptionQueue/ClinicAccessGate/ProtectedRoute; nenhum achado concreto. Não executou testes nem editou arquivos. Sem revisão externa.
- [Seis checks de navegador](browser/verification.json): CaseWorkspace, sugestões e API reais, Edge isolado/HTTP sintético loopback. Indicado indisponível sem fallback; empate só preenche campo; perda de agenda impede envio e correção humana usa ID autorizado; pendência bloqueia controles; pessoa nova/caso alheio sem route automático; nome longo em375px sem overflow. Oito fontes congeladas por SHA-256, zero pageerror e contadores da fixture zero; apenas os dois comandos de encaminhamento explicitamente acionados foram interceptados como escrita sintética. Recursos encerrados antes de gravar a prova.
- ESLint dos seis TS/TSX e harness, sintaxe Node, tipos app/Node e build com variáveis sintéticas explícitas aprovados. [Captura375px](browser/family-375.png) inspecionada, escala135%/marca preservadas. DevTools MCP indisponível; usado Playwright existente em perfil isolado.

Sem nova execução SQL/Native/D17, dados reais, banco hospedado, envio externo, chamada paga, push ou deploy. Arquivos Claude/PersonalMed/SaaS e três helpers de custódia preservados.

## Próximos passos

T08/1 concluída; T08 inteira permanece aberta para catálogo/habilitações e regras de serviço configuradas/aprovadas. Não derivar essas regras de `specialty`, de idade inferida ou de mensagens do contato. M2/corte/piloto permanecem separados. Próxima candidata independente: T32/L6, reproduzir cancelamento de reserva legada com intervalo inválido sem permitir nova reserva inválida, verificando os escritores e a necessidade de reserva de migration antes de qualquer DDL. Migração PersonalMed segue com Claude e sem carga autorizada.
