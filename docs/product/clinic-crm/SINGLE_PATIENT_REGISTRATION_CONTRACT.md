# D20/D14 — cadastro único da clínica e prontuários privados por médico

04/11/2026. Decisões do usuário recebidas na mensagem do Claude de 08:52: cadastro único, notas por médico e agendamento sem criar ficha vazia. **Proposta de contrato técnico para revisão cruzada; não é schema/API implementado.** Nenhum campo legal é movido, paciente fundido ou carregador criado por este documento.

## 1. Identidades e fonte canônica

| Entidade lógica | Identidade e responsabilidade |
|---|---|
| Cadastro da pessoa na clínica | Novo ID opaco, restrito a `clinic_id`; nome, nascimento, sexo cadastral, CPF, endereço, canais pessoais, convênio e alertas da pessoa. Uma fonte canônica por clínica, revisão/CAS e proveniência de correção. Não pertence à conta que o cadastrou |
| Prontuário privado | `patients.id` atual permanece sendo a identidade clínica, com `patients.user_id` imutável. Consultas, anamnese, histórico, diagnósticos, alergias, medicações, prescrições, arquivos, chats e rascunhos permanecem do médico |
| Relação de cuidado | Liga cadastro da pessoa ao médico naquela clínica. Registra origem/autorização, estado e revisão; não concede acesso a prontuários de outros médicos |
| Vínculo do prontuário ao cadastro | Um prontuário pode apontar para um único cadastro verificado, sem mudar seu ID/dono ou suas referências clínicas. Clínica/cadastro do vínculo são imutáveis após sua criação. No recorte inicial, no máximo um prontuário por cadastro/médico; ambiguidade bloqueia o vínculo, sem fusão automática |
| Contato administrativo | `clinic_contacts` continua representando quem procura a clínica, inclusive responsável/família. Não é a pessoa paciente nem a fonte única de seus campos legais |
| Compartilhamento clínico | `patient_shares` continua referindo-se ao prontuário privado específico e suas permissões. Ler o cadastro ou ser médico da pessoa não equivale a receber esse compartilhamento |

Nomes físicos sugeridos para o novo cadastro/relação: `clinic_patient_registrations` e `clinic_patient_doctors`; revisar DDL e invariantes antes de reservar migrations. O vínculo ao prontuário pode ser referência composta adicional em `patients`, sem renomear sua chave pública. ID de cadastro e ID de prontuário nunca são intercambiáveis em parâmetros chamados `patientId`.

Não transformar automaticamente contatos em pacientes: um responsável pode representar vários cadastros e vários canais podem chegar à mesma pessoa. A relação contato–cadastro é explícita, com papel e confirmação próprios. `patient_contact_links` existente continua referindo-se ao prontuário; a relação nova não substitui seus IDs nem amplia sua confirmação por inferência.

Não desvincular/reapontar prontuário já ligado, mesmo mantendo seu ID ou mudando somente uma FK. Retificação comum do cadastro conserva a identidade da pessoa e não transfere material clínico. Suspeita de vínculo incorreto suspende seu uso para novas projeções/documentos; o médico mantém seus registros/snapshots históricos privados e o sistema não os apresenta sob outra pessoa. Um reparo excepcional exige contrato próprio, evidência, revisão humana e auditoria, preservando beneficiário de agenda, autoria e documentos emitidos. Não existe autorização de remapeamento, fusão ou redistribuição de notas neste contrato.

CPF válido, nome/nascimento ou telefone coincidentes geram candidatos de conferência; não são chave de fusão. Não criar unicidade global por CPF. A mesma pessoa em clínicas distintas não compartilha cadastro ou dados automaticamente. Na importação, `(sistema, instância, PCod)` é a identidade de origem da pessoa; `(sistema, instância, PCod, UserNumber)` continua distinguindo a origem clínica por médico. O mapa de contas da D2 é obrigatório para atribuir material clínico.

## 2. Autorização e projeções

| Ator | Cadastro | Dados clínicos |
|---|---|---|
| Médico com relação de cuidado ativa, membro ativo da clínica | Projeção cadastral e alertas autorizados da pessoa; leitura/retificação auditadas e sujeitas à revisão | Próprio prontuário, mais compartilhamentos clínicos explícitos válidos |
| Médico designado por agendamento humano ativo, ainda sem prontuário | Cadastro mínimo necessário para preparar/atender, sem criar prontuário ou consultar notas de outros | Nenhum prontuário alheio; cria o próprio somente ao iniciar atendimento explicitamente |
| Recepção ativa com delegação aprovada para médico relacionado à pessoa | Projeção administrativa da clínica e campos necessários à tarefa; não recebe lista de outros médicos fora do seu escopo | Nenhum campo clínico ou conteúdo de consulta |
| Operador com capacidade explícita de identificação/intake na clínica | Busca mínima para confirmar pessoa e preparar uma primeira associação, conforme o fluxo abaixo; não abre cadastro completo ou afiliações por conhecer o ID | Nenhum conteúdo clínico ou acesso implícito à agenda de outro médico |
| Administrador clínico | Gestão da equipe/intake e as capacidades próprias explicitamente autorizadas; papel admin não abre a carteira de outros médicos | Nenhum acesso implícito por papel admin |
| Receptor de compartilhamento clínico | Dados já incluídos no compartilhamento/snapshot autorizado; isso não abre o cadastro canônico inteiro | Apenas o prontuário/escopo explicitamente compartilhado |
| Outra clínica, membro inativo, recepção sem escopo ou sessão insuficiente | Negado | Negado |

Uma marcação humana confirmada para um médico ativo pode autorizar acesso cadastral para aquele atendimento, com proveniência de agenda; não cria relação clínica com notas já existentes. Cancelamento/revogação encerra esse fundamento de acesso se não houver outra relação de cuidado válida. Um atendimento efetivamente iniciado mantém a relação de cuidado conforme seu ciclo auditado. Saída da clínica revoga a leitura do cadastro compartilhado; preserva registros/snapshots anteriores sujeitos às regras de custódia, sem entregar dados de outros médicos.

**Primeira associação a outro médico:** uma pessoa ligada somente a A pode solicitar consulta com B sem ter seus dados duplicados ou as notas de A abertas. Um operador com capacidade de **identificação/intake**, concedida explicitamente e armazenada no servidor para aquela clínica, pode buscar uma projeção limitada de identificação (`registrationId`, nome, nascimento e identificador parcialmente mascarado quando necessário). Busca limitada/paginada e confirmação humana da pessoa/interlocutor; ambiguidades não são unidas automaticamente. Não retornar o nome de A, sua relação de cuidado, agenda, CPF completo ou conteúdo clínico nessa busca.

Para confirmar a reserva/associação com B, o servidor exige a capacidade de intake, a própria conta ativa/sessão suficiente, escopo aprovado para a agenda de B (ou B atuando por si com aquela capacidade) e confirmação humana do beneficiário. A transação estabelece somente a origem administrativa/relação de agenda autorizada com B; não cria chart nem `patient_shares`. Apenas depois desse fundamento válido se aplica a projeção cadastral normal da tarefa. Consulta sem horário segue a mesma ação explícita de intake. Conhecer um ID, preencher uma declaração no body ou já ter um compartilhamento clínico não concede essas capacidades. O papel admin não recebe leitura ou autoassociação por si; concessão/revogação da capacidade de intake é ação administrativa separada, auditada, não parâmetro de bypass da RPC.

Recepção com capacidade de intake pode cadastrar uma pessoa, com ator e proveniência, depois da conferência de duplicatas candidatas. Fora da projeção mínima de identificação acima, cadastro compartilhado já ligado a médicos exige interseção entre suas relações autorizadas e a delegação da atendente. Pesquisa, detalhes, correção e sugestões de encaminhamento não podem expor afiliação ou agenda de médicos fora dessa interseção. A concessão de identificação/intake continua separada da anuência médica de T28/2b/2. O DTO de administração não usa `SELECT *` nem inclui prontuários, indicadores clínicos, resumos de IA ou contagens de consultas de outros médicos.

Retificação de campos canônicos exige capacidade administrativa específica/autoridade clínica adequada, revisão esperada e auditoria mínima; conhecer um ID não basta. O autor de cadastro não vira dono exclusivo. Falha/refetch não troca a fonte silenciosamente nem aceita escrita a partir de snapshot de outra conta. A matriz acima é contrato alvo: ainda não existe autorização de cadastro único implementada.

## 3. Agendamento e início de consulta sem ficha vazia

1. A reserva referencia cadastro da pessoa, médico, clínica, contato/beneficiário confirmado e confirmação humana. Pode existir sem `patients.id` para esse médico; não copiar a ficha de outro médico nem criar placeholder.
2. A identidade do beneficiário e a origem da clínica permanecem imutáveis depois da reserva, conforme T05b. `clinic_id=NULL` antigo não é atribuído pela filiação do médico, cadastro relacionado ou auditoria; T28/2b/1 continua valendo.
3. Abrir cadastro ou agenda é leitura: não inicia consulta, muda status, cria rascunho clínico ou consome IA automaticamente.
4. Ao **iniciar atendimento** explicitamente, o médico autenticado cria ou obtém idempotentemente seu prontuário vinculado ao cadastro. Validar relação de cuidado/agenda, origem, dono e revisão no servidor. Duas abas/disputas não criam prontuários duplicados nem reusam ficha de outro médico.
5. Consulta/rascunho fica ligado ao prontuário do médico e ao compromisso por um vínculo clínico explícito. A reserva original pode manter `patient_id=NULL`; não reescrever o beneficiário histórico para encaixar a ficha criada depois.

**Compatibilidade que precisa de prova:** hoje `consultations` e `consultation_drafts` usam FK `(user_id,patient_id,appointment_id)` para `appointments`. Ela não aceita a consulta nova quando a reserva tem `patient_id=NULL`. O contrato requer uma relação imutável de atendimento–agenda (sugestão: `appointment_clinical_links`) que valide médico + cadastro + prontuário, e preserve o controle equivalente dessa FK. Consultas/rascunhos passam a referenciá-la; registros existentes só entram nessa relação pela ligação exata já validada, nunca por nome/horário. Não remover a FK e confiar apenas na UI, não afrouxar a posse e não alterar IDs históricos. Desenho/instalação/reversão desse vínculo são uma fatia própria antes da agenda nova.

Mesma pessoa, médico e dia identificam candidatos de ligação no legado, não a identidade autoritativa de um compromisso. Sem chave de origem que comprove a relação ou conferência humana registrada, não criar `appointment_clinical_links`, mesmo havendo um único candidato naquele dia. Preservar consultas/agenda separadamente e a ambiguidade no staging, sem escolher por ordem ou horário. `personSourceRecordId` pode ligar a identidade da pessoa sem afirmar qual compromisso originou uma consulta.

## 4. Campos canônicos, documentos e alertas

Para prontuários vinculados, os campos cadastrais vivos vêm do cadastro canônico por projeção autorizada; dados clínicos continuam vindo do prontuário. Nascimento é data civil; idade é calculada na data de referência, sem tratar ausente como zero. Idade legada sem nascimento não inventa uma data. Campos opcionais/ambíguos mantêm proveniência e estado de conferência, sem substituir automaticamente valor já revisado.

Os valores legais que já existem em `patients` permanecem preservados até o corte e a conferência. Na transição, não são uma segunda fonte editável para prontuários vinculados: leitores/writers legados precisam de adaptação explícita e recusa de alterações incompatíveis. Novos prontuários vinculados não recebem cópias editáveis de CPF/endereço/convênio. Como `patients.name` é obrigatório e tem validação própria hoje, a migração deverá permitir metadados cadastrais derivados do cadastro vinculado, mantendo a validação dos prontuários antigos não vinculados. Não usar nomes fictícios de placeholder nem fazer sincronização bidirecional de campos.

Prescrição, atestado ou outro documento congela somente a projeção cadastral autorizada, a revisão do cadastro, o prontuário/médico e a revisão do conteúdo no snapshot da emissão. Prévia e geração precisam conferir essa revisão: mudança de cadastro após a prévia exige nova revisão humana, sem troca silenciosa de destinatário/endereço. Documento histórico assinado/emitido não é reescrito quando o cadastro muda. Claude valida os campos mínimos e o encaixe com compositor/assinatura; este contrato não habilita emissão fiscal, assinatura ou controlados.

Alinhamento proposto pelo Claude em 10:08: a emissão recebe `registrationId`/`registrationRevision` da tela, mas resolve primeiro o vínculo e a autorização no servidor. Cadastro vinculado sem parâmetros, ID divergente ou revisão alterada não pode cair no fallback legado; revisão alterada retorna `409` antes de produzir o documento. A projeção é capturada uma vez para conteúdo/snapshot/hash, com revalidação de vínculo/autoridade antes da persistência/assinatura. Releituras posteriores não podem trocar silenciosamente os dados já conferidos. No fluxo não vinculado, `patients.revision` também precisa do contrato de conferência; o comportamento atual, sem essa CAS, não é prova de prévia protegida.

Antes do corte, endereço digitado no compositor permanece exclusivo do documento. No cadastro único, endereço canônico revisado é somente leitura nesse fluxo e aponta para retificação. Quando não existe endereço no cadastro, entrada local exige confirmação humana e `addressSource: 'documento'`; não escreve de volta. Snapshot distingue referência/revisão e valor canônico do endereço efetivamente impresso. Endereço manual não pode aparecer como se estivesse naquela revisão do cadastro. Nenhuma sincronização bidirecional é autorizada.

Alerta de origem é armazenado **uma vez** no cadastro, com origem, revisão e classificação/audiência. Não duplicá-lo por médico. Médicos com acesso cadastral válido recebem a audiência clínica aprovada pela D20; a recepção recebe somente alertas administrativos confirmados. Conteúdo clínico, misto ou sem classificação não vai à projeção administrativa. Uma trava operacional, como impedir um lembrete, não precisa expor a justificativa clínica. D7/classificação humana, estado de revisão e validação de óbito continuam separados; nada dispara mensagens ou resolve elegibilidade por texto legado. História, diagnósticos e alergias de um médico não viram alertas compartilhados automaticamente.

Carteirinhas são registros da pessoa com origem e revisão; `primary` do staging é proposta de origem, não escolha automática de cobertura, cobrança ou elegibilidade. Titular de outra pessoa não funde identidade de paciente/contato nem recebe acesso ao cadastro. Fonte/destino de endereço e outros campos legais ficam definidos neste corte antes de qualquer carga; contato de responsável não sobrescreve endereço/CPF da pessoa.

## 5. Custódia, exclusão, exportação e concorrência

Cadastro da clínica e prontuário individual têm ciclos distintos. Exclusão/saída de conta não pode apagar cadastro necessário a outro médico nem transferir a propriedade das notas. A exclusão deve recusar antes de Storage/provedor/Auth quando houver referências/custódia não resolvidas. Sem escolher retenção, executor ou transferência por inferência; T24 e procedimentos da clínica continuam condicionando a operação.

Exportação exige revalidação de ator, escopo e sessão. Inclui o cadastro autorizado necessário e material clínico próprio/explicitamente compartilhado, sem consultas, arquivos ou metadados de outros médicos pelo fato de a pessoa ser a mesma. Documentos congelados preservam sua identidade/revisão histórica. Recepção continua com projeção administrativa mínima; sua operação de dados pessoais tem contrato separado em T24.

Estender o inventário de custódia de T33 para cadastro, relação de cuidado, vínculo de contato, prontuário e atendimento–agenda, incluindo referências anteriores e novas, INSERT/UPDATE/DELETE e mudanças de autorização. O recurso compartilhado tem sua própria versão; não recriar um singleton global nem tocar indiscriminadamente todas as contas da clínica. Provar em transações reais revogação/exclusão/retificação contra leitura autorizativa e escrita, inclusive snapshot antigo, referência ainda ausente e duas identidades candidatas. Serviços/Edge com service role verificam ator/escopo e projeção no servidor; RLS do navegador sozinha não basta.

## 6. Corte e limites da migração

- D2 continua exigindo contas Cortex e autoria do login compartilhado. Ficha de autoria indefinida não recebe dono genérico nem se distribui a vários médicos por suposição.
- A execução é adiada para exportação atualizada. D1/D3/D12 aprovam o escopo do lote/coorte; não autorizam carga real nesta rodada ou fusão de existentes por CPF/telefone.
- Staging `person` → cadastro, `chart` → prontuário do médico, `contact` → interlocutor, com mapas separados e idempotência por sistema/instância/entidade/chave. `appointment` sem ficha referencia cadastro+médico, sem gerar chart. Campos legais atualmente copiados em `chart` não são a fonte final para sobrescrever o cadastro revisado.
- Registros Cortex existentes só recebem vínculo verificado por procedimento auditado. Sem candidatos confiáveis, ficam não vinculados com comportamento atual; não se perde acesso ao próprio registro. Divergência entre várias fichas de origem não se resolve por ordem de importação ou por “último médico”.
- Nenhuma alteração nos arquivos do Claude. Ajustar contrato/transformações de staging e documentos por acordo explícito após esta revisão. S1/S2/carregador precisam de escopo/contrato correspondente, migrations reservadas e testes antes de implementação; não fazer carga real.

## 7. Incrementos e critérios de aceite

1. Revisar este contrato com Claude para fonte cadastral, snapshot de documentos, alertas e origens de agenda. Decisões de negócio D20/D14 já recebidas; não perguntar novamente.
2. Provar identidade/custódia e autorização do cadastro em banco descartável, com duas pessoas/clínicas/médicos e contato familiar. Reservar migrations somente para a fatia escolhida. Backend e projeções precedem mudança de telas.
3. Adaptar leitores/writers de campos canônicos, documentos e APIs com versão/revisão; rejeitar dupla escrita. Troca de conta, revogação e erro não reaproveitam DTO/cache do médico anterior.
4. Implementar agenda sem ficha e início explícito/idempotente, com vínculo clínico compatível com FKs e histórico; só depois adaptar a UI/fluxo e o carregador autorizado.
5. Ensaio sintético e upgrade antes de qualquer corte: mesma pessoa com dois médicos e notas privadas; primeiro agendamento com B quando só havia relação com A; ausência/revogação da capacidade de intake; cadastro sem chart; dois cliques de início; contato familiar; agenda sem ficha; tentativa de reapontar vínculo após atendimento; cadastro corrigido depois da prévia; médico que sai; registro `NULL`; duplicata candidata não fundida; exclusão parcial e rollback. Matriz positiva/negativa obrigatória em RPC/RLS/Edge, sem vazamento de consultas ou conteúdo clínico à recepção.

Nenhum desses testes foi executado por este documento. O estado atual continua com prontuários privados por médico e compartilhamento seletivo; o contrato é a entrada da T34, não uma migração concluída.
