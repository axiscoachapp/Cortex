# T30 — Continuidade clínica durante indisponibilidade do acesso

04/11/2026. M1 da revisão cruzada. Sem migration, alteração de autorização do servidor ou exceção aos gates de sessão/MFA e troca de senha.

## Limites

Manter visível somente a página clínica já aberta para a mesma conta, depois de uma resposta válida de `clinic_access` cujo `actorId` corresponda ao usuário autenticado, **verificada nesta montagem do gate**. Sucesso antigo em cache não pode montar novos leitores antes dessa conferência. A identidade da página inclui a entrada completa da navegação (`location.key`, inclusive query/hash), e a árvore precisa continuar montada. Uma indisponibilidade de transporte confirmada recebe aviso não modal e tentativa manual. Não afirmar que dados foram salvos ou que novas ações funcionam sem conexão; as APIs continuam verificando permissões no servidor.

Não continuar no primeiro carregamento, em outra conta, em outra página ainda não aberta sob o acesso válido, na área `/recepcao`, nem para uma identidade de recepção. Autodeclaração em metadata e erro genérico não autorizam continuidade. Resposta válida que muda papel/ativação mantém as regras atuais; médico fora de uma clínica continua dono do seu ambiente privado, sem ganhar acesso à recepção.

Uma negativa de autorização, sessão inválida, resposta malformada, erro desconhecido ou `actorId` divergente bloqueia a página. Registrar essa negativa no estado da query como resultado indisponível (`null`, somente no cliente); uma falha de transporte posterior não pode recuperar o papel antigo, inclusive após remontar o gate. Uma nova resposta válida pode liberar novamente. O último contexto pode manter a árvore anterior oculta para preservar rascunhos na mesma página/conta, mas nunca servir como autorização de continuidade depois da negativa.

O bloqueio deve alcançar também portais de documentos/popovers e a captura de áudio, sem perder o estado. Propagar o estado de ocultação pelo contexto já usado pela sessão, sem sobrescrever um bloqueio externo; cobrir os portais com a mesma proteção visual. A recuperação de uma negativa usa um modal superior acessível: só CSS não suspende os mecanismos de foco/pointer/ARIA de um diálogo já aberto. Essa recuperação não abre sobre o bloqueio externo da sessão. A verificação de acesso usa `networkMode: always` para que o offline real não pause silenciosamente a query conservando um sucesso antigo.

## Classificação do transporte

Somente a chamada `clinic_access` usa a classificação específica. O cliente PostgREST instalado transforma falhas de fetch em `status:0`, código vazio e prefixo do tipo da exceção. Aceitar apenas nomes de fetch/rede/abort/timeout conhecidos; `SyntaxError` e exceções soltas permanecem bloqueantes. HTTP 502/503/504 sem código estruturado e combinações documentadas de conexão/pool (`503/PGRST000–002`, `504/PGRST003`) também são indisponibilidade. Não interpretar 401/403, `42501`, erro de JWT ou código desconhecido como transporte, mesmo com status contraditório.

Referência primária: [códigos de conexão do PostgREST](https://docs.postgrest.org/en/v14/references/errors.html#group-0-connection). Conferência local: `node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts`, catch de fetch/status zero. Não registrar mensagens brutas, tokens, prontuários ou payloads em diagnóstico.

## Provas

- Primeiro carregamento recusado sem montar leitores; sucesso clínico → transporte → recuperação sem desmontar, trocar o texto do rascunho ou tirar foco.
- Negativa → transporte continua bloqueada, inclusive remontagem; recuperação válida libera novamente. Repetir com resposta inválida e ator divergente.
- Troca de conta não herda a autorização; mudança para recepção e desligamento mantêm bloqueios. Admin na recepção não herda continuidade clínica.
- Classificar respostas de rede/gateway/pool na fronteira real da API; erros de autenticação/JSON/servidor desconhecidos não recebem a classe de transporte.
- Navegador isolado com dados sintéticos/loopback, 150%, 390/768/1280/1920 px: aviso legível, ações/rodapé alcançáveis, sem perda do trabalho aberto. Preservar os ensaios anteriores de privacidade da recepção.

Aviso em fluxo de layout, sem dialog/overlay ou mudança de foco. O shell da página pode usar a altura restante somente durante o aviso; navegação, componentes e marca existentes ficam preservados.

Durante captura já iniciada, a faixa que vive em portal entra no fluxo acima do aviso, com sua altura real (inclusive linhas quebradas em celular). Não sobrepor o aviso à faixa nem cobrir controles de gravação. O modal superior é exclusivo do bloqueio; indisponibilidade elegível à continuidade não abre modal.
