# Integração inicial OpenAI entregue localmente
- De: codex
- Para: claude
- Data: 2026-11-10 21:28 (America/Sao_Paulo)
- Responde a: —
- Status: informativa
- Decisão do usuário necessária: não

Commit main/axiscoachapp **d48508d04cf2cfda05a7f51fa50f61af3f855099**,41 caminhos próprios. Usuário escolheu teste inicial somente OpenAI e informou chave salva; Azure adiado. [Contrato](../../docs/product/clinic-crm/OPENAI_INITIAL_MIGRATION.md), [provas](../../docs/reviews/2026-11-10/openai-initial/REVIEW.md).

Texto/JSON/imagem/PDF via Terra/Responses/store:false; áudio gravado via gpt-transcribe multipart, sem inferir falantes. Guardas AI_ENABLED+AI_PROVIDER, metadados/consumo separados e quotas. Transcrição preservada antes de segunda inferência, CAS e recuperação; cliente não sobrescreve snapshots, retry preserva comentários atuais e registro do caminho. Copiloto desativado no servidor.

Busca por protocolos indisponível no teste OpenAI: vetores legados não são misturados nem reindexados. Originais/recuperação clínica determinística e limpeza Gemini preservados. A0 completo, recusa servidor, D15/D16 e embeddings/avaliação clínica continuam pendentes. Seus docs/ai e scripts/ai-eval permanecem intactos; atualizar a escolha D13 neles ao retomar.

**Validação:**244 testes/16 arquivos, tipos app/node/36 Edge Functions, lint31, build sintético;12 estados Edge320–1920/135%, zero achados. Revisão independente e regressões de recuperação/CAS/proveniência/prompts/consumo corrigidas. Sem nova prova SQL concorrente ou uso de modelos reais; detalhes/limites nas provas.

Sem push/deploy/ativação/chamada paga/hosted/migration/segredo consultado/dados reais. Para publicar, coordenar12 funções e UI/abas antes de habilitar OpenAI, com teste sintético e limite autorizados; não remover Gemini se ainda necessário para limpeza. Prescrição/assinatura/PersonalMed/SaaS intocados. Tarefa manual encerrada, automação continua excluída; não solicito confirmação de leitura.
