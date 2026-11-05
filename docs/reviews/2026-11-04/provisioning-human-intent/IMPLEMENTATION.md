# T28/M2 — intenção administrativa vinculada à sessão humana

04/11/2026. Incremento local de laboratório após a prova da identidade Auth reservada (`2198989`). Implementa o [contrato](../../../product/clinic-crm/PROVISIONING_HUMAN_INTENT_CONTRACT.md) em schema privado descartável, sem endpoint, migration ou autorização de produção.

## Resultado e implementação

O executor valida o bearer no Auth nativo antes de extrair o contexto. O protótipo vincula operação e UUID planejado a ator, clínica, sessão, fator TOTP inicial e prazo fixo. Revalida as linhas atuais da conta/sessão/fator/filiação antes de reservar, despachar e confirmar; a confirmação exige também o receipt transacional do nascimento Auth. Outro fator verificado, mesmo na mesma sessão, não substitui o inicial. Replay não renova o prazo.

As aquisições das linhas de autoridade usam NOWAIT e o relógio é lido depois delas. Transações curtas não ficam abertas durante HTTP. Se logout, expiração ou perda de autoridade vencer enquanto o Auth cria a identidade, o nascimento pode concluir, mas a intenção permanece sem confirmação; a identidade é preservada, sem exclusão/recriação automática. A ordem inversa é observada: logout nativo espera a confirmação curta já cercada; o histórico fica, mas o replay após logout recusa.

SQL lê projeções mínimas das linhas nativas, sem copiar senha, hash, token ou segredo TOTP. O ledger guarda somente identificadores, prazo e fase. SQL recebe contexto confiável do executor; não verifica assinatura JWT sozinho nem deve receber identidade/nível de um body público.

## RED e GREEN observados

- [RED inicial](RED.json): após TOTP/AAL2 e nascimento nativos, logout retornou 204 e removeu a sessão. O candidato baseado só no contexto em cache aceitou a confirmação; a asserção falhou e a transação do teste desfez a confirmação.
- [RED do fator](FACTOR_RED.json): verificação nativa de um segundo fator na **mesma sessão** mudou `factor_id`; o candidato que aceitava qualquer fator atual aceitou a intenção antiga. Contraexemplo ocorreu antes de remover o fator original. A correção fixa seu ID na intenção.
- GREEN final: **17 grupos em cada Auth v2.197.0/v2.189.0, 34 ao todo**. [v2.197.0](v2.197.0.json), [v2.189.0](v2.189.0.json). Ambos têm `humanIntentLabProofPassed=true`, `productionAuthorizationImplemented=false`, hashes das quatro fontes e cleanup confirmado.

Os grupos incluem AAL1 recusado, TOTP/AAL2 genuínos, logout após validação, snapshot RR antigo, ator/sessão/UUID divergentes, replay e prazo original, falta de receipt, filiação/papel atuais, conta reclassificada, mutação concorrente sem espera e duas ordens do logout. Três nascimentos nativos são pausados por trava própria realmente observada enquanto, respectivamente, a filiação é revogada, o logout conclui ou o bearer expira. Todos preservam a identidade e recusam a confirmação administrativa.

A expiração do bearer usa Auth real reiniciado com JWT de oito segundos e passagem efetiva do relógio do banco; a sessão nativa continua presente. Prazo da intenção e `session.not_after` são **fixtures explicitamente alteradas**, assim como papel/status da tabela mínima. Não são provas do fluxo de administração da clínica. O teste do fator troca-o na mesma sessão, depois remove o original e comprova que a sessão continua viva e autorizável pelo segundo fator, enquanto a intenção antiga recusa.

## Execução, revisão e escopo

```text
node scripts/test-initial-password-auth.mjs --provision-intent --all
node scripts/test-initial-password-auth.mjs --provision-identity
node --check scripts/test-initial-password-auth.mjs
node --check scripts/test-provisioning-human-intent.mjs
./node_modules/.bin/eslint.cmd scripts/test-initial-password-auth.mjs scripts/test-provisioning-human-intent.mjs
```

Sintaxe e lint aprovados. Revisões locais de contrato e implementação em contexto novo identificaram a ambiguidade/troca do fator; o contraexemplo foi executado, corrigido e revisto, sem outro achado acionável no contrato delimitado. Revisão externa omitida conforme preferência do usuário. Nenhum teste de interface/build global é atribuído a esta rodada: aplicativo e Edge não mudaram.

Regressão do modo compartilhado `--provision-identity`: **15 grupos em v2.197.0 aprovados**, com hashes/cleanup no [relatório atualizado](../provisioning-auth-identity/v2.197.0.json). A versão v2.189.0 desse modo não foi repetida nesta rodada; seu GREEN anterior continua histórico. Não foram repetidos setup, matriz SQL de produção ou upgrade/custódia.

Runner verifica endpoint Docker local, imagens já disponíveis (`--pull=never`), rede interna própria sem portas/rota externa, propriedade dos recursos e limpeza. Dados e credenciais são sintéticos; material de autenticação só em memória/stdin, nunca no relatório. Cada execução compara hashes antes/depois; as fontes dos GREEN são as entregues nesta rodada. Os dois RED guardam hashes dos candidatos anteriores, não os do GREEN.

## Limites e próxima etapa

Atualização posterior desta data: a [composição com clínica real](../provisioning-clinic-authority/IMPLEMENTATION.md) centraliza neste protótipo a cerca da identidade Auth alvo em confirmação/check/replay e a checagem final de bearer/intenção/`not_after`. A regressão base v2.197.0 foi repetida: 17 grupos aprovados, relatório e hashes atualizados. O resultado base v2.189.0 acima é histórico, anterior a esse delta; a versão final é testada em ambas as versões no modo composto, com contagens próprias. Os limites seguintes descrevem o modo base, não negam a composição posterior.

A filiação é uma fixture privada mínima; **não integra `clinic_members`, custódia T33, instalação ou todos os escritores privilegiados**. Confere papel atual, sem provar invalidação monotônica de mudanças históricas/ABA. Não escolhe a geração de credencial/evento MFA de cada JWT preexistente (T31), política final de MFA, recuperação após prazo/novo login/troca de fator, credential setup, PKCE ou reconciliação de identidade já criada.

Próxima fatia: definir e provar essa fronteira com clínica/custódia reais e escritores, antes de integrar filiação/pedidos privados, cortar serviço/legado e abrir API/UI. A intenção confirmada não concede filiação, grant ou acesso clínico; M2/T31 continuam abertas. PersonalMed, helpers T33 temporariamente com Claude e produto SaaS preservados. Sem banco hospedado, carga real, envio, provedor pago, deploy ou push.
