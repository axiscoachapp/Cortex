# K6 — revisão do transporte WhatsApp

06/11/2026, Codex. Fontes C4 congeladas em `ebb866af7bff1e2685150d315f0564da20f352fc`. A revisão não aceita envio/automações dessa versão. Correções pertencem ao Claude, conforme a [mensagem2009](../../../../coordination/mensagens/2026-11-06-2009_codex-para-claude_k6-achados-whatsapp.md).

## Prova SQL executada

[SQL_REVIEW.json](red-ebb866a-final/SQL_REVIEW.json): 78 migrations e suíte original aprovadas no PostgreSQL descartável. Seis expectativas de contrato falharam, sem falhas de preparação; um controle passou. Exit1 significa achados reproduzidos, não falha de infraestrutura.

| Caso | Resultado observado |
|---|---|
| Consulta particular de médico participante | Incluída nos candidatos da clínica; controle de consulta explicitamente da clínica presente |
| Consulta cancelada | Reserva de automação preparada |
| Opt-out antes da reserva | Opt-out persistido, mas reserva preparada |
| Mesmo requestId com corpo diferente | Replay aceito; controle de payload idêntico retorna recibo existente |
| Resposta de outra conversa | Preenche reply de lembrete da primeira conversa |
| Telefone e BSUID previamente separados | Mensagem com ambos encontra colisão de unicidade, sem preservar processamento |
| Guarda interna com EXECUTE temporariamente concedido | Recusou42501; guarda funciona, além da ACL |

O runner próprio lê bootstrap, migrations e teste por `git show`, com80 fontes/hash no relatório. Só aceita Docker Desktop local, usa imagem existente pelo digest, sem portas/rede, e transações sintéticas. Remoção feita pelo ID completo criado; consulta `docker ps --all` bem-sucedida e vazia confirma ausência. Erro do daemon não conta como remoção. Sete testes Node cobrem falha/throw, sobrevivência e propriedade. A revisão do harness corrigiu a verificação antiga baseada em qualquer erro de inspect; o relatório final usa o helper corrigido. Passagens preliminares não fazem parte desta prova.

Reprodução, na raiz do repositório (nome de execução novo):

```powershell
node scripts/reviews/whatsapp-k6-sql.mjs --baseline=ebb866af7bff1e2685150d315f0564da20f352fc --run=novo-nome
node --test scripts/reviews/whatsapp-k6-cleanup.node-test.mjs
```

## Demais achados da revisão

As duas revisões independentes SQL/handlers também apontaram destinatário lido antes da reserva sem vínculo de revisão; automação sem confirmação do beneficiário/consentimento; resultado desconhecido após resposta perdida no envio e sucesso aparente quando a gravação do recibo falha; filtros inválidos de tipos convertidos em todos; leitura integral do webhook antes do limite; timestamp fora do intervalo de Date interrompendo parsing; cursor somente por timestamp perdendo empates. Localização, prioridade e correções pedidas constam da mensagem2009. Probes dos handlers foram sintéticos em memória; não são integração com Meta.

Os25 testes existentes dos handlers passaram, também na passagem conjunta com29 testes do cliente K1. Isso não cobre as seis regressões SQL novas nem elimina os outros achados. A leitura sintética de K1 pode continuar; comandos de envio/automações aguardam correções e reteste. Nenhum arquivo C4 foi modificado pelo Codex.

Limites: bootstrap local não é Auth/MFA nativo nem hospedagem real; não houve Meta, credenciais reais, envio, agendamento, deploy ou push. A revisão não homologa política externa, consentimento ou operação de produção.
