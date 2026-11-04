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
