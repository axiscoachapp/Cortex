# T31/3a — prova nativa da credencial inicial

## Resultado e escopo

O laboratório reproduziu duas liberações indevidas de estratégias candidatas, em Supabase Auth **v2.197.0 e v2.189.0**, com PostgREST v16.5 e PostgreSQL/pgvector 16. **Os candidatos foram rejeitados.** A correção de produção da senha inicial continua aberta; nenhuma migration, função Edge, RLS do aplicativo ou serviço hospedado foi alterado.

São nove grupos de verificações por versão (18 no total), além de dois diagnósticos de limpeza. JSONs por versão registram somente resultados/metadados de teste. `scripts/test-initial-password-auth.mjs` monta quatro containers próprios (banco, Auth, Data API e cliente Node) em rede interna sem portas publicadas ou rota externa. As imagens precisam estar no cache (`--pull=never`).

O script recusa override `DOCKER_HOST`, valida pipe/socket local e fixa esse endpoint em todos os comandos. Configurações/segredos sintéticos ficam em memória/env; material HTTP vai por stdin. Nenhum alvo de banco, chave real ou projeto Supabase é aceito. A propriedade dos recursos é verificada por label antes da remoção; a limpeza tenta todos os recursos, preserva o erro original e antecede a gravação do relatório.

## O que foi demonstrado

1. RLS apenas por proprietário permite ler a linha sintética antes da troca. A guarda candidata de estado pendente impede essa leitura.
2. Limpar `user_metadata` não limpa estado confiável; tentar alterar `app_metadata` pelo endpoint de usuário é recusado.
3. Senhas igual/fraca não liberam o estado.
4. Uma falha controlada após exclusão de outra sessão reverte, na mesma transação, senha, flag e sessões. A senha nova é recusada e a rotação válida pode ser repetida.
5. Após troca nativa, um JWT antigo ainda lê pela política de propriedade na Data API. A guarda candidata recusa ambos os JWTs iniciais. Não confundir revogação de refresh com revogação imediata do JWT.
6. No fluxo sequencial, refresh da sessão atual recebe claim utilizável; a outra sessão não consegue renovar. Isso confirma a revogação nativa transacional das demais sessões nesse cenário.
7. Login com a senha nova funciona e com a inicial falha após a troca válida.
8. **Login em andamento:** a requisição B passa pela validação da senha inicial e fica parada em uma espera advisory observada, no INSERT do audit de login, antes da emissão da sessão. A troca em A termina; grava-se um cutoff confiável ainda posterior. B é liberada, cria sua sessão depois do cutoff e seu refresh lê a linha protegida. As regras `estado false + claim false + sessão existente` e `session.created_at >= cutoff` foram insuficientes.
9. **Recifragem sem troca:** cria-se uma conta pendente com senha não cifrada e reinicia-se somente o Auth do laboratório com cifragem habilitada e chave sintética. Login com a senha inicial recifra o hash. A trigger candidata, que observava diferença em `encrypted_password`, limpa a pendência sem evento `user_updated_password`. Refresh e outro login com a mesma senha inicial leem a linha protegida. Mudança da representação não comprova mudança da credencial.

Os dois últimos casos precisam ser reproduzidos para o ensaio passar. Exit 0 significa **reprodução correta da rejeição**, não que os protótipos sejam seguros. O SQL em `supabase/tests/prototypes/initial-password-auth.sql` não é migration nem payload do aplicativo.

## Fontes e protocolo da prova

O [grant de senha do Auth v2.197.0](https://github.com/supabase/auth/blob/v2.197.0/internal/api/token.go) valida a senha antes da transação de emissão e também contém o caminho de recifragem sem troca. O [código v2.189.0](https://github.com/supabase/auth/blob/v2.189.0/internal/api/token.go) tem os caminhos equivalentes. A barreira do teste atua em uma instrução que o serviço executa normalmente; não altera a validação da senha nem fabrica JWT de usuário.

O [UserUpdate](https://github.com/supabase/auth/blob/v2.197.0/internal/api/user.go) persiste a nova senha dentro da transação, e a [persistência de usuário](https://github.com/supabase/auth/blob/v2.197.0/internal/models/user.go) revoga as demais sessões. A documentação de [sessões da Supabase](https://supabase.com/docs/guides/auth/sessions) recomenda a verificação de sessão existente quando necessária; o ensaio mostra que isso não basta para associar a sessão à versão da senha que foi verificada.

O laboratório tem tabelas sintéticas próprias; não aplica as migrations do Cortex. O bootstrap adapta os helpers de claims ao PostgREST, sem mudar a lógica nativa dos endpoints de autenticação. Não atesta configuração/versão do Auth hospedado nem a segurança de todo o aplicativo.

## Revisão e verificações

Revisão adversarial local identificou os caminhos nativos antes dos ensaios. A hipótese inicial de que o refresh sequencial sobreviveria à troca foi retirada ao confirmar a revogação dentro da transação; a corrida de login e a recifragem foram confirmadas. A hipótese adicional de duas trocas simultâneas permanece apenas inferida da fonte e **não foi ensaiada**.

Três ciclos de revisão local. Um ciclo foi interrompido pela plataforma após achados de infraestrutura; eles foram incorporados. A última leitura apontou recursos criados antes de uma falha de start e rejeição assíncrona precoce/JSON inválido. O script agora registra candidatos com labels antes de criar, separa create/start, verifica ownership, observa rejeições desde a criação, trata erros de parse/stdin e aguarda filhos na limpeza. `--check-cleanup` comprovou a falha após create e uma resposta interna inválida rejeitada antes do await do chamador. Não houve quarto ciclo nem revisão externa entre modelos, conforme preferência por verificação local.

```text
node --check scripts/test-initial-password-auth.mjs
node scripts/test-initial-password-auth.mjs --check-cleanup
node scripts/test-initial-password-auth.mjs --all
npx eslint scripts/test-initial-password-auth.mjs
```

Também revisado `d14f0e4` do Claude: redução de prévia assinada de receita para 300 s, com cinco testes de `prescriptionDocuments.test.ts` aprovados pelo Codex. Isso reduz a duração da capacidade de portador; não a torna revogável pelo JWT. Nenhum arquivo desse domínio foi editado.

## Próximo incremento

T31/3b deve provar um vínculo confiável entre a credencial verificada e a sessão emitida/renovada, cobrindo o login em andamento, antes de integrar a barreira às guardas existentes. A escolha de implementação continua aberta. Preservar `session_assurance_ok()`, `assert_session_assurance()` e `requireUser()` como pontos de integração do domínio de documentos. A validação pública por código de receita é exceção explícita de sessão; nenhum dado adicional é liberado.

Ainda não cobertos: duas trocas de senha concorrentes, resposta perdida depois do commit, recuperação/MFA reais, reset administrativo, contas existentes/backfill e integração das RLS/RPC/storage/Edge do aplicativo. O contrato em `docs/product/clinic-crm/INITIAL_PASSWORD_CONTRACT.md` contém esses critérios. Não fazer carga de migração, inferir autorização de paciente ou marcar T31/L2 como resolvida por este laboratório.
