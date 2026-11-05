# Recuperação do vínculo durante a reserva

05/11/2026. T05b/3b integra a relação administrativa corrigida ao agendamento humano, usando o leitor de contato e os escritores já existentes. A recepção recupera o vínculo selecionado sem perder paciente, médico, data ou intervalo, e precisa conferir novamente antes de reservar.

## Comportamento

- Uma mudança observada da relação ou da identificação mínima, ausência de vínculo antes confirmado ou falha na leitura invalida a conferência. A escolha anterior permanece visível; o formulário não a substitui em segundo plano.
- **Recuperar vínculo selecionado** faz somente leitura autorizada. Exige contato/clínica corretos e o mesmo paciente/médico; sucesso atualiza a relação e a identificação mínima e desmarca a confirmação. Ausência ou falha mantém o rascunho bloqueado para reserva até nova conferência/recuperação. Não escolhe outro beneficiário nem chama o editor administrativo.
- Recuperação/gravação bloqueiam edição, saída e duplicação. Uma resposta depois de desmontar o formulário não inicia a reserva seguinte nem anuncia sucesso.
- Antes de iniciar a reserva após a confirmação do vínculo, o formulário confere o cache atual e uma geração monotônica de invalidações observadas. Uma relação que muda e volta ao valor inicial não revalida a confirmação antiga.
- Depois de resposta ambígua da reserva, recuperar a relação não troca o identificador da operação se os detalhes do agendamento continuam iguais. Isso preserva a repetição idempotente já oferecida pelo servidor.
- Campos de início/término ocupam uma linha cada em telas estreitas, evitando corte dos controles nativos na escala atual de 135%. Marca e escala permanecem as atuais.

API, DTOs, tipos Supabase, migrations, grants e identidade clínica não mudaram. As garantias acima cobrem alterações observadas pelo cliente; não criam transação atômica entre os dois RPCs. O servidor continua responsável pela autorização e integridade efetivas de cada operação. O ciclo de suspensão/reativação, a listagem geral de vínculos e M2 de novo provisionamento/corte continuam separados.

## Verificação

| Execução | Resultado |
|---|---|
| `npx vitest run src/features/reception/BookingRelationshipRecovery.test.tsx src/features/reception/BookingDialog.test.tsx --reporter=dot` | **16 testes em dois arquivos aprovados** na fonte final: dez de recuperação e seis regressões de vínculo/agendamento. |
| `node scripts/test-booking-relationship-recovery-browser.mjs` | **Seis verificações** com CaseWorkspace, BookingDialog, API, AuthProvider e guardas reais; HTTP sintético em loopback e Edge headless isolado. Relação antiga recusada antes de reservar, recuperação sem escrita, nova conferência, resposta perdida depois da reserva simulada, repetição do mesmo UUID/payload com uma reserva única e recusa após retirada de permissão. [Chamadas, oito fontes congeladas e limpeza](browser/verification.json). |
| ESLint e build | Quatro caminhos de código sem erro/aviso novo; typecheck app/Node e build com URL/chave pública sintéticas aprovados. |
| Visual | 375px, diálogo dentro do viewport e título/ações alcançáveis por rolagem. [Topo](browser/booking-top-mobile.png), [conferência e ações](browser/booking-review-mobile.png). Zero pageerrors. |

RED inicial: seis casos sem o novo comportamento. A revisão independente identificou a continuação de uma confirmação antiga após refetch; o primeiro teste reproduziu uma reserva indevida. A segunda leitura identificou a variante de mudança e retorno do enum, também reproduzida. A geração monotônica corrigiu ambas; a terceira leitura não encontrou pendência material. A seleção ampliada revelou que travar uma seleção recém-vinculada antes de publicar o cache a classificava temporariamente como ausente; a ordem foi corrigida e as duas suítes de agendamento repetidas integralmente. Contagens intermediárias não são somadas às 16 finais.

O primeiro harness de navegador completou os cenários, mas falhou ao encerrar a fixture por usar uma propriedade inexistente. Foi corrigido para `api.close()`; a evidência final só é escrita depois do encerramento de browser/contextos/servidores. A execução final passou e os hashes foram conferidos. Revisão externa já dispensada pelo usuário; nenhum CLI externo foi usado.

Não houve nova execução SQL, Native Auth, navegador contra SQL ou App inteiro: nenhuma regra de banco mudou. As onze suítes SQL/72 migrations do incremento anterior estão em [T05b/3a](../link-relationship-editor/IMPLEMENTATION.md) e não contam como execução nova aqui. Todos os dados deste incremento são sintéticos; sem carga, hosted, APIs pagas, envio externo, deploy ou push. Arquivos paralelos de Claude/PersonalMed/SaaS preservados.

Próxima candidata: leitura administrativa paginada de vínculos por contato, com projeção mínima e guardas existentes. Suspensão/reativação requerem desenho dos escritores e nova reserva de migration antes da implementação; T05b inteira permanece aberta.
