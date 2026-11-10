# Consistência visual do aplicativo

Pedido manual de 10/11/2026: revisar novamente todas as telas, incluindo Configurações, que ainda usa uma estrutura diferente.

## Objetivo

O usuário reconhece o mesmo aplicativo ao passar entre tarefas. A navegação principal permanece disponível; título, contexto, ações e conteúdo seguem a mesma hierarquia. A identidade visual existente (Montserrat, tons claros e dourado) e a escala de 135% são preservadas.

## Escopo e desenho

- Uma moldura reutilizável para subpáginas autenticadas: navegação lateral em telas largas, contexto e área atual no cabeçalho, navegação móvel existente. A moldura não consulta pacientes nem introduz autorização.
- Cabeçalho de conteúdo reutilizável: um h1, descrição útil e ações que quebram linha no celular; sem títulos repetidos ou cabeçalhos estreitos.
- Configurações usa essa moldura. Visão geral com grupos de linhas legíveis; seletor de seção em todas as larguras, links diretos e parâmetros de contexto preservados. Implantação, preferências pessoais e segurança continuam separados.
- Páginas clínicas auxiliares, recepção, pré-consultas, financeiro, segurança e privacidade adotam a mesma estrutura conforme necessário. Páginas públicas mantêm o contexto público.
- O consultório ativo conserva seus painéis montados, captura e guardas de saída. Padronizar não significa substituir o espaço de consulta.

## Restrições

Cada login mantém seu ambiente e permissões. Recepção nunca recebe leitores de prontuário pelo layout. Dados técnicos continuam geridos pela implantação; copiloto desligado. Sem contratos/API/SQL/migrations, carga, deploy, push ou automação. Rascunhos, guardas de saída, operações e estados de leitura atuais devem ser preservados.

## Aceite

1. Cabeçalho e navegação reconhecíveis nas subpáginas; uma única região main e um h1 por página.
2. Configurações não parece um aplicativo separado; seção atual, retorno e implantação claros.
3. Conteúdo, botões e formulários alcançáveis a 320, 375, 1280 e 1920 px, na escala atual; sem rolagem lateral da página.
4. Navegação por teclado, nomes acessíveis, estado ativo e foco visível preservados.
5. Regressões de permissões, retenção de consulta e rascunhos verificadas; navegador isolado só com dados sintéticos.
6. Revisão independente, tipos/lint/build e evidências locais antes da entrega.
