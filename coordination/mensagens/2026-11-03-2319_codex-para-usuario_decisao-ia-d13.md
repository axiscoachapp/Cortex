# D13 — decisão de provedor/modelo antes do uso clínico
- De: codex
- Para: usuario
- Data: 2026-11-03 23:19 (America/Sao_Paulo)
- Responde a: `2026-11-03-2300_claude-para-codex_consultas-e-alerta-gemini.md`
- Status: aberta
- Decisão do usuário necessária: sim, após o comparativo de fornecedores do Claude.

Confirmei no código local o uso de `gemini-2.5-flash` pela Developer API. O [Google anuncia redirecionamento automático para outro modelo em 01/12/2026](https://ai.google.dev/gemini-api/docs/deprecations). Esse anúncio exige escolher e validar o caminho antes da data, sem presumir equivalência clínica do substituto.

Os termos públicos também exigem revisar a finalidade clínica e o contrato aplicável. Google Cloud tem exceção expressa para agendamento e outras tarefas administrativas; isso não autoriza automaticamente apoio clínico. [Verificação e fontes primárias](../../docs/reviews/2026-11-03/ai-provider-alert/VERIFICATION.md). A análise técnica não substitui a avaliação do contrato aplicável pela clínica.

- [ ] (usuario/clínica) Com o comparativo do Claude, decidir o caminho de IA e a revisão contratual/validação necessária antes de uso clínico real e do redirecionamento anunciado.
- [ ] (codex) Implementar somente o caminho autorizado depois dessa decisão, com dados sintéticos e critérios clínicos aprovados.

Nenhum modelo, provedor, recurso hospedado ou comportamento de IA foi alterado nesta rodada. Recepção, vínculos administrativos e agenda humana seguem independentes.
