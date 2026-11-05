# T31/3b/2c/3b — recovery em andamento composto com reserva e sessão

05/11/2026. Prova local na base `5fe74ce`, sem mudança em SQLs de protótipo, migrations, endpoints ou prontuários do aplicativo.

## Resultado

Dez grupos passaram em cada Auth v2.197.0/v2.189.0: seis regressões da fatia3a e quatro grupos novos de concorrência. [197](v2.197.0.json), [189](v2.189.0.json), [verificação](VERIFICATION.json). O verify antigo foi recusado pelo mecanismo transacional existente ao tentar persistir metadata anterior à senha reservada. Não restou sessão ou binding dessa tentativa. Senha, operação, revisão, geração e autorização confirmadas permaneceram intactas.

Isso cobre um caminho específico do contraexemplo anterior, com o ledger CAS e hook instalados. Não houve normalização da metadata para fazer o teste passar nem relaxamento da validação do worker. A emissão nativa de uma recuperação nova continua disponível como repair, com leitura e refresh sem dados. Esse controle não ensaia uma nova alteração de senha por esquecimento/reset; esse fluxo completo ainda depende de contrato próprio.

## Evidência sem aceitar erro genérico como prova

1. Verify nativo é observado em uma barreira BEFORE STATEMENT antes do UPDATE de recovery_token. Uma segunda chave transacional permite ao Admin concorrente terminar sua escrita reservada enquanto verify ainda aguarda. O Admin responde200, remove todas as sessões anteriores e o replay sequencial do link recebe403/otp_expired.
2. Login com a senha pessoal recebe vínculo password. Conclusão privada do dono confirma uma vez, revisão2→3; pessoal lê1 e JWT inicial ainda válido lê0. O estado privado autorizado é capturado antes de liberar verify.
3. Depois da liberação, um observador deferred adicional é comprovadamente alcançado pelo backend Auth. Sua condição exige phase=password_set, XID diferente da escrita de senha e operação/revisão divergentes na metadata candidata. Ele apenas pausa; **não rejeita e não altera o estado**. Seu nome AA o coloca antes da guarda deferred existente.
4. Liberado esse segundo observador, o verify recebe500/`unexpected_failure`. A condição vista é a mesma que obriga a guarda existente a rejeitar. Estado privado integral e marcadores canônicos continuam iguais; há exatamente uma sessão/binding persistidos e o JWT pessoal continua lendo1. Assim, a única sessão sobrevivente é a pessoal, sem sessão tardia escondida.
5. Recuperação nova e refresh nativos recebem repair e leem0; pessoal continua1. Um pedido Admin posterior com senha/operação erradas é recusado, a senha perdedora não autentica e a vencedora continua lendo1. Nenhuma revisão/geração/autorização é reinicializada.

O500 isolado nunca satisfaz a prova: o teste exige observação da condição exata na transação, rollback, contagens/identidade da sessão sobrevivente e controles positivos posteriores. O ensaio não implementa o tratamento desse erro na interface.

## Reprodução e revisão

```powershell
node scripts/test-initial-password-auth.mjs --setup-fence --setup-inflight --all
```

O modo novo chama o exercício3a congelado antes dos casos adicionais. Captura seis fontes: harness, dois módulos e três SQLs; os SQLs e o módulo básico permanecem intactos. Artefatos próprios preservam os relatórios anteriores. As duas barreiras e funções observadoras existem somente no DB descartável e são removidas em finally; o harness confirma limpeza de containers/rede próprios antes de emitir relatórios.

Auth/PostgREST/PostgreSQL reais, imagens em cache, endpoint Docker local verificado/pinado, rede interna sem portas publicadas/SMTP/rota externa. Tokens/senhas sintéticos ficam em memória/entrada padrão; relatórios contêm somente resultados e hashes de fonte. Sintaxe dos dois scripts, ESLint recomendado com globals Node explícitos, três combinações de flags recusadas antes do Docker, hashes e diff-check aprovados.

Revisão adversarial local, com contexto isolado/somente leitura, examinou módulo, roteamento, dependências, base e relatório197 sem achado material; não executou testes. Revisão externa dispensada conforme preferência do usuário. Build/frontend/SQL de produção e demais modos antigos não foram reexecutados; as seis regressões3a foram repetidas dentro deste modo, nas duas versões.

## Limites

Não aprova T31 inteiro ou qualquer promoção do SQL para produção. Ainda faltam PKCE em andamento, outros caminhos/snapshots nativos, MFA/upgrades, fronteira HTTP/Edge de contexto verificado, concorrência da conclusão/revogação, manutenção criptográfica, contas existentes/reset e integração RLS/RPC/storage/frontend. A recusa do snapshot antigo neste cenário não substitui esses ensaios. Próximo recorte: conclusão e revogação em duas conexões, incluindo resultado ambíguo e ausência de autorização com sessão removida.
