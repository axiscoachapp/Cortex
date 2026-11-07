# K1/4a — adaptador para assumir uma conversa

Usar o contrato `act/assign` v1.2 já entregue pelo Claude. O comando recebe somente conversationId e revisão inteira PostgreSQL ainda incrementável. Ator esperado é contexto local separado, usado exclusivamente para conferir a resposta; nunca enviar ator, clínica, targetUserId ou outra operação. A API deriva o alvo do chamador. Este incremento entrega o adaptador; botão/fluxo da caixa ficam para integração própria.

Um clique futuro corresponde a uma única invocação. Não há retry, envio WhatsApp, mark_read, vínculo, consentimento ou reserva. Resultado só é aceito com campos exatos, status open, revisão anterior+1 e assignedTo igual ao ator esperado. Isso confere o recibo do transporte, não prova CAS/autorização/RLS no servidor.

Entradas inválidas e cancelamento anterior ao transporte não invocam a API. Erro após início, cancelamento tardio ou resposta malformada pode esconder uma atribuição já aplicada: retornar erro seguro com needsRefresh=true, sem afirmar rollback ou sugerir retry automático. stale exige reler a conversa e nova confirmação humana. Não expor mensagens brutas, dados adicionais ou credenciais.

Provar com testes dirigidos e SDK instalado sobre fetch em memória, somente IDs/valores sintéticos e sem rede real. A integração de UI deverá usar escopo fresco e conversa aberta/sem responsável, ocultar ações em erro/releitura e conciliar resultado perdido antes de habilitar outro comando. O assign do produtor também abre uma conversa encerrada e pode trocar responsável; a futura ação de assumir deve deixar reabertura/transferência para fluxos explícitos próprios. Produtor/SQL/Meta/identidade/agenda não mudam neste recorte.
