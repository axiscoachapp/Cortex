# Especificação: recepção e CRM da clínica

Estado: especificação do conjunto, com fundação local de recepção/agenda implementada em 03/11/2026. Recursos futuros permanecem propostas. O [relatório do incremento](../../reviews/2026-11-03/reception-foundation/IMPLEMENTATION.md) distingue código verificado, limites e implantação pendente. Documentos relacionados: [índice](README.md).

Identidade implementada: `clinic_members` preserva `admin`/`doctor`; secretárias usam contas exclusivas em `clinic_staff_members` e delegações em `staff_doctor_scopes`. Rotas atuais: `/recepcao?case=UUID`, `/recepcao/agenda`, `/recepcao/contatos` e `/recepcao/equipe`. Compartilhamento clínico continua explícito entre médicos. As demais rotas/integrações abaixo pertencem ao roadmap.

## Objetivo e premissas

Permitir que as secretárias recebam demandas, reconheçam contatos, organizem pendências e agendem para médicos autorizados em uma única área. Preservar os prontuários privados e o compartilhamento explícito existentes.

Confirmado: Haddad Nicola, agendamento inicialmente humano, NFS-e pelo CNPJ da clínica em Curitiba, migração do PersonalMed conduzida pelo Claude. Premissas de desenho ainda abertas: um número principal na primeira implantação, possibilidade de mais números, várias secretárias simultâneas e expediente configurável. Nenhuma dessas premissas é um dado observado da operação.

## Base existente e lacunas verificadas

| Existe no código | Limite para o novo fluxo |
|---|---|
| `clinics`, `clinic_members`, convites e desligamento | Papéis atuais são `admin` e `doctor`; não há identidade de recepcionista |
| `patient_shares` e RPCs de compartilhamento | São acesso clínico entre médicos, não delegação administrativa à recepção |
| `patients.user_id` e relacionamento composto paciente/proprietário | Não devem ser substituídos por um prontuário indiscriminadamente compartilhado |
| `Calendar.tsx`, `AppointmentModal.tsx`, `appointments` | Agenda e gravação são centradas no proprietário autenticado; faltam atuação delegada e agenda clínica comum |
| `send-appointment-reminder` | WhatsApp atual prepara link `wa.me`; não recebe mensagens, não implementa uma inbox e não comprova entrega |
| Itens de trabalho com espera/confirmação | Não são uma fila concorrente de conversas para várias secretárias |
| Restrições de sessão, auditoria, exportação e exclusão | Os novos objetos precisam integrar esses ciclos, sem apagar dados fiscais ou de outros profissionais |

Referências de implementação existentes: `src/lib/sharing.ts`, `src/pages/Calendar.tsx`, `src/components/AppointmentModal.tsx`, `supabase/functions/send-appointment-reminder/index.ts` e migrações `20261029000300`, `20261029001000`, `20261029001600`.

## Experiência da recepção

Rotas propostas: `/recepcao`, `/recepcao/atendimentos/:id`, `/recepcao/agenda`, `/recepcao/contatos`, `/financeiro`, `/financeiro/notas`, `/gestao/equipe`. O destino após login depende das capacidades; médico continua chegando à sua área clínica.

Na tela principal, uma lista de atendimentos fica ao lado da conversa e do contexto administrativo. Selecionar um contato mostra telefone/canal, identidade confirmada ou pendente, paciente beneficiário, profissional relacionado, próximos horários e tarefas. Evolução, diagnóstico, transcrição e receitas não aparecem nessa projeção.

Filtros: não atribuídos, meus atendimentos, aguardando paciente, aguardando equipe, agendamentos, financeiro e concluídos. Busca por contato/telefone e filtros por médico, atendente e tipo de demanda. Contadores devem vir de consultas agregadas autorizadas e refletir o filtro, sem carregar todas as mensagens.

Em tela estreita, lista → conversa → contexto/agenda são painéis navegáveis, preservando rascunho. Manter marca Haddad Nicola e a escala padrão de 150%; não reduzir fonte para acomodar colunas. Estados de carregamento, sem resultados, falta de permissão, indisponibilidade do provedor e envio pendente precisam ser distintos.

## Jornada principal

```mermaid
flowchart LR
    A[WhatsApp ou contato manual] --> B[Fila da recepção]
    B --> C[Secretária assume]
    C --> D[Confirma contato e beneficiário]
    D --> E[Sugere médico e opções de agenda]
    E --> F[Pessoa confirma agendamento]
    F --> G[Confirmação e chegada]
    G --> H[Atendimento médico privado]
    H --> I[Serviços e cobrança]
    I --> J[Revisão fiscal]
    J --> K[NFS-e autorizada e entrega]
```

Nem toda conversa vira agendamento. Encerrar como informação prestada, desistência ou contato incorreto deve ser possível, com motivo operacional e sem criar um paciente clínico fictício.

### Reconhecimento do contato

- Guardar telefone original e versão normalizada, com origem e país quando conhecidos; não normalizar silenciosamente dados ambíguos.
- Usar identificador de contato disponibilizado pelo canal e telefone quando disponível. Não pressupor que todo evento futuro do fornecedor sempre conterá um número.
- Um telefone pode atender familiares, responsáveis e vários pacientes. O número identifica um canal, não prova a identidade nem autoriza compartilhar informações.
- Antes de revelar dados ou confirmar detalhes sensíveis, a secretária verifica o beneficiário e a relação do interlocutor; dados fiscais completos devem ser coletados em formulário autenticado/seguro, não solicitados no chat por padrão.
- Vários candidatos, número reciclado e mudança de telefone geram confirmação manual. Sem candidato, criar contato administrativo provisório.

### Sugestão de médico

Regras iniciais determinísticas, com motivo visível: (1) profissional solicitado explicitamente; (2) vínculo administrativo e continuidade confirmados; (3) serviço e profissionais habilitados na configuração da clínica; (4) regras de convênio/faixa etária, quando cadastradas e aprovadas; (5) disponibilidade e preferência do paciente. Empate ou ausência de regra vão para seleção humana.

**Implementado localmente em T08/1:** pedido/vínculos entre agendas autorizadas. Se o médico indicado está indisponível, informar a limitação e exigir escolha humana, sem fallback silencioso. Vários vínculos mostram opções sem preferência; selecionar só preenche o campo e Encaminhar confirma separadamente. Agenda removida não pode ser enviada e pendência bloqueia os controles. [Provas](../../reviews/2026-11-05/doctor-routing/IMPLEMENTATION.md). Catálogo/habilitações e regras por serviço/convênio continuam dependentes de configuração aprovada; nenhuma inferência por especialidade ou conteúdo clínico.

Não inferir diagnóstico a partir da mensagem nem consultar a evolução clínica para escolher um profissional. Pedidos assistenciais são encaminhados à equipe médica pelo procedimento da clínica. Uma marcação de possível urgência não deve ser vendida como triagem médica ou garantia de resposta emergencial.

### Fila de atendimento

Estados propostos: `new`, `assigned`, `waiting_patient`, `waiting_internal`, `resolved`, `cancelled`. Assunto e etapa de agendamento são campos separados do estado da fila. Reabertura cria evento e preserva histórico.

Assumir um atendimento é transacional: uma única secretária torna-se responsável, com revisão do registro e auditoria. Outra pessoa vê “em atendimento por …”, podendo transferir conforme permissão. Novas mensagens na mesma conversa não criam casos duplicados; assuntos diferentes podem virar casos vinculados.

MVP: fila compartilhada, ação “assumir próximo” e transferência. Evolução: distribuição automática entre secretárias elegíveis por disponibilidade/carga, com ausência configurável. Isso automatiza a atribuição de trabalho, não a reserva de consulta. Não liberar um atendimento apenas porque o navegador fechou; supervisor pode redistribuir com motivo auditado.

Rascunhos são por atendente/conversa e não somem ao mudar de painel. Uma conversa resolvida com nova mensagem é reaberta ou ligada a novo caso segundo regra documentada; o paciente não fica invisível em uma fila encerrada.

### Agenda humana

Agenda operacional pode filtrar vários médicos autorizados. Secretária seleciona profissional, serviço, duração, data e paciente confirmado; servidor valida escopo e conflito no momento da gravação. Duas tentativas simultâneas do mesmo horário não podem produzir dupla reserva silenciosa. Encaixe excepcional depende de permissão explícita e motivo.

Pré-seleção/rascunho de horário não é confirmação. Criar, remarcar e cancelar exigem ator humano autenticado no MVP; webhook ou modelo não executa essas ações. Confirmar presença por resposta do paciente pode alterar a confirmação de um agendamento já existente, após vínculo seguro, sem mover o horário.

Cancelamento e remarcação preservam eventos e invalidam lembretes antigos. Status do compromisso, presença na clínica e status longitudinal do cadastro são conceitos separados. Check-in não muda automaticamente todos os prontuários desse paciente para “em atendimento”. Google Calendar é uma integração complementar; a agenda do Cortex é a fonte de verdade, com falhas de sincronização visíveis.

## Permissões e dados mínimos

Papéis são propostas; capacidades e escopos são a autorização efetiva. Uma pessoa pode acumular funções de forma explícita.

| Capacidade | Médico | Recepção | Financeiro | Gestor operacional |
|---|---|---|---|---|
| Ver contatos e demandas | Próprio escopo | Profissionais/filas delegados | Dados necessários à cobrança | Escopo da clínica |
| Criar/remarcar compromisso | Própria agenda | Agendas delegadas | Sem permissão por padrão | Só se também delegado |
| Ler evolução/transcrição | Proprietário ou grant clínico válido | Não | Não | Não por ser gestor |
| Editar evolução/prescrever | Regras clínicas existentes | Não | Não | Não por ser gestor |
| Registrar recebimento | Se autorizado | Capacidade opcional | Sim | Se autorizado |
| Emitir/cancelar NFS-e | Capacidade financeira explícita | Não por padrão | Sim, segundo política | Capacidade explícita |
| Delegar equipe e consultar métricas | Se gestor | Não | Não | Sim |

Revisar todas as funções existentes que usam apenas “membro ativo” antes de introduzir novos papéis: convites de médicos, concessão/aceite de compartilhamento, fontes de conhecimento e desligamento. Inserir `receptionist` no CHECK sem revisar essas rotas pode transformar uma conta administrativa em acesso clínico.

Servidor deriva o ator de autenticação, resolve a clínica e valida delegação ao médico escolhido. Não confiar em `user_id` fornecido pelo cliente nem usar a identidade de um médico para executar uma ação de secretária. RLS/RPCs e funções precisam fazer a mesma verificação; ocultar botões não é controle de acesso.

Sessão, MFA/reautenticação aplicáveis, revogação e limpeza do cache continuam valendo. Desligar uma secretária revoga escopos e redistribui casos; desligar um médico não apaga contatos administrativos nem prontuários de outros profissionais.

Mensagens recebidas podem conter informação clínica espontânea: tratar conteúdo e anexos como sensíveis, restringir leitura ao escopo operacional necessário e não copiar automaticamente para prontuário ou IA. Anexos entram em quarentena com limite de tamanho/tipo e acesso autenticado. Dados de saúde e minimização constam da [LGPD disponibilizada pelo Senado](https://legis.senado.leg.br/norma/27457334/publicacao/27457731); as decisões de base legal, retenção e operadores devem ser formalizadas pela clínica.

## Modelo de dados proposto, ainda sem migração

| Grupo | Entidades propostas / extensão | Invariante |
|---|---|---|
| Equipe | `clinic_members`, `staff_doctor_scopes` | Vínculo ativo e delegação revogável; gestão não concede acesso clínico |
| Identidade administrativa | `clinic_contacts`, `contact_channels`, `patient_contact_links` | Contato/familiar pode ligar vários prontuários; telefone não é UNIQUE de pessoa |
| Atendimento | `reception_cases`, eventos de atribuição/transição | Uma responsabilidade atual, histórico preservado, revisão para concorrência |
| Conversa | `communication_channels`, `conversation_threads`, `conversation_messages` | IDs do provedor idempotentes por conexão/conta; recebido não equivale a verificado |
| Integrações | `integration_inbox`, `integration_outbox` | Recepção durável antes do ACK; reprocessamento não duplica efeito |
| Agenda | Extensões de `appointments`, regras de disponibilidade/bloqueios | Médico titular, ator e clínica distintos; autorização e conflito transacionais |
| Financeiro | `service_catalog`, `service_orders`, `service_order_items`, `payments`, `payment_allocations` | Serviço, cobrança e recebimento separados; valores em centavos e snapshots de preço |
| Fiscal | `fiscal_profiles`, `fiscal_documents`, alocações por item e eventos | Pedido idempotente, snapshot imutável, autorização confirmada por chave/retorno |
| Auditoria | Eventos administrativos, integração com auditoria existente | Ator, ação, IDs, origem e horário; logs técnicos sem conteúdo sensível |

Esses nomes delimitam responsabilidade, não são um schema a aplicar cegamente. Reutilizar entidades existentes quando o contrato for realmente o mesmo; não reutilizar `patient_chat_turns` para WhatsApp nem converter a fila de tarefas clínicas em central de recepção.

Adicionar vínculos de forma compatível, fazer backfill verificável e só depois endurecer constraints. Preservar `patients.id`, proprietário e relacionamentos compostos atuais. A migração PersonalMed entrega staging e mapa de origem; o contrato detalhado está no [handoff](DATABASE_HANDOFF.md).

## Contratos de operações

Nomes ilustrativos para RPCs/handlers futuros, sem endpoints implementados nesta entrega:

| Operação | Entrada essencial | Garantia do servidor |
|---|---|---|
| `reception_directory` | Filtros e cursor | Projeção administrativa mínima e paginação, sem blobs clínicos |
| `claim_reception_case` | Caso e revisão esperada | Exatamente uma atribuição; conflito retorna estado atual |
| `transfer_reception_case` | Caso, revisão, fila/atendente e motivo | Destinatário elegível e evento auditado |
| `link_case_beneficiary` | Contato, beneficiário e confirmação | Sem fusão automática por telefone/CPF e sem leitura clínica |
| `schedule_clinic_appointment` | Médico, serviço, intervalo, contato e chave idempotente | Sessão humana, delegação, vínculo e conflito verificados na mesma transação |
| `send_clinic_message` | Conversa, conteúdo/modelo, chave idempotente | Permissão, opt-out, janela, limites e destino revistos antes do envio |
| `create_fiscal_request` | Serviços, snapshot revisado e chave idempotente | Regime/versão aprovados, valores íntegros e nenhum duplicado |

Todas as alterações retornam IDs e revisão. Não há simulação de sucesso quando o provedor falha. Listas usam cursor e limites; o projeto inicial deve testar com milhares de contatos sintéticos, não apenas a meia dúzia da demonstração.

## WhatsApp e infraestrutura local

O backend mantém adaptadores separados para mensageria e fiscal, com entrada/saída duráveis, chaves idempotentes e reconciliação. A API oficial/BSP deve ser validada em teste; não usar automação de WhatsApp Web como fundação do produto.

Webhook público HTTPS, verificação do desafio e assinatura do provedor, validação do corpo e deduplicação por evento são requisitos. Confirmar a assinatura sobre o corpo original, antes de transformá-lo. Verificar se cada evento pertence à conexão e clínica configuradas. ACK somente após persistência durável; caso contrário, depender do mecanismo de retry documentado do provedor.

Banco local continua uma preferência registrada. Há duas opções de implantação a decidir: endpoint HTTPS protegido no ambiente da clínica ou gateway público mínimo que recebe e encaminha ao servidor local por conexão segura. Nesta segunda opção, armazenamento transitório de conteúdo fora da clínica precisa ser deliberado, cifrado, contratado e limitado; não chamar isso de “dados inteiramente locais”. Meta e integrador fiscal também tratam os dados enviados a seus serviços.

Não expor PostgreSQL na internet. Definir comportamento durante queda de internet/servidor: filas duráveis, atraso visível, replay controlado e alerta operacional. Lembrete atrasado de consulta cancelada deve ser descartado. Resultado fiscal desconhecido exige consulta antes de reemitir. A escolha de gateway/provedor é um ponto de decisão antes do piloto real, sem reescrever a arquitetura existente durante o planejamento.

## Métricas e primeira entrega

Proposta de indicadores: tempo de primeira resposta humana em horário útil, casos sem responsável, reabertura, conversão em agendamento, cancelamento, comparecimento, cobranças e notas pendentes. Mostrar denominadores e excluir dados sintéticos; não criar rankings de produtividade com dados clínicos.

Primeiro incremento utilizável: contas de recepção, escopo por médico, contato administrativo, fila manual e reserva humana na agenda. WhatsApp e fiscal entram por provas isoladas após essa fundação. Reservar contrato para automações futuras sem ligar agendamento autônomo.

Fora do primeiro incremento: campanhas comerciais, triagem clínica autônoma, bot que agenda sozinho, faturamento completo TISS/glosas, estoque, contabilidade completa, conciliação bancária automática, múltiplos CNPJs e migração automática de toda a história de WhatsApp. Esses itens precisam de descoberta própria.

## Engenharia e verificação

Manter React/TypeScript, componentes acessíveis e Supabase/PostgreSQL existentes. Novos módulos em `src/features/reception`, `src/features/communications` e `src/features/billing`; políticas e migrations em `supabase/`, testes de regra próximos do código e SQL em `supabase/tests`. Evitar acrescentar esses fluxos aos arquivos já grandes `Index.tsx` e `ChatPanel.tsx`.

Estilo: contratos tipados, ator resolvido no servidor, valores monetários inteiros e revisão explícita. Exemplo de contrato de fronteira, não implementação:

```ts
type ClaimReceptionCase = {
  caseId: string;
  expectedRevision: number;
};
// clinicId, actorUserId e escopos são resolvidos/verificados na sessão do servidor.
```

Comandos existentes para execução posterior: `npm run lint`, `npm run typecheck`, `npm test -- --pool=forks --maxWorkers=1`, `npm run typecheck:edge`, `npm run test:db`, `npm run build` e `npm run dev -- --host 127.0.0.1`. Build exige variáveis públicas do ambiente escolhido; não incluir chaves reais nos planos ou testes. Browser regressivo sintético existente: `node scripts/clinic-review-browser.mjs`; novos fluxos devem ganhar cenários próprios.

Aceite global: recepção não obtém conteúdo clínico por UI/API/export; duas secretárias não assumem o mesmo caso; disputa de horário não duplica reserva; eventos repetidos não repetem mensagens/notas; revogação funciona sem novo login; queda do provedor não impede trabalho manual; retorno fiscal perdido não causa segunda nota; dados migrados preservam origem e propriedade. Testar 390/768/1280/1920 px e escala padrão de 150%.

## Perguntas de refinamento

Quantidade de secretárias e médicos; secretárias dedicadas ou compartilhadas; números atuais e titularidade do WhatsApp; expediente e capacidade simultânea; fila presencial versus fila de mensagens; especialidades, durações e encaixes; pagamento particular/convênio, pacotes e repasses; política de contato e retenção; infraestrutura local e disponibilidade externa; requisitos contábeis. O [plano](../../../tasks/clinic-crm/plan.md) mostra o que pode avançar sem cada resposta.
