# K1/4l — mudança de fila com confirmação humana

Oferecer Mudar fila só em detalhe fresco open/próprio/revisão incrementável, sob gates existentes de ator/clínica/caixa/lista. Dialog identifica contato e fila atual, pede outra fila explícita conforme grammar4k e mostra a mudança antes de Confirmar mudança. Campo não normaliza/trunca texto; inválido/vazio/igual à atual não envia. Cancelar/Escape não enviam, devolvem foco e descartam rascunho; nenhum comando ao abrir ou editar.

Confirmação vinculada a id/revisão/readVersion/owner/fila atual, desmontada por mudança/refetch imediato idêntico ou pendente/contexto/perda de acesso. O alvo confirmado é o valor atual validado, não rascunho antigo. Reutilizar exclusão mútua, cancelamento de observação, gerações e conferência com os outros comandos; um clique/uma tentativa, sem retry ou otimismo.

Sempre reler lista/detalhe após início, inclusive recibo válido {receipt,needsRefresh:true}: act não contém queue. Mostrar somente a fila da nova leitura, sem prometer que o alvo permaneceu aplicado nem substituir DTO pelo input. Falha de conferência oculta detalhe e bloqueia comandos, libera só Conferir conversa/volta. Nova geração impede resposta antiga de substituir a leitura visível. Retry só de leitura, nova mudança exige nova escolha/confirmação.

Preservar dono/status/vínculos/não lidas/consentimento; sem assumir/devolver/reabrir/encerrar/mark_read/send/Meta/agenda/clínico automáticos. Política local não altera/prova autorização ampla do produtor/SQL/CAS/RLS. Fixture opt-in exclusiva, sintética; browser isolado320–1920/135%, nome longo, campo/ações alcançáveis, rede só loopback e cleanup. Catálogo4j continua separado; C4/C5/PersonalMed/SaaS intactos.
