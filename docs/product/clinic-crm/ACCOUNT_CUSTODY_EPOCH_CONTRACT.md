# T33 — proposta de barreira de custódia por conta

Estado: etapa histórica de laboratório T33/1, sem aprovação do candidato somente por conta. A linha singleton do predecessor pode recusar escritores de contas independentes com `40001`. **A alternativa somente por conta é insuficiente:** referências a compromisso ainda inexistente e a modelo com dono nulo exigem proteção também por recurso, ou outra regra explícita que preserve esses fluxos. Não promover esse protótipo.

Sucessor implementado localmente: [barreira por recurso e conta](RESOURCE_CUSTODY_EPOCH_CONTRACT.md), migration `20261104200000`. Este documento e o SQL somente por conta registram a etapa rejeitada; não substituem o sucessor. Sem aplicação hospedada.

## Invariantes

Manter o preflight de exclusão, marcadores monotônicos, privacidade, compartilhamento explícito e todas as guardas atuais. Uma escrita e uma intenção de exclusão que referenciam a mesma conta precisam disputar uma versão real, inclusive em REPEATABLE READ com snapshot anterior. Contas sem referência compartilhada devem poder escrever simultaneamente. `NOWAIT` deve continuar impedindo novos ciclos de espera atrás de locks já obtidos.

## Contrato proposto

Uma tabela privada guarda `user_id` e `revision`. Criar a linha no INSERT de `auth.users` por trigger SECURITY DEFINER; instalar a trigger antes de preencher as contas já existentes. Não criar linhas sob demanda nos escritores. Não há FK de cascade: a linha de versão permanece como tombstone técnico, sem nome, contato, credencial ou dado clínico, inclusive durante SET NULL/cascatas. Limpeza/retenção desses tombstones exige análise própria antes de remover a proteção de snapshots antigos; não incluir limpeza neste incremento.

`touch_custody_epoch(uuid[])` remove nulos/duplicatas, ordena UUIDs, obtém cada linha com `FOR UPDATE NOWAIT` e incrementa sua revisão na mesma transação. Linha ausente falha fechada com `55000`, sem fallback global nem autorização implícita. `lock_not_available` continua virando `40001`. Erro de snapshot do PostgreSQL também aborta a transação.

Preservar a assinatura sem argumentos exclusivamente para compatibilidade com `document_snippet_writer()`: exige `auth.uid()` não nulo e chama a variante explícita com esse ator, cujo modelo é sempre próprio. Não ampliar EXECUTE de nenhuma função privada. Marcadores de exclusão e revogação de escopos usam a conta explícita, independentemente do ator da sessão.

Claude confirmou em 04/11 06:40 que todos os chamadores atuais dos modelos têm ator e só gravam a própria conta. Um futuro carregador autorizado de `document_snippets` não poderá usar esse wrapper sem ator: deverá tocar explicitamente as contas de destino e verificar intenção de exclusão dentro do protocolo autorizado. Isso não concede EXECUTE ao service role, não cria carregador e não dispensa D2/D19 ou a autorização específica do schema/carga.

A guarda AFTER ROW coleta as contas das referências **NEW e OLD**, pelos argumentos da trigger, dono do paciente, dono/paciente do compromisso, documento de conhecimento, modelo ativo e consulta da prescrição. Primeiro toca o conjunto inteiro; resolve novamente as referências e aborta com `40001` se o conjunto mudou; depois valida somente as referências finais pelas verificações existentes. Isso cobre troca concorrente do dono de um pai entre coleta e toque. Polimorfismo de auditoria mantém o tratamento atual de compromisso ainda inexistente. Não inferir identidade/vínculo clínico de campo administrativo.

## Prova exigida antes da promoção

Reproduzir a falha atual em duas conexões e provar sucesso com contas independentes. Manter recusa quando há conta compartilhada, duas exclusões independentes, conta/snapshot antigo, paciente, autor/destinatário, vínculo indireto e mudança de referência. Reexecutar as oito ordens de exclusão, lifecycle de delegações, modelos de receita e cascatas. Provar conta antiga preenchida, conta nova inicializada, linha faltante negada e ACL privada. Adaptação de sonda SQL deve medir a conta marcada, preservando a checagem real de BEFORE INSERT + UPDATE do upsert.

Acrescentar provas de ausência→presença de compromisso auditado e de dono NULL→conta em modelo referenciado por escrita ainda não confirmada. Conta inicial ausente/nula não oferece linha de versão para disputar; a revalidação isolada do conjunto não fecha mudanças posteriores. Próximo desenho deve serializar essas identidades de recurso com versão real e sem espera atrás dos locks atuais. Não remover auditoria prévia nem tornar built-ins privados como atalho. A proteção global continua no aplicativo até provar a alternativa completa.

Fontes de semântica: [locks de linha e triggers no PostgreSQL 16](https://www.postgresql.org/docs/16/explicit-locking.html) e [snapshots e falhas de serialização](https://www.postgresql.org/docs/16/transaction-iso.html). O contrato exige prova executável adicional; a documentação não substitui os interleavings do aplicativo.
