# Lista de vínculos na página de contatos

05/11/2026, T05b/3d. A administração clínica ativa pode abrir **Consultar vínculos** no cartão do contato, carregar páginas de até 50 pessoas e corrigir a relação pelo editor existente. A lista apresenta beneficiário, médico, nascimento, relação e disponibilidade, com contagem dos itens carregados.

## Comportamento entregue

- A consulta começa ao abrir a lista. Cache e componente são separados por ator, clínica e contato. Uma leitura fresca precisa concluir antes de revelar dados de cache; troca de contato/ator ou perda de autoridade remove o contexto anterior.
- Erros, inclusive ao carregar outra página, escondem linhas e ações antigas e oferecem nova tentativa. Lista vazia é um estado distinto. Paciente/médico/vínculo indisponível continua identificado minimamente e impede correção.
- Lista e editor usam modais alternados. Abrir o editor passa os IDs exatos e preserva as guardas de confirmação, rascunho e resposta tardia já existentes. Cancelar volta à lista; salvar mostra o resultado e a invalidação existente atualiza a relação. Consulta/paginação não escrevem vínculos.
- A `queryFn` consome o `AbortSignal` do TanStack e descarta resultados abortados. Fechar/reabrir ou perder/recuperar autoridade enquanto uma consulta está pendente inicia outra leitura, sem aceitar a resposta do contexto desmontado. O transporte antigo pode terminar, mas seu resultado não volta à interface/cache como leitura válida.
- Marca e escala atuais de 135% preservadas. Cartões usam quebra de texto e controles com altura suficiente; título e ações ficam alcançáveis pela rolagem no diálogo móvel.

Não houve alteração de migration, API, DTO, tipos, permissões, campos legais, identidades clínicas ou escritores. Não se abre prontuário por esta lista. Suspensão/reativação continua uma etapa própria de T05b.

## Verificação

| Execução | Resultado |
|---|---|
| `npx vitest run src/features/reception/ContactLinksDialog.test.tsx src/features/reception/LinkRelationshipDialog.test.tsx --reporter=dot` | **22 testes em dois arquivos** aprovados: dez da lista e 12 do editor. Paginação, identidade do editor, estados vazios/indisponíveis, cache/refetch recusado, erro na segunda página, troca de contato, perda/restauração de autoridade e resultados tardios. |
| `node scripts/test-contact-links-ui-browser.mjs` | **Sete verificações** em Edge headless isolado: entrada admin sob demanda, 50+1 pessoas pelo cursor, editor real e relação atualizada, Escape/descarte/retorno, médico indisponível, recusa esconde dados/ações e diálogo375px. ContactsPage, lista, editor, API, AuthProvider e guardas reais com HTTP sintético em loopback. [Chamadas, oito fontes congeladas e limpeza](browser/verification.json). |
| Qualidade | ESLint de quatro caminhos, typecheck app/Node, build sintético e hashes aprovados. Zero pageerrors. [Topo móvel](browser/list-top-mobile.png) e [fim da lista](browser/list-end-mobile.png) inspecionados. |

RED inicial: import da lista inexistente. A revisão independente identificou um P2: uma consulta pendente sem consumir o signal era reutilizada depois de remontar a mesma chave. O probe local do revisor com QueryObserver instalado observou uma só chamada e `isFetchedAfterMount=true`; o teste de regressão exigindo a segunda chamada falhou antes da correção. Após consumir/conferir o signal, a seleção final de 22 testes passou; segunda leitura sem achado material. A primeira passagem de 21 testes não é somada. Revisão externa já dispensada pelo usuário.

O navegador usa dois contextos, admin e secretária, sem perfil real; esta última não tem botão nem consulta de vínculos. Não há destinos externos; browser/contextos/servidores encerrados antes da gravação da prova. As 73 migrations/12 suítes SQL da [base paginada](../contact-links-page/IMPLEMENTATION.md) não foram repetidas nem contadas como execução nova. Não é navegador contra SQL/Native Auth ou App inteiro.

Próximo recorte: suspensão/reativação de vínculo, com matriz de guardas de confirmação e de todos os escritores de reserva/reabertura/remarcação, revisão e reserva de migration antes da implementação. T05b inteira, M2/corte/piloto permanecem abertos. Sem hosted, push, envio externo, carga ou alteração em PersonalMed/SaaS/arquivos Claude; mensagens históricas já atendidas não foram respondidas novamente.
