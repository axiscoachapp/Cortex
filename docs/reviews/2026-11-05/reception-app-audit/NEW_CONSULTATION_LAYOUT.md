# T40 — largura e alinhamento de Nova Consulta

O limite fixo de500px deixava o formulário estreito mesmo com espaço livre. Em933px, idade/profissão tinham apenas205,81px e telefone/e-mail começavam com32,39px de diferença vertical porque o rótulo do telefone quebrava. O [RED sintético](consultation-layout-red-verified/AUDIT.json) preserva essas medidas e duas capturas.

O modal agora usa a largura disponível até56rem, com margem lateral e limite vertical para rolagem. Nome/nascimento e idade/profissão formam duas colunas no desktop e uma no celular. Inputs/select têm altura uniforme de2,75rem; botões de seleção podem quebrar o texto. Os campos administrativos alinham pelo fim da linha e usam o mesmo espaçamento das demais colunas. As ações ficam à direita no desktop e empilhadas no celular.

## Verificação

- [GREEN final](consultation-layout-final/AUDIT.json):16estados em375/933/1280/1920px a135%, com fontes congeladas em `5385b7155388894b5fb6d93f0cf6d805d588456d` e overlays explícitos somente dos dois componentes. Modal em933px:500→889,80px; altura dos controles:54→59,39px. Bordas das colunas e topos dos pares alinhados, uma coluna de largura integral no celular, ações alcançáveis e nenhum corte horizontal/rótulo ausente.
- Seleção de paciente existente, novo cadastro vazio/preenchido e regressão dos campos compartilhados em Gerenciar pacientes. Alternar as duas opções preserva o rascunho; envio não é acionado. Descarte sintético passa pela confirmação nativa existente. Dados da fixture e contadores de escrita/IA permanecem intactos.
- Quinze testes existentes de submissão/registro em dois arquivos passaram, assim como tipos sem emissão, lint UI/script, sintaxe, três combinações inválidas de opções, hashes e limpeza. Revisão final sem defeito acionável. A inspeção visual inicial levou a uniformizar também a diferença de2,7px entre colunas de grupos distintos; o ensaio foi repetido com asserções de todas as bordas.
- Nenhum erro de página, console, HTTP ou recurso externo. Cinco registros brutos `HEAD /rest/v1/patients`, HTTP200/`net::ERR_ABORTED`, foram preservados e aceitos somente nessa tupla, sem inferir a causa. O inventário aceita somente GET/HEAD e três POST de leitura/autenticação conhecidos.

[Validação consolidada](NEW_CONSULTATION_LAYOUT_VALIDATION.json). Capturas [desktop](consultation-layout-final/clinical---consultation-new-filled-1280.png) e [celular](consultation-layout-final/clinical---consultation-new-empty-375.png) inspecionadas. As passagens preliminares `consultation-layout-red` (erro inicial da própria fixture, zero capturas) e `consultation-layout-green` ficaram fora do commit.

## Responsabilidade da secretaria

A [especificação vigente](../../../product/clinic-crm/PRODUCT_SPEC.md) separa cadastro/contato/agendamento administrativo da consulta clínica privada. A secretaria opera o primeiro conjunto conforme delegações; a janela atual também coleta queixa principal e inicia o atendimento médico. Este ajuste conserva essa separação e todos os handlers, validações, identificadores e permissões. Não transfere a janela clínica inteira para a secretaria.

Sem dados reais da imagem do usuário no repositório, alteração de banco/migration/hosted, IA, push, deploy ou arquivos Claude/SaaS/PersonalMed. A tarefa agendada continua pausada; este trabalho foi solicitado manualmente. MFA/recuperação/compartilhamento e M2/piloto continuam separados e pendentes.

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=5385b7155388894b5fb6d93f0cf6d805d588456d --overlay=src/components/NewConsultationModal.tsx --overlay=src/components/PatientAdministrativeFields.tsx --run=consultation-recheck --only=new-consultation
```

Use um nome novo de execução.
