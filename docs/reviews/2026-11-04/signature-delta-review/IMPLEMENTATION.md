# Revisão dirigida de `4b863b4` e `813ebc7`

04/11/2026. Entrada Claude 20:41; snapshot imutável `d5b3f9c8b0bdecc3ca2c16f05a6f8bf5b2f8e3aa`. Revisão somente leitura dos arquivos do Claude, com testes próprios. Nenhum handler, migration ou componente de produção foi alterado pelo Codex.

## Resultados

Os dois contraexemplos anteriores de fronteira Cf agora são reconhecidos; nomes com Cf interno e separador no mesmo item também são reconhecidos. Os novos testes cobrem o SID/algoritmo/padding do CMS, retomada `stored` sem token/PSC e callbacks antigos enquanto a tentativa nova está em `psc_requested`. Esses achados específicos tiveram correções, mas os casos adicionais abaixo impedem encerrar a revisão integral do delta.

Comando dirigido de Vitest: `src/lib/regulatedMedications.test.ts`, `src/lib/signatureFlow.test.ts`, `src/lib/pades.test.ts`, `src/components/DocumentComposerModal.test.tsx`: **86 aprovados, um ignorado, quatro arquivos**, 44,65 s. Essa execução usou a árvore corrente limpa desses arquivos; a prova adicional congela as fontes do snapshot indicado. Não foi repetido o conjunto global de 725 testes/87 arquivos relatado pelo Claude.

As reproduções do módulo usam implementação real congelada e PKI gerada em memória, sobre a fixture de banco/Storage dos testes existentes. [memory.json](memory.json) atesta os cinco arquivos originais e o executor; não é integração real de fluxo/banco/Storage. Inclui controle positivo que conclui normalmente e gera uma auditoria antes dos contraexemplos.

[verification.json](verification.json): **69 migrations instaladas, três suítes SQL selecionadas aprovadas, helper concorrente D17 aprovado**, incluindo controle que remove NOWAIT e observa a espera; cleanup final confirmado. Treze vetores do detector comparados com `7f699c4` e os dois estados do probe de falha tardia registrados. Não foram repetidos os 47 SQL globais, 29/16/14/9 de provisionamento/delegação ou upgrade T33. Os hashes identificam as fontes SQL/helper congeladas e os executores/probe próprios.

Houve duas falhas na preparação do novo harness: caminho de PDF sintético incompatível com `prescriptions_owned_path`, corrigido na fixture; e verificação de ausência da rede que só reconhecia `No such ...`, enquanto o Docker local retorna `network ... not found`. A inspeção independente confirmou recursos ausentes, a verificação foi corrigida e a rodada final repetiu SQL/probe/concorrência/cleanup. Nenhuma dessas tentativas anteriores foi usada como rodada GREEN global. Sintaxe/lint dos dois executores aprovados; revisão estática de segurança do harness sem outro achado, com limite de não executar Docker pelo revisor.

## Achados adicionais

### P2 — falha antiga encerra tentativa nova já ambígua

`signature_advance`, linha 577 da migration `20261105100000`: `failed` é cercado por tentativa somente se o estado atual for `psc_requested`. Depois que a tentativa 2 vira `ambiguous`, `failed(attempt=1)` atravessa a cerca e a transição `ambiguous → failed` é permitida. A operação continua com `psc_attempts=2`, encerrada pela falha da 1. A mesma chamada quando a 2 está `stored` é recusada pelo trigger com **22023**, não pela cerca P4094; não afirmar que esse segundo estado aceita a falha.

O CAS precisa proteger os resultados tardios em todos os estados pertinentes. Comparação separada antes do RPC não fecha essa janela. A reprodução SQL própria preserva a sessão, usa funções públicas como `service_role` e desfaz suas fixtures.

### P2 — resposta antiga recria objeto após limpeza encerrada

`signatureFlow.ts:250` faz upload antes do CAS `stored`; o catch de P4094 na linha 101 retorna `in_progress`. Roteiro observado: A espera PSC na tentativa 1; B repete e recebe recusa na 2; B encerra como `failed`, remove o caminho vazio e limpa a flag. A responde depois, cria o PDF e recebe P4094 ao registrar `stored`.

Estado final reproduzido: **failed, tentativa 2, cleanup_pending=false, um objeto, zero auditorias**. `signature_pending_work` não descobre terminal sem cleanup. Não basta só reler estado antes do upload: a limpeza e a escrita tardia precisam de protocolo que preserve o objeto concluído e torne a limpeza tardia detectável/idempotente. Nenhum descarte incondicional de caminho compartilhado entre tentativas.

### P2 — texto de reason é confundido com chave do PDF

`signatureCertificates` em `pades.ts:532` usa `lastIndexOf('/ByteRange')`. O valor de `/Reason` vem depois dessa chave e aceita o texto `Prescricao /ByteRange medica`. Primeira chamada verifica o artefato e armazena, mas quatro 40001 na conclusão deixam `stored`. Na retomada, a busca captura o texto do motivo, não a chave; retorna certificado ausente e o fluxo cancela com `stored_object_invalid`, removendo o PDF válido.

Reprodução em memória: antes **stored/um objeto/uma chamada PSC**; depois **cancelled/zero objetos/uma chamada PSC/zero auditorias**. A leitura estrutural da assinatura deve distinguir chaves de conteúdo textual. Nenhuma assinatura real foi usada.

### P2 — Cf junto ao separador decimal reduz a dose lida

`maxMg` em `regulatedMedications.ts:157` une Cf entre dígitos, mas não ao redor do ponto decimal. Em `Tramadol 150\u200b.0 mg`, o match cai no sufixo `0 mg`; o helper retorna `receita_controle_especial`. No snapshot anterior `7f699c4`, que removia Cf, o mesmo texto retornava `notificacao_a`; o controle sem Cf (`150.0 mg`) continua retornando `notificacao_a`.

O mesmo contraexemplo foi incluído com Cf depois do ponto e antes da vírgula. É regressão concreta na classificação textual conforme a própria regra de dose do módulo, **não prova de emissão indevida no endpoint completo**. Preservar nomes com leitura mista sem transformar fragmento numérico em dose menor; incluir esses vetores no teste antes da correção pelo dono.

## Reprodução e limites

```text
node scripts/test-signature-delta-review.mjs --source=d5b3f9c8b0bdecc3ca2c16f05a6f8bf5b2f8e3aa
node scripts/test-signature-flow-review.mjs --source=d5b3f9c8b0bdecc3ca2c16f05a6f8bf5b2f8e3aa
```

O primeiro executor instala SQL do snapshot em banco novo/rede interna local sem portas, executa suítes selecionadas, o probe de falha tardia e o helper D17 congelado. O segundo usa somente módulos virtuais em memória, sem rede/serviços. As asserções dos contraexemplos registram o defeito observado, portanto saída zero destes executores **não significa ausência de achados**. `reviewResolved=false` permanece explícito.

Revisão adversarial local encontrou os três casos de assinatura; Codex reexecutou os dois de memória. Revisão externa dispensada conforme preferência do usuário. Projeto SaaS, PersonalMed e arquivos do Claude preservados. M2/Auth não avançaram nesta rodada de resposta prioritária; o incremento `2f0a155` permanece laboratório. Proposta futura de handlers ainda precisa de contrato: revalidar no Auth antes de `signature_complete` é necessário, mas uma consulta HTTP anterior não cerca atomicamente logout/expiração durante o RPC. Não há aceite de handler, provedor, emissão, certificado real, deploy ou banco hospedado por esta revisão.
