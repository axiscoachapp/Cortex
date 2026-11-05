# Correção da relação administrativa no atendimento

Verificação local em 05/11/2026. A administração pode abrir um beneficiário já vinculado ao contato no atendimento da recepção e corrigir a relação para próprio paciente, responsável, familiar ou outra relação confirmada.

## Comportamento entregue

- O editor confere contato, beneficiário e médico retornados pelo leitor existente antes de mostrar o formulário. A chave de consulta inclui ator, clínica e os três identificadores. Ação e leitura ficam restritas à administração clínica ativa; a autorização efetiva continua no banco.
- Nome, nascimento e médico aparecem na conferência. A gravação exige seleção alterada e confirmação humana; mudar a seleção desmarca a confirmação.
- O formulário congela a revisão e o preenchimento. Conflito ou falha de rede preservam ambos; uma atualização em segundo plano não substitui a escolha. Falha na leitura esconde o formulário sem apagar o rascunho e indisponibilidade do vínculo, paciente ou médico impede salvar.
- Recuperar a relação do servidor é explícito e pede consentimento para descartar uma escolha alterada. A recuperação bem-sucedida inicia nova conferência; gravação e recuperação bloqueiam saída. Retorno tardio depois da desmontagem não dispara sucesso.
- O escritor existente recebe apenas contato, paciente, revisão-base e enum da relação. A interface exige a revisão sucessora antes de anunciar sucesso e atualizar os atendimentos.

Não há alteração de migration, tipos, API, identidade clínica, campos legais ou confirmação original do vínculo. A entrada é o atendimento já autorizado; não foi criada uma listagem geral de pacientes/vínculos. Suspensão, reativação e integração da nova conferência no formulário de reserva continuam como fatias separadas de T05b.

T27/H2 e as barreiras de escopo T28 já estão entregues; este incremento usa suas permissões atuais e não acrescenta grants. M2 de novo provisionamento, reconciliação/corte e piloto continua aberta. D6/D7 seguem aguardando o usuário com Claude; PersonalMed não foi alterado.

## Evidências

| Verificação | Resultado e limite |
|---|---|
| Vitest: `LinkRelationshipDialog`, `ContactCorrectionDialog`, `BookingDialog` | **25 testes distintos em três arquivos** aprovados. Incluem cache inicial, revisão congelada, recuperação com consentimento, falha de refetch, indisponibilidade após refetch, bloqueio de saída/duplicata e resposta após desmontagem. Reexecuções não são somadas. |
| `node scripts/test-reception-delegation-api.mjs --link-editor` | **72 migrations e onze suítes SQL** aprovadas em PostgreSQL descartável com dados sintéticos; [fontes, contagens e limpeza](SQL.json). Backend de relação, delegações, limites de função e ciclos de equipe/escopo preservados. |
| `node scripts/test-link-relationship-editor-browser.mjs` | **Sete verificações** em Edge headless isolado: entrada admin, conferência humana, conflito, recuperação explícita, nova revisão, descarte e diálogo de 375px. Componentes/API reais com HTTP sintético em loopback; [chamadas e hashes](browser/verification.json). Secretária não tem ação nem leitura do editor; zero pageerrors. |
| Qualidade | ESLint dos seis caminhos de código, sintaxe do harness, typecheck app/Node e build com URL/chave pública sintéticas aprovados. |
| Revisão | Revisão independente limitada ao contrato/arquivos, sem achado material. Revisão externa dispensada pelo usuário; nenhum CLI externo executado. |

RED inicial: import do editor ainda inexistente. Durante a implementação, uma asserção de indisponibilidade passou a aguardar a notificação observável da consulta; os rótulos foram separados em módulo próprio para eliminar aviso novo de Fast Refresh. A seleção final de 25 testes e o build foram repetidos após essa separação.

O ensaio SQL usa fixture de papéis/sessões; o navegador não se conecta ao SQL e não cobre Native Auth nem o App inteiro. O runner conserva as fontes históricas da baseline `f716e68` e captura os três overlays já existentes. Rede Docker interna, imagens em cache, recursos próprios rotulados e ausência após limpeza conferida. O navegador bloqueia destinos externos e encerra seus contextos/servidores.

Capturas inspecionadas na escala atual de 135%: [topo do editor](browser/review-mobile-top.png), [conferência com ações após rolagem](browser/review-mobile.png), [atendimento corrigido](browser/corrected-case-mobile.png). Título e ações ficam alcançáveis pela rolagem do diálogo, dentro do viewport móvel.

Próxima fatia candidata: refletir a relação corrigida na reserva e renovar a confirmação humana, preservando paciente/médico e o rascunho de horário. O ciclo completo de T05b permanece pendente.
