# T39/3c/2c/2b/2 — limites e indisponibilidade de MFA

O aviso de excesso de tentativas orienta aguardar antes de tentar novamente, sem inventar um prazo de liberação que o app não recebeu. O limite continua sendo do servidor; este recorte não implementa contador, espera obrigatória ou repetição automática.

Uma recusa no desafio interrompe a operação antes da verificação. Uma recusa na verificação preserva seleção/código/fatores e sessão. Erros de limite e indisponibilidade usam avisos locais em português com foco, sem exibir texto bruto do servidor; o próximo envio depende de clique explícito e cria outro desafio.

Testar com o SDK instalado e transporte sintético isolado:429 no desafio,503 no desafio,503 na verificação,429 na verificação e nova recusa422 após retry humano. Dois formatos de erro (`code` com header de versão e `error_code` legado), quatro larguras320–1920 a135%. Conferir chamadas por fase, nenhum retry autônomo no intervalo observado, mesma página, sessão/fatores intactos, zero recurso clínico/escrita/externo. O header sintético Retry-After120 torna explícito que o prazo não pode ser inferido como60s.

Um controle negativo injeta dois timers encadeados (60s+1s) que submetem o formulário sintético real; a verificação de silêncio deve recusá-lo. Executar os timers ao longo de120s, observar mais750ms reais para a cadeia assíncrona do SDK chegar à rede e aguardar networkidle antes da contagem. O evento networkidle anterior sozinho não comprova que um envio assíncrono novo já começou. Esta é uma janela observada, não uma garantia sobre timers arbitrariamente distantes. As duas chamadas e uma recusa422 extras desse controle ficam visíveis no relatório, separadas das40 falhas dos cenários principais; nenhuma delas representa ação automática do produto entregue.

As provas não atestam limite, disponibilidade, espera, TOTP, recuperação de conta ou AAL2 de um Auth real. Sucesso e recuperação administrativa continuam separados. Só dados sintéticos, nenhum serviço hospedado ou novo schema.
