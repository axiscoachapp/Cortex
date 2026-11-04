# T31/1 — catálogo e barreiras das funções da recepção

## Escopo e decisão

Este incremento fortalece a verificação local de permissões. Não altera migrations, funções de produção, dados hospedados, interfaces nem contratos de importação. T31 continua aberta para a credencial inicial e o gate externo de MFA.

**Hipótese verificável:** os testes devem detectar tanto um auxiliar privado exposto por grants diretos quanto uma redefinição que perca a barreira dedicada à identidade de recepção. Procurar apenas `assert_clinical_actor` no texto da função, ou aceitar qualquer erro de recurso ausente, não comprova essa barreira.

A revisão original L3 citou auxiliares de exclusão/storage. As revogações já estão em `20261101000000_review_hardening.sql`, inclusive os grants diretos de `anon`/`authenticated`. A auditoria das 57 migrations instaladas não reproduziu a exposição. Reaplicar revogações sem falha demonstrada duplicaria uma correção existente.

O bootstrap descartável, porém, só reproduzia defaults de tabelas/sequências. Agora inclui os grants diretos de EXECUTE das funções públicas para `anon`, `authenticated` e `service_role`. A [documentação oficial da Supabase](https://supabase.com/kb/troubleshooting/custom-role-inherits-privileges-that-were-not-explicitly-granted) descreve esses defaults e a diferença em relação ao grant de `PUBLIC`. O ensaio simula a configuração permissiva dos projetos existentes; não pressupõe que todo projeto novo tenha os mesmos defaults.

## Verificações acrescentadas

- Probe transacional comprova os grants diretos: revogar somente `PUBLIC` ainda deixa a função executável pelos três papéis.
- Catálogo instalado: nenhum SECURITY DEFINER comum executável por `anon`; qualquer novo SECURITY DEFINER autenticado exige inclusão e revisão explícita. A lista tem 60 assinaturas: 31 clínicas, 20 operacionais de recepção, duas administrativas, duas de sessão, dois predicados clínicos, acesso, storage e busca de conhecimento. Assinaturas desaparecidas ou mudança do contrato SECURITY DEFINER/EXECUTE também falham.
- Identidades sintéticas de recepção ativa e inativa: 31 funções clínicas devem negar por `42501` **e pela mensagem da barreira dedicada**. As duas administrativas devem negar por `42501`. São 66 chamadas, além das verificações de predicados/sessão/acesso/storage/busca. As funções de modelos de documentos entram sem alterar o domínio do Claude.
- Storage usa paciente existente e caminho que passa como médico dono; o mesmo caminho falha como recepção.
- Busca usa fonte aprovada/indexada e vetor válido, com controle positivo como médico. A recepção não recupera fonte de outro médico. Uma fixture deliberadamente inconsistente marca o proprietário anterior como recepção, preservando sua fonte válida, para provar que a busca também nega conteúdo previamente próprio e chamadas service-role com alvo recepção. Esse estado é forçado só na transação de teste: o provisionamento normal o recusa.
- Sete falhas transacionais comprovam a sensibilidade dos testes: novo RPC autenticado sem revisão; auxiliar privado exposto a autenticado; auxiliar privado exposto a anônimo; redefinição clínica sem guarda; bypass só para recepção inativa; erro de recurso `42501` fingindo ser a barreira; busca sem guarda do alvo recepção. Cada execução precisa falhar no ASSERT esperado, sem aceitar erro sintático/timeout como prova. Uma execução limpa final comprova rollback.

## Revisão e reprodução

Revisão adversarial local em dois ciclos, somente leitura. Achados do primeiro ciclo corrigidos: busca nega por conjunto vazio, recursos NULL podiam produzir `42501` por outro motivo, e storage não tinha parent positivo. O segundo ciclo não encontrou novo problema concreto dentro do escopo; a execução continuou necessária e encontrou uma falha no próprio harness de mutações (`String.replace` interpretava `$$`). A inserção por callback preserva literalmente os dollar quotes SQL. Revisão externa entre modelos dispensada pelo usuário e omitida neste heartbeat não interativo.

Comandos:

```text
npm run test:db
node --check scripts/test-function-boundaries.mjs
npx eslint scripts/test-function-boundaries.mjs scripts/test-database.mjs
```

O runner cria seu próprio container PostgreSQL/pgvector, sem portas expostas, aplica o bootstrap e todas migrations e remove o container no `finally`. Não usa projeto Supabase, credencial, banco do SaaS ou banco hospedado. Fixtures e falhas ficam em transações com rollback. Evidência consolidada em `verification.json`.

**Execução concluída em 04/11 às 04:05:** 57 migrations/36 suítes SQL, sete falhas detectadas e execução limpa após rollback, concorrência de recepção, dez corridas de agenda, 20 de escopos, duas de modelos de documentos e oito cenários de exclusão aprovados (`test:db`, exit 0). Sintaxe Node e eslint dos dois scripts aprovados. Separadamente, revisão de `915311c`: 18 testes/2 componentes aprovados; diff/relatório/capturas móveis inspecionados, sem reexecutar o harness de navegador do Claude. A suíte geral de 538 testes não foi repetida neste incremento de testes SQL/scripts.

## Limites e próximos incrementos

- Este teste complementa as suítes de comportamento/concorrência existentes. Não é prova formal de todos os argumentos, de toda instrução interna, das funções SECURITY INVOKER, do serviço Auth ou de políticas hospedadas fora das migrations.
- As funções trigger ficam fora da lista de RPCs comuns: não são invocáveis como função SQL normal; seu comportamento continua nas suítes de triggers/custódia. As 20 funções operacionais têm seus cenários de escopo/dados/concorrência nas suítes existentes, sem nova ampliação de permissões.
- As mensagens de erro clínicas são parte intencional desta prova. Uma mudança de texto deve atualizar o teste com revisão; não substituir por aceitação genérica de `42501`.
- Ainda falta impedir uso direto de credenciais temporárias antes da troca de senha com estado confiável no servidor. O `must_change_password` de metadados editáveis pelo usuário e o gate visual não bastam. Implementação exige contrato próprio, incluindo sessões existentes, recuperação e integração com funções de documentos. Nenhuma troca de arquitetura Auth foi feita neste incremento.
- Ainda falta o ensaio/correção de recuperação do gate externo de MFA com documento já aberto. T30 cobre o gate de acesso da clínica; não comprova o gate externo.
- D18/M2 e decisões da migração permanecem pendentes. Nenhuma carga real, publicação ou chamada paga.
