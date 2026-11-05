# T28/M2 — geração da autoridade administrativa

04/11/2026. Próxima prova limitada após `2f0a155`: vincular uma intenção à mesma época de autoridade, usando `clinic_members` e o guard privado/T33 reais. Só banco descartável; não é migration, endpoint nem integração Auth/credencial.

## Predicado e histórico

O guard atual `reception_provisioning_admin(clinic,admin)` confere conta, custódia e filiação **atuais**. Isso não distingue admin ativo → médico/inativo/ausente → admin ativo. Uma intenção reservada antes dessa perda não deve voltar a ser válida quando o papel retorna. Nova operação humana poderá obter nova geração; não atualizar o vínculo antigo por replay.

No protótipo, adicionar à linha real de `clinic_members` um UUID de geração administrativo, independente de `updated_at` e da versão da custódia. A custódia pode mudar por outras escritas legítimas e não é o histórico da autoridade. Preencher membros existentes na instalação; atribuir nova geração em INSERT e em mudança de clínica, usuário, papel ou status. DELETE/INSERT sempre cria outra geração. UPDATE sem mudança nesses campos conserva a geração. Escritores normais autenticados/serviço/proprietário não escolhem nem restauram o valor: o trigger deriva a geração e ignora um valor fornecido. Desabilitar triggers/reescrever DDL deliberadamente como superusuário não faz parte desse modelo.

Um helper privado consulta o guard real primeiro, mantendo suas travas Auth/T33/filiação, e obtém a geração da linha cercada. Outro compara com o UUID capturado pela intenção e recusa NULL/divergência; não há liberação por booleano do cliente. Geração não é segredo nem substitui autorização atual. Uma intenção futura deve conservar o valor original no ledger já previsto; esta prova não cria outro ledger de provisionamento.

## Concorrência, instalação e escopo

- Recusar aquisição ocupada sem espera; usar a proteção T33 real contra snapshot RR antigo. Alteração que ganhou antes deve invalidar a geração antiga; checagem curta que ganhou primeiro impede confirmação concorrente de mudança até terminar ou faz o escritor recusar/repetir explicitamente.
- Provar ABA de papel/status, DELETE/INSERT, alteração e volta na mesma transação, não restauração por valor fornecido e no-op. Mudança de outro administrador não invalida a geração deste ator.
- Instalar atomicamente em RC com trava NOWAIT da tabela; erro/ocupação ou snapshot estabelecido não deve deixar coluna/trigger/helper parciais. Não reservar número de migration para um protótipo fora de `supabase/migrations`.
- Helpers/schema privados sem USAGE/EXECUTE para public/anon/authenticated/service_role. Os testes invocam como proprietário confiável com contexto de serviço; isso não é uma fachada pública nem prova de autenticação humana.
- Preservar definições entregues de T33/guard, leitores/escritores de fila/agenda, grants e pedidos. Controles que retirem NOWAIT só no banco descartável, cancelando a consulta própria após observar a espera e restaurando/comparando a definição exata. Rodar regressões dirigidas do provisionamento/pedidos existentes para detectar acoplamento da coluna/trigger experimental. UPDATE direto autenticado que a ACL atual recuse deve continuar recusado; não conceder acesso para fazê-lo chegar ao trigger. Serviço/proprietário com escrita permitida devem alcançar o trigger e não escolher a geração.

O nome e exposição da coluna no schema público existem somente na base descartável; compatibilidade de tipos/API, política de privilégios, instalação/upgrade completa e custódia da intenção ainda dependem do desenho de produção. Uma geração não invalida o histórico de mudanças do Auth (`account_type`, credencial/MFA, sessão/fator), nem decide como recuperar identidade Auth já criada. Esses vínculos, composição com a prova nativa anterior, filiação sem grants, corte do serviço/legado e recuperação permanecem pendentes. PersonalMed, dados legais e os três helpers T33 do Claude ficam preservados.

## Aceite da prova

RED real: guard baseado só no estado atual aceita contexto antigo após ABA. GREEN: geração original recusada em cada sequência; geração nova aceita apenas sob autoridade atual. Duas conexões RC/RR, instalação atômica, ACL e ausência de concessão automática comprovadas. Não chamar o incremento de solução M2/T31 completa nem promover o SQL para produção.
