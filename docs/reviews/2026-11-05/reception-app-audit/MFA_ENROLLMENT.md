# T39/3c/2c/1 — limpeza e cadastro TOTP sintéticos

Corrigidos dois problemas na apresentação do cadastro MFA: a lista continuava exibindo o pendente já removido porque não era atualizada após `enroll`; a imagem quadrada ficava deformada no celular por altura fixa. Agora o sucesso invalida a consulta de fatores do ator atual e a imagem usa largura limitada ao conteúdo/altura automática.

O [RED](mfa-enrollment-red/AUDIT.json), baseado em `415dea40c9bf48fba2d164fcb6492130e4929fb9`, mede254,22×280,80px na imagem declarada quadrada. O teste novo do componente também falhou pela manutenção do nome antigo após cadastro. A alteração de base durante a execução foi um commit documental do Claude sobre produção, sem mudança em `src`; a prova permaneceu em fontes congeladas.

O [GREEN final](mfa-enrollment-final/AUDIT.json), com overlay explícito único de AccountSecurity, passa em12estados375/1280/1920px a135%. O clique Adicionar remove somente o pendente sintético antigo e cadastra um novo, ainda não verificado. A lista acompanha o novo ID/nome e preserva os dois ativos. Imagem quadrada, largura e bordas reais ficam dentro do conteúdo do cartão. Revelar a chave-placeholder e digitar código parcial não verifica nada; dispensar a confirmação de Cancelar configuração preserva setup/dados e não envia remoção.

## Evidências e limites

- Dez testes Node e14Vitest em dois arquivos aprovados; dois novos testes Node tiveram RED. A primeira execução Vitest teve timeout no helper/inicialização de worker; a repetição sequencial com fork único e timeout maior passou com as mesmas asserções.
- [12 regressões de erro/foco](mfa-enrollment-final-focus/AUDIT.json), tipos sem emissão, lint UI/scripts, sintaxe/três flags inválidas, hashes/módulos servidos e limpeza aprovados. Revisão pediu conferir bordas esquerda/direita do QR, além da largura; a medição foi corrigida e ambos os ensaios finais repetidos. Leitura final sem outro achado.
- Fixture positiva opt-in exige leitura MFA isolada e exclui o modo de recusa. Permite apenas login, GETuser, DELETE do pendente antigo e POSTfactors estrito (`friendly_name`, `factor_type`, `issuer`). A ordem limpeza→cadastro é uma guarda do mock, não uma alegação da política do Auth real. São seis mutações sintéticas: três limpezas/três cadastros. Fatores ativos, nova remoção e challenge/verificação permanecem protegidos/fora deste modo.

O gráfico diz **SYNTHETIC ONLY** e a chave é um placeholder público inválido; não são QR/segredo TOTP utilizáveis. [Captura375px](mfa-enrollment-final/security--seguranca-enrollment-setup-375.png) inspecionada. [Validação consolidada](MFA_ENROLLMENT_VALIDATION.json). RED preservado; passagens preliminares fora do commit.

Nenhum erro de rede/HTTP/console/recurso externo no ensaio positivo; a regressão mantém somente seus seis403/console conhecidos. Página, dois fatores ativos e dados sintéticos conferidos. Sem consulta clínica, IA, escrita de paciente/agenda, SQL/Native Auth/hosted/push/carga/edição Claude/SaaS/PersonalMed. Não prova persistência/Auth/TOTP/AAL2 reais. Cancelamento confirmado, limpeza da seleção/código após remover setup, verificação e recuperação seguem em3c/2c/2; T39/M2/corte/piloto abertos.

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=415dea40c9bf48fba2d164fcb6492130e4929fb9 --overlay=src/pages/AccountSecurity.tsx --run=enrollment-recheck --only=mfa-enrollment
node --test scripts/fixtures/clinic-review-api.node-test.mjs
```

Use nome novo de execução.
