# Suspensão e reativação do vínculo: banco/API

05/11/2026, T05b/4a. Implementa o ciclo descrito em CONTACT_LINK_CORRECTIONS.md sobre os vínculos administrativos existentes. Sem interface de estado nesta fatia, sem identidade clínica nova e sem importação.

## Estado e comando

- `patient_contact_links.active boolean not null default true` materializa o estado ativo implícito atual. Nenhum estado anterior é inferido, autor/data de confirmação são preservados e chaves/FKs continuam imutáveis. Não se apaga o vínculo.
- `reception_set_link_active(contact, patient, expected_revision, active)` retorna a revisão atual/sucessora. Somente admin clínico ativo da clínica, assurance e conta disponível, usando a autoridade privada existente. CAS antigo é `40001`; alvo nulo é `22023`; ausência/permissão é `42501`.
- Suspender é permitido mesmo se paciente arquivado ou médico inativo. Reativar exige disponibilidade de ambos e nova conferência humana pelo chamador. Não aceita trocar a relação e o estado na mesma gravação. Alterar relação de vínculo suspenso é recusado.
- Mudança efetiva incrementa revisão uma vez e audita ator/IDs/revisão/estado anterior e posterior, sem valores pessoais. No-op na revisão atual não cria evento. Retry antigo após mudança não reaplica silenciosamente uma intenção superada.
- Locks compartilhados da autoridade/recursos precedem o lock exclusivo do vínculo no comando; aquisições após outros locks usam NOWAIT e disputa vira `40001`. Guardas de linha cobrem DML direto e são ALWAYS. Nenhum grant clínico é criado.
- Um helper privado volátil trava a linha do vínculo também nas leituras operacionais/autorização por vínculo. Snapshot RR anterior à suspensão não pode continuar autorizando pela versão antiga; disputa/versão obsoleta é recusada. A projeção administrativa continua independente e o CAS protege seu editor.
- `reception_contacts`, `reception_contact` e `reception_case` passam a VOLATILE para os RPCs POST já usados pelo app: locks de linha precisam de transação READ WRITE. PostgREST executa função STABLE em READ ONLY mesmo no POST ([documentação oficial](https://docs.postgrest.org/en/v12/references/transactions.html)). Não se promete suporte GET para estes leitores cercados; DTOs e nomes/argumentos POST permanecem iguais.

## Matriz de compatibilidade

| Caminho | Regra |
|---|---|
| `reception_link_patient` | Confirmação antiga não reativa; chave existente suspensa é recusada. Chave nova ativa segue escopo atual. |
| `reception_update_link_relationship` / guarda de identidade | Identidade/confirmação originais imutáveis, relação só com vínculo ativo; estado altera metadata/auditoria no servidor. |
| INSERT de appointment CRM, qualquer escritor | Trava o vínculo correspondente e exige ativo, incluindo inserção já cancelada. Escritores humanos/agenda/clinic/FKs anteriores continuam valendo. |
| UPDATE de appointment CRM | Reabertura de cancelado ou mudança de início/término exige ativo sob o mesmo lock. Beneficiário/médico/contato não mudam. |
| Histórico de appointment CRM | Cancelar, confirmar presença, chegada/desfazer chegada, conclusão e sincronização sem mudar intervalo/reabrir continuam pelas guardas anteriores, sem exigir ativo. |
| Retry de reserva já persistida | Pode retornar o ID histórico sem criar/remarcar/reabrir reserva; não reativa vínculo nem substitui beneficiário. |
| Agenda clínica sem CRM | Conserva as regras anteriores. |
| Contato/caso operacional | Beneficiários só ativos no DTO anterior. Autorização por vínculo exige ativo; exceção de órfão considera também vínculos suspensos. Permissão por caso/administrador continua independente. |
| `reception_link_edit` / página administrativa | Mesmo schema estrito, `active` agora reflete o estado persistido. Itens suspensos seguem identificados minimamente para administração; DTO da agenda fica intacto. |

Nenhuma alteração de medicamento, alergia, identidade legal, prontuário, alerta PersonalMed ou compartilhamento. Os três helpers de custódia do Claude ficam intactos. UI de suspensão/reativação e aviso de histórico serão entregas posteriores sobre esta base.

## Aceite local

Provar papéis/MFA/CAS/no-op/auditoria sem duplicação; confirmação antiga e DML privilegiado; reserva nova/reabertura/remarcação recusadas após suspensão, histórico/encerramento preservados; órfão não vira fila geral e caso existente mantém escopo. Duas conexões reais em RC/RR: reserva antes/depois da suspensão e confirmação antiga, sem depender de sleeps para integridade. Base descartável sintética, regressões de agenda, tipos gerados e adaptador estrito. Reserva de migration no ESTADO antes do arquivo; sem hosted/push/carga.
