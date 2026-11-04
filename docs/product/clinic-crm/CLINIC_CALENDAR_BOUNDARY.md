# T28/2b/1 — limite da agenda administrativa da clínica

04/11/2026. D18: os médicos trabalham somente na Haddad Nicola. Este incremento restringe a agenda da recepção à origem administrativa explícita; não implementa ainda a anuência por médico de T28/2b/2 nem altera o modelo de pacientes em esclarecimento na D20.

## Regra

Uma secretária delegada só recebe detalhes e opera compromissos cujo `appointments.clinic_id` é a clínica solicitada. `clinic_id=NULL` é origem ainda não atribuída, mesmo quando o médico é membro da clínica, o paciente está vinculado a um contato da clínica ou já existe outro compromisso dele nessa clínica. Não deduzir origem pela filiação do médico, telefone, paciente, horário ou auditoria antiga; não preencher valores automaticamente.

O médico mantém acesso à própria agenda sem clínica definida. Isso não é uma delegação à recepção ou a outro administrador. Nas RPCs administrativas, a exceção para `NULL` exige simultaneamente sessão clínica autorizada para a própria agenda e `auth.uid()=appointments.user_id`; o papel admin sozinho não basta. Leitores e escritores diretos do médico continuam seguindo suas políticas atuais.

`reception_appointments` mantém seu DTO e limites: exclui compromissos sem clínica para terceiros, inclusive da consulta agregada e do limite de itens. Não projeta esses registros como blocos, nem revela paciente, ID, título, notas ou horários. Não altera a projeção dos bloqueios explicitamente cadastrados na clínica. Paciente/contactId de um compromisso autorizado não autoriza mostrar outros compromissos.

`reception_change_appointment` aplica a mesma fronteira antes e depois de adquirir a linha. ID inexistente, outra clínica e origem não atribuída para terceiros recebem a mesma recusa `42501 / Agendamento indisponível`, inclusive para confirmar, chegada, desfazer chegada, cancelar e remarcar. Não muda revisão, lembrete, vínculo, autoria ou auditoria em recusa. Mantém MFA, escopo ativo, CAS e ordem de locks já corrigidos em T29. Assinaturas e acesso de `authenticated` preservados; execução por `anon`/`service_role` explicitamente negada.

## Disponibilidade e histórico

Compromissos ocultos continuam ocupando o horário nas regras de conflito existentes. A recepção pode receber a recusa genérica de conflito ao tentar um horário aparentemente livre; essa resposta não inclui identificação ou conteúdo do compromisso oculto. Não permitir encaixe automático ou atribuição de origem para resolver esse caso. A clínica precisará atribuir a origem do legado por procedimento separado, antes de exibir esses registros à recepção.

Auditoria administrativa antiga não atribui uma clínica ao compromisso. O médico ainda pode manter seus próprios compromissos antigos e o sistema preserva as restrições existentes de custódia/histórico. Não apagar ou reescrever dados para ajustar a agenda à nova consulta.

## Aceite

- Reproduzir, antes da correção, recepção delegada recebendo e alterando compromisso `NULL` de médico ativo, mesmo com paciente ligado ao contato da clínica.
- Após a correção, o mesmo ator lê/opera compromisso explicitamente da clínica, sem ver ou operar o `NULL` no filtro por médico ou agregado. Todas as ações negadas usam a recusa dedicada e não produzem efeitos.
- ID de outra clínica e inexistente não revelam a origem pela mensagem. Admin sem delegação não ganha acesso; médico continua vendo e alterando seu próprio compromisso `NULL`, sem autorizar recepção.
- Bloqueios da clínica e conflitos com horários ocultos continuam ativos; DTO estrito e RLS clínica da recepção preservados. Consulta de outra clínica, MFA incompleto, service role, revogação, CAS e corridas reais de edição/conclusão continuam cobertos.
- Sem mudanças de paciente/compartilhamento, schema de importação, carga, banco hospedado ou envios. M2 só encerra depois da anuência médica e da integração correspondente.
