# K1/4j1 — leitura do catálogo de atendentes

Contrato de transporte entregue por Claude0926 em be5b794 e mantido em b7f424d/v1.4. Este incremento prepara somente o leitor; não transfere conversa nem apresenta um destinatário como autorizado. O produtor conserva a responsabilidade pela elegibilidade e pela ambiguidade global. Os dois achados1011 passaram no reteste dirigido de b7f424d; o seletor4j continua em recorte separado, depois da prioridade K2.

Entrada local estrita: `{before?:string|null,limit?:number}`. Padrões before:null e limit:50; limite inteiro1–50. O wire envia só `{action:'assignees',before,limit}`. Não aceita ator, clínica, conversa ou alvo no corpo. A versão entregue emite cursor `a1.<UUID canônico>`; validar forma, ecoar bytes completos e verificar associação à última linha/avanço, sem fabricar cursor para a próxima página.

Resposta estrita: `{items:[{userId,name,role:'reception'|'admin',ambiguous:boolean}],nextBefore:string|null}`. Máximo50 e no máximo o limite pedido, UUIDs distintos em ordem crescente, posteriores ao cursor solicitado. Cursor não nulo exige página não vazia e corresponde à última linha. Nome literal preservado, não vazio/em branco e até256 caracteres; sem telefone, e-mail, escopos ou campos extras. Vazio não equivale a canal conectado ou equipe completa.

Ambiguous true é preservado; o leitor nunca o converte em autorização ou seleção. Nomes iguais na mesma página (NFC, trim e caixa pt-BR) precisam estar todos marcados true; caso contrário a página inteira é inválida. Isso detecta inconsistência local, sem certificar nomes fora da página ou corrigir a lacuna500/truncamento do produtor. Nenhuma fusão de pessoas, apelido inferido ou UUID exibido como desempate.

AbortSignal é encaminhado, pré-cancelamento impede chamada e resposta tardia cancelada não é devolvida, inclusive durante leitura do erro. Erros públicos são locais/genéricos por código conhecido, sem detalhes brutos ou retry automático. directory_unavailable significa catálogo indisponível, nunca página vazia ou incompleta. Sem prazo de transporte adicional, cache, auto-paginação, DTO de escrita ou chamada Meta. Uma página é um snapshot parcial, não uma lista completa imutável.

Próximo recorte, após produtor corrigido: leitor fresco por contexto, paginação explícita, bloqueio de ambíguos e do próprio ator, confirmação ligada à conversa/alvo/revisão/readVersion e releitura após act/assign. UI e autorização/CAS do servidor permanecem provas separadas. K2 e importação/P1/P2/P4 não são alterados por este leitor.
