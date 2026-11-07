# K1/4k — mudança explícita de fila

Adaptador independente do catálogo de responsáveis, usando act/set_queue do contrato WhatsApp v1.2. Snapshot local estrito: conversationId UUID, revision PostgreSQL incrementável (0..2147483646), status open, assignedTo igual ao ator esperado, currentQueue string não vazia<=128 e queue nova diferente da atual. O alvo deve casar exatamente com ^[a-z0-9][a-z0-9_-]{0,39}$, como o produtor; sem normalizar texto ambíguo/truncar/inferir fila do médico ou do responsável.

Wire exato: action act, operation set_queue, conversationId, revision e queue. Ator/clínica/status/proprietário/currentQueue locais não são autoridade e ficam fora do corpo. Uma invocação, sem retry. Snapshot validado é imutável durante await.

O recibo do produtor só contém revision, status e assignedTo: não contém queue. Validar DTO estrito open/revisão+1/proprietário preservado NÃO comprova a fila aplicada. Resultado local sempre {receipt, needsRefresh:true}, inclusive quando o recibo é válido. O consumidor deve reler o detalhe e a lista e só apresentar a fila lida; se a leitura falhar, manter resultado inconclusivo/ação bloqueada, nunca preencher a fila solicitada otimisticamente. Valor de fila no recibo é campo extra inválido no contrato atual.

Falha após início, recibo inválido ou cancelamento tardio também exige leitura; preflight inválido/cancelado antes do envio não envia. Não prometer rollback nem reenvio automático. Erros com mensagens locais/whitelist, sem detalhes brutos.

Política local aberta/própria é mais restrita que o writer, que aceita set_queue sob a autorização do domínio da caixa e não muda responsável/status/vínculos/consentimento. Não prova autenticação/autorização/CAS/RLS/concorrência nem fila realmente aplicada. Não editar C4/SQL nem invocar mark_read/send/Meta. UI e confirmação humana com contexto fresco/exclusão/conferência/readVersion ficam no recorte4l; nenhum envio ao montar/ao selecionar.

Provas somente sintéticas/SDK instalado com fetch em memória. Sem banco, navegador, servidor real, dados de paciente, carga PersonalMed, operação externa ou publicação.
