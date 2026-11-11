# Integração inicial OpenAI — validação local

10/11/2026. Base6532667, branchmain; [contrato](../../../product/clinic-crm/OPENAI_INITIAL_MIGRATION.md). Somente dados sintéticos, fetch simulado e navegador isolado. Chave real não foi consultada, exibida ou usada. Nenhuma publicação/ativação/chamada paga/migration/operação hospedada.

## Entrega

Terra via Responses para texto/JSON/imagens/PDF; gpt-transcribe multipart para gravações. Guardas AI_ENABLED/AI_PROVIDER, limites90s/2MB de resposta, origem fixa/redirect recusado, `store:false`, schema estrito e validação local, recusa/incompletude/vazio recusados. Modelo pedido e efetivo separados, ausência explícita; metadados sem conteúdo/identidade. Consumo OpenAI separado, com tier de contexto longo; ausência de medição mantém reserva, sem alegar fatura ou teto por operação.

Áudio original retido, transcrição checkpointada antes de settlement/segunda inferência, CAS por updated_at e retorno de recuperação. Cliente não contorna o CAS com upsert de snapshot antigo. Notas manuais/consentimento/comentários e proveniência preservados; retry sem fala não apaga texto anterior. Prompts padrão/customizados e regeneração não pressupõem diarização.

Copiloto recusado no servidor. Protocolos por embeddings indisponíveis durante teste OpenAI, sem misturar vetores ou fallback Gemini. Recuperação clínica determinística e controle de acesso de respostas antigas permanecem; originais de protocolos e limpeza Gemini preservados. Prescrição/assinatura/PersonalMed/SaaS intocados.

## Provas

- `npm exec -- vitest run <16 arquivos do relatório> --maxWorkers=2 --reporter=default --reporter=json --outputFile=docs/reviews/2026-11-10/openai-initial/vitest.json`: **244/244**, zero falhas/ignorados; [resultado](vitest.json). Inclui adapters/handlers novos, posse/CAS/comentários/cache/quota, segurança/privacidade, UI de revisão e fontes. Não é uma nova execução dos2420 testes gerais do app.
- `npm run build` com URL/chave pública sintéticas: tipos app/node e build aprovados. Deno `npm run typecheck:edge`: **36 funções** aprovadas, inclusive após os ajustes finais. ESLint dos31 arquivosTS/TSX alterados, `node --check scripts/app-audit-browser.mjs` e diffcheck normal do Git aprovados.
- `AUDIT_OPENAI_MIGRATION=1 AUDIT_WORKSPACE_ROLE=doctor AUDIT_COMPACT=1 node scripts/app-audit-browser.mjs --only /assistente`: Edge isolado, **12 estados** (auth/assistente/resposta com aviso) em320/375/1280/1920,135%, [relatório](browser/audit.json). Zero errosJS/console, overflow, controles sem nome ou requests desconhecidos. Capturas320/1280 inspecionadas; o histórico possui rolagem própria.
- Bundles de cliente inspecionados por presença de nomes/endpoints: nenhum `OPENAI_API_KEY` nem `api.openai.com`; segredo permanece só no backend. Nenhum valor real de segredo foi procurado.

## Revisão e correções

Duas frentes de implementação e revisão independente de contexto novo, três ciclos de código. Contrato conferido nas fontes oficiais vinculadas. Achados tratados com controles sintéticos:

1. Upsert da UI e catch antigos podiam apagar checkpoint/CAS: três RED, depois GREEN; retry de snapshot registrado também reproduzido e corrigido.
2. Tentativa sem fala apagava transcrição anterior: dois RED, depois retenção literal/proveniência e tentativa vazia separada.
3. Regeneração ainda afirmava rótulos médico/paciente:13 RED, regras comuns de atribuição e GREEN em todas as especialidades/modelo personalizado.
4. Consumo acima272K tokens ignorava tier longo: corrigido, controle300K/1K=607,5 créditos estimados. Reasoning não é somado duas vezes.
5. Retry podia reenviar comentários antigos: baseline atual do servidor é usado, controle RED→GREEN.
6. Caminho atribuído antes de sua gravação falhar impedia retry: controle falhou antes, agora registra candidato antes de publicar o caminho local; novo envio/revisão GREEN.

Fixturas antigas dos handlers foram adaptadas à nova dependência; falhas de fixture não são apresentadas como defeitos de produto. Suítes legadas de embeddings permanecem testadas no modo legado; há controle separado de503/zero efeitos no modo OpenAI. Não houve segunda opinião por CLI/modelo externo, conforme preferência anterior do usuário.

## Limites e próximos passos

Sem comparação clínica, voz real, API paga, prova de acesso aos modelos ou orçamento autorizado. CAS exercitado por fixture, sem novo ensaio SQL concorrente; schema não mudou. A0 completo/recusa clínica servidor, D15/D16, versionamento/reindexação de embeddings e avaliação médica continuam pendentes. Coordenar UI/funções/abas na publicação autorizada e fazer primeiro teste pago apenas sintético/com limite. Não inferir autorização clínica pela chave salva.

Commits somente de caminhos próprios/main/axiscoachapp. `tasks/plan.md`, `tasks/todo.md` e untracked alheios preservados. Automação excluída; tarefa manual encerra após handoff.
