# T28 — pedidos privados originados pelo provisionamento

04/11/2026. Incremento da [anuência médica](DOCTOR_DELEGATION_CONSENT.md), antes do corte do serviço. Sem nova API pública, criação de login/credencial, interface, reconciliação ou publicação. `provision_clinic_receptionist` continua pendente de substituição; esta fundação sozinha não encerra M2/T31.

## Origem e autoridade

Adicionar `request_source` privado, obrigatório e imutável: `human_request` ou `staff_provisioning`. O default das linhas anteriores é `human_request`, pois o produtor anterior exige sessão humana autenticada. Não atribuir essa origem aos escopos legados, aos dados PersonalMed ou por inferência de autor. Nenhum novo campo pessoal/FK; `requested_by` permanece obrigatório.

A fábrica privada `request_provisioned_reception_delegation(clinic, staff, doctor, admin, operation)` aceita apenas contexto de serviço e deriva a origem fixa. `admin` é referência ao administrador por quem o serviço atua, não identidade autenticada do serviço nem médico decisor. Deve ser conta clínica disponível, administrador ativo da mesma clínica; recepção, médico comum, membro externo/inativo e intenção de exclusão recusados. Linha de `auth.users` e filiação real bloqueadas com FOR SHARE NOWAIT: cobrir também mudança de `account_type`, cujo UPDATE não carimba o epoch, além de papel/DELETE. A futura fachada deve autenticar a sessão humana/MFA e vincular administrador, operação durável e identidade criada; esta função privada não substitui isso.

Nenhum EXECUTE para public/anon/authenticated/service_role, nem acesso direto às tabelas privadas. Só uma futura fachada confiável poderá chamá-la como proprietário; os testes usam esse limite explicitamente. O JWT do serviço não é convertido em sessão humana. Origem `staff_provisioning` não permite aprovar, recusar, cancelar ou revogar pelo médico: as transições humanas/MFA e de lifecycle existentes permanecem iguais.

## Efeito e repetição

- Criar somente `pending`, revisão 1, UUID do servidor, capacidade atual, sem escopo. Se houver escopo legado do par, recusar com conflito que exige reconciliação, sem adotá-lo, removê-lo ou chamá-lo de aprovação.
- Conservar identidade, origem e solicitante. Um pedido atual de outra origem ou outro administrador não é apropriado pela fábrica; recusar conflito.
- Registrar operação atômica no ledger existente, com espécie `provision_request` e parâmetros exatos. Mesmo `(admin,operation)` com outros parâmetros retorna `22023`; repetição exata não duplica pedido/operação.
- Resposta perdida: validar autoridade/contas atuais antes de retornar o mesmo UUID em `pending`, ou o estado **atual** `approved` se a aprovação médica e o grant exato ainda forem válidos. Não repetir concessão, criar outra instância ou devolver aprovação histórica como atual.
- Estado terminal, inativação/saída ou divergência de grant retornam `40001`/`42501`; não reabrem o pedido, reativam conta ou substituem identidade. Pedido novo requer operação nova, elegibilidade atual e ação posterior do fluxo autorizado.
- Atualização `request_source` recusada também em combinação com uma transição válida. Fábrica e guardas validam origem/autoridade/currentness, incluindo escritores privilegiados normais; não é só validação do chamador.

`provisioning_request_current` exige pending sem escopo do par, ou approved com grant ligado ao UUID e aos três identificadores exatos. Usa somente o estado privado; não libera prontuários nem muda leitores operacionais. O INSERT legado de serviço continua um corte separado: se ele ocorrer depois de um pedido pending, a retomada da fábrica detecta o conflito em vez de fingir ausência de acesso.

O fluxo humano existente pode identificar a instância corrente e registrar uma nova operação humana sobre ela, inclusive outra origem/solicitante original. Esse alias não altera `request_source`/`requested_by`, não representa nova autoria original nem aprovação, e precisa ser testado assim. Perda de autoridade administrativa depois de um pedido já confirmado não desfaz sua história; bloqueia retomada pelo serviço com essa referência de administrador. Aprovação segue sendo uma decisão humana atual do médico.

## Concorrência e integração

Reusar contas/epochs e referências existentes de requests/operations, sem novo ledger nem alteração nos três helpers T33 temporariamente com Claude. Após resolver os IDs imutáveis, cercar todas as contas relevantes e reler estado antes de decidir em RC; snapshot RR antigo recusa se houver mudança. Guardas AFTER usam aquisições NOWAIT; não aguardar locks de conta depois da linha.

Provar duas fábricas concorrentes, resposta perdida, operação divergente, lifecycle de staff/médico e autoridade administrativa por mudança de papel/DELETE em RC/RR, além de privacidade/custódia, aprovação médica real e impossibilidade de aprovação pelo serviço. Instalação atômica: locks NOWAIT nas tabelas privadas, RC explícito e recusa de snapshot estabelecido; backend humano/caches antigos deve continuar compatível depois do DDL.

Só depois integrar criação da filiação e pedidos numa transação de provisionamento sem grants, com o protocolo durável/Auth/T31 e corte do produtor antigo. Reconciliação de escopos existentes, origem de sistema sem administrador, APIs/UI de decisão e piloto continuam separados. Nenhuma mudança de clínica, autoria legal, pessoa/chart ou carregador PersonalMed autorizada por este contrato.
