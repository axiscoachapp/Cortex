# K6/5a — reteste da reserva e da trava do contato em f837c57

O recorte de reserva de lembretes passou no commit `f837c5769322579c145cb9c6f2588b5d00a77643`. As correções anteriores de filtro/revisão/prazo, vínculo suspenso, opt-out com aliases, precisão do cursor e parser foram retestadas. A trava do contato foi exercitada em sessões PostgreSQL concorrentes, com os RPCs administrativos reais e sem envio de mensagens.

Isso conclui a revisão destes resíduos. O robô ganhou sua suíte original como regressão; sua revisão independente de concorrência e a revisão C5 continuam pendentes. O campo `accepted` do relatório se refere somente ao recorte declarado, sem aceite global C4/C5 ou homologação real.

## Provas

- PostgreSQL16 local, imagem existente por digest, Docker Desktop com endpoint local conferido; container próprio por ID completo, sem rede/portas. Aplicadas as79 migrations congeladas. As duas suítes originais `whatsapp.test.sql` e `whatsapp-flows.test.sql` passaram.
-14 controles SQL independentes passaram: consulta privada/cancelada, opt-out antes da reserva, replay com payload alterado, resposta cruzada, aliases sem fusão, guarda interna mesmo com EXECUTE, filtro do médico alterado, vínculo suspenso no candidato/reserva, SAIR por alias, revisão antiga, tentativa antes do prazo e filtro de tipo alterado.
- Cinco grupos concorrentes passaram, detalhados abaixo. Definição/ACL/configuração da função restauradas e conferidas depois dos controles locais.82 fontes SQL e quatro fontes do harness registradas; hashes do harness conferidos depois da execução. Cleanup exige consulta positiva de ausência do ID criado.
-11 testes Node: quatro da adaptação da fixture e sete de cleanup.49 testes Vitest em dois arquivos do produtor, com seis caminhos de código/teste comparados ao SHA revisto. Lint dos cinco scripts alterados, sintaxe dos quatro executáveis/módulos e duas flags inválidas aprovados.
- Dois probes em memória sobre os handlers do SHA: cursor preserva microssegundos/offset, e uma localização malformada não impede o irmão válido de ser ingerido. Quatro módulos congelados, dependências falsas e objetos Request; nenhuma chamada de rede.

## Concorrência do contato

| Ensaio | Observação |
|---|---|
| Correção autenticada em transação aberta | `whatsapp_automation_begin` retorna `null`; nenhum run ou outbound é consumido; holder continua aberto |
| Controle sem NOWAIT | O mesmo caminho espera pelo PID do holder, observado em `pg_stat_activity` e `pg_blocking_pids`; cancelamento do PID próprio dá57014 |
| Controle sem a barreira | Reserva o snapshot antigo enquanto a correção não foi commitada; a transação do controle é revertida |
| Correção commitada e tentativa fresca | Destinatário antigo recusado em transação independente revertida; destinatário atual, com consentimento sintético próprio, é reservado |
| Reserva aberta antes da próxima correção | RPC de correção espera pelo PID da reserva; só prossegue depois do commit, e a mensagem mantém o destinatário reservado |

A propriedade validada é o snapshot até o commit da reserva. O contrato permite alterações posteriores do contato, como mostra o último ensaio. Não foi testada atomicidade entre o commit e uma chamada à Meta, e não houve chamada à Meta.

## Ajustes do ensaio

O contrato novo exige a revisão da regra e recusa chamadas antes do prazo. A fixture antiga usava2099: agora início/fim e relógio dos candidatos são relativos ao mesmo `now()`, preservando intervalos de30 minutos e controles positivos elegíveis. A primeira adaptação deixou fins em2099, recusada pelo guard de sobreposição; o teste de intervalos foi acrescentado. O primeiro holder também tentou ler revisão da tabela sem permissão; passou a obter a revisão pelo RPC autorizado `reception_contact_edit`, sem conceder acesso direto. Essas falhas de fixture foram registradas como incompletas e não entram como falhas do produtor.

O probe de handlers recebeu somente o resolvedor do novo módulo puro `whatsappFlow.ts`. Nenhum arquivo do Claude foi modificado. A revisão independente não encontrou defeito material no ensaio; cross-model não executado por ser tarefa agendada não interativa, sem autorização para CLI externo.

[SQL_REVIEW.json](reservation-f837c57-contact-rpc/SQL_REVIEW.json), [HANDLER_PROBES_F837C57.json](HANDLER_PROBES_F837C57.json), [VALIDATION](RESERVATION_RETEST_F837C57.json). Tentativas preliminares com erro de fixture permanecem fora da entrega. Próximos: revisar independentemente o bot e seu comando atômico, retestar C5 no novo SHA e só então avançar os comandos da recepção. K7 pós-consulta/áudio local, M2/MFA/compartilhamento e piloto seguem separados.
