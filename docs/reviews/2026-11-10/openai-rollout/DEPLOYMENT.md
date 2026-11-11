# OpenAI publicado e testado

10/11/2026,22:06 America/Sao_Paulo. Usuário autorizou teste real da API e publicação das alterações necessárias no Supabase; confirmou push. Código d48508d, Git remoto bb6eb20. Frontend público200 e contrato draftPersisted/aiMetadata identificado no chunk clínico servido.

## Publicação

Projeto Cortex, conhcwuwtrkerpbblzgu. CLI3.1.0, alvo explícito e --use-api; publicadas somente12 funções: analyze-document, chat-assistant, create-template-ai, finalize-consultation, generate-document, generate-prebriefing, ingest-knowledge, live-copilot, process-clinical-notes, process-comment, suggest-questions, transcribe-consultation.

AI_PROVIDER=openai selecionado após publicação. AI_ENABLED já era true e foi preservado, assim como a chave e os demais segredos. Nenhuma migration:83 locais/remotas iguais. Cópias das12 fontes anteriores para rollback fora do repositório, [confirmação](ROLLBACK.json). Não foram consultados prontuários nem escritos dados clínicos.

[Verificação](DEPLOYED.json):12 ACTIVE, JWT mantido, POST sem sessão401 e preflight200/origem exata do app em todas. Download posterior confirma igualdade normalizada de transcribe-consultation e cinco módulos compartilhados, [readback](SOURCE_READBACK.json).36 funções finais; nenhum probe temporário remanescente.

Ao selecionar segredo, contadores de versão de outras funções avançaram sem mudança de timestamp da fonte. O primeiro ensaio classificou por versão e foi corrigido para separar esse efeito: [ensaio inicial](ENVIRONMENT_REVISION_CHECK.json), resultado final em DEPLOYED.json. Nenhuma fonte não alvo teve timestamp alterado. O verificador geral de rollout ainda aponta24 não alvos pelo timestamp conservador de _shared; a comparação por fonte própria identificou exatamente as12 publicadas. Não há migration pendente nem falha de publicação nos alvos deste recorte.

## API real e português brasileiro

Áudio WebM/Opus de23 segundos, voz pt-br de eSpeak-NG gerada offline, conteúdo inteiramente fictício. Sem pacientes, consulta real ou TTS pago. Um probe temporário com nonce em memória, hash/prazo/controle401 foi usado e removido em finally. Revisão independente corrigiu rechecagem de consumo/prazo após awaits. Estado one-shot é por isolate; o executor faz uma única requisição válida e nenhum retry.

Uma tentativa inicial do harness retornou500 antes de produzir resultados; não foi apresentada como teste aprovado. A versão de conectividade não altera flags/globais e retornou200 nas duas rotas OpenAI: [conectividade](SMOKE_CONNECTIVITY.json). Após publicação/ativação, novo teste usou os adapters reais, sem overrides, e retornou200 com AI_ENABLED/AI_PROVIDER corretos: [adapters](SMOKE.json). Todos os três probes foram removidos; chave nunca saiu do ambiente hospedado.

- gpt-transcribe:23 segundos, português detectado na conectividade, transcrição preservou42 anos, cefaleia há três dias, negações de febre/alergias e ausência de prescrição. A abertura reconheceu "sintético" como "sintático"; não se alega perfeição ou validação clínica.
- gpt-6.1-terra: modelo efetivo confirmado, schema estrito, idioma pt-BR, resumo em português brasileiro preservando esses fatos.148 tokens de entrada/50 de saída em cada teste.
- Quatro chamadas OpenAI aprovadas no total, sem retries automáticos. Estimativa Standard US$0,004246 (não fatura), [consumo/idioma](COST_AND_LANGUAGE.json). Um clipe sintético não mede precisão em consultas reais/sotaques/ruído/medicações.

Teste não incluiu login médico nem persistência clínica de ponta a ponta. As244 regressões locais e a prova do código publicado permanecem como evidência complementar, não como ensaio real de prontuário. Copiloto segue desligado; protocolos por embeddings seguem indisponíveis até migração própria. D15/D16 e validação clínica continuam pendentes. Sem assinatura/fiscal/Meta/envios ou alterações em domínios Claude/SaaS.

Resultado: publicação e ativação concluídas; usuário pode atualizar a aba e iniciar teste sintético do fluxo do aplicativo. Nenhum push adicional ou automação reativada.
