# Backlog verificável: CRM da clínica

Data: 03/11/2026. [Plano](plan.md), [especificação](../../docs/product/clinic-crm/PRODUCT_SPEC.md) e [handoff PersonalMed](../../docs/product/clinic-crm/DATABASE_HANDOFF.md). Caixas marcadas significam implementação local verificada, sem implantação ou dados reais. [Evidências e limites](../../docs/reviews/2026-11-03/reception-foundation/IMPLEMENTATION.md).

T01–T07 e T09–T11 implementados nos três arquivos `20261103*_reception_*.sql`, quatro suítes SQL e `src/features/reception`. T08 tem sugestão por pedido/vínculo; regras por serviço ficam pendentes. T00 recebeu referência agregada do Claude, mas operação/corte permanecem abertos. T24 já tem bloqueio preventivo de exclusão e liberação de responsabilidade; o ciclo completo continua pendente. Alvos abaixo eram estimativas, consolidadas nesses arquivos durante a execução.

Alvos futuros abaixo são sugestões de planejamento; os alvos implementados foram consolidados conforme o relatório do incremento. Cada tarefa deve deixar um caminho testável. `migration:...` é um rótulo de escopo; as migrations reais da recepção já têm numeração `20261103` e estão listadas no handoff para coordenação com Claude.

## Fundação e primeira recepção

- [ ] **T00 — Confirmar operação e mapa do legado.** Dependências: nenhuma.
  - Aceite: receber dicionário/contagens e mapa de médicos do Claude; registrar números/filas/escopos da equipe; registrar pendências do contador e topologia local/pública.
  - Verificar: revisar casos sintéticos de família, paciente de dois médicos e primeira consulta; dúvidas restantes têm responsável e bloqueiam somente tarefas dependentes.
  - Alvos: `DATABASE_HANDOFF.md`, `PRODUCT_SPEC.md`, `plan.md` (3 documentos).

- [x] **T01 — Autorizar um papel de recepção sem ampliar acesso clínico.** Dep.: T00 para papéis; pode usar dados sintéticos enquanto o legado é estudado.
  - Aceite: membro de recepção tem capacidades explícitas; convites/aceite de compartilhamento clínico recusam conta não clínica; sessão e desligamento revogam acesso.
  - Verificar: SQL de médico, recepção, gestor, inativo e estranho; tentativas diretas às RPCs de compartilhamento e fontes.
  - Alvos: `migration:reception_roles`, `supabase/tests/reception-access.test.sql`, `src/lib/clinicCapabilities.ts`, `src/lib/clinicCapabilities.test.ts` (4).

- [x] **T02 — Delegar agenda e fila por profissional.** Dep.: T01.
  - Aceite: gestor delega/revoga escopo; relação entre clínica, atendente e médico é validada; revogação vale para requisição seguinte.
  - Verificar: SQL de delegação cruzada/forjada e conta inativa, incluindo médico fora da clínica.
  - Alvos: `migration:staff_scopes`, `supabase/tests/staff-scopes.test.sql`, `src/features/reception/api.ts`, `src/features/reception/contracts.ts` (4).

- [x] **T03 — Entrar na área correta e configurar a equipe.** Dep.: T01–T02.
  - Aceite: recepção chega ao seu ambiente; gestor altera escopos permitidos; nenhuma rota clínica vaza dados por navegação direta.
  - Verificar: testes de sessão/rota e navegador com perfis separados; erro de permissão distinto de lista vazia.
  - Alvos: `src/App.tsx`, `src/features/reception/ReceptionShell.tsx`, `src/features/reception/TeamSettings.tsx`, `src/features/reception/ReceptionShell.test.tsx`, `src/components/MobileSubpageNavigation.tsx` (5).

**Checkpoint A:** comprovar autorização no banco/API antes de preencher a tela com dados reais.

- [x] **T04 — Criar e buscar contatos administrativos.** Dep.: T02.
  - Aceite: contato não cria prontuário automaticamente; canal guarda original e normalização; busca paginada retorna somente campos autorizados.
  - Verificar: família com telefone comum, ausência de DDD, número alterado e milhares de registros sintéticos; RLS entre clínicas.
  - Alvos: `migration:clinic_contacts`, `supabase/tests/clinic-contacts.test.sql`, `src/features/reception/contacts.ts`, `src/features/reception/ContactSearch.tsx`, `src/features/reception/ContactSearch.test.tsx` (5).

- [x] **T05 — Confirmar beneficiário e vincular prontuário existente.** Dep.: T04; importação real depende do mapa T00.
  - Aceite: contato/responsável pode ligar vários pacientes; vínculo não cria compartilhamento clínico; ambiguidade exige confirmação.
  - Verificar: telefone reciclado, dois médicos, menor atendido por responsável e tentativa de vincular prontuário alheio.
  - Alvos: `migration:contact_patient_links`, `supabase/tests/contact-links.test.sql`, `src/features/reception/BeneficiaryPicker.tsx`, `src/features/reception/BeneficiaryPicker.test.tsx` (4).

- [x] **T06 — Criar atendimento na fila e assumir sem disputa.** Dep.: T04.
  - Aceite: entrada manual tem estado/origem; assumir é atômico e auditado; uma responsabilidade atual por caso.
  - Verificar: duas sessões tentando assumir o mesmo caso, idempotência e revisão antiga.
  - Alvos: `migration:reception_cases`, `supabase/tests/reception-cases.test.sql`, `src/features/reception/cases.ts`, `src/features/reception/CaseQueue.tsx`, `src/features/reception/CaseQueue.test.tsx` (5).

- [x] **T07 — Atender, transferir e recuperar o trabalho.** Dep.: T06.
  - Aceite: transições e transferências têm histórico; rascunho é por ator/caso; nova demanda não fica oculta após encerramento.
  - Verificar: sair/voltar, concorrência, troca de usuário, atendente desligado e destinatário sem escopo.
  - Alvos: `migration:case_transitions`, `supabase/tests/case-transitions.test.sql`, `src/features/reception/CaseWorkspace.tsx`, `src/features/reception/CaseWorkspace.test.tsx`, `src/features/reception/CaseContext.tsx` (5).

- [ ] **T08 — Sugerir médico por regras administrativas.** Dep.: T05–T07.
  - Aceite: explicação por pedido/vínculo/serviço; empate vai para pessoa; regra não consulta evolução ou dá diagnóstico.
  - Verificar: pessoa nova, continuidade, médico indisponível, dois vínculos e correção humana.
  - Alvos: `src/features/reception/routing.ts`, `src/features/reception/routing.test.ts`, `src/features/reception/DoctorSuggestion.tsx`, `src/features/reception/DoctorSuggestion.test.tsx`, `src/features/reception/CaseWorkspace.tsx` (5).

**Checkpoint B:** recepção demonstra uma fila utilizável com entrada manual, dois atendentes e contato familiar; sem esperar integração externa.

## Agenda humana

- [x] **T09 — Ler agenda mínima dos médicos delegados.** Dep.: T02, T05.
  - Aceite: visão por profissionais autorizados e período; sem campos clínicos em títulos/notas retornados; bloqueios/durações distinguem disponibilidade de reserva.
  - Verificar: tentativas de ler outro médico/clínica, período extenso e estado de falha.
  - Alvos: `migration:delegated_calendar_read`, `supabase/tests/delegated-calendar.test.sql`, `src/features/reception/calendar.ts`, `src/features/reception/ReceptionCalendar.tsx`, `src/features/reception/ReceptionCalendar.test.tsx` (5).

- [x] **T10 — Reservar horário com confirmação humana.** Dep.: T09.
  - Aceite: ator/escopo/vínculo verificados no servidor; conflitos simultâneos recusados; exceção só com permissão e motivo.
  - Verificar: duas transações no mesmo intervalo, paciente incorreto, duração inválida, retry e tentativa de agendamento por webhook/modelo.
  - Alvos: `migration:delegated_calendar_write`, `supabase/tests/scheduling-concurrency.test.sql`, `src/features/reception/BookingReview.tsx`, `src/features/reception/BookingReview.test.tsx`, `src/features/reception/calendar.ts` (5).

- [x] **T11 — Remarcar, registrar chegada e tratar cancelamento.** Dep.: T10.
  - Aceite: alterações humanas auditadas; lembrete antigo invalidado; presença e status do prontuário não são confundidos.
  - Verificar: remarcação concorrente, cancelamento com mensagem pendente, revogação de escopo e Google indisponível.
  - Alvos: `migration:appointment_events`, `supabase/tests/appointment-events.test.sql`, `src/features/reception/ReceptionCalendar.tsx`, `src/features/reception/calendar.test.ts`, `supabase/functions/send-appointment-reminder/index.ts` (5).

**Checkpoint C:** agendar/remarcar para dois médicos, resolver disputa de horário e manter operação manual durante falha externa.

## WhatsApp oficial

- [ ] **T12 — Homologar transporte e conexão de teste.** Dep.: T00 para número/topologia; T02 para escopos.
  - Aceite: API/BSP e titularidade aprovados; coexistência/histórico/identificador verificados; número de teste separado de produção.
  - Verificar: prova oficial de conexão e recebimento, contrato/custo/dados, endpoint HTTPS e comportamento com servidor local desligado.
  - Alvos: `docs/product/clinic-crm/WHATSAPP_DECISION.md`, `src/features/communications/provider.ts`, `supabase/functions/_shared/whatsappProvider.ts`, `src/features/communications/provider.test.ts` (4).

- [ ] **T13 — Receber eventos de forma durável e idempotente.** Dep.: T12, T06.
  - Aceite: desafio/assinatura e clínica validados; persistir antes do ACK; mensagem/evento repetido não duplica caso ou conteúdo.
  - Verificar: assinatura inválida, conta errada, replay, eventos fora de ordem e queda entre persistência/processamento.
  - Alvos: `migration:communication_inbox`, `supabase/tests/communication-inbox.test.sql`, `supabase/functions/whatsapp-webhook/index.ts`, `supabase/functions/_shared/whatsappWebhook.ts`, `src/features/communications/webhook.test.ts` (5).

- [ ] **T14 — Exibir conversa e enviar pela recepção.** Dep.: T13, T07.
  - Aceite: paginação e destino confirmados; envio exige responsável/capacidade; enviado/entregue/lido/falhou dependem de evidência do canal.
  - Verificar: troca de contato durante envio, duplo clique, revogação e retorno de envio perdido.
  - Alvos: `migration:communication_outbox`, `supabase/functions/send-clinic-message/index.ts`, `src/features/communications/Conversation.tsx`, `src/features/communications/Conversation.test.tsx`, `src/features/communications/outbox.test.ts` (5).

- [ ] **T15 — Respeitar janela, preferências e lembretes.** Dep.: T14, T11.
  - Aceite: fora da janela só modelo permitido; opt-out bloqueia novos envios; confirmação de presença não cria/remarca consulta.
  - Verificar: virada de janela, modelo reprovado, contato familiar, evento repetido e consulta cancelada antes da entrega.
  - Alvos: `migration:communication_preferences`, `supabase/tests/communication-preferences.test.sql`, `supabase/functions/_shared/communicationPolicy.ts`, `src/features/communications/policy.test.ts`, `src/features/communications/MessageComposer.tsx` (5).

**Checkpoint D:** prova com número de teste, eventos repetidos e indisponibilidade; somente depois habilitar equipe real limitada.

## Financeiro e NFS-e

- [ ] **T16 — Registrar serviços e cobranças.** Dep.: T10, T00 para política comercial.
  - Aceite: catálogo e snapshot de preço/classificação; serviço distinto do compromisso; dinheiro em centavos com alterações autorizadas.
  - Verificar: serviço cancelado, retorno sem cobrança, desconto, preço alterado e recepção sem capacidade financeira.
  - Alvos: `migration:service_orders`, `supabase/tests/service-orders.test.sql`, `src/features/billing/orders.ts`, `src/features/billing/ServiceOrder.tsx`, `src/features/billing/ServiceOrder.test.tsx` (5).

- [ ] **T17 — Alocar recebimentos e estornos.** Dep.: T16.
  - Aceite: parcial e múltiplos meios; alocação não excede saldos; correções preservam histórico e não cancelam nota implicitamente.
  - Verificar: parcelas, pagamento concorrente, retry, valor negativo indevido e estorno autorizado.
  - Alvos: `migration:payments`, `supabase/tests/payments.test.sql`, `src/features/billing/payments.ts`, `src/features/billing/Payments.tsx`, `src/features/billing/Payments.test.tsx` (5).

- [ ] **T18 — Confirmar pagador, beneficiário e perfil fiscal.** Dep.: T16, T05; dados/regra aprovados pelo contador.
  - Aceite: papéis distintos; perfil por regime/vigência; campos fiscais completos via canal seguro, sem copiá-los automaticamente do WhatsApp.
  - Verificar: responsável familiar, tomador empresa, dados incompletos e CNPJ alfanumérico em fixtures oficiais/sintéticas.
  - Alvos: `migration:fiscal_profiles`, `supabase/tests/fiscal-profiles.test.sql`, `src/features/billing/FiscalReview.tsx`, `src/features/billing/FiscalReview.test.tsx`, `src/features/billing/fiscalValidation.ts` (5).

- [ ] **T19 — Provar emissão nacional em homologação.** Dep.: T18; contador, certificado e fornecedor aprovados.
  - Aceite: adaptador escolhido e payload validado; autorização/rejeição consultáveis; confirmar limites de cancelamento e custódia do certificado.
  - Verificar: exemplos de serviços da clínica em homologação, sem dados clínicos nem emissão real; documentar protocolo e resposta.
  - Alvos: `docs/product/clinic-crm/FISCAL_PROVIDER_DECISION.md`, `supabase/functions/_shared/fiscalProvider.ts`, `src/features/billing/providerContract.test.ts` (3).

- [ ] **T20 — Criar pedido fiscal imutável e reconciliar.** Dep.: T19, T17.
  - Aceite: chave idempotente/snapshot persistidos; timeout vira desconhecido; consultar referência antes de reenvio.
  - Verificar: órgão autorizou e retorno se perdeu, worker caiu, webhook duplicado/forjado e revisão antiga.
  - Alvos: `migration:fiscal_documents`, `supabase/tests/fiscal-documents.test.sql`, `supabase/functions/issue-service-invoice/index.ts`, `supabase/functions/reconcile-service-invoice/index.ts`, `src/features/billing/fiscalLifecycle.test.ts` (5).

- [ ] **T21 — Consultar e entregar documentos autorizados.** Dep.: T20.
  - Aceite: lista distingue processamento/autorização/rejeição; PDF/XML privados; entrega é separada da autorização.
  - Verificar: arquivo ausente, usuário sem escopo, destinatário errado e falha no canal de entrega.
  - Alvos: `src/features/billing/Invoices.tsx`, `src/features/billing/Invoices.test.tsx`, `supabase/functions/get-service-invoice/index.ts`, `supabase/functions/deliver-service-invoice/index.ts`, `src/features/billing/invoiceDelivery.test.ts` (5).

- [ ] **T22 — Cancelar/substituir com histórico.** Dep.: T21; regras contábeis e API confirmadas.
  - Aceite: permissão/justificativa; original preservado; pendente/recusado/ação no portal não são apresentados como cancelamento concluído.
  - Verificar: prazo/condição recusados, retry, nota substituta e devolução financeira sem cancelamento implícito.
  - Alvos: `migration:fiscal_events`, `supabase/tests/fiscal-events.test.sql`, `supabase/functions/cancel-service-invoice/index.ts`, `src/features/billing/InvoiceActions.tsx`, `src/features/billing/InvoiceActions.test.tsx` (5).

**Checkpoint E:** contador valida cenários reais representados em homologação; reconciliar valores, chave e XML. Não publicar emissão apenas porque existe PDF.

## Operação, privacidade e piloto

- [ ] **T23 — Medir fila e operação.** Dep.: T07, T11, T17; fiscal pode aparecer indisponível até T21.
  - Aceite: primeira resposta, conversão e pendências têm denominador; filtros por escopo; sem texto de conversa em telemetria.
  - Verificar: horário útil, transferências, reabertura, duplicatas e amostra sintética com resultados conhecidos.
  - Alvos: `migration:reception_metrics`, `supabase/tests/reception-metrics.test.sql`, `src/features/reception/OperationsDashboard.tsx`, `src/features/reception/OperationsDashboard.test.tsx` (4).

- [ ] **T24 — Completar custódia, retenção e recuperação.** Dep.: T15, T22.
  - Aceite: novos objetos no mapa de exportação/retenção; desligamento redistribui trabalho sem apagar histórico; backup/replay não duplica efeitos externos.
  - Verificar: pedido de exclusão com obrigação fiscal, contato ligado a dois médicos, mídia em quarentena e recuperação após falha de internet.
  - Alvos: `migration:crm_privacy_lifecycle`, `supabase/tests/crm-lifecycle.test.sql`, `supabase/functions/export-user-data/index.ts`, `docs/runbooks/clinic-crm-recovery.md`, `scripts/clinic-crm-recovery.mjs` (5).

- [ ] **T25 — Ensaiar e ativar o piloto limitado.** Dep.: T23–T24 e checkpoints anteriores.
  - Aceite: equipe e ambiente selecionados; ativação por capacidade/flag; suporte e rollback preservam o que provedores já processaram.
  - Verificar: SQL, regressões clínicas, lint/types/Edge/build e navegador 390/768/1280/1920 px a 150%; roteiro de duas secretárias e provas externas autorizadas registradas separadamente dos mocks.
  - Alvos: `scripts/clinic-crm-browser.mjs`, `scripts/fixtures/clinic-crm-api.mjs`, `docs/runbooks/clinic-crm-launch.md`, `docs/product/clinic-crm/PILOT_REPORT.md` (4).

**Checkpoint final:** aceite operacional da clínica e reconciliação fiscal. Nenhum checkbox futuro deve ser marcado só por tela pronta, código gerado ou teste que simula autorização de fornecedor.
