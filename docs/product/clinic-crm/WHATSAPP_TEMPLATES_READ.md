# K1/5a — leitura dos modelos sincronizados

O leitor usa somente a ação `templates` do contrato WhatsApp v1.2, com corpo exato `{action:'templates'}` e `AbortSignal` opcional. O produtor exige acesso à caixa, deriva clínica e canal e consulta os modelos armazenados. O leitor não transporta ator, clínica, conversa, filtros ou cursor e não sincroniza nem envia mensagens.

A resposta estrita é `{templates:[{name,language,category,status,body,paramCount}]}`. Os limites locais são:

- Até 1.000 itens; nome de 1 a 512 caracteres ASCII `[a-z0-9_]`.
- Idioma com duas ou três letras minúsculas e sufixo opcional de país, como `pt`, `pt_BR` ou `por_BR`, com até seis caracteres.
- Categoria e status com até 40 unidades de string; corpo com até 4.096; quantidade de parâmetros inteira entre 0 e 100.

Campos extras, campos obrigatórios ausentes e duplicatas de nome e idioma invalidam a resposta inteira. O mesmo nome em idiomas diferentes é válido. O leitor preserva ordem, texto e metadados vazios ou desconhecidos permitidos pelo armazenamento, sem normalizar, truncar, deduplicar, filtrar ou inferir parâmetros do corpo. `APPROVED` apenas relata o status armazenado; não autoriza envio.

Cancelamento prévio não invoca o transporte; cancelamento tardio ou durante a leitura do erro descarta o resultado. Erros usam mensagens locais e códigos conhecidos, sem detalhes brutos ou repetição automática.

Uma resposta vazia pode representar ausência de canal e não comprova conexão. A futura UI K1/5b deverá verificar acesso e conexão atuais, isolar consultas por ator e clínica, descartar resultados antigos, distinguir erro de catálogo vazio e permitir nova leitura explícita. O corpo será renderizado como texto, sem interpretar HTML, links ou parâmetros e sem preencher dados de paciente.

O endpoint atual não informa cursor nem total. O cliente não promete catálogo completo nem snapshot transacional. A consulta C4 ordena por nome e permanece sujeita aos limites de resposta do servidor. Paginação ou mudanças do produtor continuam com C4, se necessárias.

Este incremento não altera C4, C5 ou schema. A validação usa dados sintéticos e o SDK instalado com transporte em memória; não comprova UI, banco, autorização real, aprovação na Meta ou envio. Nenhuma carga, operação hospedada ou push.
