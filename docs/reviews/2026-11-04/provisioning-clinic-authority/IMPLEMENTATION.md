# T28/M2 — confirmação exige identidade Auth atual

04/11/2026. Correção local do protótipo de provisionamento, conforme pedido do usuário. [Contrato](../../../product/clinic-crm/PROVISIONING_CLINIC_AUTHORITY_CONTRACT.md). Sem migration, fachada pública, aplicação em banco hospedado ou push.

## Falha e correção

O [RED do receipt](RECEIPT_RED-v2.197.0.json) reproduziu a falha pela API nativa: DELETE retornou 200 e a leitura atual já recusava o receipt, mas uma transação REPEATABLE READ aberta antes da exclusão confirmou a identidade antiga. As linhas de autoridade do ator permaneceram iguais; a recusa não podia depender de uma mudança acidental no administrador.

`fence_current_receipt` agora toma FOR SHARE NOWAIT na linha Auth alvo reservada antes de consultar o receipt. Identidade removida ou com marcadores alterados recusa em READ COMMITTED; alteração posterior ao snapshot RR aborta com 40001. A cerca protege tanto a confirmação quanto check e replay de begin que devolveriam `confirmed`. O histórico permanece histórico, sem afirmar que o alvo ainda existe. A ordem inversa também é exercitada: DELETE nativo realmente espera a curta transação que cercou o alvo primeiro; após a exclusão, o replay recusa.

A cerca é compartilhada pelo protótipo base e pela composição com clínica real. `assert_final_deadlines` confere bearer, prazo da intenção e `auth.sessions.not_after` depois da última aquisição. A revisão local encontrou essa última janela temporal; o teste injeta atraso somente na cerca privada do laboratório, comprova entrada antes de `not_after`, atravessa o prazo e exige recusa na confirmação e no replay de begin. JWT e intenção continuam válidos, e a definição original é restaurada e comparada.

## Composição e provas

O ambiente instala **69 migrations congeladas em `a8aa43b3e4c9ec86e7329a633e8d566409225416`** junto do Auth nativo. O adaptador omite somente as nove declarações exatas de mocks que colidiriam com o Auth real. Compara colunas/donos/ACL das tabelas nativas e definições/donos dos helpers antes/depois, preservando sua implementação. Não concede leitura das tabelas Auth aos papéis clientes. Storage continua fixture SQL, sem serviço de arquivos real.

Administrador, login e TOTP/AAL2 são nativos. O bearer é validado em `/user`, e a clínica nasce pela Data API autenticada. A intenção captura a geração original de `clinic_members`, validada pelo guard/T33 reais. A fixture de papel/status do protótipo base só restringe; não substitui a filiação real. O [RED da composição](RED-v2.197.0.json) mostrou que a fixture sozinha aceitaria ABA real da filiação com a mesma sessão/fator ainda vivos.

| Execução final | Resultado |
|---|---|
| Auth v2.197.0, composição | 19 grupos aprovados |
| Auth v2.189.0, composição | 19 grupos aprovados |
| Auth v2.197.0, regressão base `--provision-intent` | 17 grupos aprovados |

Os 19 grupos por versão (38 ao todo) cobrem exclusão e metadata nos dois níveis de isolamento, replays, ordem inversa observada, expiração dentro da cerca, AAL1 recusado, geração/ABA/no-op, nova sessão, logout e nascimento Auth em voo após perda de autoridade ou expiração real do bearer. Não criam filiações de recepção, prontuários ou grants para os alvos.

Relatórios finais: [v2.197.0](v2.197.0.json), [v2.189.0](v2.189.0.json); [regressão base](../provisioning-human-intent/v2.197.0.json). Ambos os relatórios compostos têm `compositionProofPassed=true`, preservação nativa e cleanup confirmados. Cada execução congela suas fontes, compara hashes ao fim e limpa somente os recursos próprios. Os RED guardam os hashes dos candidatos anteriores, diferentes do GREEN final.

```text
node scripts/test-initial-password-auth.mjs --provision-clinic --all --source=a8aa43b3e4c9ec86e7329a633e8d566409225416
node scripts/test-initial-password-auth.mjs --provision-intent
node --check scripts/test-initial-password-auth.mjs
node --check scripts/test-provisioning-clinic-authority.mjs
npx eslint scripts/test-initial-password-auth.mjs scripts/test-provisioning-clinic-authority.mjs
```

Sintaxe/lint aprovados. Revisões locais de contrato e implementação encontraram os problemas de receipt e relógio; ambos tratados, última leitura estática do delta sem outro achado concreto. Revisão externa dispensada pelo usuário. Não foram executadas suítes SQL gerais, build, testes de UI nem upgrade de produção nesta rodada. A regressão base v2.189.0 anterior continua histórica; as duas versões foram exercitadas no modo composto atual.

## Limites e continuidade

É uma correção nos protótipos, sem mudar a autorização de produção. Permanecem: todos os escritores privilegiados do ledger e corridas de reserva de UUID; custódia/instalação/upgrade da intenção; histórico completo de credencial/eventos Auth e recuperação; integração da filiação/pedidos, corte do serviço legado, reconciliação e API/UI. M2/T31 não estão concluídas.

O snapshot congelado antecede `908c38d`: esta prova não é reteste do delta D17 do Claude. Não altera os três helpers T33 dele, PersonalMed, campos legais ou SaaS. Credenciais sintéticas ficam em memória/stdin; rede Docker interna própria, sem portas publicadas, rota externa, dados reais, envio ou serviço pago.

Prova posterior: [vínculos imutáveis do ledger](../provisioning-ledger-bindings/IMPLEMENTATION.md) preserva esses 19 grupos e acrescenta quatro em cada Auth, sobre snapshot `4a232f3` com o D17 já corrigido. Essa composição posterior também é laboratório, sem encerrar custódia, produtores de INSERT/phase, instalação ou corte do serviço.
