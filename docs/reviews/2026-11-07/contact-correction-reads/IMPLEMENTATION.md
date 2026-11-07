# T47 — leitura verificada da correção

Campos só aparecem após leitura concluída nesta montagem, idle e id validado. Pending/paused/erro retiram campos e ações, mantendo rascunho/baseline em memória. Retry relê, preserva o texto e exige nova conferência. Só Recuperar cadastro confirmado substitui baseline/rascunho; uma revisão nova descoberta em background não é adotada no payload de gravação.

Leitor por instância, AbortSignal opcional até o SDK, mesmo corpo/DTO/deadline20s; cancelar o leitor não cancela gravação. Salvar confere snapshot real no QueryClient antes da mutação. Cada sucesso retorna um invólucro interno com versão de leitura para invalidar a conferência até em respostas imediatas coalescidas; DTO público do API não mudou. T46/contexto/mutex e revisão congelada preservados.

## Provas

[Contrato](../../../product/clinic-crm/CONTACT_CORRECTION_READS.md), [RED controlado](UNIT_RED.json), [restauração](RED_CONTROL.json), [RED coalescido](COALESCED_RED.json), [controle da dependência](COALESCED_CONTROL.json), [GREEN](UNIT_GREEN.json), [SDK](SDK.json), [CLI](CLI.json), [validação](VALIDATION.json).

Controle corrigido contra duas fontes originais:15RED/dois controles,17casos e restauração por hash, sem timeout genérico. Depois, revisão encontrou conferência mantida em releitura rápida; teste controlado que remove apenas a dependência readVersion falha após esperar a notificação React, e a fonte final é restaurada por hash. O primeiro RED com asserção imediata era sensível ao momento da notificação e foi excluído. O hash da restauração inicial é intermediário; o controle coalescido registra o hash final.

Final149Vitest/dez arquivos/18novos, tipos reais/lint8/sintaxe3/seis rejeições CLI. SDK Supabase2.86/PostgREST instalado, nove grupos/oito POST/três hashes em memória, zero rede; corpo exato/pre-abort/retorno tardio/abort em voo/erros seguros/DTO estrito/compatibilidade sem sinal. Deadline conferido por argumento20_000 e sinal nativo controlado nos unitários, sem alegar espera real de20s como ensaio positivo.

[Auditoria bruta final](../../2026-11-05/reception-app-audit/contact-correction-reads-layout-final/AUDIT.json):28estados/48PNGs320–1920/135%,355fontes/39hashes/dois overlays/cleanup.34requests de login/contexto/diretório/cadastro, quatro403/console esperados e oito confirmações nativas de recuperação; zero demais falhas/JS/clínico/escritas/reservas/externos. Leitura inicial mantida em espera, rascunho conferido sem enviar, recuperação mantida403, erro sem campos, retry com rascunho/conferência retirada, descarte explícito para baseline do servidor, fechamento. Capturas320/ações375 inspecionadas; indicador de recuperação agora quebra linha e ações são alcançáveis.

## Revisão e limites

Duas rodadas independentes: P2 de coalescência válido/acionável corrigido; final sem novos achados. Cross-model skipped: non-interactive context.

Preliminares preservados/excluídos: variável copiada errada no teste de deadline; expectativas antigas de elementos destacados/ocultos e erro bruto; captura pending aguardando networkidle até estourar o prazo; cortes2/20px em mensagens/botões estreitos. Corrigidos e repetidos, nenhum timeout genérico/erro de preparação conta como prova válida. A captura só dispensa networkidle nas duas requisições deliberadamente retidas, exigindo status pending; padrão dos outros modos mantido.

Navegador não salva correção. Pausa/cancelamento/clique antigo/mutação enfileirada e payload da revisão são unitários/SDK. Não prova transação/RLS/Auth/servidor ou rollback. T46 continua responsável por efeitos de gravação já enviada. Sem migração, SQL, identidade inferida, campos legais, produtor/C5/Claude/PersonalMed/SaaS, Meta, hospedado, carga, paid, deploy ou push. Digest68 de mensagens intacto/2152 já atendida, sem confirmação duplicada. Próximo ciclo de vínculos ou outros recortes K1/MFA/K7, respeitando4j/C4/C5 pendentes.
