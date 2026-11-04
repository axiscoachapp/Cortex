# T29 — Alterações concorrentes da agenda

04/11/2026. Correção M3/L4 da revisão cruzada, independente de D18 e da migração PersonalMed.

## Contrato

`reception_change_appointment` deve retornar `42501`/`Agendamento indisponível` para ID ausente/nulo ou de outra clínica, sem executar locks de calendário com médico nulo ou expor tabelas internas. O cliente mapeia somente essa combinação exata de operação/código/mensagem para orientar a atualização da agenda; outros erros de permissão continuam genéricos, sem reproduzir texto interno. Autorizações humanas/MFA, escopos existentes e privacidade dos prontuários permanecem obrigatórios.

Verificar a garantia da sessão/MFA antes da leitura inicial, inclusive para ID ausente ou de outra clínica. Depois da leitura inicial, verificar existência/clínica e autorização antes de bloquear qualquer compromisso. Em seguida bloquear a linha `FOR UPDATE`, verificar novamente existência/clínica/escopo e revisão atual, e somente então **tentar sem espera** o advisory lock da conta/calendário. Se ocupado, recusar com `40001`; se obtido, chamar o helper existente para a barreira de versão do calendário. A tentativa é necessária porque a edição direta toma linha → conta, enquanto as conclusões clínica/manual ainda tomam conta → linha. Nunca aguardar o advisory enquanto segura a linha. Não trocar o médico, contato, beneficiário ou origem de uma reserva para contornar conflito.

Manter CAS, intervalos, conflito de horário/bloqueio, estados/chegada, autoria, auditoria e retenção da reserva. Uma edição com revisão antiga deve falhar com `40001` na RPC; a edição direta do médico já usa filtro de revisão e deve resultar em zero linhas (ou serialização em REPEATABLE READ). O perdedor preserva seu rascunho e atualiza a agenda antes de decidir novamente, sem reenvio automático.

A tentativa não bloqueante pode recusar uma edição atual durante outra escrita do mesmo médico, mesmo em compromisso distinto. É uma recusa conservadora, recuperável com nova decisão humana, sem modificar o trabalho clínico em andamento. Não alterar os fluxos de conclusão ou seu domínio como efeito desta correção.

## Provas

- Reproduzir a falha de ID ausente antes da correção e verificar a mensagem estável depois, inclusive ID nulo, clínica incorreta e ator sem delegação.
- Duas conexões, READ COMMITTED/REPEATABLE READ: médico primeiro/recepção depois, recepção primeiro/médico com revisão antiga depois e duas alterações de recepção na mesma revisão. Observar as esperas reais no servidor e verificar uma única alteração, revisão/autoria/horário/auditoria do vencedor e nenhuma `40P01`/espera por timeout no artefato corrigido.
- Para reproduzir a inversão, o ensaio descartável pode usar gatilho exclusivo de teste que pausa o médico depois do lock da linha e antes do lock da agenda; nenhum gatilho de teste entra nas migrations. Provar que a recepção corrigida não segura o lock do calendário enquanto aguarda essa linha. Remover os instrumentos do banco descartável antes de outras suítes.
- Conclusão manual e `complete_consultation_metadata`: duas conexões reais e pausa por lock do paciente antes do compromisso, nas duas isolations. A RPC deve recusar sem esperar o advisory e a conclusão deve terminar uma única vez. Um protótipo somente de teste com espera bloqueante deve reproduzir o novo impasse que a simples inversão de ordem criaria.
- Verificar que revisão antiga/ID ausente não introduzem efeitos parciais; preservar os testes anteriores de conflito, identidade imutável, agendamento humano, revogação e custódia.

Sem nova API/DTO ou tela; não ampliar o acesso a pacientes/agendas nem alterar a política de legado/prática particular. Sem implantação, chamadas externas ou dados reais.
