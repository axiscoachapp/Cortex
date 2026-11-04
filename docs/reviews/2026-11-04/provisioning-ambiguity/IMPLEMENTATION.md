# T28 — criação incerta preserva a identidade

04/11/2026. Incremento local do provisionamento, sem migration, implantação ou dados reais. **Não encerra M2:** concessão automática legada, reconciliação durável, pedidos públicos e interface de anuência continuam pendentes. T31 de credencial inicial permanece separado.

## Problema e correção

`create-clinic-receptionist` tentava apagar o login recém-criado quando o RPC de provisionamento retornava erro. Uma resposta perdida não prova rollback: a filiação pode ter sido confirmada. As FKs existentes podem recusar a exclusão, mas não justificam enviar essa compensação. Além disso, o handler tratava qualquer resposta sem erro como sucesso, inclusive `false` e `null`.

Agora somente `data === true` sem erro confirma o provisionamento e permite devolver as credenciais temporárias já previstas no fluxo atual. Erro retornado, exceção de transporte e resposta inesperada devolvem 503 com aviso de resultado incerto. Não há exclusão de identidade, repetição automática do RPC ou nova tentativa de criação dentro da requisição. Erros internos, identidade e credenciais não entram na resposta de falha nem em logs.

A conta pode existir sem filiação confirmada. O marcador confiável `app_metadata.account_type=reception`, gravado no Auth antes do RPC, mantém essa identidade fora do ambiente clínico. O incremento preserva esse marcador e as validações anteriores de sessão/MFA, administrador e clínica. Não há nova permissão, credencial ou categoria de dados.

## Verificação

`RED.json` registra o teste do handler real antes da correção, com limites de rede/Auth/banco simulados: 30 casos, 25 aprovados e cinco falhas esperadas. Reproduziu tentativa de exclusão, resposta perdida depois de commit simulado, timeout lançado e aceitação de `false`/`null`. O teste não prova que o Auth realmente apagaria uma conta protegida por FK; comprova a tentativa indevida e o tratamento incorreto da resposta.

A revisão adversarial local, com contexto novo, não encontrou defeito concreto no contrato restrito. Sugeriu dois controles adicionais, incluídos: objeto truthy sem booleano e `data=true` acompanhado de erro. Foi leitura estática; revisão externa dispensada pelo usuário.

A suíte SQL de fronteiras ganhou uma identidade marcada somente no Auth, sem `clinic_staff_members`. Ela precisa ter recepção inativa/sem clínica, não pode inserir prontuário próprio e passa pela mesma matriz de RPCs clínicas, predicados, Storage e busca já usada para recepção ativa/inativa. Os controles positivos anteriores permanecem. A suíte modificada entra como overlay explícito com SHA-256 no runner protegido, sem importar SQL não revisado de outro agente.

Comandos desta rodada:

- `npm exec vitest run -- src/lib/securityHandlers.test.ts src/features/reception/TeamSettings.test.tsx --reporter=json --outputFile=docs/reviews/2026-11-04/provisioning-ambiguity/GREEN.json`.
- `node scripts/test-reception-legacy-array-guard.mjs --focused`: usa SQL congelado de HEAD e overlays próprios; resultado dirigido em `../legacy-array-guard/focused.json`. Não alegar execução das regressões omitidas expressamente nesse modo.
- `npm exec --offline --yes --package=deno@2.9.6 -- deno check --cached-only --no-config supabase/functions/create-clinic-receptionist/index.ts`: aprovado sem downloads.
- `npm run lint`: zero erros, oito avisos anteriores. Build/tipos com URL/chave publicável sintéticas no processo; nenhuma alteração de `.env`.

Resultados finais e hashes estão em `verification.json`. Não houve alteração de interface, ensaio novo de navegador, Auth HTTP real, chamada externa ou publicação nesta rodada. O componente e o tradutor de erros existentes têm regressões unitárias no comando acima.

Fechamento: **37 testes/2 arquivos**, **65 migrations/43 suítes SQL**, 16 casos concorrentes de pedidos, 14 de decisões e nove de arrays aprovados; cleanup confirmado. O modo dirigido omitiu as sete famílias de regressão listadas no próprio JSON; nenhuma nova execução de upgrade foi necessária, pois não houve mudança de schema/funções SQL. Baseline SQL `7b8015556c4c16a678f65aa61589e687841fbd9b`, com overlays próprios; ajustes D17 que o Claude está escrevendo na árvore compartilhada não entraram nessa execução congelada. Deno, tipos/build e lint aprovados.

## Limites e próxima etapa

Atualizar a página permite conferir uma filiação que efetivamente foi confirmada. **Isso não recupera a senha nem resolve uma identidade sem filiação.** Retomada/regularização precisam de operação durável, identidade dedicada verificável e do protocolo T31; não devolver senha antiga, inferir aprovação ou apagar contas por varredura. Nenhum reconciliador automático ou endpoint de recuperação foi criado.

Antes de concluir M2, ainda substituir provisionamento/setter por solicitação pendente, cortar concessões sem anuência e fechar leitores/escritores sobre pedido aprovado mais grant exato. Preservar os prontuários privados e o agendamento humano. PersonalMed e os arquivos do Claude foram preservados. Commit local main/axiscoachapp, sem push.
