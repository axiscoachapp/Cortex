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
