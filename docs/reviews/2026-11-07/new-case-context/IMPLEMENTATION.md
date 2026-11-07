# T44 — contexto do novo atendimento

A janela fica vinculada ao ator, clínica e papel da abertura. Perda de acesso, ocultação da sessão ou retirada do médico escolhido removem campos antigos e interrompem os próximos passos do cliente. Recuperar o acesso mantém a janela invalidada; fechar e abrir outra inicia um preenchimento vazio.

## Envio e recuperação

- Snapshot por intenção, exclusão síncrona de dois submits e verificações de montagem/contexto antes de cada chamada e depois de cada await.
- Contato retornado fora de contexto não inicia atendimento. Resultado de atendimento/invalidação tardio não chama onCreated nem modifica seleção/erros. Uma requisição já enviada pode ter sido concluída; nenhuma promessa de aborto ou rollback.
- Retry explícito no mesmo contexto conserva a chave da intenção e reutiliza contato já retornado. Nenhum retry automático.
- Invalidação apenas das famílias fila/contatos do ator e da posição exata da clínica; sem comparação com texto de busca. Bloqueio de saída durante envio, retirado quando a janela perde contexto.

## Evidências

[Contrato](../../../product/clinic-crm/NEW_CASE_CONTEXT.md), [validação consolidada](VALIDATION.json), [controle RED inicial](RED_CONTROL.json), [RED de colisão do cache](CACHE_RED.json), [GREEN final](UNIT_GREEN.json), [guardas CLI](CLI.json).

Controle inicial: 20 falhas/3 controles no formulário original de 32bcaac, sem timeouts genéricos, restaurado por hash. Depois, revisão reproduziu uma colisão real de cache: a busca de outra clínica podia coincidir com o id da clínica de origem. Um novo teste falhou antes da correção por família/posição. O hash restaurado inicial é da versão anterior a esse ajuste; VALIDATION registra o hash final.

A suíte final inclui 24 casos novos e 32 regressões de busca/agenda: 56 testes em quatro arquivos. Ela cobre troca de ator/clínica/papel, inatividade, sessão oculta, desmontagem, retorno tardio entre contato e atendimento e após invalidação, snapshot, envio duplo no mesmo batch, cache real do QueryClient, retry/idempotência e guardas de saída. Tipos reais da aplicação, lint dos quatro arquivos e sintaxe dos dois scripts também passaram.

O navegador usa Edge isolado, aplicação congelada no SHA-base com somente o formulário em overlay e transporte sintético em loopback. Cinco estados por largura (320/375/1280/1920, escala135%): rascunho, interrupção real da releitura de acesso, recuperação sem reabrir o rascunho, fechamento e nova janela limpa. Quatro503 de acesso/console são deliberados; a lista de requests exige somente login/contexto/fila/contatos. Nenhuma submissão, reserva ou leitura clínica. Respostas tardias, identidade e escritas são cobertas por unitários, não por essa sessão de navegador.

A primeira execução completou20estados mas falhou porque herdava uma exigência de ReceptionCalendar nunca aberto neste fluxo. O modo ganhou uma lista própria de fontes realmente servidas, mantendo a exigência antiga da busca/agenda. A segunda passou antes da correção do cache; ambas foram preservadas e excluídas do manifesto final. A execução final é new-case-context-cache-final.

## Revisão e limites

Primeira revisão independente: P2 de colisão do cache classificado como válido/acionável, reproduzido e corrigido. Segunda revisão sem achados acionáveis. Uma suspeita de bloqueio de navegação após sucesso foi descartada por controle em memória com hook/router reais, destino alcançado e zero alertas/confirmações. Cross-model skipped: non-interactive context.

Sem RPC/SDK/schema/migration novos, arquivo do Claude/C5/produtor/PersonalMed/SaaS alterado, envio externo, Meta, chamada paga, carga real, banco hospedado, deploy ou push. Não prova autorização, transação, aborto ou persistência de servidor. Apenas o recorte T44 fica concluído; K1, MFA/K7 e correções C4/C5 seguem nos seus contratos. Nenhuma mensagem Claude nova:2152 já atendida, sem confirmação repetida.

[Auditoria bruta final](../../2026-11-05/reception-app-audit/new-case-context-cache-final/AUDIT.json):20estados/36PNGs,351fontes/36hashes/um overlay,40requests, quatro503/console esperados; zero demais falhas/JS/clínico/escritas/externos, cleanup positivo. Capturas320 do bloqueio/recuperação e1920 da nova janela conferidas visualmente.
