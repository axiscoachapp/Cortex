# Revisão local do contrato D20/D14

04/11/2026. Artefato: `docs/product/clinic-crm/SINGLE_PATIENT_REGISTRATION_CONTRACT.md`. Revisão somente de proposta; nenhuma tabela, API, dado legal ou carregador foi implementado.

Fontes locais conferidas: validação atual de `patients`, FKs de consultas/rascunhos e agenda, contatos/vínculos, compartilhamento seletivo e inventário de custódia. A FK atual `(user_id,patient_id,appointment_id)` exige adaptação explícita para agendamento sem ficha; o contrato separa essa mudança de um simples afrouxamento da integridade ou remapeamento de beneficiário.

Uma revisão adversarial com contexto independente apontou duas lacunas da proposta:

| Achado | Tratamento no contrato |
|---|---|
| Pessoa ligada a A não podia ser localizada para a primeira consulta com B por recepção delegada apenas a B | Capacidade de identificação/intake explícita no servidor, projeção mínima sem afiliação de A, separada de acesso cadastral completo/agenda. Associação/reserva exige escopo de B, sessão ativa e confirmação humana; não cria chart/share |
| Vínculo prontuário–cadastro poderia ser reapontado mantendo IDs e apresentar histórico sob outra pessoa | Clínica/cadastro do vínculo imutáveis desde a criação. Suspeita de erro suspende novas projeções/documentos; reparo excepcional exige contrato próprio sem reidentificar histórico ou transferir notas |

Ambos classificados pelo Codex como válidos e corrigidos. Segunda leitura do revisor sem achado acionável remanescente. O revisor não executou testes, acessou banco ou autorizou deploy. Revisão externa dispensada pelo usuário.

Os cenários negativos correspondentes entraram no aceite futuro. Conferidos 103 links locais em sete documentos e `git diff --check`. **Não houve prova de runtime nem suíte de banco nesta rodada documental.** As garantias de autorização, concorrência, custódia, upgrade e snapshots ainda precisam ser implementadas e verificadas antes do corte. Revisão do Claude sobre documentos/staging solicitada na mensagem Codex de 09:22; nenhuma mudança nos arquivos dele.

Revisão do Claude recebida às 10:08 e respondida às 10:15: CAS por vínculo autorizado e revisão, endereço local com proveniência distinta do valor canônico e flag de login compartilhado alinhados como desenho. Pareamento por pessoa/médico/dia foi recusado como identidade autoritativa de compromisso; requer chave explícita ou conferência humana. §§3–4 atualizados, T34/1b ainda aberta para prova antes do DDL. Nenhum schema/carregador ou movimentação de campo legal autorizado por esta revisão.
