# T39/3c/1 — configurações TOTP pendentes e preparação do código

Corrigido um defeito concreto em `AccountSecurity`: o SDK Auth2.86.0 devolve em `data.totp` apenas fatores verificados. A tela usava essa lista e, portanto, não mostrava configurações pendentes nem as encontrava na limpeza anterior a um novo cadastro. Agora usa `data.all` filtrado por `factor_type === 'totp'`. A escolha para verificar continua limitada aos fatores verificados; fatores de telefone ficam fora desse fluxo.

O [RED integrado](mfa-preparation-verified/AUDIT.json), apesar do nome da pasta, está explicitamente recusado (`completed:false`): a fixture enviou três fatores e a aplicação mostrou somente dois. Dois testes novos do componente também falharam: pendência ausente e nenhuma remoção anterior ao cadastro. O SDK instalado foi inspecionado em `GoTrueClient._listFactors`; não se alterou seu comportamento.

O [GREEN](mfa-preparation-green/AUDIT.json) usa snapshot `3ef508a5c83086fd7841066f9d8c54f465aeef51` com overlay explícito único de `AccountSecurity.tsx`. Doze estados em375/1280/1920px, a135%: dois autenticadores ativos e um pendente, escolha do segundo ativo, filtro `12x34`→`1234` com botão desabilitado e seis dígitos sintéticos habilitando o botão. Nenhum clique de verificação/cadastro/remoção é feito no navegador. As capturas intermediárias preservam o mesmo documento, conferido por marcador; metadados da fixture ficam intactos.

## Verificação e limites

- Sete testes Node da fixture e onze testes Vitest em dois arquivos aprovados, incluindo os dois novos testes do componente e as regressões existentes. O componente prova por mocks que somente o TOTP pendente é removido antes do novo cadastro; ativo/telefone permanecem. Os dois novos testes da fixture também tiveram RED antes da implementação.
- [15 estados de regressão de permissões](mfa-preparation-final-regression/AUDIT.json), tipos da aplicação sem emissão, lint de dois arquivos UI/três scripts, sintaxe/três flags inválidas, hashes/módulos servidos e limpeza aprovados. Revisão independente identificou o defeito do SDK; leitura final do ajuste sem outro achado concreto.
- Fixture MFA opt-in isolada, sem segredos/QR. Ledger completo não-OPTIONS permite somente POST de login e GET de usuário. Probes Node recusam cadastro, challenge e remoção com403. O navegador não chama esses endpoints, serviços clínicos, IA ou escrita de paciente/agenda; erros de rede/HTTP/console/execução/destinos externos zero.

[Captura móvel corrigida](mfa-preparation-green/security--seguranca-mfa-factors-375.png) inspecionada. [Validação consolidada](MFA_PREPARATION_VALIDATION.json). O RED histórico e o GREEN são preservados; a regressão anterior à mudança final do runner fica fora do commit.

Este recorte prova leitura/preparação no cliente e ordem de limpeza em mocks. Não prova cadastro/remoção/verificação no Auth real ou por transporte integrado, TOTP criptográfico, sessão AAL2, recuperação ou idempotência. Esses fluxos continuam em T39/3c/2; compartilhamento, T39 inteira, M2, corte e piloto seguem abertos. Sem SQL/migration/Native Auth/hosted/push/carga ou alteração Claude/SaaS/PersonalMed.

## Reexecutar

Use nome novo e o overlay explícito da correção ao reproduzir sobre a base histórica:

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=3ef508a5c83086fd7841066f9d8c54f465aeef51 --overlay=src/pages/AccountSecurity.tsx --run=mfa-recheck --only=mfa-preparation
node --test scripts/fixtures/clinic-review-api.node-test.mjs
```
