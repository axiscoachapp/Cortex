# T39/3c/2c/2b/3 — código e foco no bloqueio clínico

Baseline `2f927fed453c7b145c2ecb35190feea9ca372d99`. [Contrato](../../../product/clinic-crm/MFA_INLINE_VERIFICATION.md).

CLAIM: no formulário inline, código não atravessa troca manual de fator; campos não mudam durante a tentativa; recusas iguais recebem foco sem liberar o ambiente clínico.

Três RED reais em `SessionAssurance.test.tsx` reproduziram código/erro remanescentes ao selecionarB, campos editáveis com verificação pendente e recusa repetida sem foco (10anteriores verdes). Correção restrita a `InlineFactorVerification`: limpar código/erro no handler de troca manual, desabilitar seletor/input durante busy e usar objeto de erro/ref/tabIndex-1 para focar inclusive mensagens iguais. Não se alteraram consulta de assurance, autorização, cache, árvore clínica, ator, logout ou retorno de foco do trabalho aberto.

`UNIT_RED.json`/`UNIT_GREEN.json`:40Vitest/três arquivos verdes, incluindo os dez testes antigos do gate,18AccountSecurity e nove regressões do helper.14Node/dois arquivos de transporte/cadastro/cancelamento/delegações, TypeScript, lint de quatro arquivos, sintaxe de dois scripts e cinco combinações inválidas de flags aprovados; helper final tem lint/sintaxe dirigido após reforço das asserções. Dois RED C5 preexistentes fora desta suíte dirigida continuam pendentes.

Revisão independente apontou falta de repetição do mesmo erro no mesmo fator e falta de predicados para transbordamento/ações internas do diálogo. Foram acrescentados terceiro clique antes de trocar fator e assertivas `dialogHorizontalOverflow<=1`/`dialogActionReachable!==false`. Segunda revisão sem achados acionáveis. Cross-model skipped: non-interactive context.

Fonte final aceita: [AUDIT](../../2026-11-05/reception-app-audit/mfa-inline-guards-final/AUDIT.json),48estados/96PNGs (capturas e ações)320/375/1280/1920 a135%, App/Auth providers e Auth JS2.86.0 reais sobre321fontes congeladas/25hashes de execução/um overlay `SessionAssurance.tsx`. Dois formatos de erro sintéticos, não dois servidores Auth reais. Hashes antes/depois estáveis/limpeza positiva; imagens320 de pendente e recusa repetida inspecionadas. Transbordamento interno zero e ações alcançáveis em todos os estados.

Oito cenas fazem três tentativas humanas cada: primeira retida/recusada, mesma recusa no mesmo fator sem limpar o erro manualmente, troca paraB que limpa código/erro sem comando e nova recusa expirada. São24desafios distintos ligados aos fatores certos e24verificações:48comandos MFA entre66requests de login/leitura do usuário/desafio/verificação.24HTTP422 e24avisos de console deliberados; zero erroJS/falha de request/recurso inesperado/clínico/escrita de paciente ou agenda/IA/externo. Mesmo documento, fatores e fingerprint da sessão sintética preservados; árvore clínica ausente nas48capturas, erro focado/contido na viewport em todas as recusas.

A tentativa pendente é interceptada antes de chegar ao servidor, com interceptador ativo/campos bloqueados/apenas desafio no ledger antes do release; isto não simula perda ou latência real de Auth. `mfa-inline-first` (40estados) e `mfa-inline-repeated-final` (48 sem os predicados finais) são preliminares excluídas. Tentativa de CLI com SHA abreviado recusada antes de servidor/navegador. O runner conserva o nome interno `mfaEnrollmentChecks`, mas marca o modo próprio `mfaInlineOnly` e suas chamadas em `mfaVerificationCalls`.

Reprodução: `node scripts/reception-app-audit-browser.mjs --baseline=2f927fed453c7b145c2ecb35190feea9ca372d99 --only=mfa-inline --overlay=src/components/SessionAssurance.tsx --run=<nome-novo>`. Vitest: `npx vitest run src/components/SessionAssurance.test.tsx src/pages/AccountSecurity.test.tsx src/lib/reviewFixes.test.ts --pool=forks --maxWorkers=1`. Node: `node --test scripts/fixtures/mfa-verification-api.node-test.mjs scripts/fixtures/clinic-review-api.node-test.mjs`.

Recorte de recusas/foco/seleção; sucesso, TOTP/Auth/AAL2 reais, recuperação, perda real de transporte e limites efetivos do servidor seguem separados. Sem migração/hosted/envio externo/Claude/SaaS/PersonalMed.
