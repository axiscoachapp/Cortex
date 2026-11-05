# Instalação atômica do laboratório M2

Recorte após a fronteira de confirmação. Não é migration/upgrade produtivo, custódia ou política de retenção. Instala somente os dez overlays Codex conhecidos em banco descartável com Auth nativo e migrations do app já congeladas/aplicadas.

## Transação e fronteira

O instalador atual executa overlays em chamadas/transações separadas; uma falha tardia pode deixar produtores/guardas parcialmente instalados. O novo modo monta uma única transação READ COMMITTED e só publica a composição inteira no commit final. Remover somente os delimitadores externos conhecidos dos overlays; identity/intent são perfis sem transação, os outros oito exigem exatamente begin/commit e, quando presente, isolation READ COMMITTED. Recusar perfil/chaves/controle transacional inesperados e exigir o SHA-256 normalizado de cada uma das dez fontes revisadas, inclusive contra controles escondidos na mesma linha. Pins e locks exportados são imutáveis. Não oferecer um parser ou sandbox SQL genérico nem aceitar SQL do cliente.

Antes do primeiro DDL do protocolo, tomar auth.users em SHARE ROW EXCLUSIVE NOWAIT e public.clinic_members em ACCESS EXCLUSIVE NOWAIT, refletindo os locks já necessários aos triggers/coluna de geração. Se houver escritor/leitor incompatível, recusar e reverter tudo. Não alegar ausência de espera de todo lock de catálogo ou administração concorrente; DDL de DBA fora desses objetos não é a ameaça deste recorte. Não manter transação durante HTTP.

Dentro da mesma transação conservar as provas de corpo: check_intent antes/depois de mudar seu dono é idêntico; begin_intent só troca exists(Auth alvo) pelo leitor booleano. Helpers/T33 do app, funções nativas, ACL/colunas/enums/RLS Auth e os contratos de produtores não mudam. O instalador pertence ao executor confiável do laboratório; nenhum grant novo ao cliente/serviço.

## Provas requeridas

1. RED em uma versão Native: executar os seis primeiros overlays separados, injetar falha antes dos quatro restantes e observar protocolo parcial persistido apesar do erro. Somente instalação, sem alegar TOTP/fluxo ou falha de produção.
2. GREEN: falha intencional depois de todos os DDLs, antes do commit, deve deixar fingerprint anterior intacto: schemas/papéis/coluna/guards/owners/ACL, inclusive triggers em Auth. Sem DROP de reparação para esconder instalação parcial.
3. Duas conexões: escritores sintéticos reais em auth.users e clinic_members mantêm seus locks; a instalação recusa55P03 com mensagem de NOWAIT, excluindo lock/statement timeout, enquanto eles continuam abertos, sem efeito persistido. São fixtures SQL sobre tabelas reais, não HTTP Native em voo. Controle retirando somente NOWAIT do cabeçalho correspondente precisa ser observado esperando pelo holder na relação/modo/query esperados; ao liberar, alcançar a falha tardia e reverter tudo. Não aceitar timeout como prova de espera ou sucesso de rollback.
4. Instalação vazia/quiescente completa passa; repetição sobre namespace existente é recusada sem alteração. Isso não é migração de histórico nem idempotência produtiva. Depois executar as42 regressões Native de composição/produtores/fronteira nas duas versões Auth, com fontes finais/hashes/cleanup e nenhum grant/credencial.

O fingerprint deve considerar funções/triggers, donos/ACL de schemas/objetos/papéis e a coluna/trigger na filiação. A verificação da instalação não faz carga, limpeza ou inferência sobre dados antigos. Nenhuma duração de retenção, tombstone/remoção de histórico ou política jurídica será escolhida aqui.

## Limites

Migrations do app e bootstrap continuam fora da transação experimental; não afirmar instalação atômica do produto inteiro. Antes de produção faltam custódia/retenção, instalação/upgrade com histórico, adaptação de acesso do servidor, recuperação, corte/reconciliação/gate e API/UI. Sem pacientes reais/PersonalMed/importação, alterações hospedadas, provedores pagos, emissão, deploy ou push. Três helpers do Claude e trabalho SaaS preservados.
