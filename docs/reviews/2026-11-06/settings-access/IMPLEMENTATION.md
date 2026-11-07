# Configurações — acesso da recepção e barreira administrativa

06/11/2026. Correção local do Codex em ClinicAccessGate/ReceptionLayout; revisão de C5 e do lease devolvido em e527011. A página C5 e seus componentes não foram editados.

## Comportamento corrigido

Recepção ativa, com clínica/agendas já autorizadas, pode abrir a rota de Configurações. Há entrada no cabeçalho da recepção; Conta continua apontando para Segurança. Contas indisponíveis continuam bloqueadas, e outros caminhos continuam redirecionados sem montar leitores clínicos.

A identificação usa `matchRoutes` com a mesma regra da rota real, incluindo case, barras finais e caracteres codificados. Uma comparação literal permitia que aliases recebessem a exceção antiga de continuidade clínica. O controle negativo `/configuracoes-extra` continua fora da exceção.

Configurações não recebe continuidade de prontuário durante falha de verificação. Falha/recusa desmonta a página inteira e seus portais, limpando os formulários locais; recuperação exige verificação bem-sucedida. Isso não muda a preservação de prontuário/rascunho/foco já testada nas páginas clínicas. Segurança continua fora dos gates em App, que não foi alterado.

## Provas e resultado parcial da revisão C5

56 testes/3arquivos passaram:31 do gate, mais equipe/permissões. RED reproduziu redirecionamento da recepção, continuidade administrativa indevida e portal retido; aliases com uppercase/%63 também falharam antes do matcher equivalente. Testes cobrem seis aliases, prefixo negativo, inatividade/ausência de agendas, transporte/recusa e recuperação. Revisão independente comparou14 caminhos e não encontrou divergência restante. Seis testes Node verificam fixtures novas/anteriores e o opt-in que só libera leituras sintéticas.

Navegador Edge isolado, App/AuthContext/SDK reais, APIs HTTP loopback e fontes/Tailwind congeladas em09301d9, com apenas Gate/Layout sobrepostos.375/1280/1920 a135%; recepção e administrador, Segurança externa, Equipe/Permissões reais, parâmetros preservados, editor/rascunho removidos e três recuperações no mesmo documento. Não houve Salvar, envio, exportação, alteração de conta ou escrita clínica. A ledger exige recursos explícitos; fixtures recusam comandos.

| Relatório | Resultado |
|---|---|
| `settings-access-red-final` | Uma captura da versão anterior: recepção redirecionada à fila |
| `settings-admin-red-final` | Três capturas: portal/editor continuam no erro503 da versão anterior |
| `settings-access-gate-final-copy` |20 estados percorridos e todas as verificações funcionais do gate concluídas; auditoria visual completa permanece RED no editor C5 |

Os relatórios estão em `docs/reviews/2026-11-05/reception-app-audit/`. O último retorna exit1/completed=false por **91px de rolagem horizontal e ações inacessíveis no AutomationEditor a375px**, defeito presente também na versão anterior. As asserções não foram reduzidas. Isso não é aprovação visual de C5; [mensagem2113](../../../../coordination/mensagens/2026-11-06-2113_codex-para-claude_configuracoes-gate-e-escopo.md) e complemento registram o achado com o dono. Três503/console correspondentes são esperados no ensaio com correção; nenhum outro erro/recurso/IA/escrita foi observado. Hashes foram conferidos externamente após o runner parar na asserção visual. Cleanup confirmado em todos os relatórios.

Passagens sem sufixo `red-final` foram preliminares e não integram esta entrega. Capturas finais foram inspecionadas; screenshot do modal antigo mostra a coluna de referência e texto cortados à direita.

## Pendências

- Corrigir layout do editor C5 pelo dono e repetir a auditoria completa, mantendo asserções.
- A entregaaccbba6 acrescenta chave de contexto a WhatsAppSettings; reteste desse delta e freshness/cancelamento dos queries continuam separados. O ensaio acima usa C5 do snapshot09301d9.
- Resíduos C4 corrigidos emaccbba6 aguardam reteste do novo contrato; contato sem barreira não foi aceito por inferência de identidade. [Resposta2127](../../../../coordination/mensagens/2026-11-06-2127_codex-para-claude_d26-e-contrato-contato.md) propõe NOWAIT/retorno sem recibo para revisão antes de ensaio concorrente.
- D26 recebida: próximos incrementos K7 removem entradas de Pendências/redirecionam links legados e concentram ações no paciente/pós-consulta, preservando dados.

Sem NativeAuth/MFA/RLS/Meta reais, banco hospedado, migration, push, deploy ou alteração de arquivos Claude/SaaS/PersonalMed. Gate corrigido; C5/K6 completos e piloto continuam abertos.
