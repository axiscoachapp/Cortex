# T32/L10 — consulta da agenda por médicos autorizados

05/11/2026. Implementação e verificação locais; base fixa `be5b04ed81855b355a5fbb88d8bc5875d68158d6`.

O achado L10 original permanece mensurável após T32/1c: a consulta usa índices de período, mas reavalia a autorização por compromisso. Com 5.023 reservas sintéticas, devolve 21 e executa 1.023 chamadas ao predicado de escopo. Os índices anteriores encontram 5.023 candidatos; o filtro descarta 5.002 no heap. Isso é custo de leitura, sem evidência de vazamento no resultado.

## Mudança e contrato

Migration `20261105270000_reception_calendar_scope.sql`, reservada no ESTADO às17:05 antes do arquivo. Enumera membros ativos da clínica e mantém somente quem passa pelo predicado canônico `reception_scope_ok`, respeitando o filtro opcional de médico. A lista é calculada dentro da mesma chamada STABLE, sem cache entre chamadas. As reservas usam `user_id=ANY(scoped_doctors)` e os bloqueios usam o equivalente por médico.

Hipótese submetida à revisão adversarial: esse pré-filtro preserva a autorização existente e permite selecionar os candidatos pelo índice do médico. O helper canônico já exige membro ativo para qualquer médico alvo não nulo; suas regras de ator, conta, exclusão, MFA e delegação não são reimplementadas. Admin sem delegação continua sem acesso à agenda alheia.

A mesma assinatura, ACL, DTO, SECURITY DEFINER, search_path vazio, ordenação, limites42dias/1000itens, erros e fallback limitado de intervalos inválidos permanecem. O filtro de origem continua separado: clínica explícita ou origemNULL somente para o próprio médico autorizado. Delegação nunca transforma origemNULL em agenda da recepção. Nenhuma mudança em prontuários, escritores, identidade, compartilhamento ou estado clínico.

## Evidências

Reprodução:

```powershell
node scripts/test-reception-calendar-scope.mjs --measure
node scripts/test-reception-calendar-scope.mjs
```

O runner usa imagem PostgreSQL16 já disponível (`--pull=never`), rede Docker interna e container sem porta publicada, identificados por rótulo próprio. Congela bootstrap/migrations/testes da base e captura os overlays do runner/migration. Usa exclusivamente fixtures sintéticas e confirma remoção do container, volumes e rede próprios antes de escrever o resultado.

- [MEASUREMENT.json](MEASUREMENT.json): medição inicial sem candidato;76migrations/88fontes. Registro histórico do runner anterior à correção da inspeção bitmap; seu hash não é o do runner final.
- [SQL.json](SQL.json): comparação antes/depois no mesmo banco descartável,77migrations/89fontes, dez suítes SQL e limpeza aprovadas. Resultado JSON completo do RPC como recepcionista autenticada é idêntico antes/depois, incluindo21itens e bloqueios.

| Medida na execução final | Antes | Depois |
|---|---:|---:|
| Chamadas de escopo por amostra (3amostras) | 1.023 | 3 |
| Mediana do RPC instrumentado | 998,156ms | 10,913ms |
| Reservas examinadas pelo índice por ramo | 5.023 | 21 |
| Linhas removidas pelo filtro do heap | 5.002 | 0 |

O plano novo utiliza `reception_appointment_period` com condição `user_id=ANY($5)`. Os três tempos anteriores foram881,759/1350,203/998,156ms; os posteriores9,868/11,627/10,913ms. Não há limite de tempo frágil no teste: o guard exige no máximo10chamadas de escopo nesta fixture, redução contra a base, índice por médico e igualdade integral do payload autorizado.

Fixture:21reservas autorizadas,1001da mesma clínica para médico não delegado,4000privadas de100outros donos e1de outra clínica. A densidade não amplia o limite de1000itens autorizados. As dez suítes verificam janela/bordas/1000→1001, intervalos inválidos, agenda, mudanças/CAS, origem da clínica, identidade, estado/permissões de vínculos, fronteiras das funções e ciclo dos escopos. Todas constam no JSON.

Medições do RPC real e da consulta interna extraída da definição usam `force_generic_plan`, conexões novas por amostra e cache de buffers já aquecido; o RPC também usa `track_functions=all`. A consulta interna é explicada como dono SECURITY DEFINER, com as mesmas claims; a igualdade dos resultados é verificada separadamente como `authenticated`. Os números são de laboratório sintético instrumentado, sem garantia de latência em produção, RUM ou medição da interface.

## Revisão e verificações adicionais

A primeira execução do candidato passou pela igualdade do payload e pela redução de chamadas, mas a inspeção do teste ignorava o filho Bitmap Index Scan. A falha da asserção foi corrigida no runner, restrita ao ramo de `appointments`; a comparação completa foi repetida com sucesso. Nenhuma regra SQL foi alterada para satisfazer essa inspeção.

Revisão local independente, com contexto isolado e somente leitura, conferiu função anterior, novo SQL, helper canônico e runner corrigido; nenhum achado substantivo. Revisão externa/cross-model dispensada conforme preferência do usuário. Sintaxe Node, ESLint recomendado com globals Node explícitos, hashes dos overlays e diff-check aprovados. O ESLint normal do projeto tem configuração vazia para `.mjs`, por isso foi usado o perfil explícito.

Não houve novo build/teste de interface, HTTP/PostgREST, corrida entre conexões, Native ou duas versões de Auth: o recorte altera somente a estratégia deste leitor SQL. T32 inteira continua aberta para retenção/privacidade e dependências T24; piloto/corte separados. Sem publicação, banco hospedado, carga PersonalMed, envios externos ou alterações em arquivos Claude/SaaS.
