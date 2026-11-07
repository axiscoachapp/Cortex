# K1/6 — consultas pausadas na caixa de conversas

Uma consulta com fetchStatus paused ainda está pendente de conferência. Ela não torna válidos os dados anteriores de conexão, lista, mensagens ou caminho do robô, mesmo mantendo status success no cache. Frescor exige sucesso após montagem e fetchStatus idle.

Conexão pausada desmonta lista, detalhe e consulta de modelos. Lista pausada oculta linhas e detalhe; mensagens pausadas ocultam corpo, flags e comandos, desfazendo confirmações abertas. Caminho pausado oculta apenas o percurso, preservando mensagens e comandos que não dependem dele. Cada nível apresenta espera de conexão de rede, sem confundir pausa com catálogo vazio ou erro do servidor.

Atualizações da lista e mensagens ficam desabilitadas durante fetching ou paused; voltar, filtros e troca de contexto continuam possíveis. Fechar/trocar contexto descarta observação antiga. A continuidade de uma leitura explicitamente solicitada pode retomar ao voltar a rede, sem repetir comandos humanos nem restaurar confirmação anterior. Políticas de retry, refetch de foco/reconexão e transporte não mudam.

Não desabilitar toda a aplicação por um sinal genérico de rede nem alegar que navigator.onLine prova disponibilidade do servidor. O gate usa o estado real da consulta. Testes com onlineManager e navegador isolado simulam pausa/retorno sem executar comandos. Sem Meta, banco, hosted, produtor, C5, importação ou push. Não prova autorização real, rollback ou ausência de corridas no servidor.
