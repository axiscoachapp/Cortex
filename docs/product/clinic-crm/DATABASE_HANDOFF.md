# Handoff para Claude: PersonalMed e expansão da clínica

Data: 03/11/2026. Destinatário pretendido: Claude, que está migrando os dados do PersonalMed. Este arquivo foi preparado para o usuário repassar; nenhuma mensagem foi enviada ao outro agente e nenhuma migração foi executada por este planejamento.

## Atualização da fundação da recepção

Implementação local adicionou `20261103001000_reception_access.sql`, `20261103002000_reception_workflow.sql` e `20261103003000_reception_calendar.sql`. Ensaio somente em banco descartável. Contas de secretária ficam em `clinic_staff_members`, delegação em `staff_doctor_scopes`, contatos em `clinic_contacts` e vínculos confirmados em `patient_contact_links`. `clinic_members` continua clínico, e `patients.user_id` não mudou.

O handoff agregado do Claude foi consultado: pessoa de origem `PCod`, prontuário por pessoa/médico e telefones frequentemente sem DDD. Nenhum dado/arquivo de migração foi modificado. Mapas de origem e backfill dos vínculos continuam com Claude, mediante alinhamento do corte. Não inferir relação familiar ou compartilhamento clínico pelo telefone.

A agenda agora valida intervalos e conflitos também nas gravações antigas. Sobreposições do legado podem falhar na importação direta; conservar staging/rejeições e alinhar a estratégia antes do corte, sem deslocar horários ou descartar registros silenciosamente. Contatos legados podem manter `phone` bruto e `phone_normalized=NULL` até confirmação. Entradas novas pela recepção exigem DDD quando brasileiras. A reserva CRM exige sessão humana e vínculo confirmado; não disparar essa operação como efeito de migração.

## Contexto que a migração precisa preservar

O Cortex da Haddad Nicola terá recepção compartilhada, fila de atendimento, WhatsApp, agenda operada por pessoas e faturamento pelo CNPJ da clínica em Curitiba. O banco atual mantém prontuários por `patients.user_id`, com compartilhamento clínico explícito. A recepção precisará de cadastro administrativo e vínculo com agendas, não de acesso irrestrito ao histórico clínico.

O contato que escreve pode ser diferente do paciente atendido. Um telefone pode ser da família; uma pessoa pode consultar vários médicos, cada um com seu prontuário. Portanto, telefone, nome ou CPF coincidente não autorizam fundir registros clínicos automaticamente.

## Perguntas prioritárias

| Prioridade | Pergunta para Claude | Por que importa |
|---|---|---|
| 1 | Qual formato foi extraído e quais tabelas/campos existem? Enviar dicionário e contagens, sem registros identificáveis | Permite mapear o CRM sem presumir estrutura do PersonalMed |
| 1 | Quais são as chaves originais de paciente, médico, consulta e agendamento? São estáveis? | Reprocessar sem duplicar e manter rastreabilidade |
| 1 | O cadastro é único da clínica ou existe uma cópia por médico? Quais vínculos médico–paciente e autores foram recuperados? | Preservar propriedade e continuidade, sem inferir compartilhamento |
| 1 | Como estão telefone, celular, DDD, país, contato de responsável e e-mail? Há famílias com o mesmo número? | Reconhecimento seguro do canal e ambiguidades |
| 1 | Existem agendamentos futuros, bloqueios, retornos ou lista de espera? Qual foi a data de corte? | Evitar operar agendas diferentes após a migração |
| 2 | Foram extraídos serviços/procedimentos, valores, pagamentos, responsáveis financeiros, convênios e documentos fiscais? | Dimensionar importação financeira e impedir reemissão de notas antigas |
| 2 | Quais problemas de datas, codificação, textos ricos, anexos e campos vazios foram detectados? | Preservação clínica sem normalização destrutiva |
| 2 | Já existe staging/mapa de IDs? Qual é o destino de teste e quais migrations/schema Claude pretende alterar? | Evitar colisão com o trabalho de CRM e validar antes do ambiente real |

Na primeira resposta, bastam prioridades 1. As demais podem vir depois. Não incluir nomes, CPF, telefones reais, textos clínicos, credenciais ou certificado no chat; usar agregados, dicionário e exemplos sintéticos.

## Contrato de dados proposto para alinhar

1. Entregar staging separado, manifesto do lote e mapa de origem → destino. Toda alteração de transformação tem versão; preservar o identificador original e o valor bruto necessário para auditoria em área restrita.
2. Identidade de origem inclui sistema, instância da base, entidade e chave original; distinguir pessoa/contato de registro clínico por médico. Importação idempotente não pode se apoiar em nome ou telefone como chave única.
3. Preservar o ID/proprietário dos pacientes já existentes no Cortex. Importar novos registros somente após resolver o mapa de médicos; caso sem médico confiável vai para revisão, sem dono genérico com acesso amplo.
4. Gerar candidatos a `clinic_contacts` e a vínculos com prontuários; o lote não deve conceder `patient_shares`, delegações de equipe ou acesso clínico automaticamente.
5. Conservar número original; normalizar canal somente quando houver informação suficiente. Relacionamento de responsável precisa de origem e confirmação; correspondência de telefone não confirma parentesco ou identidade.
6. Preservar data de nascimento como data civil, idade desconhecida e idade zero. Horários legados exigem timezone identificado; usar America/Sao_Paulo quando confirmado, sem deslocar datas de consulta por conversão indevida.
7. Históricos de nota/pagamento importados são registros históricos. Nunca disparar WhatsApp, criar cobrança nova, emitir NFS-e ou gerar conteúdo com IA durante importação/reprocessamento.
8. Documentar rejeições, duplicatas candidatas e campos sem correspondência. Não descartar silenciosamente consultas, anexos ou texto que ultrapasse um campo do destino.

Contrato sintético de envelope — exemplo de estrutura, não dados reais e não schema já aprovado:

```json
{
  "sourceSystem": "personalmed",
  "sourceInstance": "base-demo",
  "sourceEntity": "patient_record",
  "sourceRecordId": "legacy-patient-001",
  "sourceDoctorId": "legacy-doctor-001",
  "batchId": "migration-demo-001",
  "transformVersion": "proposed-v1",
  "targetPatientId": null,
  "targetContactId": null,
  "mappingStatus": "requires_review"
}
```

## Divisão de responsabilidade

| Frente | Responsável a combinar | Entrega |
|---|---|---|
| Extração, dicionário e qualidade do legado | Claude | Staging, manifesto, contagens, problemas e mapa de origem |
| Propriedade clínica e vínculos | Decisão conjunta com a clínica | Mapa de médicos e casos ambíguos revisados |
| Contatos, delegação de recepção e novos módulos | Frente Cortex/CRM | Schema aditivo e interfaces após alinhar o contrato |
| Política tributária e emitente | Contador + clínica | Regime, códigos, momento de emissão e exemplos autorizados |
| Aplicação final da migração | Um único executor designado | Backup, ensaio, corte, reconciliação e recuperação |

Não executar migrations concorrentes sobre as mesmas tabelas. Não reservar numeração de migration até alinhar os dois trabalhos. O plano de CRM não pede ao Claude para mudar o modelo clínico inteiro nem bloqueia o estudo do legado.

## Critérios para aceitar um lote

- Contagens por entidade e médico reconciliadas, com rejeições justificadas e amostra revisada em ambiente restrito.
- Segunda importação do mesmo lote não cria duplicatas nem eventos externos.
- Pacientes de vários médicos e famílias com mesmo telefone continuam representados corretamente.
- Contato administrativo não herda evolução, receita, áudio nem permissões clínicas.
- Agendamentos futuros reconciliados após data de corte; nenhuma confirmação histórica reenviada.
- Procedimento de reversão antes do corte e correção controlada após novas escritas; não apagar alterações novas para desfazer um lote antigo.

## Mensagem pronta para repassar

> Estamos planejando ampliar o Cortex da Haddad Nicola com recepção, fila de WhatsApp, agenda humana e NFS-e pelo CNPJ da clínica em Curitiba. Para encaixar isso na migração do PersonalMed, preciso primeiro de: (1) dicionário de tabelas/campos e contagens; (2) chaves de paciente, médico, consulta e agenda; (3) explicação se há cadastro único ou prontuários por médico e como recuperar esses vínculos; (4) qualidade de telefones/DDD/contatos de responsáveis, incluindo números compartilhados; (5) agendamentos futuros e data de corte; (6) se existem dados financeiros/fiscais recuperáveis. Envie agregados e exemplos sintéticos, sem dados pessoais no chat. Preserve IDs de origem, staging e mapa idempotente. Não una prontuários só por nome/CPF/telefone e não crie compartilhamentos clínicos, mensagens ou novas notas fiscais durante a importação. Vamos alinhar os vínculos administrativos antes de alterar o schema final; por favor informe também as tabelas e migrations que você pretende tocar.
