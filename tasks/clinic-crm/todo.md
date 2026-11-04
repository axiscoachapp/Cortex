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

- [x] **T04a — Corrigir nome/telefone do contato pela administração.** Dep.: T04.
  - Aceite: confirmação humana, validação no servidor, revisão contra sobrescrita, legado bruto preservado, auditoria sem copiar valores pessoais, paciente independente e retry da criação preservado.
  - Verificar: SQL de papéis/MFA/revogação/legado, duas conexões concorrentes, editor preservado em conflito/refetch e navegador a 150%.
  - Alvos reais: `20261103003500_reception_contact_corrections.sql`, `reception-contact-corrections.test.sql`, `ContactCorrectionDialog.tsx`, `ContactCorrectionDialog.test.tsx`, `ContactsPage.tsx`.
  - [Evidências e limites](../../docs/reviews/2026-11-03/contact-corrections/IMPLEMENTATION.md).

- [x] **T05a — Especificar retificação de vínculo administrativo.** Dep.: T05.
  - Aceite de desenho: correção de relação/beneficiário exige escopo, ator e revisão; registros anteriores da agenda continuam íntegros; nenhuma fusão de prontuários nem concessão clínica implícita.
  - Verificar antes de implementar: relações familiares, contato reciclado, paciente com dois médicos, vínculo usado por agendamento histórico e revogação de escopo. S2 e carga real permanecem separadas.
  - [Contrato revisado localmente](../../docs/product/clinic-crm/CONTACT_LINK_CORRECTIONS.md). Nenhuma migration ou interface de vínculo implementada por esta tarefa.

- [ ] **T05b — Implementar ciclo auditado do vínculo administrativo.** Dep.: T04a, T05a.
  - Fatias: SQL/guardas de todos os escritores; concorrência e contratos mínimos; editor admin e integração com reserva/modal médico. Seguir o contrato T05a, sem retificação de identidade clínica ou carga real.
  - Aceite: relação/revogação/reativação por revisão; nenhuma confirmação antiga reativa implicitamente; novas reservas/reaberturas/remarcações exigem vínculo ativo; histórico e encerramento clínico preservados; paciente de CRM não é remapeado.
  - Verificar: atores/MFA, duas conexões reais, FK histórica, regra de órfãos e formatos estritos de leitura. Migration precisa de reserva prévia no ESTADO.
  - **T05b/1 concluída:** beneficiário imutável de reserva CRM, guarda contra escrita direta/privilegiada e orientação no modal médico; layout sem overflow a 150%. [Evidências](../../docs/reviews/2026-11-03/appointment-identity/IMPLEMENTATION.md). Revogação/reativação e editor de vínculo seguem pendentes; não considerar T05b inteira entregue.
  - **T05b/2 concluída:** confirmação idêntica preserva relação/autor/data e não duplica auditoria; divergência recusada e formulário preservado na busca/falha parcial/refetch. [Evidências](../../docs/reviews/2026-11-03/link-confirmation/IMPLEMENTATION.md). O ciclo completo continua pendente.
  - **T05b/3 concluída no banco/API:** correção administrativa de relação por revisão, snapshot mínimo separado e identidade/confirmação imutáveis, sem mudar prontuário. [Evidências](../../docs/reviews/2026-11-04/link-relationship/IMPLEMENTATION.md). Editor e estados de vínculo seguem pendentes; T27/T28 de segurança precedem a ampliação visual.

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

## Fundação de IA coordenada com Claude

- [ ] **T26 — A0: contrato e controles independentes de provedor.** Plano de origem: `docs/ai/PLANO_IA_EFICIENCIA_E_AVALIACAO.md` (Claude). Reserva futura `05000`; sem migration implementada.
  - Primeiro definir entradas/saídas por tarefa, modelo pedido/efetivo, medição versus estimativa, desligamento/orçamento e verificação de recusa no servidor/worker. Sem texto clínico em logs, sem ampliar leitura da recepção nem inferir identidade entre médicos.
  - Verificar: recusa/desligamento concorrentes com chamada/retry, metadados ausentes, exportação/exclusão, posse/compartilhamento explícito e proveniência. D13/D15/D16 e escolha com os médicos continuam pendentes; não trocar modelo/provedor, habilitar uso real, disparar avaliação externa ou iniciar síntese A1 por esta tarefa de contrato.

## Achados da revisão cruzada — prioridade antes do editor/piloto

Origem: [revisão do Claude](../../docs/reviews/2026-11-04/claude-reception-review/REVIEW.md). Estado inicial: leitura/triagem; não marcar um achado resolvido sem reprodução e prova da correção.

- [x] **T27 — H2: custódia de exclusão antes de qualquer limpeza.** T27/1 e T27/2b implementadas e verificadas localmente; sem publicação.
  - Reproduzir médico solo com agenda autenticada, médico delegado, caso encerrado, bloqueio e autor de confirmação/correção. Pré-check deve separar agenda própria de custódia de terceiros e cobrir todas as referências impeditivas antes de Storage/provedor/auth. Rejeitar novas operações de recepção no médico em exclusão; testar corrida e retomada sintéticas. Nenhuma exclusão real autorizada por esta tarefa.
  - [x] **T27/1:** pré-check de referências existentes, cascata real da conta solo sintética e recusa de busca/caso/delegação após marcador visível. 51 migrations/30 suítes SQL e 26 testes de handlers de segurança aprovados. [Evidências](../../docs/reviews/2026-11-04/deletion-custody/IMPLEMENTATION.md).
  - [x] **T27/2:** barreira privada de versão com NOWAIT, marcadores monotônicos, ator/médico e fontes indiretas; snapshot antigo aborta antes de efeitos externos. A proposta antiga de locks bloqueantes de associação foi rejeitada e não foi aplicada.
  - **T27/2a concluída como prova limitada:** quatro corridas reproduzidas nas migrations atuais (ensaio estrito RED) e quatro recusadas no protótipo descartável (GREEN), incluindo RPC pública com snapshot antigo. [Evidências](../../docs/reviews/2026-11-04/deletion-concurrency/MECHANISM.md). Nenhuma correção no app nesta etapa.
  - **T27/2b concluída**, `20261104002000`: 53 migrations/32 suítes SQL, concorrência existente, oito ordens de exclusão e 26 testes de handlers de segurança aprovados. Marcadores/upsert/carimbo final e cascatas reais sintéticas comprovados. [Evidências](../../docs/reviews/2026-11-04/deletion-barrier/IMPLEMENTATION.md). Carga/retentativas do piloto seguem em T25.
- [ ] **T28 — H1/M2/L5: escopos administrativos e prática particular.** Priorizar após T27, antes de editor/piloto.
  - Provar admin versus médico membro sem delegação nos leitores e escritores. Separar gestão de equipe/contatos de autorização de agenda/lista de pacientes, seguindo a matriz atual. Explicitar anuência/limites de delegação; não reviver escopos antigos ao reingressar. Qualquer ampliação de política precisa de decisão explícita.
  - [x] **T28/1, `20261104003000`:** remove acesso implícito do admin a agenda/carteira alheia, preserva gestão por diretório mínimo separado e a própria agenda. 55 migrations/33 SQL, 43 testes da recepção e 19 verificações de navegador aprovados; tipos/build/lint verificados. [Evidências](../../docs/reviews/2026-11-04/admin-scopes/IMPLEMENTATION.md).
  - [x] **T28/2a — L5, `20261104004000`:** revoga delegações na saída, impede escopos inativos/convidados e limpa escopos antigos objetivamente inativos; reingresso exige nova concessão. 56 migrations/34 SQL, 20 interleavings e backfill sintético aprovados, além das regressões de custódia/recepção/S3. [Evidências](../../docs/reviews/2026-11-04/scope-lifecycle/IMPLEMENTATION.md). M2/D18 permanece separada; revisar grants ativos sem proveniência no piloto.
  - [ ] **T28/2b — M2/D18:** aguardar limite administrativo escolhido pela clínica/usuário; então anuência médica e recorte da prática particular. Não criar grant de admin nem inferir vínculo de paciente.
- [x] **T29 — M3/L4: concorrência e inexistência de agendamento.** `20261104006000` implementada e verificada localmente; sem publicação.
  - Provar edição médica direta contra RPC de remarcação em duas conexões, corrigir ordem de locks e responder indisponibilidade para ID inexistente; manter CAS, conflito de horário e histórico.
  - 57 migrations/35 SQL, dez provas dirigidas da agenda (incluindo conclusões manual/assistida), regressões de recepção/permissões/S3 e oito ordens de exclusão aprovadas. 48 testes/10 arquivos da recepção, build/typecheck e lint verificados. Advisory adquirido sem espera após a linha/CAS; conservador `40001` durante outra escrita do mesmo médico. [Evidências](../../docs/reviews/2026-11-04/appointment-changes/IMPLEMENTATION.md).
- [x] **T30 — M1: continuidade clínica em falha transitória de acesso.** Implementada/verificada localmente, sem migration ou publicação.
  - Preservar área clínica previamente autorizada em erro de transporte com aviso; resposta autorizativa negativa e mudança real de papel continuam bloqueando. Testar sucesso → falha → recuperação e negativa explícita.
  - Conferência nesta montagem/conta/entrada de navegação; cache de negativa não revive, portais/captura bloqueados com recuperação acessível. 538 testes/77 arquivos, 38 direcionados de gates/API, quatro fluxos novos de navegador e 19 regressões da recepção a 150% aprovados, com build/typecheck/lint. [Evidências](../../docs/reviews/2026-11-04/clinical-continuity/IMPLEMENTATION.md).
- [ ] **T31 — L2/L3: credencial inicial, guardas e privilégios.**
  - [x] **T31/1 — catálogo/ACL:** bootstrap reproduz grants diretos de EXECUTE da Supabase; lista explícita de 60 SECURITY DEFINER autenticados, zero expostos a anônimo, 66 chamadas clínicas/administrativas com recepção ativa/inativa, controles positivos de storage/busca e sete falhas transacionais detectadas. Revogações L3 já estavam em `20261101000000`; nenhuma migration/função de produção alterada. 57 migrations/36 suítes SQL aprovadas; [evidências e limites](../../docs/reviews/2026-11-04/function-boundaries/IMPLEMENTATION.md).
  - [x] **T31/2 — recovery do gate externo de MFA:** modal superior não dispensável, cache/ator/níveis inválidos protegidos, retry de fatores e restauração de foco no mesmo documento. 29 testes/3 arquivos, quatro fluxos de MFA e quatro regressões da clínica no Edge a 150% em quatro larguras, build/typecheck/lint aprovados. Sem backend ou arquivos do Claude; limite de portais tardios documentado. [Evidências](../../docs/reviews/2026-11-04/session-recovery/IMPLEMENTATION.md).
  - [ ] **T31/3 — credencial inicial no servidor:** provar exigência de troca e bloqueio das sessões anteriores, falhas parciais/recuperação/MFA, sem ampliar RPCs da recepção. [Critérios de aceite](../../docs/product/clinic-crm/INITIAL_PASSWORD_CONTRACT.md) com integração dos documentos/validação pública revisada; ainda sem implementação/migration de produção.
    - [x] **T31/3a — Auth/Data API descartáveis reais:** 18 grupos em Auth v2.197.0/v2.189.0 e dois diagnósticos de limpeza. Recifragem de hash no login e login temporário em andamento refutaram as guardas candidatas, inclusive `session.created_at >= cutoff`. SQL só em protótipo rejeitado. [Provas](../../docs/reviews/2026-11-04/initial-password-auth/IMPLEMENTATION.md).
    - [ ] **T31/3b — vínculo confiável credencial/sessão:** escolher e provar mecanismo que resista aos contraexemplos antes da integração em RLS/RPC/storage/Edge e frontend. Incluir duas trocas concorrentes, resposta perdida, MFA/recuperação e contas existentes. Estado global/JWT/data de sessão isolados não bastam; nenhuma liberação pelo cliente ou inferência de rotação anterior.
      - [x] **T31/3b/1 — candidato nativo ensaiado:** 24 grupos em duas versões, com autoridade privada, hook, revogação total, OTP/TOTP, duas trocas concorrentes, recifragem tardia, refresh e resposta descartada. 18 regressões dos contraexemplos preservadas. [Limites](../../docs/reviews/2026-11-04/credential-session-binding/IMPLEMENTATION.md): PKCE anterior à troca, manutenção de criptografia, revisão adicional interrompida e integração continuam pendentes; não promover o protótipo para produção.
      - [ ] **T31/3b/2 — comparar link de uso único:** conta sem senha temporária, `generateLink` local sem envio, dois consumos concorrentes, finalização no servidor serializada, resposta perdida e JWT anterior negado por sessão viva/pendência. Escolher protocolo após essa comparação; componentes do app e migration de produção vêm depois.
        - [x] **T31/3b/2a — comportamento nativo:** nove grupos por versão Auth v2.197.0/v2.189.0; duas verificações concorrentes do mesmo link geram duas sessões, todas bloqueadas pela pendência privada. Admin password write revoga sessões/link ainda não consumido; JWTs revogados ainda válidos são negados mesmo após controle positivo. [Prova e limites](../../docs/reviews/2026-11-04/single-use-setup/IMPLEMENTATION.md). Conclusão é somente fixture do dono; CAS/resposta perdida/verify em andamento/MFA/PKCE e integração permanecem pendentes.
- [ ] **T32 — L6/L8/L9/L10: integridade do legado, retenção/privacidade e consulta limitada.**
  - Cancelar legado com intervalo inválido sem permitir nova reserva inválida; definir retenção mínima/idempotência e atendimento de dados da recepção em T24; medir e limitar leitura por médicos autorizados. L7 mantém a regra de órfãos por privacidade, com orientação operacional. L1 está coberto por T05b/2.
- [ ] **T33 — evitar colisão global da barreira de custódia.** Prioridade antes de ampliar o piloto; achado do Claude de 04/11 06:11 confirmado por leitura.
  - Reproduzir em duas conexões a recusa entre contas independentes; provar particionamento por contas referenciadas, incluindo autores/destinatários, fontes indiretas e identidade anterior. Preservar snapshots antigos, intenção monotônica, cascatas e todas as corridas de exclusão. Coordenar assinatura de `touch_custody_epoch` com Claude para `document_snippet_writer`; não editar o domínio dele. Reservar migration somente após prova do mecanismo. Sem retry silencioso de efeitos externos.
