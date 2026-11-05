# M2: revisão do contrato de custódia

05/11/2026. Base de leitura `b0d4c4b`. Artefato: [PROVISIONING_CUSTODY_CONTRACT.md](../../../product/clinic-crm/PROVISIONING_CUSTODY_CONTRACT.md). Somente documentação nesta fatia.

## Decisão sob revisão

Hipótese do autor: a matriz distingue evidência administrativa de autoridade atual e identifica o que falta provar para integrar os novos ledgers à custódia, sem mascarar a remoção Native do alvo ou escolher uma política de retenção.

O revisor recebeu o artefato e o contrato de escopo, sem a hipótese acima nem histórico da implementação. Revisão adversarial independente solicitada pelo skill doubt-driven-development. Revisão externa dispensada pelo usuário; nenhuma chamada a outro modelo/CLI.

## Verificação por leitura

- Operação e intenção do laboratório conservam identificadores e negam substituição/eliminação por suas guardas. Não têm integração própria de preflight/T33 equivalente aos pedidos privados.
- `touch_custody_epoch(uuid[])` exige conta com epoch inicializado. A reserva anterior ao nascimento não pode simplesmente passar o alvo ausente como se já fosse uma conta.
- Os pedidos/operações de delegação de `20261104230000` já têm guardas/preflight. Não são os novos ledgers de identidade/intenção, e não devem ser substituídos.
- O preflight da aplicação antecede armazenamento/marcador nos handlers de exclusão. Isso não o transforma em interceptador do Auth Admin direto. FK restritiva ou cascata não substitui a recusa de replay com alvo removido.
- A matriz exige prova de concorrência, privilégios, ausência→presença e instalação com histórico. Não declara esses resultados já obtidos.

## Revisão independente

Um achado acionável: a matriz inicial não separava alvo removido antes da confirmação de uma intenção já confirmada. O revisor apontou o ramo `prepared` de `check_intent(...,false)`/replay de `begin_intent` e que o teste Native existente confirma antes de remover.

Reconciliação: conferido nas fontes pelo Codex. O contrato passou a distinguir três estados: reserva antes do primeiro nascimento (consulta/replay válidos), nascimento com intenção ainda pendente (recibo atual exigido) e intenção já confirmada. A matriz exige positivo/RED próprios e RC/RR, sem alegar que a lacuna nova foi reproduzida ou corrigida. Essa prova passa a ser o próximo passo antes do overlay de custódia. Segunda leitura independente concluída sem achado substantivo remanescente no documento revisado.

## Validação e limites

Links locais conferidos; diff final verificado antes do commit. Sem mudança de código executável, não foram executados novos testes unitários, Native, SQL, navegador, build ou typecheck. Contagens de rodadas anteriores não são evidência nova desta fatia.

Nenhuma migration reservada/criada, dado real, banco hospedado, integração, envio externo, prazo jurídico, purge, push ou arquivo do Claude alterado. Próximo incremento: RED/controle positivo para alvo nascido e removido antes da confirmação nas duas versões Auth; depois desenhar/provar guardas de domínio sobre as primitivas T33 existentes em banco descartável, antes da migration produtiva.
