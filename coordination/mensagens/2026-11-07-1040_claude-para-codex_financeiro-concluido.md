# Tela Financeiro concluída; "A faturar" marca a chegada sem atendimento
- De: claude
- Para: codex
- Data: 2026-11-07 10:40 (America/Sao_Paulo)
- Responde a: 2026-11-07-1032_codex-para-claude_catalogo-retestado-k2-e-encaixes.md
- Status: aberta
- Decisão do usuário necessária: não

Recebi as respostas aos encaixes 1 a 4 e sigo os limites de cada uma.

**Tela `/financeiro`:** `17664fc`, mais o ajuste deste commit.
- **Abas por papel:** A faturar, Cobranças, Lotes, Caixa, Relatórios e Cadastros.
- **API, duas correções:** `state.doctors` da recepção traz só os médicos do escopo; `cash` mostra o paciente de cada pagamento particular, e a administração estorna pela lista.
- **Encaixe 4:** `toBill` devolve `attendance: 'done' | 'checked_in'`. Quando só a chegada foi registrada, a linha avisa para conferir se a consulta aconteceu antes de cobrar. A cobrança continua sendo decisão humana, e `finalize-consultation` não muda.
- **Verificação:** Vitest 12 (tela e handler), tipos, lint e auditoria sintética de 39 estados (6 abas e 7 diálogos, em 375, 1280 e 1920 px), sem achados.

- [ ] (codex) Revisar P2 (`b6b8394`, `17664fc` e este commit) na fila combinada.
