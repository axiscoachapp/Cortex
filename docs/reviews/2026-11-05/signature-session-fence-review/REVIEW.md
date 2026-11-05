# D17 a10919d — revisão da cerca de sessão

05/11/2026, Codex. **Integração dos handlers ainda não aprovada.** O reteste das suítes existentes passou, mas as provas adicionais reproduzem três desvios do contrato. Claude permanece responsável pelas correções da migration/fluxo e dos seus testes.

Artefato congelado: `a10919d5773ef06e5946ad5f053addcfd51d48c4`. Contrato: `docs/prescriptions/ASSINATURA_HANDLERS.md` nesse snapshot. Só tipos, harnesses e documentação próprios foram alterados pelo Codex.

## Achados

### R1 / P2 — autorização criada após vencimento durante DELETE

`signature_begin_authorization`, linhas 498–503 do snapshot, confere o prazo e depois executa DELETE bloqueante dos estados OAuth vencidos. Outra conexão de serviço chama `signature_expire_sessions()` e mantém esse DELETE aberto; ele não toma 125/epoch pelo DELETE. O novo pedido passa pela cerca e espera na linha. `auth.sessions.not_after` vence antes de liberar o holder; depois do commit do holder, o pedido cria e confirma a autorização.

Prova SQL real: espera observada via `pg_blocking_pids`, vencimento observado **antes** da liberação e estado novo presente após o sucesso. Controle com prazo longo também espera e conclui ainda dentro do prazo. JWT exp permanece futuro; só not_after vence. `created_at` da autorização fica anterior ao prazo porque foi capturado antes do DELETE — ele não mede a hora real do INSERT e não foi usado como prova de aceitação tardia. [Dois resultados/controle](sql-verification.json), campo `oauthFenceReview`.

Adquirir todas as linhas necessárias com recusa por contenção antes da última leitura do relógio. Não reevaluar um conjunto de DELETE mais amplo depois do pré-lock e não manter aquisição bloqueante após a cerca. A sequência precisa de corrida que detecte a espera e de controle removendo a proteção, além do prazo longo.

### R2 / P2 — callback antigo cancela tentativa mais recente após revogação PSC

Em `signature_advance`, linhas 663–669, a negativa de sessão PSC produz `cancelled_by_revocation` antes das conferências de pertinência/tentativa em 671–700. A prova cria tentativa 2 em ambiguous, revoga a sessão pela API de serviço e entrega `stored` da tentativa 1. Resultado real: nenhuma recusa, tentativa 2 cancelada e cleanup_pending=true. O contrato exige P4094 sem tocar a tentativa mais recente.

[SQL](sql-verification.json), destino `ambiguous_psc_revoked`. O caso usa `signature_revoke_session`, sem escrever diretamente na sessão PSC. O CAS/estado/tentativa precisa preceder qualquer cancelamento/efeito; uma negativa de sessão não transforma um callback antigo em dono da operação atual.

### R3 / P2 — passo sem tentativa que deixou de ser pertinente lança erro

SQL real: `prepared` sobre ambiguous/2 recebe 22023; `complete` sobre cancelled_by_revocation recebe P4093, preservando estado. O contrato §3.3 manda devolver a operação atual para o passo sem tentativa que deixou de ser pertinente. [SQL](sql-verification.json), destinos `prepared_after_ambiguous` e `complete_after_cancelled`.

O fluxo real também reproduz o problema com a cópia em memória do banco: A reserva e aguarda o download original; B conclui o mesmo operationId; A retorna ao prepared e propaga 22023 em vez de devolver completed. A auditoria fica com uma publicação e uma chamada PSC; o erro é uma resposta falsa de falha ao pedido atrasado. [Prova do fluxo](memory.json), campo `terminalRace`. Não apresentar essa parte em memória como integração SQL; as duas chamadas SQL adicionais acima são provas separadas.

Classificar o estado/pertinência sob a trava antes de tratar o passo como produtivo; devolver histórico sem nova publicação, cancelamento ou URL pública. Ampliar o fake e as ordens concorrentes para não repetir a mesma rejeição do SQL como se fosse aceite do contrato.

### R4 / P2 de teste — contenção de Auth não observa a espera

Por inspeção do snapshot, os casos novos em `test-signature-concurrency.mjs:593–596/:641–643` só exigem erro 40001 numa chamada síncrona. Seu lock_timeout é 10s; sem NOWAIT a espera pode terminar em lock_not_available, convertido no mesmo 40001 pela função. Esses casos não distinguem a proteção correta do timeout. O `watchCompletion` anterior já tem observação de espera para outra linha, mas não é usado nesses dois casos.

Usar observador de bloqueio/processo e controle retirando **somente** NOWAIT de auth.sessions/auth.mfa_factors. O mutante deve falhar por esperar, não passar pelo timeout. Este achado é de leitura; a mutação específica de NOWAIT do Auth não foi executada pelo Codex. Os controles antigos do helper foram repetidos e passaram, com essa limitação explícita.

### R5 / P3 — forma validada depois da barreira

O comentário de `signature_auth_shape` e o contrato dizem validar antes de qualquer trava. As sete funções produtivas chamam `signature_lock` primeiro (por exemplo, linhas 494/512/533/580). Contexto malformado pode disputar a barreira antes de 22023; em contenção, a precedência de erro pode mudar. Leitura estática, sem efeito persistente/bypass reproduzido. Alinhar ordem e contrato; não é uma alegação de exploração do handler, que ainda não existe.

## Verificação executada

| Verificação | Resultado |
|---|---|
| Snapshot Git/SQL | 69 migrations e todas as 48 suítes SQL raiz aprovadas |
| Helper D17 congelado | Ordens antigas e novas de logout/fator/prazo, controles existentes e upload/fim aprovados; limitação R4 acima |
| Cinco probes SQL próprios | Dois controles anteriores preservados (P4094/ambiguous e 22023/stored), R2 e dois casos de R3 reproduzidos com expectativas exatas |
| Corrida OAuth própria | R1 reproduzida e controle longo aprovado, bloqueio observado |
| Fluxo congelado em memória | Controle normal e dois contraexemplos antigos corrigidos; R3 terminal reproduzida |
| Vitest dirigido | 59 aprovados e um ignorado em três arquivos: signatureFlow, pades e psc; sem suíte Auth nessa seleção |
| Tipos | Regenerados em DB próprio com postgres-meta v0.95.2 local: sete p_auth obrigatórios, p_data obrigatório e close/reconcile; 36 inserções/3 remoções |
| Verificações locais | Typecheck app/Node, Deno 2.9.6 offline de signatureFlow, sintaxe/ESLint dos três scripts e diff aprovados |

Evidências: [sql-verification.json](sql-verification.json) e [memory.json](memory.json). `reviewResolved=false`: um harness que confirma o contraexemplo não aprova o produto. A rodada não repete matriz completa de upgrade/custódia, navegador, build, Native Auth HTTP nem os 807 testes gerais relatados pelo autor.

## Reprodução e limites

```powershell
node scripts/test-signature-delta-review.mjs --session-fence --generate-types --source=a10919d5773ef06e5946ad5f053addcfd51d48c4
node scripts/test-signature-flow-review.mjs --resolved --source=a10919d5773ef06e5946ad5f053addcfd51d48c4
```

Migrations/suítes/helper D17/implementação do fluxo vêm do Git congelado. Os probes e runners próprios são overlays capturados com hashes e conferidos ao fim; o modo antigo usa o probe do seu baseline, preservando os relatórios históricos. Tipos são gravados somente depois do cleanup e da conferência de que o destino não mudou. A repetição final produziu o mesmo hash dos tipos já gerados, preservando o typecheck realizado sobre esses bytes.

Somente dados sintéticos e Docker local verificado, imagens locais sem pull, rede interna sem portas publicadas. Banco, metadados e rede tiveram labels próprios e remoção verificada; sem destino/env hospedado. Sessões/fatores são fixtures SQL compatíveis com a projeção nativa, não novo teste do serviço Auth/JWT real. PDFs, certificados e chaves do fluxo são sintéticos e ficam em memória; nenhum dado de paciente ou provedor real foi usado.

Revisão local adversarial corrigiu dois problemas das provas: fixture OAuth sem user_settings e comparação enganosa de created_at; também exigiu expectativa do caso revogado e proteção contra sobrescrita concorrente dos tipos. Execuções intermediárias falharam antes da aprovação final do harness; não contam como produto verde. Revisão externa dispensada pelo usuário. Sem edição de arquivos Claude, assinatura/VALIDAR real, cron, migração de pacientes, hosted, emissão, deploy ou push.
