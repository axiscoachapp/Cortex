# T31/3b/2a — comparação nativa de link inicial

04/11/2026. Laboratório sintético; nenhum fluxo do aplicativo, migration de produção, banco hospedado, envio ou credencial real alterado.

## Resultado

**Link consumível uma vez em sequência não garante uma única sessão em concorrência.** Em Auth v2.197.0 e v2.189.0, duas requisições nativas de `/verify` para o mesmo recovery token ficaram comprovadamente esperando uma linha bloqueada no banco. Após liberar a barreira, **ambas retornaram 200 e criaram duas sessões**. O replay posterior foi recusado com `403/otp_expired`.

Isso refuta a premissa de usar o consumo do link como exclusão mútua da conclusão. A alternativa sem uma senha temporária compartilhada continua possível, mas exige protocolo de conclusão confiável, serialização/CAS, reconciliação de resposta perdida e tratamento das sessões de setup. **Esse protocolo não foi implementado nem aprovado por este ensaio.**

Outro ajuste de premissa: omitir `password` em Admin create não produz hash vazio. O Auth gera uma senha aleatória interna; o cliente não a fornece nem a recebe. O ensaio verifica somente a presença do hash, sem ler/copiar seu valor, e a recusa de login com a senha sintética ainda não definida. O [código oficial de Admin create](https://github.com/supabase/auth/blob/v2.197.0/internal/api/admin.go) documenta a geração interna.

## Evidência executável

Comando: `node scripts/test-initial-password-auth.mjs --link --all`.

- Nove grupos por versão, registrados em `v2.197.0.json` e `v2.189.0.json`.
- Conta criada sem fornecer senha; login arbitrário recusado com `400/invalid_credentials`.
- `generate_link` devolve uma capacidade, sem criar sessão; rede interna sem SMTP ou rota externa impede entrega. API: [documentação oficial](https://supabase.com/docs/reference/javascript/auth-admin-generatelink).
- Consumo concorrente observado por dois backends Auth em espera de lock: `200/200`, duas linhas reais em `auth.sessions`. Não é apenas um par de Promises disparado sem barreira.
- Todas as sessões de setup recebem zero linhas da Data API enquanto a tabela privada está pendente. Edição de `user_metadata` não libera.
- Admin password write revoga todas as sessões emitidas e seus refresh tokens. JWTs anteriores ainda não expirados continuam recebendo zero linhas; `exp` é conferido com margem de 60 segundos.
- Login com a senha pessoal passa no Auth, mas recebe zero linhas antes da conclusão do aplicativo.
- Um recovery link ainda não consumido foi recusado com `403/otp_expired` depois do password write, nas duas versões. Isso **não** cobre verify já em andamento nesse momento.
- Uma alteração direta de fixture por postgres permite testar o controle positivo: sessão pessoal viva lê uma linha e JWTs revogados continuam lendo zero.

O `pending=false` é uma alteração exclusiva do dono do banco de teste. Não existe RPC de conclusão, endpoint, evidência transacional de senha nem reconciliação neste protótipo. Não confundir esse controle positivo com solução pronta.

## Isolamento e revisão

O modo `--link` reutiliza o harness local: endpoint Docker verificado/pinado, imagens em cache com `--pull=never`, containers/redes próprios e identificados, rede interna, sem portas publicadas. Dados, tokens e senhas sintéticos ficam em memória; relatórios contêm somente resultados agregados. O SQL remove o antigo observador de hash rejeitado e usa pendência privada mais sessão viva. Limpeza é obrigatória antes de emitir o relatório.

Revisão adversarial local encontrou classificações amplas de erro que poderiam transformar 500/429 em evidência falsa de revogação. Corrigidas para status/códigos nativos específicos, com nova execução. Segunda leitura estática sem outro achado no escopo restrito; o revisor não executou testes. Revisão externa dispensada pelo usuário.

Verificação final: 18 grupos do novo modo, 24 regressões de `--binding --all` e 18 de `--all` aprovados, com cleanup confirmado em todas as pilhas. `node --check` dos dois scripts, eslint direcionado e `git diff --check` aprovados. Nenhum componente do aplicativo mudou; a suíte de frontend não foi reexecutada por este incremento de laboratório.

## Próximo incremento

Provar o protocolo de conclusão antes de integrá-lo: dois consumidores, duas definições concorrentes, resposta perdida, verify em andamento contra rotação, MFA/PKCE, contas existentes e reset privilegiado. Não promover este SQL para migrations. T31/3b/2 permanece aberto.

T33 registra separadamente a colisão global do epoch de custódia apontada pelo Claude; nenhuma assinatura desse mecanismo mudou neste ensaio.
