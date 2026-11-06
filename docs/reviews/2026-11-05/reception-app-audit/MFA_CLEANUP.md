# T39/3c/2a — interromper cadastro quando a limpeza falha

Corrigido um segundo defeito concreto em `AccountSecurity`: `unenroll` pode resolver a Promise com `{ error }`, e o fluxo ignorava esse erro antes de chamar `enroll`. Agora a limpeza de cada TOTP pendente confere o erro e interrompe o cadastro. O caminho de sucesso mantém a ordem anterior e não remove fatores verificados ou de telefone.

O [RED integrado](mfa-cleanup-red/AUDIT.json) usa fontes congeladas em `c5e7e4450c8acbbf9408e0c636684860ef1de8b4`: após DELETE recusado, o cliente ainda tentou POST `/auth/v1/factors`, que a fixture bloqueou. Um teste novo do componente também falhou por ausência de aviso/continuação indevida. O novo teste da fixture falhou antes de implementar seu controle opt-in.

O [GREEN final](mfa-cleanup-final/AUDIT.json), com overlay explícito único da página, passa em12estados375/1280/1920px a135%. Em cada largura: três fatores iniciais; Adicionar recebe403 na limpeza e não tenta cadastrar; outro clique repete somente a limpeza recusada; clicar Remover no pendente e cancelar a confirmação nativa não envia DELETE nem informa remoção. O mesmo documento e os metadados dos fatores são preservados.

## Verificação e limites

- Oito testes Node e12Vitest em dois arquivos aprovados. Os testes existentes preservam limpeza apenas do pendente antes do cadastro bem-sucedido; o novo caso exige parar no erro retornado pelo SDK. Tipos sem emissão, lint UI/scripts, sintaxe/três flags inválidas, hashes/módulos servidos e limpeza aprovados. Revisão independente sem achado acionável.
- [12 regressões de preparação MFA](mfa-cleanup-final-preparation/AUDIT.json) aprovadas com o mesmo overlay. O modo antigo continua sem permitir mutações MFA.
- `mfaCleanupReview` exige a fixture MFA isolada e acrescenta somente DELETE do ID pendente à allowlist de login/GETuser. Esse DELETE sempre devolve403/`insufficient_aal`, sem alterar dados. Cadastro, challenge, verificação e DELETE de fator ativo continuam proibidos. Ledger completo não-OPTIONS; seis403 e seus eventos de console são esperados exatos. Zero outro erro, recurso externo, consulta clínica, IA ou escrita de paciente/agenda.

[Captura móvel do aviso](mfa-cleanup-final/security--seguranca-cleanup-denied-375.png) inspecionada; [validação consolidada](MFA_CLEANUP_VALIDATION.json). As capturas2a foram roladas manualmente até o aviso para inspecioná-lo. Naquela versão, ele podia ficar acima do botão no celular; esse achado foi corrigido em [T39/3c/2b](MFA_ERROR_FOCUS.md). As primeiras passagens GREEN/regressão, anteriores a esse enquadramento, ficam fora do commit; RED preservado.

A recusa e os dados intactos são sintéticos; não há prova de permissão/Auth real, exclusão real, TOTP/AAL2, cadastro/verificação bem-sucedidos ou recuperação. T39/3c/2 segue aberto para esses fluxos, além da visibilidade do aviso; compartilhamento, T39 inteira, M2, corte e piloto continuam separados. Sem SQL/migration/Native Auth/hosted/push/carga ou edição Claude/SaaS/PersonalMed.

## Reexecutar

Use nome novo:

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=c5e7e4450c8acbbf9408e0c636684860ef1de8b4 --overlay=src/pages/AccountSecurity.tsx --run=cleanup-recheck --only=mfa-cleanup
node --test scripts/fixtures/clinic-review-api.node-test.mjs
```
