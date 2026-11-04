# T30/M1 — Área clínica preservada em indisponibilidade confirmada

04/11/2026, Codex. Sem migration, mudança de RPC/DTO ou alteração de autorização no banco. Backend não foi publicado nem modificado. [Contrato](../../../product/clinic-crm/CLINICAL_ACCESS_CONTINUITY.md).

## Comportamento

O gate mantém visível apenas uma página clínica que recebeu resposta válida nesta montagem, para a mesma conta e entrada de navegação, enquanto a chamada de acesso apresenta uma indisponibilidade confirmada de rede/gateway/pool. Aparece aviso em fluxo normal, sem mudar foco ou remontar o rascunho. O transporte usa uma classe específica e combinações positivas de status/código; erro genérico, JSON inválido, JWT/401/403 e `42501` não viram autorização por falta de resposta. [Referência primária do PostgREST](https://docs.postgrest.org/en/v14/references/errors.html#group-0-connection).

O primeiro carregamento e a remontagem aguardam uma conferência própria (`isFetchedAfterMount`); sucesso em cache não monta leitores novos. `location.key` distingue navegação/query/hash; uma árvore desmontada não ganha continuidade no retorno. `networkMode: always` permite detectar o offline real em vez de pausar silenciosamente com o papel antigo. Troca de conta, ator divergente, primeira abertura e área administrativa da recepção ficam bloqueados.

Uma negativa/erro desconhecido substitui o papel no cache por `null`, exclusivamente no cliente. Falha de rede posterior não restaura o papel antigo, inclusive após remontar. Na mesma página/conta, a árvore anterior pode ficar oculta para preservar o estado; só uma nova resposta válida libera novamente. Papel/ativação retornados pelo servidor continuam governando os caminhos existentes. Um médico sem clínica ativa conserva seu ambiente privado, sem acesso administrativo adicional.

O bloqueio propaga `parentHidden || blocked` pelo contexto de visibilidade já usado pela captura; diálogos/alertas/popovers antigos ficam ocultos. Um **modal superior de recuperação** controla corretamente foco, pointer e ARIA, preservando o diálogo e seu texto por baixo. Esse modal não abre sobre uma trava externa da sessão. O aviso de simples indisponibilidade continua não modal.

A faixa de captura em portal recebe somente um marcador de layout no `ChatPanel`; enquanto há continuidade, entra no fluxo acima do aviso pela sua altura real, incluindo quebras em celular. `SessionAssurance` recebeu somente um marcador de shell, sem alteração de lógica. Nenhum componente de prescrição/documento do Claude foi modificado.

## Verificação

- **RED antes da correção:** 16 falhas reproduziram classificação ausente, ocultação durante transporte, reabertura de cache/rota/ator e falta de bloqueio do portal sintético. Outros 16 casos já passaram.
- **38 testes direcionados/3 arquivos** aprovados: gate/API de acesso e `SessionAssurance`. Incluem rascunho/foco, primeira abertura, recusa → transporte → remontagem, ator diferente, query-string de paciente, papel clínico → recepção ativa/inativa e área administrativa durante transporte.
- **Navegador:** quatro fluxos em Edge/Chromium isolado com gate/API/Auth reais e formulário/diálogo/captura sintéticos. Rede offline real, recuperação, quatro larguras 390/768/1280/1920 a 150%, faixa de captura sem encobrir aviso/rodapé e negativa com Radix aberto. Retry por clique, Tab/Shift+Tab e Enter; documento e rascunho preservados. Sem leitura de tabelas clínicas, chamadas externas ou erros de página. [Registro](browser/verification.json).
- **Regressão da recepção:** 19 verificações do harness anterior aprovadas, incluindo duas secretárias, delegação/revogação, fila, rascunho, agenda humana, conflito e correção administrativa. [Registro](reception-regression/verification.json).
- **Suíte completa:** `npm test`, **538 testes/77 arquivos aprovados**, incluindo os casos finais de mudança de papel. Build/typecheck aprovados com variáveis sintéticas de loopback, sem alterar `.env`. Lint sem erros/oito avisos anteriores.

O ensaio de navegação usa fixtures isoladas, sem conta Supabase persistente. A faixa de captura exercita o layout/contexto, sem ligar microfone ou enviar áudio. Não é prova de integração externa ou de validação clínica de IA. Como não houve alteração de SQL/backend, a suíte de banco não foi repetida nesta entrega; sua última evidência é T29/`d6d44ee`.

## Revisão e correções do ensaio

Revisão adversarial local encontrou e corrigiu: portais que escapavam de `hidden`, sucesso em cache usado após remontagem, identidade incompleta por pathname e pausa de query no offline. A segunda leitura encontrou foco/ARIA/pointer do modal antigo e colisão da faixa de captura com o aviso; o modal superior e o fluxo real da faixa corrigem ambos. A terceira leitura não encontrou outro problema concreto. Clique e teclado previstos na revisão passaram no navegador.

O primeiro ensaio de offline tentou clicar no aviso após a reconexão já tê-lo removido; corrigido para aguardar a recuperação automática de leitura. Um assert imediato de teste foi ajustado para aguardar a notificação assíncrona da query. O build detectou uma opção de Playwright usada por engano numa query do Testing Library; corrigida, sem alterar comportamento do produto. Não apresentar essas falhas do harness como defeitos restantes.

Revisão externa dispensada pelo usuário e pelo contexto não interativo. M2/D18, credencial inicial/ACL (T31), retenção/piloto e demais decisões continuam separados. Sem banco hospedado, PersonalMed, API paga, push ou deploy.
