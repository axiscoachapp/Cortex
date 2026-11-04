# T05b/2 — confirmação de vínculo sem sobrescrita

03/11/2026. Incremento local, com dados sintéticos. Nenhum push, implantação, banco hospedado, envio externo ou carregador do PersonalMed foi executado.

## Resultado

Confirmar uma reserva deixava o RPC `reception_link_patient` sobrescrever relação, autor e data de um vínculo anterior. A migration reservada `20261103003700_reception_link_confirmation.sql` limita esse caminho a criar um vínculo novo ou reconhecer uma confirmação idêntica, sem escrever novamente nem duplicar auditoria. Uma relação divergente falha com `22023`. Permissões, MFA, escopo e disponibilidade do paciente são conferidos também nas repetições.

A criação usa a chave existente com `ON CONFLICT DO NOTHING`; o caminho de repetição trava e confere a linha. Não há novo RPC, mudança de assinatura/DTO, acesso clínico ou fusão de identidades.

O formulário de reserva reconhece o vínculo mesmo quando o paciente vem da busca geral, fixa a relação registrada e mantém essa seleção após falha do horário. O sucesso da confirmação é preservado no cache; leituras anteriores em andamento são canceladas antes de gravar esse resultado. Trocar modo/paciente limpa a conferência e a relação anterior. Saída da sessão fica bloqueada durante a gravação.

## Verificação

- SQL antes da correção falhou com `Retry replaced original confirmation authorship`; asserções provam que autor/data originais e auditoria são mantidos, divergência é recusada, novo vínculo delegado funciona e revogação de escopo continua valendo.
- **48 migrations/27 suítes SQL passaram** no PostgreSQL 16 descartável. O harness de duas conexões passou com relações concorrentes divergentes e idênticas, preservando o primeiro autor e um único evento. Regressões de fila, agenda, correção de contato e booking também passaram.
- **Seis testes do formulário passaram após a correção final**, incluindo seleção pela busca, falha parcial, troca de modo, refetch divergente, saída durante gravação e leitura antiga que termina depois do novo vínculo.
- Navegador isolado Chromium/Edge com API loopback e rede externa bloqueada: **17 verificações aprovadas**, incluindo relação de responsável fixa na busca, falha de horário sem perda da relação e layout a 150% em 390/768/1280/1920 px. [Resultados](browser/verification.json) e [tela móvel](browser/link-confirmation-390.png). Autorizações foram provadas no PostgreSQL; o transporte sintético não substitui essa evidência.
- **449 testes em 67 arquivos** passaram na suíte geral serial. Lint sem erros (oito avisos anteriores), tipos e build aprovados com ambiente público sintético explícito. O navegador foi reexecutado após a correção final de cache, com as 17 verificações aprovadas.

Revisão adversarial local encontrou uma corrida de cache após sucesso da confirmação. O teste a reproduziu com uma leitura atrasada e asserção direta do cache. A correção cancela essa leitura antes de preservar o vínculo; segunda revisão sem problemas remanescentes. **Cross-model skipped: non-interactive context.**

Durante a preparação, a fixture concorrente nova foi inicialmente inserida antes da contagem antiga de pacientes. Isso alterava a linha de base do teste de órfãos. A preparação foi movida para depois dessas asserções, mantendo seus valores esperados; a suíte e a concorrência passaram em seguida. Um erro de tipagem do teste (`exact` de Playwright usado no Testing Library) também foi corrigido antes do build final. Nenhum timeout ou regra de produção foi relaxado.

## Limites

O ciclo completo de correção/revogação/reativação de vínculos continua pendente: não há coluna de atividade/revisão nem editor administrativo nesta fatia. O próximo incremento precisa reservar outro número e atualizar todos os leitores/escritores conforme [T05a](../../../product/clinic-crm/CONTACT_LINK_CORRECTIONS.md). Não apagar vínculos históricos nem reaproveitar compromisso CRM para outro beneficiário.

A0 foi registrado apenas como contrato/backlog e reserva futura, com a divisão por domínio combinada com Claude. Nenhum provedor/modelo de IA foi alterado e a avaliação/assinatura real continuam separadas.
