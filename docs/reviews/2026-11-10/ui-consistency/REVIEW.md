# Nova sessão de revisão integral da interface

Pedido manual de10/11/2026. Base local `f6683c4`, entrega `9083e08f6a0f6e9cc823da886b39d553020884ef`, branch main/axiscoachapp.39 caminhos próprios (38 fontes/testes e o executor de navegador). [Objetivo e aceite](../../../product/clinic-crm/APP_UI_CONSISTENCY.md), [manifesto](SOURCE_COMMIT.json).

## Resultado

As subpáginas autenticadas agora compartilham `WorkspaceShell` e `PageHeading`: navegação, contexto, largura, espaçamento, título, descrição e ações seguem uma estrutura comum. Configurações deixou a moldura lateral própria e passou a usar essa mesma navegação, com grupos de linhas e um seletor de seção em todas as larguras.

Agenda, pacientes, modelos, biblioteca, assistente, recepção, conversas, indicadores, contatos, equipe, delegações, pré-consultas, financeiro, segurança e privacidade foram revistos. Compartilhamento usa a mesma moldura. Login, páginas públicas e retornos mantêm seu contexto; os estados Google/assinatura/404 usam a identidade e tipografia existentes. Aviso de privacidade revisto sem alteração de conteúdo legal.

O consultório em andamento conserva sua estrutura e seus painéis montados; apenas os estilos da navegação lateral foram alinhados. Não foram alterados contratos, queries, DTOs, produtores, permissões, operações ou guardas de rascunho. A ilha de recuperação `/seguranca` continua fora de ClinicAccessGate e, sem acesso verificado, mostra navegação de conta; não monta leitores clínicos para preencher uma barra lateral.

## Ajustes dirigidos

- Ações principais mantêm texto e quebram linha no celular. Datas e filtros da agenda de recepção ficam alinhados; pré-consultas usa a largura disponível.
- Biblioteca não esmaga o título entre metadados e ação. Assistente usa um painel que comporta conteúdo e entrada, sem esconder os atalhos em320px.
- Segurança usa cartões e cabeçalhos coerentes, sem o título serifado e a marca isolada anteriores. Autenticadores têm estado vazio explícito.
- A navegação lateral compartilhada rola na região central; Configurações e Sair ficam disponíveis no rodapé também em telas baixas.
- Especialidade/prescritor continuam em consulta, copiloto desligado e parâmetros de contexto de Configurações preservados.

## Revisão independente

Três frentes de implementação com arquivos separados e um revisor de contexto novo, sem edição. O revisor encontrou um P3 visual: Adicionar/Cancelar autenticador ultrapassavam a borda dos cartões em320px/135%. Corrigido com largura limitada e quebra de texto. Rechecagem isolada com Montserrat real:231,6px e220,8px, ambos contidos. A captura compacta também revelou uma quebra evitável entre o seletor de área e Sair; retirada a lacuna vazia e ocultado apenas o ícone decorativo abaixo de360px. Revisor mediu183,98px+59,39px, centros alinhados e sem overflow em320/359/360/375px.

Nenhum defeito funcional ou de guardas encontrado no diff revisado. A escolha anterior do usuário por seguir com a revisão atual foi mantida; nenhum CLI externo/pago foi chamado.

## Verificação

- Suíte ampla:170 arquivos,2415 testes passaram, cinco falharam e um ficou ignorado. As cinco falhas eram de `BillingPage.test.tsx`, cuja fixture não fornecia AuthContext à nova moldura. Corrigida somente a fixture; nenhuma asserção de negócio retirada.
- Reteste final:58 testes/cinco arquivos verdes, incluindo os cinco cenários financeiros, proteção de rascunho, segurança e navegação/perfis. [Reconciliação](TEST_RECONCILIATION.json):2420 testes verificados entre a corrida ampla e os retestes, um ignorado, zero falhas pendentes. Não houve uma segunda corrida completa.
- Tipos app/node, lint de37 caminhos TypeScript, sintaxe dos executores e build com backend sintético passaram na versão final. [Checagens e hashes](FINAL_CHECKS.json), [lint](FINAL_LINT.json). `QUALITY.json` conserva a saída da primeira corrida, inclusive a falha de fixture, para não apagar o diagnóstico.
- Navegador:298 estados em seis ensaios,320/375/1280/1920px, escala135%, três papéis. [Resumo](BROWSER.json):110 amplos,62 compactos,24 médico,34 recepção,24 interações e44 financeiros finais. São estados de testes sobrepostos, não298 fluxos distintos. Zero erros JS/console, chamadas desconhecidas, leitores privados de recepção, campos sem rótulo, controles sem nome ou overflow lateral detectados.
- Capturas desktop/celular/320 inspecionadas. Na inspeção final, as setas do mês financeiro estavam quebrando para linhas distintas em320; agora ficam em três colunas com o mês ao centro, sem mudar datas/operações. Reteste financeiro nas quatro larguras após essa alteração.

As fontes do app foram estáveis nos ensaios amplos/compactos/perfis. O último refinamento posterior nesses fontes é apenas o grid do período em BillingPage; a rodada financeira final e o reteste58 usam essa versão. Os executores ganharam verificações de alinhamento do cabeçalho320, botão de segurança contido no cartão após rolar e limites financeiros por papel.

`run.mjs` reproduz as auditorias `whole`, `compact` e `roles`. O navegador é Edge isolado, com origem local, backend falso `.invalid`, fixtures sintéticas e bloqueio de destinos externos. O teste verifica também uma região main/um h1 nas subpáginas, rodapé lateral visível, ausência de leitores clínicos na recepção e abas financeiras exatas por papel. Não faz envio, assinatura, faturamento ou operação de banco real.

A primeira tentativa do ensaio de médico procurava botões/abas de administrador que corretamente não existiam. O executor foi corrigido para conferir exatamente as duas abas autorizadas e a ausência de ações de recebimento/criação; esse resultado preliminar não conta como prova válida. Não foi alterado o produto para satisfazer essa expectativa errada.

As capturas gerais mostram o viewport de rolagem interna no celular; não representam todo o documento de uma vez. Ações inferiores, como Adicionar autenticador, têm captura própria após rolar. Retenção de rascunho/permissões é verificada por testes existentes e integração da moldura; mocks não constituem homologação de ACL do servidor.

Sem push, deploy, banco hospedado, importação, segredos, dados reais, chamadas pagas ou reativação da automação. Alterações SaaS e arquivos Claude preservados.
