# T48 — leitura verificada dos vínculos administrativos

A lista administrativa agora exige sucesso desta montagem e leitura ociosa. Durante consulta, pausa ou erro, retira nomes, nascimento, nome do contato, contagens, cursores e entradas dos editores. O erro público é genérico. Corrigir, suspender, reativar e paginar conferem o snapshot atual antes da ação; os guardas de disponibilidade e os identificadores explícitos continuam iguais.

Somente admin clínico ativo, ator autenticado correspondente e sessão visível montam o leitor. A chave é própria por instância: troca/perda de contexto desmonta e cancela só aquela leitura; nova abertura começa na primeira página. O AbortSignal opcional chega ao RPC existente, preservando corpo, DTO, ordenação/cursor, limite de 50, deadline de 20s e chamadas sem sinal. [Contrato](../../../product/clinic-crm/CONTACT_LINK_READS.md).

## Evidência

- Doze controles antigos verdes. Contra as duas fontes originais de `0693cddd5ee9b7675d045fa3e6bf3cf2064f5e9b`: 21 falhas esperadas e quatro controles, entre 25 casos novos; restauração byte a byte conferida por hash. A suíte final passou 150 testes em dez arquivos, inclusive os editores existentes e T45–T47.
- SDK Supabase instalado 2.86.0/PostgREST com fetch em memória: 13 grupos, 12 POST, três hashes estáveis e nenhuma rede nativa. Valida corpo canônico, DTO/contato/cursor/ordem/limite, pré-aborto, aborto em voo, retorno tardio e compatibilidade sem sinal. O prazo é controlado nos testes, sem esperar 20s reais.
- Tipos da aplicação (`tsconfig.app.json`), lint dos oito arquivos de código, sintaxe dos três scripts e seis rejeições de CLI passaram. [Validação estruturada](VALIDATION.json), [RED](UNIT_RED.json), [GREEN](UNIT_GREEN.json), [SDK](SDK.json).
- Edge isolado, somente fixtures sintéticas: 32 estados, 60 PNGs, larguras 320/375/1280/1920 e fonte a 135%; 357 fontes congeladas, 40 hashes de runtime e dois overlays. Foram 34 requests, dos quais 20 leituras da fixture de vínculos; quatro 403 e quatro erros de console deliberados. Nenhuma outra falha, acesso clínico, escrita, criação, reserva ou chamada externa. Cleanup confirmado. [Relatório bruto](../../2026-11-05/reception-app-audit/contact-link-reads-final/AUDIT.json).
- Navegador verifica carregamento inicial, duas páginas explícitas, retirada dos dados durante próxima página/atualização, 403, retry e fechar, com ações alcançáveis e sem transbordamento. Capturas de espera em 320 e ações da segunda página em 375 inspecionadas. Contexto, callbacks antigos, pausa e cancelamento são provas unitárias/SDK, sem abertura/envio dos editores no navegador.

## Revisão e limites

Duas revisões em contexto novo. O único achado acionável era da prova SDK: 51 cópias da mesma linha também violavam a ordenação e mascaravam o limite. A fixture final usa 51 UUIDs válidos e ordenados distintos. A segunda revisão não encontrou novo problema acionável, incluindo harness e proposta K2. Cross-model skipped: non-interactive context.

Uma rodada preliminar usava uma asserção de erro antes da notificação React e mock que devolvia dados antigos ao contexto novo; corrigidos e RED/GREEN repetidos. Saídas preliminares estão excluídas do manifesto. Capturas pendentes dispensam networkidle somente com estado de carregamento explicitamente conferido, preservando o deadline real.

O recorte protege consulta e entrada dos editores. Efeitos de uma correção/suspensão/reativação já enviada continuam separados; não promete aborto ou rollback de escrita. Não prova Auth, RLS, autorização, concorrência ou transação reais. Nenhum SQL, schema, produtor Claude, PersonalMed, hosted, Meta, carga, envio pago, deploy ou push foi alterado/executado.

A mensagem Claude0926 foi respondida com proposta de agregado K2 e cinco controles C5 verdes, sem declarar homologação completa do C5 nem reteste K6/corrida. K2 é a próxima prioridade, dependente da confirmação de contrato/fonte pelo dono C4; catálogo assignees/4j permanece integração separada. [Resposta](../../../../coordination/mensagens/2026-11-07-0940_codex-para-claude_k2-painel-contrato-e-controles-c5.md).
