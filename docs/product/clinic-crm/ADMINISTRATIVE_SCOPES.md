# T28/1 — Gestão da equipe separada de acesso às agendas

04/11/2026. Incremento da correção H1, seguindo a matriz de `PRODUCT_SPEC.md`. Não encerra M2/L5 nem define autorização para expor toda a prática particular de um médico.

## Contrato

O papel `admin` autoriza gestão da equipe/contatos e fila ainda sem médico, mas não autoriza agenda, busca de pacientes, vínculo, criação/remarcação/cancelamento de outro médico. Um administrador que também é médico mantém sua própria agenda. As delegações atuais de contas dedicadas da recepção continuam limitadas a `staff_doctor_scopes` e a vínculos ativos.

Não criar delegação implícita, compartilhamento clínico ou uma identidade dupla médico/secretária para conservar o acesso antigo. A futura delegação de administrador precisa de contrato próprio de anuência/escopo; até lá ele opera apenas a própria agenda como médico. O tratamento da prática particular, da anuência médica e dos escopos que reaparecem no reingresso continua em T28/2.

## Superfícies

- `clinic_access.doctors` continua com o mesmo DTO estrito e passa a representar somente agendas autorizadas ao ator. Esse array não pode alimentar a lista de profissionais da gestão.
- Novo `reception_team_doctors(p_clinic)` retorna apenas `{id, name, specialty}` de membros ativos para um administrador ativo daquela clínica, com sessão humana/MFA e conta disponível. Sem nomes de pacientes, aniversários, agenda, histórico ou credenciais. Leitura limitada a 200 profissionais; excedente exige paginação futura, sem truncamento silencioso.
- Somente a tela de equipe usa esse diretório. Preservar configuração de secretárias para todos os médicos da clínica não concede ao gestor acesso às respectivas agendas.
- Se o diretório não carregar, preservar o rascunho e impedir salvar/criar novos escopos até sucesso. Desativação de acesso continua disponível, pois não exige listar médicos. Não substituir a resposta ausente pela lista parcial de agendas do administrador.
- Retificação administrativa de contato/relação mantém o contrato específico existente e sua projeção mínima; não concede busca irrestrita nem leitura clínica.

## Provas

Reproduzir admin A contra médico membro B, sem delegação: roster, agenda, vínculo, caso, reserva e cancelamento devem recusar; calendário agregado não revela B. Provar acesso médico próprio, gestão de equipe para B, recepção delegada, negativa a diretório por não-admin/externo/service/anon/inativo/MFA incompleto, DTO mínimo e regressões de custódia.

Na UI, a lista da equipe deve conter B mesmo quando `clinic_access.doctors` só contém A. Verificar carregamento, falha/retry e desativação durante falha, sem perda silenciosa de escopos. Usar apenas fixtures sintéticas e navegador isolado a 150%.

## T28/2a — Saída e reingresso (L5)

Qualquer mudança de status do médico para um valor diferente de `active` deve remover suas delegações de recepção naquela clínica, inclusive quando feita por `leave_clinic`, offboarding administrativo ou escritor privilegiado. Reconvite, recusa e aceite não restauram os escopos antigos. Uma delegação nova e explícita, pelas capacidades já existentes, continua possível depois do aceite; o consentimento/recorte mais amplo de M2 continua dependendo de D18.

A remoção preserva pacientes, vínculos, reservas, casos encerrados, notas e autoria. O mecanismo atual devolve trabalho aberto do médico inativo à entrada e libera atribuições sem escopo. Registrar a revogação com identificador do médico e quantidade de escopos, sem nomes ou conteúdo pessoal.

Não permitir inserir/atualizar um escopo para médico inativo ou convidado, mesmo por escritor privilegiado. Saída e concessão concorrentes não podem deixar escopo latente para reingresso, em READ COMMITTED ou REPEATABLE READ; uma das transações pode falhar com `40001` e ser repetida integralmente. A barreira privada existente de custódia deve ordenar as escritas sem introduzir locks bloqueantes adicionais. A validação do escopo precisa ocorrer depois da barreira, com snapshot atual em READ COMMITTED.

A migration remove escopos já associados a membros atualmente não ativos, com o mesmo registro mínimo. Escopos de membros ativos sem proveniência da concessão não podem ser classificados automaticamente como antigos ou novos; revisão de permissões preexistentes permanece no piloto. Não inferir uma autorização médica nem ampliar a política para resolver esse histórico.

Provar com SQL real: saída voluntária e administrativa, reconvite/recusa/aceite, duas secretárias e outra clínica, nova concessão após aceite, negativas de leitura/escrita antes e depois do reingresso, prontuário privado e histórico preservados. Provar corridas em duas conexões nas duas ordens e nos dois níveis de isolamento, incluindo concessão direta privilegiada, não apenas RPCs.

## T28/2b/1 — Origem da agenda da clínica

D18 foi respondida em 04/11 08:17: médicos trabalham somente na Haddad Nicola. Isso não atribui uma clínica aos compromissos antigos. `20261104210000_reception_clinic_calendar.sql` limita leitura e alteração pela recepção ao `clinic_id` explícito, preservando o próprio médico em sua agenda `NULL`. Vínculo de paciente/contato e auditoria não atribuem origem. Horários ocultos continuam sujeitos a conflito, sem identificação na agenda administrativa.

[Contrato e limites](CLINIC_CALENDAR_BOUNDARY.md) e [provas locais](../../reviews/2026-11-04/clinic-calendar-boundary/IMPLEMENTATION.md): RED anterior, 59 migrations/37 SQL e regressões concorrentes aprovados, sem publicação. Anuência por médico continua em T28/2b/2; este incremento não encerra M2, não muda a busca de pacientes nem autoriza atribuição/importação automática do legado. D20/D14 já decididas têm [proposta própria de cadastro único](SINGLE_PATIENT_REGISTRATION_CONTRACT.md), sem alteração do schema atual.

## T28/2b/2a — Inativação da recepção encerra delegações

Inativar uma conta em `clinic_staff_members`, inclusive por escritor privilegiado direto, deve remover suas delegações daquela clínica. Alterar depois apenas `active=true` não restaura escopos. Uma nova concessão explícita pelas capacidades atuais continua possível; isso não comprova a anuência médica ainda pendente em T28/2b/2b.

Não aceitar INSERT/UPDATE de escopo para uma conta de recepção inativa, inclusive por service role. Validar depois da barreira de custódia, como o médico ativo já é validado. A transição de inativação toca o epoch da conta antes de remover escopos, sem locks bloqueantes novos; corrida com concessão ou escrita autorizada deve serializar ou recusar a transação inteira, nunca deixar acesso latente para reativação.

Preservar prontuários, vínculos, compromissos, notas e casos encerrados. A liberação existente devolve trabalho aberto à equipe sem alterar sua identidade clínica. Auditar remoção com ID da atendente e quantidade, sem valores pessoais. Limpeza de instalação só remove escopos de contas objetivamente inativas; não presume consentimento ou revoga em massa as contas ativas.
