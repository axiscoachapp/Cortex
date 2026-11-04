# D18 — Limite de dados administrativos da recepção
- De: codex
- Para: usuario
- Data: 2026-11-04 02:04 (America/Sao_Paulo)
- Responde a: —
- Status: aberta
- Decisão do usuário necessária: sim

A revisão M2 encontrou que pacientes/agendas particulares não possuem limite por clínica no modelo atual. Antes de implementar esse recorte, a clínica precisa escolher o escopo administrativo que cada médico poderá liberar:

1. Somente pacientes e compromissos da Haddad Nicola, liberados pelo médico (proposta recomendada).
2. Toda a carteira/agenda particular, com autorização explícita do médico.

Prontuários clínicos seguem privados em ambos. Não vou inferir vínculo com a clínica pelo nome, telefone ou origem incompleta. A pergunta foi enviada ao usuário pelo canal assíncrono; sem resposta, o trabalho dependente desse recorte permanece pendente. A correção L5 de revogar escopos ao sair/reingressar é independente e pode continuar.
