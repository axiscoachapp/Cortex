# T39/3b/2b/1 — leitura negada e recuperação na mesma página

O cliente integrado passa em [12 estados](delegation-denied-verified/AUDIT.json), quatro em cada largura 375/1280/1920 px, com escala de 135%. App, AuthContext e parser são os do snapshot `81abbff454899814957daed87a77be9b34a3a413`, sem overlays. Autenticação e RPCs usam transporte sintético em loopback. Nenhuma fonte da aplicação foi alterada.

Em cada largura, a lista inicialmente mostra três pedidos. Depois de clicar Atualizar lista, a fixture devolve HTTP 403/código 42501. O cliente remove os cartões, nomes e ações de decisão e apresenta o aviso de permissão com Tentar novamente. Uma nova tentativa ainda negada mantém tudo oculto. Quando o controle da fixture volta a permitir a leitura, outro clique restaura os três nomes e ações corretas, distinguindo um acesso ativo de dois inefetivos.

As três capturas posteriores à inicial não recarregam a página. Um marcador do documento é conferido em cada etapa. Os dados dos três pedidos permanecem iguais durante todo o ensaio; a fixture não habilita decisões nem oferece uma operação de revogação real. O erro da leitura oculta os dados antigos no DOM, sem afirmar remoção do cache interno do React Query.

## Evidências

- Seis leituras negadas e seis eventos de console HTTP correspondentes, preservados integralmente. O runner exige exatamente caminho/status/texto/recurso conhecidos, sem aceitar outros erros. Zero pageerrors, requestfailed, destinos externos ou recursos inesperados. Ledger completo não-OPTIONS, allowlist de quatro rotas de autenticação/contexto/lista; sem consulta clínica, IA ou escrita de paciente/agenda.
- 20 testes existentes da API/página e três testes da fixture aprovados. O novo teste falhou antes de implementar o modo `denied`, depois passou: duas leituras 403 sem DTO, recuperação do DTO intacto e decisão ainda recusada no modo de leitura.
- [15 estados de regressão de leitura](delegation-denied-read-regression/AUDIT.json) e [12 de conflito](delegation-denied-conflict-regression/AUDIT.json) aprovados. O primeiro não registra erros; o segundo preserva somente seus três 409/console esperados.
- Sintaxe e lint dos três scripts, três combinações inválidas de flags, hashes, módulos servidos e limpeza aprovados. Antes da execução final, a conferência de recuperação foi ampliada para os três nomes e contagens exatas de acesso ativo/inefetivo. Revisão independente sem achado acionável; revisão externa não executada nesta automação.

[Captura final em 375 px com a lista oculta](delegation-denied-verified/permissions--permissoes-recepcao-denial-hidden-375.png), inspecionada visualmente. [Validação consolidada](DELEGATION_DENIED_VALIDATION.json). A primeira execução ficou preliminar e fora do commit.

O teste verifica a reação do cliente a um 42501 sintético. Não prova RLS, revogação de permissão, persistência ou alteração de autoridade real. T39/3b/2b/2 continua com resposta perdida e retry da decisão; o mock ainda não implementa replay idempotente. T39/3b e T39 inteiras, MFA/compartilhamento, M2, corte e piloto permanecem abertos. Sem SQL/Native Auth novo, carga, hosted, deploy, push ou edição Claude/SaaS/PersonalMed.

## Reexecutar

Use um nome de execução novo:

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=81abbff454899814957daed87a77be9b34a3a413 --run=denied-recheck --only=delegation-denied
node --test scripts/fixtures/clinic-review-api.test.mjs
```
