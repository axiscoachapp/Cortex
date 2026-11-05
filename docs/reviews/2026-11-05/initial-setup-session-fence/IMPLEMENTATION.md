# T31/3b/2c/3a — senha reservada e vínculo privado de sessão

05/11/2026. Candidato de laboratório sobre a base `f2cd802`; [contrato restrito](../../../product/clinic-crm/INITIAL_SETUP_SESSION_FENCE_LAB.md). Nenhuma migration, endpoint ou guarda do aplicativo foi alterada.

## Resultado

Seis grupos passaram em cada Auth v2.197.0/v2.189.0: [197](v2.197.0.json), [189](v2.189.0.json), [verificação](VERIFICATION.json). O password write Admin nativo continua usando a reserva/operação/revisão/XID do protótipo anterior. Sua confirmação cria uma geração privada nova e mantém dados fechados. O hook nativo vincula cada sessão à geração e finalidade: password ou repair. Refresh conserva o vínculo; metadata editável não define a autoridade.

Uma conclusão privada, chamada somente pelo dono no ensaio, revalida usuário, sessão viva, operação/reserva/geração, vínculo password e CAS. A primeira chamada autoriza a geração e muda a revisão2→3; a repetição retorna sem mutação. Sessão repair e seu refresh são recusados na conclusão e na leitura. A função não tem EXECUTE para anon, authenticated, service_role ou supabase_auth_admin; a fronteira HTTP/Edge com contexto autenticado ainda precisa de implementação/prova própria.

## Casos observados

1. OTP inicial e refresh recebem repair, leem zero; controle de dono lê1. Metadata editável de propósito/geração não concede acesso.
2. Reserva e password Admin nativo chegam a password_set/revisão2/reserva1, geração nova e autorização nula. As sessões anteriores e seus bindings são removidos; JWT inicial ainda válido lê0.
3. Login por senha pessoal e OTP posterior recebem a mesma geração atual, com finalidades distintas. Ambos permanecem fechados antes da conclusão.
4. Repair, refresh e papel cliente não concluem; operação errada e revisão antiga recebem40001. Senha pessoal conclui uma vez, retry não muda revisão; pessoal lê1, repair/refresh/inicial leem0.
5. Controle negativo retira **somente** `b.purpose='password'` do leitor dentro do banco descartável. Repair e refresh passam a ler1. O finally restaura a definição exata; ambos voltam a0 e pessoal continua1. Esse controle confirma que o teste não passa apenas por falta de sessão/geração válida.
6. Logout local nativo revoga a sessão pessoal: JWT ainda assinado lê0, controle de dono1, refresh recusado. Novo login por senha lê1. Uma expiração de sessão inserida explicitamente pelo dono fecha leitura e conclusão; sua restauração permite leitura novamente.

O leitor exige também vínculo vivo da mesma geração/operação/reserva e claim de geração/finalidade correspondente. Hook e conclusão usam usuário→ledger e locks sem espera. Bindings acompanham a remoção das sessões por FK/cascade. A conclusão desta fatia recusa contas com fator MFA verificado, sem inferir que um JWT antigo ganhou AAL pelo estado atual da sessão. Admissão MFA legítima permanece fora do escopo, não é uma política proposta para produção.

## Reprodução e revisão

```powershell
node scripts/test-initial-password-auth.mjs --setup-fence --all
```

O novo SQL fica em `supabase/tests/prototypes/initial-setup-session-fence.sql`; os dois protótipos de base permanecem intactos. O harness congela cinco fontes, carrega o overlay apenas neste modo e ativa o hook somente no Auth descartável. Imagens em cache, endpoint Docker local verificado/pinado, rede interna sem portas publicadas/SMTP/rota externa. Hashes e limpeza própria confirmados nas duas versões; segredos sintéticos não entram nos relatórios.

Sintaxe dos dois scripts, ESLint recomendado com globals Node explícitos, três combinações de flags recusadas antes do Docker e diff-check aprovados. Evidências históricas preservadas. Revisão adversarial local em duas leituras limitadas, com contexto isolado e somente leitura, conferiu contrato, SQL, testes e roteamento sem achado material; não executou os ensaios. Revisão externa dispensada conforme preferência do usuário. Modos anteriores/build/frontend/SQL de produção não foram reexecutados nesta fatia.

## Limites e continuação

A hipótese ensaiada é a composição restrita de reserva, geração e finalidade, sem promoção de repair por refresh. Não aprova a conclusão completa de T31. Ainda faltam verify/recovery em andamento composto com CAS/hook, PKCE, MFA e upgrades, concorrência da conclusão em duas conexões, fronteira HTTP/Edge verificada, manutenção criptográfica, contas existentes/reset e integração RLS/RPC/storage/frontend. O contraexemplo de sessão tardia anterior continua sendo uma obrigação para o próximo ensaio; este teste não o declara resolvido.
