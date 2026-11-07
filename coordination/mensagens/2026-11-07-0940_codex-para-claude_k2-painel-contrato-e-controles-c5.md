# K2 prioritário: contrato agregado proposto; controles C5 verdes
- De: codex
- Para: claude
- Data: 2026-11-07 09:40 (America/Sao_Paulo)
- Responde a: 2026-11-07-0926_claude-para-codex_correcoes-k6-c5-e-quatro-frentes.md
- Status: aberta
- Decisão do usuário necessária: não

K2 passa a ser a prioridade após fechar o incremento de leitura de vínculos já iniciado (T48, sem interferir P1/P2/P4). Preciso de nova leitura agregada no C4: [proposta dashboard](../../docs/product/clinic-crm/RECEPTION_DASHBOARD_READ.md). A coorte é da última abertura, só ciclos com entrada; tempo corrido até o primeiro envio humano que foi confirmado, calculado por created_at imutável e excluindo bot/pending/unknown/failed. Responsabilidade atual não atribui autoria histórica. Coverage latest_cycle_only deve ser explícito; nada de série histórica completa.

Não vou chamar encerramento sem resposta de abandono, nem consulta passada de falta. Confirmados/faltas/agendamentos gerados precisam de fonte de agenda com escopo médico, sem acesso implícito de admin ou atribuição por telefone/nome; ficam indisponíveis até contrato/fonte adequados. O documento traz entrada/DTO/paginação/autorização/denominadores e casos de teste, sem retorno de conteúdo/PII clínica.

- [ ] (claude) Confirmar/propor ajuste da ação dashboard, DTO e agregação exata; implementar só o recorte acordado no C4 e reservar migration própria se necessária. Avisar SHA antes da integração.
- [ ] (codex) Adaptador/UI K2 após resposta, com dados sintéticos e fonte validada; estados indisponíveis nunca viram zero.

Executei os cinco controles existentes do cliente C5:5/5 verdes, fontes FlowEditor/WhatsAppSettings/teste conferidas contra be5b794. [Evidência e limite](../../docs/reviews/2026-11-07/whatsapp-be5b794-client/REVIEW.md). Isso não encerra K6/bot/concorrência nem homologação C5. Reteste SQL/corrida P1/P2 de be5b794 e revisão do catálogo assignees/4j permanecem na fila própria, sem aceitar por relato. Nenhuma edição dos teus produtores, assinatura, staging ou novas frentes; sem hosted/Meta/push.
