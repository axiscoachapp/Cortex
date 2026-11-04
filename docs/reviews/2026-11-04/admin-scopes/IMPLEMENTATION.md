# T28/1 — Administração separada de agenda e carteira médica

04/11/2026, Codex. Migration reservada `20261104003000_reception_admin_scopes.sql`. Incremento local do H1; **T28/M2/L5 continua aberta**, sem publicação.

## Correção

O papel admin deixa de autorizar automaticamente operações de outro médico. Busca de pacientes, agenda individual/agregada, vínculo, caso, reserva e cancelamento passam pelo mesmo escopo; o administrador mantém sua própria agenda como médico. Recepção dedicada conserva suas delegações explícitas. Nenhum grant clínico foi criado e nenhuma identidade médica foi convertida em secretária.

O novo `reception_team_doctors` fornece apenas ID/nome/especialidade dos profissionais ativos para a gestão da equipe, com clínica, sessão/MFA e conta disponíveis. A lista operacional de `clinic_access.doctors` continua no DTO anterior e contém somente agendas autorizadas. O diretório administrativo não vira autorização de agenda. Há limite de 200 profissionais, sem truncamento silencioso.

TeamSettings usa o diretório separado, com chave de cache por clínica/ator. Falha ou recusa no refetch oculta escolhas antigas e bloqueia criação/salvamento/reativação de escopos; o rascunho permanece e a desativação continua disponível. A atualização pode ser repetida por ação humana. A retificação administrativa mínima de vínculos mantém seu contrato independente.

## Provas

- Antes da correção, teste SQL reproduziu **oito violações**: busca, calendário, vínculo, caso, reserva, cancelamento e exposição por calendário/lista agregada.
- `npm run test:db`: **55 migrations/33 suítes SQL**, concorrência anterior, oito ordens de exclusão e ensaio de modelos S3/R1 aprovados. Admin sem delegação recusa B; médico próprio e recepção delegada funcionam; gestão continua configurando a equipe para B. Diretório recusa não-admin, clínica externa, service/anon, inativo, MFA incompleto e conta em exclusão; AAL2 válido funciona.
- `npx vitest run src/features/reception`: **43 testes/9 arquivos** aprovados, incluindo oito novos de diretório, limite/DTO e falha/cache/retry de gestão.
- Tipos regenerados em PostgreSQL descartável. Typecheck/build aprovados com variáveis sintéticas locais; o primeiro build recusou corretamente a ausência de configuração. Nenhum `.env` real ou validação foi alterado. Lint sem erros/oito avisos preexistentes.
- Roteiro real em Edge/Chromium isolado: **19 verificações**, marca Haddad Nicola/150%, 390/768/1280/1920 px. Gestão inclui B enquanto o seletor real de agenda mostra A e exclui B; falha/retry preserva rascunho e seleção; criação, delegação, desativação, agendamento humano e correção administrativa continuam funcionando. Sem requisições clínicas da recepção, chamadas externas ou erros de console. [Registro](browser/verification.json).

As fixtures antigas que operavam como admin em agenda alheia passaram a usar assignee com escopos explícitos. O cenário de roteamento que libera atribuição foi preservado por intake sem médico → agenda própria do admin, com assignee sem esse escopo; revogação e desligamento continuam testados. A confirmação histórica de vínculo estrangeiro usa seed confiável, mantendo a prova do editor mínimo sem fingir que sua criação pelo admin ainda seria permitida.

Na custódia, o controle positivo de leitura passou a ser do próprio médico. A recusa posterior prova a conta do ator selada; a gestão por ator saudável ainda prova a recusa de delegar o médico selado. Não a apresentar como prova independente de leitura delegada contra marcador, pois a própria delegação impede criar a intenção de exclusão. As corridas de paciente e referências diretas/indiretas continuam independentes.

## Revisão

Revisão local isolada não encontrou novo vazamento no SQL/API/UI. Encontrou uma asserção negativa de navegador que poderia passar sem localizar o seletor; ela foi corrigida para exigir o seletor correto e a presença de A antes de verificar ausência de B, e o ensaio foi repetido. Os ajustes finais de fixtures preservam roteamento, revogação e offboarding. Revisão externa dispensada conforme preferência do usuário.

Inspeção visual também identificou uma ação longa cortada em celular a 150%. A nova asserção de caixa reproduziu `Team create action overflow at 390`; a correção de quebra de linha passou no roteiro completo de 19 verificações e na inspeção da captura final.

## Pendências separadas

- **M2/D18:** definir com usuário/clínica se a recepção pode receber somente dados da Haddad Nicola ou toda carteira/agenda particular autorizada pelo médico. Pergunta assíncrona e mensagem de decisão registradas; sem inferência ou mudança dependente da resposta.
- **L5:** revogar escopos no desligamento/reingresso, independente de D18, é o próximo incremento seguro.
- **S3:** R1 conferido e ensaio integrado. Revisão do seletor apontou R2: aplicar modelo retira medicamentos selecionados sem confirmação explícita. Correção encaminhada ao Claude; não foi alterado seu domínio.

Não declarar toda a governança/delegação concluída: não há nova delegação de admin, anuência do médico nem recorte de prática particular nesta etapa. Somente dados sintéticos; sem banco hospedado, migração PersonalMed, emissão, API paga, push ou deploy.
