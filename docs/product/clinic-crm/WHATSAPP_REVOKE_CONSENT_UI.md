# K1/4n — retirar autorização com confirmação humana

Oferecer Retirar autorização apenas no detalhe fresco open/próprio/consented true/revisão incrementável e telefone waId conhecido (7..15 dígitos ASCII), sob gates existentes de ator/clínica/conexão/lista. É uma restrição local adicional, sem mudar o produtor ou inferir telefone de BSUID/contato/paciente.

Confirmação identifica contato e telefone, explica retirada dos lembretes na clínica e possível efeito em outras conversas do mesmo número. Mensagens já preparadas/reservadas/enviadas podem continuar; conversa, dono/vínculos e não lidas ficam preservados. Não oferecer concessão ou prometer impedir toda resposta humana. Cancelar/Escape não enviam e restauram foco; confirmar uma vez chama4m, sem comandos ao montar/abrir.

Confirmação vinculada a id/revisão/readVersion/owner/waId/consented/optedOut/contexto; qualquer mudança/refetch imediato ou retido/perda de escopo descarta. Compartilhar exclusão/conferência/gerações com demais comandos. Sempre reler lista/detalhe após início, mesmo com recibo válido, porque act não contém flags. Mostrar somente autorização Vigente/Não vigente e optedOut da leitura fresca; feedback neutro, nenhum consented:false/optedOut:true otimista. Leitura falha oculta detalhe e bloqueia comandos, só retry de leitura/volta; contexto trocado aborta observação sem rollback prometido.

Aviso optedOut descreve o telefone marcado para não receber lembretes, sem inferir que a pessoa pediu isso. Fixture opt-in exclusiva reproduz retirada por variantes de telefone com outra conversa preservada em identidade/dono/fila/status, sem fusão ou prontuário. Provas sintéticas, app/SDK reais com HTTP loopback e navegador isolado320–1920/135%; preservar C4/C5/SaaS/PersonalMed, sem SQL/Meta/hosted/carga/push ou autorização/CAS/retirada real afirmados.

A lista também faz parte do contexto fresco: cada leitura bem-sucedida tem uma versão local (nunca enviada). O detalhe é remontado ao mudar essa versão ou o snapshot selecionado, incluindo owner/revisão/telefone/flags, mesmo com refetch idêntico/coalescido da lista. Nova confirmação só após nova leitura do detalhe.
