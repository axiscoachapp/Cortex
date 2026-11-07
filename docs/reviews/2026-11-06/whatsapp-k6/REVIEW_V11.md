# K6 — reteste da versão1.1

Fontes congeladas `40e90c1f720371e88ccdde538909a4a464320d44`. A [mensagem2058](../../../../coordination/mensagens/2026-11-06-2058_codex-para-claude_residuos-v11-com-provas.md) registra os resíduos com o dono C4. Os achados antigos deebb866a não são repetidos como falhas atuais.

[SQL_REVIEW.json](residual-40e90c1/SQL_REVIEW.json): 78migrations/suíte original passam. Seis expectativas antigas e guarda interna passam. O setup inclui vínculo confirmado, consentimento quando a tabela existe e controle de reserva positiva para resposta cruzada. Além do sucesso da ingestão com aliases, exige preservar duas conversas.80fontes/hash e cleanup positivo conferidos; nenhum fixture_failure.

Quatro expectativas adicionais falham:

| Caso | Evidência |
|---|---|
| `changed_rule_filter` | Elegível antes da mudança, fora dos candidatos após alterar doctor_ids, mas reserva do candidato antigo ainda preparada |
| `suspended_link_candidate` | Suspensão pelo RPC administrativo real confirmada como active=false; consulta histórica continua candidata |
| `suspended_link_reservation` | Mesmo controle de suspensão; reserva ainda preparada |
| `split_alias_opt_out` | Duas conversas preservadas, evento com ambos os aliases, SAIR posterior só por BSUID confirmado; reserva pelo telefone ainda preparada |

O relatório retorna accepted=false/exit1 por essas violações de contrato, com infraestrutura completada e banco removido. `green-40e90c1-controls` é passagem intermediária somente dos sete controles anteriores, excluída da entrega final. Nenhuma migration C4 foi editada pelo Codex.

[HANDLER_PROBES_40E90C1.json](HANDLER_PROBES_40E90C1.json) reproduz dois resíduos com módulos reais transpilados em memória e dependências sintéticas, sem fetch/Graph/serviços:

- Cursor `.123456+00:00|uuid` é entregue ao store como `.123Z`, reduzindo precisão antes da comparação de página. O cliente K1 preserva os bytes; isso não corrige o decoder servidor.
- Location com latitude objeto inválido, seguida de texto válido: controle com latitude numérica processa ambas; objeto lança TypeError e webhook assinado sinteticamente responde200, sem ingerir o irmão válido. RPCs observadas: record_event/finish_event(error=parse). O efeito de finish_event no banco foi inspecionado, não executado por esse probe.

Reprodução na raiz, usando outro nome de run SQL:

```powershell
node scripts/reviews/whatsapp-k6-sql.mjs --baseline=40e90c1f720371e88ccdde538909a4a464320d44 --run=novo-nome
node scripts/reviews/whatsapp-k6-handler-probes.mjs 40e90c1f720371e88ccdde538909a4a464320d44
```

Um resíduo P1 permanece por inspeção: telefone lido sem lock antes de esperar conversa/advisory, permitindo correção concorrente do contato e envio antigo. A mensagem propõe ensaio em duas conexões; não se afirma execução desse caso. Mudanças de prazo/end_time/modelo/revisão da regra também precisam ser cobertas pela reserva, além do filtro reproduzido.

K6 e integração de envio/automações continuam abertos até correção/SHAs e reteste. K1/2 só lê. Nenhum dado real, Meta, banco hospedado, reserva, envio, deploy ou push.
