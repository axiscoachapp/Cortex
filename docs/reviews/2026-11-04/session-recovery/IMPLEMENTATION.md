# T31/2 — recuperar MFA com documento aberto

## Resultado

O gate externo `SessionAssurance` agora preserva o documento aberto atrás de um modal de recuperação que controla foco, acessibilidade e pointer. É possível repetir a verificação, carregar os autenticadores novamente, corrigir um código rejeitado e concluir o MFA na mesma página. Ao recuperar, o foco volta ao controle anterior do mesmo médico e a digitação continua no mesmo rascunho.

Sem alteração de migrations, RLS, funções Edge, API de IA, autenticação hospedada, componentes do Claude ou dados do PersonalMed. Esta correção da interface **não** resolve a credencial inicial no servidor (T31/3).

## Reprodução e decisão

**Hipótese verificada:** ocultar a árvore e o portal antigo por CSS não libera o FocusScope, o bloqueio de pointer nem o `aria-hidden` de um modal Radix já aberto. O recovery precisa ocupar a camada modal superior e, ao sair, devolver o foco ao documento autorizado.

O teste novo reproduziu a falha anterior: o botão de tentar novamente tinha ancestral `aria-hidden=true`. A [documentação do Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog) descreve o foco preso no modal; a implementação instalada também controla pointer e ARIA. Não alterar essa biblioteca nem desmontar o documento preserva o estado existente.

O recovery não pode ser dispensado por Escape ou interação externa. Tem título/descrição acessíveis, aparece acima do gate da clínica e só existe enquanto a sessão está bloqueada. A visibilidade por CSS distingue as duas camadas; quando MFA está pendente, o recovery de acesso à clínica também permanece oculto. As duas verificações precisam passar antes de liberar o documento/captura.

## Mudanças e revisão

- Removido `keepPreviousData`: resultado de outro ator/chave não autoriza uma nova verificação. Montagem exige uma resposta nova, inclusive com cache fresco; resposta com níveis indeterminados falha fechada. Mudança da chave da sessão preserva a árvore do mesmo ator atrás da trava; troca de ator não carrega a árvore anterior.
- Fatores usam chave de cache por ator. Erro de listagem tem retry explícito e não permite submissão com fator inválido/pendente. Código inválido preserva o recovery; concluir exige nova verificação de assurance.
- O recovery é modal Radix de tela inteira, com controles alinhados e espaçados. O documento continua montado; o contexto de visibilidade remove a captura sintética/real da área interativa enquanto bloqueado.
- Foco é capturado por eventos do workspace, inclusive portais React. Depois do fechamento, um frame permite que o Radix retire o FocusScope superior. A restauração exige mesmo ator, elemento conectado e ausência de ocultação por `hidden`, `inert`, ARIA ou visibilidade CSS.
- A revisão adversarial local encontrou a perda de foco ao terminar; corrigida e provada em navegador. A primeira tentativa manteve o recovery fechado durante a animação: seu marker CSS ainda ocultava o documento no momento de restaurar foco. Montar o recovery apenas enquanto bloqueado resolveu a ordem de remoção. Segundo ciclo de revisão sem novo problema concreto dentro deste contrato. Revisão externa entre modelos omitida neste heartbeat não interativo, conforme preferência anterior por verificação local.

## Evidências

29 testes em três arquivos: `SessionAssurance`, `ClinicAccessGate` e autenticação/assurance das funções Edge. Incluem modal real, rascunho/foco, cache na montagem, troca de ator, nova chave de sessão, resposta indeterminada e erro de fatores/retry/verificação.

`scripts/session-assurance-browser.mjs` executou quatro fluxos de Edge/Chromium isolado: erro com documento aberto e controle real de ARIA/pointer/Tab/Escape; saída cancelada por rascunho não faz logout; retry de fatores/código rejeitado e recuperação com foco/digitação; precedência MFA → gate da clínica → documento. Layout e zoom de 150% verificados em 390/768/1280/1920 px. Capturas e métricas em `browser/verification.json`; nenhum erro de página, acesso clínico ou envio externo.

A fixture substitui as respostas dos métodos de MFA no navegador. Exercita componentes/gates reais com Auth e transporte de clínica sintéticos em loopback; **não** valida protocolo do provedor Auth, código TOTP real, microfone ou geração clínica. O conteúdo do documento e a captura são componentes sintéticos com estado preservado.

Também reexecutado `scripts/clinic-access-browser.mjs`: quatro fluxos anteriores aprovados, com as mesmas quatro larguras, offline real do navegador e recuperação sobre modal aberto. O relatório copiado em `clinic-regression.json` registra essa execução; as capturas anteriores não mudaram. Build/typecheck com variáveis explicitamente sintéticas e eslint dos caminhos alterados aprovados. A tentativa de build sem essas variáveis foi recusada pelo validador, como esperado; não houve alteração do validador. SQL e suíte geral não foram repetidos porque não houve mudança de backend; suas contagens anteriores não são apresentadas como nova execução.

## Limites e continuidade

Esta prova cobre modais já abertos. A revisão também reproduziu tecnicamente um Dialog arbitrário **novo**, montado depois da trava, tomando a camada superior; não confirmou um gatilho atualmente alcançável no aplicativo. Não foi introduzido um gerenciador global de modais para esse cenário. Futuras ações assíncronas que abram portais durante o bloqueio precisam impedir/deferir essa abertura e repetir a prova de foco/ARIA; o CSS isolado não basta. Essa limitação não é uma autorização para mostrar dados atrás da trava.

T31/3 continua: estado confiável da senha inicial, sessões anteriores e falhas parciais. Requisitos e alternativas rejeitadas em [INITIAL_PASSWORD_CONTRACT.md](../../../product/clinic-crm/INITIAL_PASSWORD_CONTRACT.md), enviado ao Claude para os pontos que afetam documentos. Sem novo schema/loader/carga de migração; D18/D20 e decisões anteriores permanecem pendentes.
