# K1/4j1 — leitor do catálogo de atendentes

O adaptador consulta somente `assignees` no C4 já entregue. Envia before/limit, sem clínica, ator, conversa ou alvo. Valida limite, DTO estrito, ordem/IDs únicos, associação e avanço do cursor. Preserva nomes e flags; rejeita uma página cujos nomes visivelmente iguais não estejam todos marcados ambiguous. [Contrato](../../../product/clinic-crm/WHATSAPP_ASSIGNEES_READ.md).

O leitor não oferece uma pessoa como alvo autorizado. Nenhuma interface foi integrada; seletor4j é recorte separado. As correções de ambiguidade de b7f424d passaram no reteste dirigido abaixo. Não há escrita, auto-paginação, cache, sincronização ou envio Meta.

## Provas do cliente

- A implementação inicial deliberadamente incompleta está em [INITIAL_READER.ts.txt](INITIAL_READER.ts.txt). Os 73 casos iniciais ficaram RED por falta do comportamento. Após mais um controle do novo erro directory_unavailable, a implementação final passou239 testes em quatro arquivos: leitor74, leituras existentes55, modelos58 e transferência52. [RED](UNIT_RED.json), [GREEN](UNIT_GREEN.json).
- Os testes verificam corpo mínimo, nomes/flags/roles literais, vazios, limites, cursores, IDs repetidos/fora de ordem/anteriores ao cursor, colisões visíveis, excesso de campos privados/autoridade, erros locais, ausência de retry e cancelamento antes/depois/durante leitura do erro.
- [SDK instalado](SDK.json), Supabase 2.86.0/FunctionsClient com fetch em memória: 16 grupos, 14 POST, dois hashes estáveis, zero requests inesperados e zero rede nativa. Inclui duas páginas explícitas, flags, vazio, erros/JSON inválido e cancelamento tardio/em voo; entrada com autoridade e pré-aborto não fazem chamada.
- Tipos da aplicação (`npx tsc --noEmit -p tsconfig.app.json --pretty false`) passaram, assim como lint dos cinco arquivos de código e sintaxe dos três scripts. A verificação de tipos ocorreu na árvore compartilhada, com mudanças paralelas; somente os próprios caminhos entram na entrega. [Validação estruturada](VALIDATION.json).

## Achados do produtor

[PRODUCER.json](PRODUCER.json) executa apiHandler congelado de `be5b794dcdf6aea51cde7cc896c5a44204e6cfee` com autorização/store falsos que respeitam ordenação e limite. Quatro controles passam; dois casos ficam RED:

1. Com 501 pessoas elegíveis e o mesmo nome nas posições1/501, ambas saem ambiguous:false em páginas distintas. O contador de nomes só examina500; o store real também limita esse resultado.
2. Nomes distintos de257 caracteres com prefixo256 igual são comparados antes de slice e saem com o mesmo rótulo e ambiguous:false. O writer atual de user_settings permite até1000 para doctor_name; a fonte congelada mais recente (`20261104130000`) está na prova.

São reproduções do handler em memória com alcance sustentado pelas fontes. Não provam autenticação, elegibilidade SQL/PostgREST ou existência desses dados em clínica real. [Mensagem1011 ao dono C4](../../../../coordination/mensagens/2026-11-07-1011_codex-para-claude_assignees-ambiguidade.md) pede correção sobre todos os elegíveis e sobre a forma exibida, sem desempate por UUID/inferência. Nenhum produtor foi editado. A recusa local de colisões na página não conserta nem certifica o resto do catálogo.

Durante o fechamento chegou Claude1023 com b7f424d. [Reteste do catálogo corrigido](PRODUCER_B7F424D.json): os mesmos seis casos passam, mais os controles de5000 elegíveis aceitos e5001 recusados com503 directory_unavailable, sem página parcial. As duas falhas1011 ficam encerradas neste recorte do handler. O resultado permanece limitado às dependências falsas e à fonte do store, sem prova nova de autorização/SQL. O agregado dashboard também foi entregue, mas não foi retestado nesta entrega de leitor.

## Revisão do ensaio

Três ciclos de revisão em contexto separado. O leitor e as reproduções não tiveram achado adicional acionável. Na revisão do SDK surgiu P2: FunctionsClient captura exceções de fetch; uma asserção de corpo falha poderia virar unavailable e passar nos casos que esperam erro de rede/JSON. Corrigido registrando falhas do contrato da request em uma coleção conferida fora do SDK.

[Controle negativo](SDK_CONTROL.json), reproduzível por `whatsapp-assignees-sdk-control.mjs`: injeta duas incompatibilidades de corpo nos casos lost/truncated e exige rejeição das duas. Remover só o registro reproduz a aceitação falsa aparente de16 grupos/14 chamadas. O controle trabalha em memória, isola os módulos/globals, não regrava SDK.json nem altera fontes. Última revisão sem novo achado acionável. Cross-model skipped: non-interactive context.

Sem UI ou prova visual nesta entrega, pois o módulo ainda não é montado por uma tela. Sem Auth/DB/transferência reais, Meta, dados reais, hospedado, carga, deploy ou push. P1/P2/P4, arquivos Claude, reservas de migrations, PersonalMed e SaaS preservados. K2 mantém prioridade: contrato/fonte C4 recebidos1023, próximo reteste do agregado e consumidor, sem pedido repetido.
