# K7/1 — acompanhamento no paciente (D26)

Consulta manual e os registros salvos podem ser abertos no próprio paciente, em `Index`, pelos botões **Consulta manual** e **Acompanhamento**. Não há mudança de rota nem queixa clínica no URL. O painel reutiliza o editor e as leituras de registros/tarefas/revisões; disponibiliza consulta, resultado/encaminhamento/retorno, medidas, episódio gestacional, reconciliação de medicamentos, orientações e informações pré-consulta.

O agendamento e a queixa são congelados ao abrir a consulta manual. O chat permanece montado. O editor continua com os mesmos comandos, revisão/CAS e confirmação do médico; nenhuma alteração em schema, aprovação, prescrição, assinatura ou compartilhamento. Fechar, trocar paciente, sair da conta e navegar respeitam as guardas existentes; cancelar o descarte mantém o texto. O foco volta ao botão que abriu o painel.

## Isolamento e migração gradual

- Escopo de estado por ator/paciente. A montagem confere novamente a propriedade, com cancelamento da leitura ao desmontar, e não exibe registros, editor ou nome anterior enquanto a conferência falha ou está pendente.
- O painel não consulta diretório geral, nomes de outros pacientes ou áudios gerais. Histórico e revisões incluem o ator na chave e filtro; os registros mantêm o paciente explícito. Erros de leitura continuam visíveis.
- A consulta de propriedade não refaz automaticamente enquanto o editor está aberto, para evitar desmontar texto não salvo por foco/reconexão. Escritas continuam sujeitas à autorização do banco. Uma nova abertura exige leitura fresca.
- `/trabalho` e sua navegação ainda existem **neste incremento**. A substituição foi antecipada para preservar acesso a registros antes de remover a página. Próximo K7/2: mover avisos de recuperação para Início/paciente e espera/confirmação para Agenda/Recepção, retirar as entradas genéricas e redirecionar URLs legados. Pós-consulta é incremento posterior. K7 inteira permanece aberta.

## Verificação

- 48 testes Vitest em cinco arquivos: painel, integração Index, editor, ChatPanel e assinatura. Cobrem paciente/ator, recusa ao reabrir, contexto manual, troca/saída bloqueadas e URL sem queixa. Não provam Auth ou RLS reais.
- Dois testes Node verificam o opt-in da fixture sintética, recusa/recuperação e bloqueio de gravações no acompanhamento. Tipos globais e lint dos caminhos alterados aprovados; três combinações inválidas de flags recusadas e sintaxe dos scripts conferida.
- Auditoria com App, Auth, providers e SDK do snapshot `106a8f80ccacd33aff05e8b44056e6ee54daff7d`, cinco overlays próprios, API HTTP exclusivamente loopback e perfil Edge headless descartável. Fonte/Tailwind congelados, hashes e cleanup verificados pelo runner.
- `patient-workspace-red-entry`: tela antiga carregada e falha pela ausência da entrada Acompanhamento. As duas tentativas anteriores esperavam papel `button` para o antigo `link` e **não são evidência de comportamento**.
- `patient-workspace-final`: 17 estados, RED de largura de 49px em375. `patient-workspace-final-layout` manteve o RED no botão longo de confirmar. Cabeçalho e ações passaram a quebrar linha.
- `patient-workspace-complete`: ampliado aos sete tipos de registro e aos fluxos espera/confirmação,33 estados; RED83px na atualização da lista de medicamentos. O botão ganhou largura limitada e quebra. Nenhuma asserção de recorte foi reduzida.
- Rodada final e métricas: [VALIDATION.json](VALIDATION.json). Os mesmos33 estados, em375/933/1280/1920 com escala135%, incluem versões, consulta manual, descarte cancelado, foco e recusa/recuperação. Nenhum envio, IA, gravação clínica, alteração de registros ou chamada externa no navegador.
- Rodada final: zero erros JS; dois503/console esperados na indisponibilidade sintética. Quatro HEAD de pacientes têm resposta200 seguida de `ERR_ABORTED` no registro bruto, sem inferir causa. Os20 hashes de runtime/overlays foram conferidos novamente após a auditoria. A última alteração de CSS também teve os oito testes do editor e lint repetidos.

A revisão independente encontrou perda de foco e nome antigo no estado recusado. Ambos foram corrigidos; a segunda leitura não encontrou outra falha material. Cross-model não executado: tarefa agendada não interativa, sem autorização para CLI externo. Relatórios brutos em `docs/reviews/2026-11-05/reception-app-audit/`; tentativas preliminares não entram na entrega.
