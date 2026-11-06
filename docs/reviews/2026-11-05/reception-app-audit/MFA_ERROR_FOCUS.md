# T39/3c/2b — aviso de falha MFA visível e focado

Depois de uma falha de ação na Segurança da conta, o aviso agora recebe foco programático e o navegador o traz para a área visível. O parágrafo mantém `role="alert"` e usa `tabIndex={-1}`, sem criar outra parada na sequência de Tab. Cada falha recebe um novo objeto de mensagem: repetir o mesmo erro também aciona o foco. Editar código ou escolher outro fator não o dispara novamente.

O [RED](mfa-focus-red-baseline/AUDIT.json) sobre `6405563dc0b927a3ec0d012ae3bbc78daa4ab878` recusa o aviso inativo; dois casos do componente também falharam antes da correção. O [GREEN](mfa-focus-green/AUDIT.json) passa em12estados375/1280/1920px a135%, com overlay explícito único de AccountSecurity e restante das fontes congelado.

Em cada largura, o usuário escolhe o segundo fator e informa quatro dígitos parciais. Adicionar recebe a recusa sintética da limpeza; o aviso ganha foco e fica totalmente exposto. Editar o código para cinco dígitos mantém o foco no campo. Outro clique gera o mesmo erro e volta a focar o aviso, preservando fator/código. Cancelar a confirmação nativa de Remover mantém os dados e não envia DELETE adicional.

## Evidências e limites

- Seis observações de foco real, retângulo inteiramente no viewport e cinco pontos de hit-test sem sobreposição/clipping. O novo modo `--check-mfa-error-focus` não chama rolagem nem foco no harness. Em375px, o aviso ficou entre149,8–230,8px na primeira falha e35,8–116,8px na repetição. [Captura móvel](mfa-focus-green/security--seguranca-cleanup-denied-375.png) inspecionada.
- Treze testes Vitest em dois arquivos aprovados, incluindo repetição idêntica em lote assíncrono e edição sem roubo de foco. [12 regressões de preparação](mfa-focus-preparation-regression/AUDIT.json), tipos sem emissão, lint UI/runner, sintaxe/quatro flags inválidas, hashes/módulos servidos e limpeza aprovados. Revisão independente sem achado concreto.
- Página/metadados/fator/código/busy e interrupção de cadastro preservados. Ledger continua restrito a login/GETuser/DELETE pendente sempre recusado. Apenas seis403/console esperados; nenhuma tentativa de cadastro, outro erro, chamada clínica, IA ou destino externo. O modo antigo de captura manual2a continua disponível para sua reprodução histórica.

[Validação consolidada](MFA_ERROR_FOCUS_VALIDATION.json). Uma chamada inicial com SHA inválido não gerou prova; a execução RED usada aqui foi refeita com o SHA obtido do Git e preservada sem alterações.

O foco cobre erros das ações, não os avisos separados da consulta inicial de fatores. Não houve teste em dispositivo/teclado virtual ou leitor de tela físico; nem prova de Auth/TOTP/AAL2/cadastro/remoção/verificação reais. Próximo3c/2c: fluxos MFA positivos/recuperação no transporte integrado. Compartilhamento, T39 inteira, M2/corte/piloto abertos; sem SQL/Native Auth/hosted/push/carga/Claude/SaaS/PersonalMed.

## Reexecutar

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=6405563dc0b927a3ec0d012ae3bbc78daa4ab878 --overlay=src/pages/AccountSecurity.tsx --run=focus-recheck --only=mfa-cleanup --check-mfa-error-focus
```

Use nome novo de execução.
