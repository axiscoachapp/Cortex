# D17 — revisão do desenho v2 e regressão dirigida

04/11/2026. Desenho congelado em `1c02436b1e3ec9717fbe17ee5bf24752ac7c5137`, resposta à entrada Claude de 22:48. Leitura de contrato e código, sem edição do domínio do Claude. O desenho ainda não é implementação nem aprovação de handlers.

## Evidência desta rodada

[verification.json](verification.json): **93 testes aprovados, um ignorado, quatro arquivos**, zero falhas; fontes executáveis conferidas antes/depois. Exercitados `pades`, `signatureFlow`, `regulatedMedications` e `DocumentComposerModal`, com PKI e dados sintéticos. O código de `908c38d` inclui os quatro ajustes pedidos: cerca de tentativa também em ambiguous/terminal imutável, upload incerto para ambiguous e descoberta de candidato terminal, leitura de ByteRange e dose decimal com Cf. A regressão unitária dirigida passou. Classificação textual é conferência da regra interna do módulo, sem nova conclusão clínica/regulatória.

**Zero suítes SQL, corridas de banco ou Auth nativo nesta rodada.** Os 47 SQL/771 testes relatados pelo Claude e as provas SQL anteriores continuam atribuídos às suas respectivas execuções; a leitura do delta não os substitui. A primeira tentativa de atestar testes incluiu o documento enquanto Claude o editava e foi descartada por mudança de hash. A rodada final atesta as fontes executáveis; o documento revisto é o commit v2 identificado acima.

## Ajustes necessários no desenho antes da cerca SQL

1. **Separar a barreira comum da cerca de sessão.** A §3 põe a nova cerca dentro de `signature_lock`, mas a mesma função atual é chamada por revoke/cleanup e pelos passos de fechamento que a proposta dispensa da sessão. Manter a barreira de conta/T33 comum e chamar explicitamente a cerca nativa apenas nos ramos produtivos, com validação obrigatória de contexto. O relógio final deve alcançar também os retornos antecipados/idempotentes. Não resolver isso por parâmetro opcional que permita pular a cerca de um ramo produtivo.

2. **Definir recusa, cancelamento e CAS em transações.** `40001` indica contenção/snapshot inválido: deve abortar e pedir retry, sem cancelar a operação. Ausência/expiração confirmada pode fechar apenas a operação do usuário e a revisão/tentativa ainda pertinentes. Exigir caso A antigo, sessão encerrada, contra B mais recente em `psc_requested`/`ambiguous`/`stored`, além de terminal já concluído. O caminho que persiste cancelled/cleanup precisa retornar resultado normal para o handler mapear; não lançar P4011 após o UPDATE e esperar que o cancelamento persista. Uma exceção não tratada aborta o RPC, conforme [transações do PostgREST](https://docs.postgrest.org/en/v13/references/transactions.html#aborting-transactions); um bloco de exceção também desfaz suas escritas internas, conforme [PL/pgSQL 16](https://www.postgresql.org/docs/16/plpgsql-control-structures.html#PLPGSQL-ERROR-TRAPPING). Esses são requisitos de desenho, não falhas reproduzidas de um handler já existente.

3. **Declarar a política de troca de fator.** A leitura proposta comprova que o fator atual da sessão pertence ao ator e está verified. Ela não detecta, sozinha, que antes existia outro fator verificado. A frase “fator trocado leva a P4011” precisa de vínculo inicial armazenado/checado e prova nativa, ou ser limitada a troca concorrente/snapshot velho. Não importar a política estrita de intenção administrativa para D17 por inferência. AAL2 e fator atual verificado permanecem obrigatórios.

4. **Incluir o consumo do OAuth no inventário.** `signature_consume_authorization` devolve o verifier e consome o estado, mas está ausente da lista de assinaturas que recebe contexto e da matriz de cercas. Declarar seu gate e o relógio final do prazo do estado; o SQL atual usa `now()` depois de adquirir 125/123, que pode representar o início anterior da transação. O novo contrato não deve deixar esse caminho implícito. Testar expiração/logout antes do consumo e durante a aquisição, sem usar a consulta HTTP anterior como cerca do RPC.

## Decisões de interface e reconciliação

Helper tipado compartilhado, bootstrap e tipos permanecem com Codex. JSON estrito obrigatório e retirada das assinaturas antigas estão alinhados; lembrar que `signature_advance` tem `p_data` com default no SQL atual: a assinatura final deve preservar a obrigatoriedade real de `p_auth`, inclusive no catálogo e nos testes. Nenhum código desses arquivos foi alterado nesta rodada.

Reconciliação de `stored` não publica sem contexto humano validado. O prazo de 24 horas é aceito apenas como default técnico proposto para encerrar candidato temporário não publicado, com referência temporal explícita e CAS sob a barreira; não autoriza expurgo de prescrição, auditoria ou arquivo concluído. A descoberta da fila não é autorização de efeito futuro: revalidar estado/revisão/tentativa no ponto de mutação e preservar completed. Não iniciar cron, provedor, emissão ou banco hospedado por este alinhamento.

Próximo: Claude ajusta esses pontos do desenho e envia o contrato fechado; Codex então entrega o helper/fixtures e atualiza o adaptador nativo junto, antes de Claude implementar a cerca SQL. A revisão SQL integral de `908c38d` ainda precisa do reteste dirigido e das corridas correspondentes. PersonalMed, SaaS e prontuários privados permanecem intactos.

Revisão adversarial local desta resposta, contra o desenho congelado e o SQL atual, não encontrou exigência sem base ou outro erro concreto. Somente leitura estática; revisão externa dispensada conforme preferência do usuário.
