# Página administrativa de vínculos: banco e API

05/11/2026, T05b/3c. Nova leitura paginada por clínica/contato para a administração clínica ativa, com os mesmos campos mínimos do editor de relação. A interface da listagem será a próxima fatia; nenhum botão ou fluxo de usuário foi acrescentado aqui.

## Contrato entregue

`reception_contact_links(clinic, contact, after = null, limit = 50)` retorna até 50 itens e cursor do último paciente quando há próxima página. O cursor pertence ao mesmo contato/clínica; UUIDs crescentes dão ordem estável sem OFFSET. Paciente arquivado ou médico inativo permanece identificado com disponibilidade falsa. Não retorna CPF, telefone, conteúdo clínico ou novos campos legais.

A autoridade privada administrativa existente verifica sessão humana, assurance e conta disponível, e trava a filiação administrativa. O novo leitor cerca também ator e contato com `FOR SHARE NOWAIT`; não amplia agendas ou acesso ao prontuário. `anon`, serviço, secretária, médico comum, administrador externo/inativo/em exclusão são recusados, inclusive quando a lista estaria vazia. Tamanho/cursor inválidos são erros, sem clamp silencioso.

Migration `20261105230000` reservada às13:37 antes de criar o arquivo. Acrescenta somente função/ACL; escritores, projeções antigas, identidade clínica, tabelas/estados e os três helpers T33 do Claude permanecem intactos. A função entra no catálogo explícito de limites das APIs. Tipos regenerados: nove linhas, somente a assinatura nova.

No cliente, a página usa o schema estrito de `LinkEdit`, limita itens, recusa campos extras/privados, revisões inválidas, outro contato, cursor incoerente, IDs repetidos/desordenados e itens que não avançam em relação ao cursor enviado. A falha de permissão continua sendo erro, sem virar lista vazia.

## Evidências

| Execução | Resultado |
|---|---|
| `node scripts/test-reception-delegation-api.mjs --link-page --red` | **72 migrations**, função ainda ausente com `42883`; [RED e limpeza](RED.json). |
| `node scripts/test-reception-delegation-api.mjs --link-page --types` | **73 migrations e 12 suítes SQL** aprovadas. Página padrão com 53 vínculos sintéticos, fronteira sem repetição, fim vazio, cursor de outro contato, limites, projeção idêntica ao leitor existente, autorização/MFA/RLS e disponibilidade. [Fontes, tipos e limpeza](SQL.json). |
| Concorrência no mesmo banco descartável | **Oito checks**: holders de filiação/conta/contato em RC e RR recusam com `40001`; liberação tem controle positivo. Retirada só de `NOWAIT` do leitor gera espera detectada por cancelamento `57014`; definição original restaurada em `finally`. Snapshot RR antigo após retirada do papel admin recusa, e nova transação recebe `42501`. |
| Vitest | **21 testes/três arquivos** (`contactLinksApi`, `linkApi`, `contracts`) aprovados; 11 novos. RED anterior registrou método ainda inexistente. |
| Qualidade | ESLint de cinco arquivos, sintaxe dos runners, typecheck app/Node, build sintético e hashes aprovados. Revisão independente sem falha material, com lacunas de cobertura incorporadas e artefato final conferido. Revisão externa dispensada pelo usuário. |

A cobertura ampliada inicialmente falhou ao preparar um vínculo de outro médico pelo RPC: o contato era privado à agenda anterior. A fixture passou a inserir explicitamente o vínculo sintético como owner do banco; não se concedeu um escopo nem se alterou o escritor para fazer o teste passar. Médico inativo e ator em exclusão são cobertos no leitor novo. Não foram desabilitadas as guardas de custódia para fabricar exclusão de paciente/médico com vínculo retido; as expressões de disponibilidade seguem o leitor existente.

O runner mantém a baseline congelada `f716e68` e captura quatro overlays, a suíte e o helper final; modos antigos usam catálogo histórico compatível e não sobrescrevem estas evidências. Somente dados sintéticos em PostgreSQL descartável, imagens locais em cache, endpoint Docker local fixado, rede interna, recursos rotulados e ausência depois da limpeza verificados. Não é Native Auth/HTTP nem navegador contra SQL. Não houve novo ensaio de navegador por ser entrega sem interface.

## Coordenação e próximos passos

Mensagens Claude13:40/13:48 respondidas uma vez: `pm-v2` registrado para o futuro carregador/S6 e confirmação médica por página visível incorporada à premissa D7 escolhida. A restrição indevida a clique individual da resposta13:44 foi corrigida às13:54; proposta de alergia permanece sujeita à conferência clínica individual. Nenhum schema/carregador/carga foi iniciado. A linha do ESTADO levada pelo commit paralelo `983d3e6` foi preservada, sem reescrever histórico.

Próxima candidata: abrir esta lista paginada na página de contatos da administração e reutilizar o editor existente, com cache por ator/contato e recuperação de erro. Suspensão/reativação continua separada, dependente de guardas em todos os escritores. T05b inteira, M2/corte/piloto permanecem abertos. Sem hosted, deploy, envio externo, chamadas pagas ou push; PersonalMed/SaaS preservados.
