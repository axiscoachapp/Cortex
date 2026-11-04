# T33/2 — custódia por recurso/conta e instalação atômica

04/11/2026. Implementação local em `20261104200000_reception_scoped_custody.sql`. Nenhuma publicação, banco hospedado, carga, envio ou arquivo do Claude alterado.

## Comportamento

Escritores de contas sem recurso compartilhado conseguem concluir transações simultâneas. A referência artificial única que causava `40001` entre médicos foi removida do runtime. Conta/recurso realmente disputados continuam sujeitos a recusa explícita para preservar a custódia; a interface/Edge já tratam o conflito existente.

Uma versão privada por conta protege autores, destinatários, donos e marcadores. Uma versão por identidade de paciente, compromisso, consulta, documento de conhecimento e modelo protege também pais ainda inexistentes ou sem dono. A guarda toca recursos diretos NEW/OLD, pacientes indiretos e só então contas/intenções. DELETE dos pais também toca versões, sem transformar referências já removidas por cascade em novas referências proibidas.

A inicialização da conta é BEFORE INSERT de Auth, antes de qualquer hook AFTER que grave configurações. Linhas privadas retêm apenas UUID/chave técnica/revisão como tombstones; nenhuma senha, cópia de hash, token, nome ou conteúdo clínico. Cliente/service role não recebem acesso direto. O wrapper sem argumento usado pelo domínio de modelos preserva a assinatura e exige o próprio auth.uid, conforme confirmação do Claude.

## Instalação segura

A migration força READ COMMITTED e, antes de trocar funções, bloqueia/incrementa o singleton antigo com NOWAIT. Uma intenção ou escritor que já ultrapassou a barreira antiga impede a instalação até terminar. Depois, reserva com SHARE ROW EXCLUSIVE NOWAIT todas as tabelas de referência, intent, membership, modelos próprios e Auth. Os locks permanecem até COMMIT.

Se a instalação encontrar operação ativa, falha e desfaz integralmente os DDL e o incremento inicial. O executor deve repetir a migration inteira em oportunidade adequada; não há retry automático nem efeito externo dentro da transação. O initializer BEFORE é criado uma única vez, evitando DROP TRIGGER/AccessExclusive atrás de leitores antigos de Auth. A tabela singleton permanece apenas como histórico de instalação, sem consulta pelas guardas novas.

## Evidência executada

- `node scripts/test-account-custody-epochs.mjs --resources`: 30 grupos dirigidos, 57 migrations anteriores/36 suítes SQL e todas as regressões existentes; cleanup confirmado. Resultado em `../resource-custody-epochs/RESULT.json`.
- `node scripts/test-account-custody-epochs.mjs --upgrade`: 37 grupos, migration real aplicada após o predecessor, 58 migrations/36 suítes SQL e regressões completas; cleanup confirmado em `RESULT.json`.
- Instalação do zero: `scripts/test-database.mjs`, 58 migrations/36 SQL, sete falhas injetadas de fronteira, recepção, dez ordens de agenda, 20 interleavings de lifecycle, modelos e oito ordens de exclusão.
- `npm run test:db:custody` executa os 37 grupos dirigidos de upgrade/recurso em banco próprio, sem duplicar as suítes já feitas pelo `test:db`. `TARGETED.json` distingue esse escopo (zero suítes históricas nesse processo).

O comando padrão `npm run test:db`, já chamado pelo CI, inclui a regressão dirigida de custódia após as suítes históricas. Nenhum teste histórico foi retirado. Os relatórios são emitidos somente depois de limpar containers/redes próprios.

Verificação geral adicional: **578 testes/80 arquivos** aprovados; lint sem erros/oito avisos anteriores; tipos do app/Node e das 26 Edge Functions aprovados. O build inicialmente recusou ausência de configuração pública, conforme a guarda existente; repetido com URL `.invalid` e chave pública sintéticas apenas no processo, passou sem backend real, arquivo de env ou alteração da guarda. A demora de 395s da suíte veio dos ambientes isolados por arquivo, conforme diagnóstico do runner; a execução completa terminou sem falha de teste. Uma repetição parcial iniciada durante a triagem foi interrompida após o sucesso da suíte completa.

As provas cobrem as duas ordens dos contraexemplos de auditoria prévia e dono NULL, quatro corridas em tabelas reais sob snapshot RR antigo, inicialização/versão de recurso posterior ao snapshot, namespaces, paciente indireto, OLD isolado de dono NULL, DELETE/cascatas e initializer seguido de hook AFTER real. A remoção proposital do advisory try produz espera/57014; com a implementação correta, a mesma disputa retorna imediatamente 40001 com lock_timeout desativado.

O upgrade é recusado com intenção antiga aberta, escritor interno de modelos antes do INSERT e escritor com RowExclusive sem passagem pelo singleton. Esse escritor interno é executado no contexto definer da RPC, sem conceder EXECUTE a clientes. A prova mantém leitores RR antigos de Auth, usa default de sessão RR e verifica o override para READ COMMITTED, rollback integral e repetição após o holder terminar. Após instalar, uma intenção antiga continua negando nova referência administrativa; writer RR pré-instalação é recusado, e nova escrita funciona enquanto o singleton retido está bloqueado.

## Revisão e limites

Revisão local de runtime em três leituras e de instalação em duas: corrigidas conversão indevida de ID bigint de auditoria, fixtures de horário/custódia estrangeira, NOWAIT mascarado por lock_timeout, falta de OLD/RR reais, ausência da ponte com o predecessor, isolamento de instalação e DROP de trigger atrás de leitor. Sem achado concreto remanescente nas leituras finais. Os revisores fizeram leitura estática; a execução foi feita pelo Codex principal. Revisão externa dispensada pelo usuário.

Os testes usam PostgreSQL real com bootstrap mínimo da Supabase, exclusivamente sintético. Não demonstram rollout do Auth hospedado, dimensionamento do piloto ou acesso a dados reais. Recursos compartilhados, inclusive o mesmo built-in, ainda podem gerar conflito legítimo. Medição de throughput/retries e retenção/limpeza dos tombstones seguem em T25/T24/T32; remover tombstones sem provar o efeito em snapshots antigos enfraqueceria a barreira.

A fixture de 2.500 contatos é uma verificação funcional com orçamento de 25s, não benchmark controlado. Em upgrade, predecessor/novo levaram 11.872/12.147 ms com transporte Docker; esses tempos não sustentam alegação de melhora de performance.

Sem mudança de DTO/RPC público, prontuários privados, compartilhamento explícito ou confirmação humana de agenda. Sem alteração de provedor de IA ou do carregador PersonalMed.
