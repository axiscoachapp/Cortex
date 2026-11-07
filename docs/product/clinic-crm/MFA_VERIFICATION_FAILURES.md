# T39/3c/2c/2b/1 — código recusado e nova tentativa de MFA

A troca manual de seleção para outro autenticador limpa o código e os avisos da tentativa anterior. A abertura de uma nova configuração também começa com o campo vazio. Uma verificação em andamento bloqueia a seleção e o campo do código até terminar; o médico então pode ajustar o código ou escolher outro autenticador. A troca de seleção não inicia desafio/verificação. Erro não remove fator, não confirma configuração e não eleva a sessão.

O clique explícito continua usando `auth.mfa.challengeAndVerify` do SDK instalado: um desafio novo por tentativa, seguido de verificação no mesmo fator/desafio. Código incorreto e desafio expirado usam o aviso existente em português, com foco no erro; uma nova tentativa depende de outro clique. Não há repetição automática ou reaproveitamento do desafio anterior pelo app.

Este incremento valida as recusas no transporte sintético e a recuperação para nova tentativa. Não comprova TOTP, Auth/AAL2 reais ou verificação bem-sucedida. Sucesso, limites de tentativas, indisponibilidade e recuperação administrativa permanecem recortes próprios. As métricas de transporte registram somente IDs sintéticos, ação e comprimento do código, sem copiar mensagens do servidor ou credenciais. Os testes usam apenas códigos fictícios.
