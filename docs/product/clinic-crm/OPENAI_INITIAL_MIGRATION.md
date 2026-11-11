# Integração inicial OpenAI — contrato local

Decisão do usuário em10/11/2026: testar inicialmente somente OpenAI; Azure adiado. Uma chave de projeto `OPENAI_API_KEY` foi salva pelo usuário. Chave não é autorização para ativar tráfego, publicar ou consumir API paga.

## Recorte

- Texto/imagens/PDF: Responses API, modelo exato `gpt-6.1-terra`, `store:false`, sem ferramentas, continuidade hospedada ou retry automático. JSON Schema estrito e validação local; recusa, saída incompleta/vazia/inválida falham antes de persistir conteúdo.
- Áudio gravado: multipart `/v1/audio/transcriptions`, modelo exato `gpt-transcribe`, até25MB. Nome técnico com extensão; sem upload na Files API. Não há diarização neste recorte: não inferir médico/paciente nem horários. O áudio original permanece até a consulta revisada ser salva.
- O servidor preserva a transcrição antes da segunda inferência e atualiza o rascunho por `updated_at`/posse/caminho exatos. Resposta aditiva: `draftPersisted`, `draftUpdatedAt`, `draftPersistenceFailed` quando aplicável e `aiMetadata`. A UI não regrava snapshots após processamento nem antes de repetir áudio já registrado; falha de registro de caminho não é tratada como registro confirmado. Comentários/queixa vêm do baseline salvo; tentativa sem fala preserva transcrição anterior e sua proveniência, sem gerar uma nova evolução a partir dela.
- `_shared/clinicalAi.ts`: `callClinicalText(apiKey, parts, options)` e `transcribeClinicalAudio(apiKey, blob, mimeType)`. Partes de texto `{text}` ou anexo `{document:{data:Uint8Array,mimeType:string}}`; opções `systemInstruction`, `maxOutputTokens`, `responseSchema`. Retorno `{text, usage, metadata}`; metadata com provedor, modelo solicitado/efetivo (null se não informado), versão de adaptação, diarização quando aplicável. Sem remapear modelos.
- Guardas finais: `AI_ENABLED=true` **e** `AI_PROVIDER=openai`; chave só servidor. Sem alterar segredos/flags hospedados nesta entrega. Autorização/posse/revisão/quota e fallback manual existentes preservados. Requests limitados em tempo/tamanho, sem corpo/identidade/segredo nos logs ou erros.
- Consumo OpenAI distinto de Gemini. Tokens ausentes/parciais não viram custo zero: reserva fica cobrada. Conversão por tabela documentada é estimativa de controle, não fatura. Modelo efetivo ausente não será inventado. Não se alega teto monetário por operação nem orçamento contratado.
- Embeddings ficam fora: vetores Gemini768 não são compatíveis com OpenAI. Durante o teste OpenAI não executar embeddings Gemini, consultar índices legados com vetores novos nem reindexar automaticamente. Busca por protocolos explicita indisponibilidade; recuperação clínica determinística já existente permanece. Indexação responde503 preservando originais. Migração futura exige modelo/proveniência/reindexação e aceite próprios.
- Copiloto ao vivo segue desativado inclusive no servidor. Limpeza de arquivos Gemini antigos permanece disponível, independente da ativação de IA. Prescrição/assinatura/PersonalMed/SaaS e schema não entram neste recorte.

## Provas exigidas

Somente fixtures sintéticas e fetch mockado: serialização oficial, JSON estrito/nested, recusa/truncamento, metadados/consumo incompletos, formatos/tamanho/silêncio, chave/flags, timeout, origem única, zero fallback Gemini, sem perda de transcrição quando geração/settlement/salvamento falha. Regressões dos handlers de posse/revisão/fontes/rascunhos e tipos Edge. Revisão independente antes do commit; sem testes pagos ou dados reais.

## Próximo passo de ativação (separado)

Autorizar publicação e teste pago sintético com limite; validar acesso aos modelos e qualidade clínica com médicos. D15/D16 e requisitos de dados/recusa continuam pendentes para uso clínico real. A0 completo (recusa clínica no servidor, controles por tarefa), A1/A6 e ferramenta de avaliação pertencem às etapas próprias; este recorte não os declara concluídos.

A publicação deve coordenar as12 funções alteradas e a UI antes de habilitar `AI_PROVIDER=openai`; atualizar as abas dos testadores. Não remover o segredo Gemini enquanto houver limpeza de arquivos antigos pendente. `store:false` não substitui aprovação das condições de tratamento de dados. Nenhuma mudança SQL é necessária neste recorte.

## Fontes oficiais conferidas em10/11/2026

- [Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra)
- [Transcrição](https://developers.openai.com/api/docs/guides/speech-to-text) e [contrato](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)
- [Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses), [JSON estrito](https://developers.openai.com/api/docs/guides/structured-outputs) e [anexos](https://developers.openai.com/api/docs/guides/file-inputs)

## Alterações de 11/11/2026 (Claude, por pedido direto do usuário, com medição)

Avaliação real com paciente sintética de 16 consultas e áudio de duas vozes: [AVALIACAO_IA_PACIENTE_ANTIGO.md](../../reviews/2026-11-10/revisao-geral/AVALIACAO_IA_PACIENTE_ANTIGO.md).

- **Atribuição de falantes:** a regra "não inferir médico/paciente" deixou a evolução vazia em 2 de 3 execuções e cheia de ressalvas na terceira. Passa a valer a atribuição pelo contexto, sem ressalvas de autoria no texto; a dúvida vai para `clarifications` só quando muda o sentido clínico. A revisão do médico antes de salvar continua obrigatória. `gpt-4o-transcribe-diarize` foi testado e descartado (54 s e erros em termos clínicos).
- **Contexto do prontuário na evolução:** `transcribe-consultation` e a regeneração de `finalize-consultation` recebem a história médica e a avaliação e o plano da última consulta, em bloco marcado como contexto. A regra "a evolução vem só do que foi dito" permanece.
- **Alertas:** `drug_interaction_alerts` cobre também alergia registrada e contraindicação anotada no prontuário.
- **Extração pós-salvamento:** recebe as medicações do cadastro, devolve só as iniciadas ou alteradas e `medicationsStopped` (proposta de retirada, confirmada pelo médico no cartão).
- **Assistente:** `retrieve_patient_context` reescrita (migration `20261111100000`); anotações mais recentes; nome do paciente fora do prompt; pergunta de medicação com paciente responde só o que o prontuário registra e mantém o aviso fixo.
- **Pré-consulta:** avaliação e plano completos da última consulta, história médica e resumo das cinco anteriores; regra de não inventar.

## Alterações de 11/11/2026, segunda rodada (Claude, ia-servidor)

Fonte: [relatorios/ia-openai.md](../../reviews/2026-11-10/revisao-geral/relatorios/ia-openai.md). Prompts, contexto do prontuário e recuperação da rodada anterior mantidos. Migration `20261111160000_ai_quota_clinic_day.sql`.

- **Erros do provedor (achado 12):** 429 (exceto `insufficient_quota`) e 5xx continuam com "tente novamente". Os demais 4xx não pedem nova tentativa: áudio longo demais (413), áudio não aceito (422), conteúdo grande demais (413), documento ilegível (422); chave, modelo, cota da conta ou pedido malformado respondem 503 "IA indisponível no momento; registre manualmente." Todos com `Referência`. O log `model_request_failed` guarda `http_status`, `error_code` e `error_type` (só identificadores curtos), nunca a mensagem do provedor. O cliente mostra o `error` do servidor.
- **Cota (achado 10):** tabela de preços conferida (Terra 0,001/0,005 crédito por token; transcrição 4,5 créditos/min). Reserva da transcrição proporcional ao tamanho do áudio (estimativa a 32 kbps, mínimo 25). Limite padrão 8.000 créditos/dia (cálculo em `_shared/quota.ts`: ~4.600 para 25 consultas de 20 min com resumos e perguntas); linhas com o antigo padrão 1.500 sobem para 8.000, nenhum outro limite muda. O dia da cota é o dia da clínica (`America/Sao_Paulo`) em `reserve_usage`, no medidor e na mensagem, que diz quando renova; a resposta 429 traz `resetsAt`.
- **Reserva de chamada que falhou (achado 15):** o adaptador marca `AiProviderError.billing`: `none` (não enviada ou resposta não-2xx) libera a reserva a zero na hora; `reserved` (2xx com saída inutilizável) cobra a reserva; falha de transporte ou tempo esgotado continua com a reserva pendente até a liberação automática (custo desconhecido).
- **Limites de saída e avisos (achado 9):** regeneração 6.000 tokens (igual ao rascunho), extração pós-salvamento 2.000, história de primeira consulta 2.500, assistente 1.500. Quando a extração ou a história não é gerada, `finalize-consultation` devolve `notices: string[]` com o motivo (limite diário, IA indisponível ou falha).
- **Retry do salvamento (achado 13):** a proposta de cadastro (`diagnoses`, `medications`, `allergies`, `medicationsStopped`) e os `notices` ficam em `consultations.profile_proposals`; o caminho "já salva" devolve o que foi guardado.
- **Modelo efetivo (achado 16):** aceita `gpt-6.1-terra` ou `gpt-6.1-terra-<qualquer sufixo>` e registra o modelo informado (null se tiver caracteres fora de identificador). Outro modelo continua rejeitado.
- **Roteador de medicação (achado 14):** o seguimento só é roteado quando a própria mensagem cita um medicamento e uma pergunta anterior já era decisão de medicação; verbos genéricos ("manter", "iniciar") só contam com medicamento citado ou retomado ("os dois"). Novos padrões de dose e de segurança na gestação e lactação. Com paciente: modo registro; sem paciente: aviso fixo.
- **Ordem das guardas (achado 17):** todas as funções desta área verificam IA ativa e chave logo após a autenticação; chave ausente responde 503 com o texto padrão. Exceções deliberadas: `process-comment` salva o comentário literal com IA desligada, e salvar uma evolução revisada (`saveDirect`) nunca depende da IA.
- **Gemini legado (achado 20):** chamadas Gemini e indexação exigem `AI_PROVIDER=gemini` explícito; limpeza de arquivos antigos continua liberada.
- **Entradas limitadas (achados 21 e 22):** `process-comment` envia até 80 itens por lista, marcando os omitidos; `suggest-questions` marca o trecho cortado. Modelo personalizado acima de 20.000 caracteres e evolução editada acima de 30.000 são recusados (413) com mensagem, antes de qualquer cobrança.
- **Áudio longo (achado 11):** orçamento de 140 s por chamada; prazo da transcrição 30 s + 5 s por MB. Se sobrar menos de 60 s para a evolução, a resposta traz `noteDeferred: true` com a transcrição já salva; o cliente pede a evolução com `noteOnly: true` (mesmo `draftId`/`audioStoragePath`), sem reenviar o áudio. Falha da evolução traz `draftNotice` quando o motivo é acionável.
- **Minimização (achado 19):** nome do paciente só no rascunho e na regeneração (mensagem ao paciente) e no encaminhamento; fora do resumo ao paciente, da pré-consulta, das perguntas e do comentário. Nome do arquivo anexado não vai ao provedor.

Não verificado sem a API real: limite de duração do `gpt-transcribe`, tempo real de transcrição por MB, limite de ~150 s da plataforma, códigos de erro exatos devolvidos pela OpenAI e o formato de sufixo do modelo.

