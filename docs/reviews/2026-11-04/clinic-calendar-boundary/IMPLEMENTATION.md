# T28/2b/1 — origem explícita na agenda da recepção

04/11/2026. Correção local da parte de agenda do achado M2. Migration `20261104210000_reception_clinic_calendar.sql`, reservada no ESTADO antes da criação. Nenhuma aplicação em banco hospedado, carga ou alteração do modelo de pacientes.

## Comportamento

A recepção delegada só recebe e altera compromissos explicitamente atribuídos à clínica solicitada. Compromisso com `clinic_id=NULL` permanece fora da leitura por médico e agregada, mesmo com paciente ligado ao contato da clínica, outra reserva desse paciente ou evento administrativo antigo/novo. Nenhum valor é preenchido por inferência.

Todas as cinco ações administrativas recusam origem não atribuída, outra clínica ou ID inexistente com `42501 / Agendamento indisponível`. A fronteira é conferida antes e depois de adquirir a linha. Recusa não muda revisão, status, chegada, horário ou auditoria. O próprio médico mantém leitura e manutenção de sua agenda `NULL`, mediante seu escopo/sessão autorizados; esse acesso não é delegado nem concedido pelo papel admin.

Horários ocultos continuam bloqueando reservas conflitantes. Eles não são projetados como bloqueios ou identificados na resposta da agenda. A recusa de conflito continua genérica; a equipe pode precisar conferir um horário aparentemente livre até existir atribuição explícita da origem do legado. Bloqueios cadastrados na clínica permanecem visíveis e ativos. DTO, assinaturas e acesso de `authenticated` preservados; execução anônima/service role explicitamente negada.

## Provas e verificação

Comando reproduzível: `node scripts/test-reception-clinic-boundary.mjs`. Relatório agregado em `verification.json`.

- RED reproduzido na base imediatamente anterior à migration: secretária delegada recebe o compromisso sem clínica definida. O harness exige a asserção específica de divulgação, não aceita qualquer falha.
- GREEN: mesma pessoa lê/opera a reserva explícita da clínica, sem acesso à reserva `NULL` por filtro ou agregado. Controles positivos de nome mínimo, bloqueio da clínica, DTO estrito e RLS clínica preservados.
- As cinco ações são testadas contra ID `NULL`, inexistente, compromisso sem clínica do médico delegado, compromisso de outro médico e compromisso explicitamente de outra clínica. As recusas usam a mensagem dedicada e preservam os dados/auditoria.
- Vínculo com contato, agendamento do mesmo paciente e auditoria anterior/posterior não atribuem origem. Médico mantém leitura direta e pelas RPCs e confirma o próprio compromisso antigo; secretária continua sem acesso depois dessa confirmação.
- Tentativa de reserva humana sobre o horário oculto ainda recebe conflito; não deixa uma reserva adicional.
- **59 migrations e 37 suítes SQL aprovadas**, incluindo os controles anteriores de admin, MFA, service role, escopo/revogação, agenda e custódia. O novo `.test.sql` também entra automaticamente no runner SQL do CI.
- Sete falhas injetadas de fronteira de funções e rollback, corridas de fila/reserva/vínculo/contato, dez ordens de alteração/conclusão de agenda, 20 interleavings de escopo/reingresso e duas corridas de modelos aprovados.
- `node --check`, eslint direcionado e `git diff --check` aprovados. Nenhum componente, tipo de aplicativo ou função Edge alterado; frontend/build não foram reexecutados por este incremento SQL.

O primeiro GREEN identificou um erro de precedência na asserção de DTO (`integer - text[]`), corrigido com parênteses antes da execução final completa. Essa falha de teste não foi usada como evidência de segurança. Dois contextos independentes revisaram contrato e implementação/testes sem achado acionável; não executaram os testes nem autorizaram deploy. Revisão externa dispensada pelo usuário.

O harness aceita zero argumentos, recusa alvo Docker herdado, verifica/pina pipe/socket local, usa imagem em cache e cria container/rede interna próprios sem portas publicadas. Só carrega bootstrap, migrations e fixtures sintéticas. Limpeza verifica propriedade por labels antes de remover recursos e precede a emissão do relatório. Não lê `.env`, staging ou bases existentes.

## Limites e próxima fatia

M2/T28 ainda não está concluída: **T28/2b/2 precisa da anuência por médico para delegações**, de guardas de revogação/concorrência e da interface correspondente. A busca mínima de pacientes segue a política existente até essa fatia; este incremento não amplia seu alcance. D20 ainda esclarece o modelo de pacientes/compartilhamento, e o procedimento de atribuição da origem do legado é separado. Nenhum prontuário foi compartilhado, paciente fundido ou campo legal movido.
