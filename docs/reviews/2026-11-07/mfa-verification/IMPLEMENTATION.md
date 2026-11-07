# Verificação MFA: recusas e nova tentativa

Baseline `72a54d5302bf49ca196803c8f800b506961c3627`. [Contrato](../../../product/clinic-crm/MFA_VERIFICATION_FAILURES.md).

CLAIM sob teste: o código não atravessa uma troca de autenticador; o alvo/código ficam bloqueados durante a tentativa; erro preserva fatores/sessão e nova tentativa explícita cria outro desafio ligado ao fator selecionado, sem aceitação implícita.

Dois RED do componente reproduziram código/erro remanescentes ao trocar fator e campos editáveis durante a promessa pendente (13 antigos verdes). Um terceiro RED dirigido reproduziu o código do fator anterior herdado ao abrir nova configuração. Correção restrita ao seletor/campo e à limpeza do código após cadastro no AccountSecurity. Backend/Auth/SQL não mudam.

O transporte usa o Auth JS instalado2.86.0: `GoTrueClient._challengeAndVerify` chama desafio e verificação separadamente; `lib/fetch.handleError` lê `code` com resposta `X-Supabase-Api-Version:2024-01-01` e faz fallback para `error_code`. Foram inspecionadas essas fontes locais, sem inferir outra versão instalada. A fixture sintética reproduz os dois formatos de erro, com header exposto por CORS só no formato atual. Isso não equivale a executar dois servidores Auth reais.

Validação final: 16 testes Vitest em um arquivo, 13 testes Node em dois arquivos, TypeScript, lint de sete arquivos, sintaxe de cinco scripts e quatro combinações inválidas de flags aprovados. Os RED originais estão em `UNIT_RED.json` e `ENROLL_CODE_RED.json`; `UNIT_GREEN.json` preserva o resultado final. Os dois RED C5 preexistentes fora deste recorte continuam pendentes; não há alegação de suíte global verde.

Navegador Edge isolado, App/Auth providers e SDK reais sobre snapshot congelado: 40 estados (cinco por formato/largura), formatos modern/legacy, larguras320/375/1280/1920 a135%. São321 fontes congeladas,23 hashes de execução e um overlay `AccountSecurity.tsx`; hashes conferidos antes/depois. Cada cenário fez três tentativas explícitas, com desafios distintos e vinculados ao fator selecionado; trocar fator não envia nada. Fatores e fingerprint da sessão sintética preservados, mesma página montada. Erro incorreto/expirado recebe foco e cabe na viewport; imagens320 inspecionadas. Sem overflow/controles ausentes nas40 capturas.

Fonte aceita: [AUDIT final](../../2026-11-05/reception-app-audit/mfa-verification-code-final/AUDIT.json),40PNGs.66 requests limitados ao login/leitura do usuário e24pares desafio/verificação;24recusas422 e24avisos de console deliberados. Zero erro JS, falha de transporte, recurso inesperado, clínico, escrita de paciente/agenda, IA ou externo; limpeza positiva. `mfa-verification-first` e `mfa-verification-final` são preliminares excluídas, anteriores à última limpeza de código. O runner mantém o nome interno `mfaEnrollmentChecks`, mas identifica este modo em `mfaVerificationOnly` e nas chamadas próprias.

Reprodução: `node scripts/reception-app-audit-browser.mjs --baseline=72a54d5302bf49ca196803c8f800b506961c3627 --only=mfa-verification --overlay=src/pages/AccountSecurity.tsx --run=<nome-novo>`. Vitest: `npx vitest run src/pages/AccountSecurity.test.tsx --pool=forks --maxWorkers=1`. Node: `node --test scripts/fixtures/mfa-verification-api.node-test.mjs scripts/fixtures/clinic-review-api.node-test.mjs`.

Revisão adversarial independente, somente leitura, concluiu sem achados acionáveis após inspecionar diff, fixture, contrato e fontes instaladas do Auth JS. Cross-model skipped: non-interactive context.

Recorte T39/3c/2c/2b/1 concluído. Verificação bem-sucedida/AAL2, limites de tentativas, indisponibilidade e recuperação seguem pendentes; fixtures negativas não elevam sessão nem comprovam TOTP/servidores Auth reais. Nenhuma migração, carga, configuração hospedada ou implementação Claude/SaaS/PersonalMed alterada.
