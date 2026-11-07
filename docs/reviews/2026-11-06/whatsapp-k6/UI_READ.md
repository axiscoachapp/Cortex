# K1/2 — Conversas na recepção, leitura

06/11/2026, Codex. A aba **Conversas** em `/recepcao?view=conversations` abre lista, filtros de situação/responsável, busca explícita e mensagens recentes. Atendimentos mantém a fila existente; as duas áreas montam uma por vez e preservam `case/status/mine/doctor` na URL. Nenhum arquivo do lease C5 foi alterado neste incremento.

O acesso local exige recepção ativa ou administrador clínico, clínica presente e ator Auth igual ao contexto. A fronteira autoritativa continua no servidor. Consultas e estado local são separados por ator/clínica; caches inativos têm gcTime0, toda montagem exige leitura fresca e o transporte recebe AbortSignal. Erro/recusa esconde lista e mensagens anteriores. Fechar a seleção cancela a leitura pendente, descarta resposta tardia e devolve foco à lista. Uma nova seleção recebe foco mesmo pendente/recusada. A rolagem considera a posição real do título, incluindo1280px com layout ainda empilhado.

Somente `state`, `conversations` e `messages` são usados. Não há envio, marcar como lida, consentimento automático, vincular paciente/caso, reserva ou interpretação clínica. Texto do provedor é renderizado como texto React; mídia mostra descrição/nome de arquivo, sem download ou URL externa. Lista até50 e histórico recente até50, sem paginação/completude prometida enquanto o decoder C4 perde microssegundos.

## Contrato v1.1

O cliente entregue em1cdef8f era v1. A entrega40e90c1 acrescentou `consented` e cursor `data|id`; o novo cliente valida ambos e preserva o cursor recebido sem converter datas/UUIDs. Antes da adaptação, teste com DTO1.1 falhou em `before` timestamp-only. Novos testes cobrem cursor completo/preciso, tuple inválida/extra e consentimento. O servidor ainda tem os [resíduos v1.1](REVIEW_V11.md).

## Evidência

[UI_READ_VALIDATION.json](UI_READ_VALIDATION.json):89testes/4arquivos,11Node, tipos app/node, lint sem avisos, sintaxe de sete scripts/três flags inválidas e99 hashes conferidos. Navegador final28estados sem erro de página/recurso inesperado; três403/console sintéticos previstos e cleanup confirmado. Revisão final sem achado acionável após as correções abaixo.

- Testes de componente cobrem acesso, lista/mensagens, estado indisponível, busca/filtros, vazio, recusa/retry, troca de conta/clínica, remount, cancelamento/resposta tardia e foco. Teste próprio do wrapper comprova ausência de queue/case na aba Conversas e preservação dos parâmetros na ida/volta.
- RED inicial da funcionalidade sobre stub; depois RED específico de foco pendente/recusado. A revisão descobriu rolagem presa ao breakpoint de telefone: RED navegador em1280 mostrou título com interseção zero. A condição passou a usar posição renderizada, com teste próprio.
- A primeira inspeção visual encontrou busca com largura insuficiente no celular, mesmo sem overflow. RED com largura dos controles reproduziu; grid passou a usar toda a largura em320/375, com controles de2,75rem (44px na base16px e59,4px na escala135%, classe h-11).
- Navegador usa SDK/AuthContext/App reais e HTTP loopback sintético, perfil Edge temporário e fontes/Tailwind congeladas em5aaa469 mais quatro overlays próprios. Cenários cobrem320/375/768/1024/1280/1440/1920, administradora/recepção, teclado, nomes longos, mídia, filtros/vazio, recusa403 e recuperação no mesmo documento. A ledger exige só login/contexto/WhatsApp até a troca explícita para Atendimentos; nenhuma escrita/IA/acesso clínico/envio.

Relatórios aceitos: `whatsapp-read-mobile-red`, `whatsapp-read-scroll-red` e `whatsapp-read-scroll-final`, em [reception-app-audit](../../2026-11-05/reception-app-audit/). Passagens `whatsapp-read-first`/`whatsapp-read-final` foram superadas pelos achados visuais e ficam fora da entrega. Três403/console correspondentes são esperados; nenhum outro erro é aceito. A configuração Node inicial do lint omitia globais de evaluate(browser) e recusava um catch vazio preexistente; a execução correta declara os dois ambientes e permite catch vazio, sem mudar regras da aplicação.

Os RED retêm JSON integral e somente a captura que demonstra a falha (mobile320/rolagem1280). O GREEN retém todas as28capturas e JSON. O painel foi aberto por teclado; a prova vertical ocorre antes de qualquer rolagem de inspeção do documento.

Limites: Auth e APIs são simulados; não é teste NativeAuth/MFA/RLS/Meta/produção nem homologação de persistência/idempotência. C5/lease devolvido ainda requer revisão própria. K1 de comandos/K2/K3/K4 restante/K5/K6 completo/M2/piloto continuam abertos; confirmação humana, identidade e prontuários privados preservados.
