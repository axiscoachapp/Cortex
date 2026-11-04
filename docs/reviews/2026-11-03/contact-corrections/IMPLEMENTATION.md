# Correção administrativa de contatos

Incremento local de 03/11/2026, posterior à [fundação da recepção](../reception-foundation/IMPLEMENTATION.md). Implementado no escopo autorizado de recepção/contatos; sem carga do PersonalMed ou mudanças em infraestrutura hospedada.

## Comportamento

Na lista de contatos, a administração da clínica pode abrir **Corrigir contato**, revisar nome/telefone e confirmar os novos dados. Secretárias continuam com a leitura delegada e abertura de atendimentos; a correção de um contato compartilhado fica com a administração neste incremento.

A alteração é do interlocutor administrativo. Nome/telefone do paciente, prontuários, vínculos, agendamentos e compartilhamento clínico permanecem independentes. Número brasileiro novo precisa de DDD. Uma alteração somente de nome preserva telefone legado bruto, inclusive espaços e ausência de DDD, e sua normalização anterior.

Cada contato tem revisão mantida pelo servidor. Uma correção concorrente é recusada, preservando o preenchimento local. **Recuperar cadastro do servidor** exige consentimento se houver edição e bloqueia campos/saída durante a busca. Revalidação em segundo plano não troca a revisão-base do formulário; indisponibilidade oculta o editor sem destruir seu texto. Salvar bloqueia saída/route/logout enquanto a operação estiver pendente.

Identidade, clínica e origem do contato são imutáveis. Auditoria registra ator autenticado, revisão e nomes dos campos alterados; não copia nome/telefone para os eventos. Alteração sem efeito não gera revisão/evento extra. Escrita privilegiada de metadados também invalida revisões antigas.

O retry da criação original continua retornando o mesmo contato depois de uma correção. Um digest SHA-256 privado conserva a comparação do payload de criação sem manter outra cópia textual dos valores anteriores. Novo payload com o mesmo identificador de operação continua recusado. Nenhuma projeção pública contém esse digest.

## Contratos e autorização

- Migration `20261103003500_reception_contact_corrections.sql`, reservada antes da criação e numerada antes da futura S1 `04000`.
- `reception_contact_edit(uuid)` retorna somente `id`, `name`, `phone`, `revision`.
- `reception_update_contact(uuid, integer, text, text)` exige revisão atual e retorna a nova revisão.
- Ambos exigem sessão autenticada, clínica ativa e papel admin, com os controles existentes de MFA/exclusão. Secretária, médico sem administração, admin externo, admin inativo e service role não entram pelo editor.
- `reception_contact`/`reception_contacts` e projeções de reserva continuam com o mesmo formato; clientes de validação estrita não recebem campos adicionais.
- Tabelas continuam sem acesso direto para o cliente autenticado. A nova permissão é verificada no banco, além da visibilidade do botão.

## Verificação

- SQL: 46 migrations, 25 suítes, incluindo correção, CPF/prontuários anteriores, MFA, revogação, ator técnico, normalização, legado bruto, imutabilidade, retry e auditoria sem valores pessoais.
- Duas conexões PostgreSQL disputam a correção do mesmo contato: uma confirma e a revisão antiga da outra falha. Ensaios anteriores de fila/agenda continuam passando.
- Sete testes do editor: conferência humana, texto em conflito, descarte explícito para recuperar, refetch com revisão nova, erro/recuperação de rede, saída durante gravação e recuperação tardia iniciada sem edição.
- Suíte geral serial aprovada: **435 testes em 66 arquivos**, incluindo os testes sintéticos adicionados pelo Claude. Lint sem erros (oito avisos preexistentes), tipos e build aprovados.
- Navegador com duas sessões admin e uma secretária, sobre HTTP sintético de loopback: conflito visível, texto preservado, recuperação explícita, identidade do paciente preservada, fluxo anterior da recepção e telas 390/768/1280/1920 a 150%.
- Tipos regenerados a partir das migrations locais em PostgreSQL descartável. Nenhuma dependência adicionada ou segredo usado.

Uma primeira execução com quatro workers registrou dois timeouts e uma falha subsequente em testes antigos de autenticação/nota clínica sob carga concorrente. Os nove testes desses arquivos passaram isolados, sem alterar código ou limites de tempo; a suíte serial completa passou em seguida. O build emitiu um diagnóstico de tempo de bundling, sem falha.

Revisão adversarial local levou às correções de preservação do telefone bruto e das guardas de salvamento/recuperação. O contrato do digest/retry recebeu revisão separada sem novos achados. **Cross-model skipped: non-interactive context.** Nenhuma CLI externa de IA foi executada.

Artefatos: [relatório do navegador](browser/verification.json), [editor 390](browser/contact-correction-390.png), [editor 1280](browser/contact-correction-1280.png). O navegador simula o transporte; permissões e concorrência são testadas separadamente no PostgreSQL real descartável.

## Publicação e sequência

Migration e frontend ainda não publicados. Aplicar a migration em ambiente ensaiado antes da interface que chama os novos RPCs. Rastreabilidade de importação S1, identidade canônica S2, coorte do legado e implantação em nuvem permanecem nas etapas correspondentes; este incremento não os executa.

Retificação de vínculos/beneficiário é o próximo contrato a especificar, considerando as referências históricas de agendamentos. Não remover vínculos nem mover prontuários para corrigir cadastro de interlocutor.
