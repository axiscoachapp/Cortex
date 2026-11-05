# Confirmação de provisionamento — fronteira do servidor em laboratório

Recorte M2 após os produtores privados. Não é endpoint, migration de produção, criação de conta ou concessão de acesso. O módulo experimental ficará em scripts/prototypes e será exercitado com o SQL privado composto e Native Auth locais.

## Entrada e autoridade

O servidor recebe Request e um objeto JSON já lido pelo chamador, estritamente `{operationId}` UUID. Leitura limitada do stream pertence ao futuro handler e não será implementada aqui. Não aceitar ator, sessão, AAL, expiração, clínica, alvo, fase ou booleano de confirmação do cliente.

O próprio módulo importa requireUserContext. Verifica o bearer no Auth antes de usar claims e exige AAL2 também quando a conta não tem fator verificado. Não aceita contexto pré-decodificado nem função de autenticação como argumento público do módulo. O helper Auth compartilhado e suas políticas não mudam.

O único port confiável recebe `{operationId, actorId, sessionId, aal:'aal2', exp}` imutável e chama a confirmação privada uma vez. Não recebe Request/bearer/body. Um wrapper SQL privado do laboratório deriva a clínica da intenção persistida e chama check_intent(...,true); não confia em clínica/UUID alvo externos. A verificação autoritativa continua no procedimento existente, com sessão/fator/geração, receipt alvo atual e relógio final depois das cercas. Leitura prévia da clínica não é autorização e não muda seu vínculo imutável.

O wrapper pertence ao instalador e não dá EXECUTE a public/anon/authenticated/service_role nem aos produtores. O ensaio chama via instalador confiável. Isso não estabelece a identidade/credencial de um adaptador produtivo; custódia/instalação/corte e a política de acesso desse adaptador permanecem pendentes.

## Resultado e falhas

O port devolve JSON desconhecido. O módulo só projeta operação/alvo/clínica/prazo depois de conferir phase=confirmed, operação e ator/sessão iguais aos verificados, UUIDs e prazo válido. Não copia a linha inteira, fator/geração, credencial ou campos extras. Reconfere prazo da intenção e expiração do bearer depois do await, para não entregar uma resposta atrasada como autorização atual. O resultado administrativo não é acesso a prontuário/equipe nem credencial de login.

Erros Auth mantêm o helper existente. Entrada inválida, recusa42501, conflito22023, repetição40001 e indisponibilidade têm códigos internos estáveis sem mensagens/linhas/segredos do banco. Um resultado inválido ou falha de transporte pode ocorrer após commit; não afirma rollback, não repete o port automaticamente, não exclui/recria o alvo e não renova a intenção. A futura reconciliação precisa tratar esse resultado incerto.

## Provas do recorte

- Unitários do módulo e Auth reais carregados com SDK/Auth em memória: sem bearer, sub divergente, recepção, AAL1 com/sem fator, campos extras e UUID inválido não chegam ao port. Controle válido, contexto só do bearer, DTO estrito, retorno divergente/expirado e falha após commit sem repetição.
- Native Auth v2.197.0/v2.189.0: SDKshim encaminha o mesmo bearer para /user real na rede interna; SQL/clinic/TOTP/receipt são reais, sem rota EdgeHTTP. Provar confirmação/replay, outro ator/sessão/operação, bearer adulterado e perda de autoridade entre Auth e transação; alvo/receipt preservados e nenhum grant/credencial.
- Módulos/SQL próprios capturados por hash, migrations congeladas, ACL do wrapper, cleanup e revisão adversarial. As 76 regressões existentes podem ser reaproveitadas, distinguindo-as das provas novas.

## Fora deste incremento

Adaptador produtivo/endpoint HTTP/DTO público, leitura de stream, filiação/pedidos, credencial/MFA histórico/recuperação, custódia/retenção/upgrade com histórico, namespace externo do Auth, reconciliação/corte/gate/UI. Sem paciente real/PersonalMed/importação, provedor pago, hosted, deploy ou push. M2 permanece aberta.
