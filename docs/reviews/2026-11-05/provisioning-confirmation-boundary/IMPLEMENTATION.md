# Confirmação pelo servidor no laboratório M2

Nova fronteira experimental entre o Request autenticado e o procedimento privado de confirmação. [Contrato](../../../product/clinic-crm/PROVISIONING_CONFIRMATION_BOUNDARY_CONTRACT.md). Sem endpoint, migration produtiva, credencial, filiação, concessão ou alteração de prontuário.

O módulo importa o helper Auth real, verifica o bearer e exige AAL2. Aceita somente JSON já lido `{operationId}`; a leitura limitada do stream fica para o handler futuro. Ator/sessão/AAL/expiração nunca vêm desse objeto. O comando enviado ao port confiável é congelado, contém somente operação e contexto verificado e é chamado uma vez, sem retry automático. O wrapper SQL experimental deriva a clínica da intenção persistida e chama check_intent(...,true), preservando receipt alvo atual, sessão/fator/geração, cercas e relógio autoritativo.

O wrapper pertence ao instalador, sem EXECUTE para clientes, serviço ou produtores privados. Isso não estabelece um adaptador/credencial de produção. A leitura da clínica não autoriza nada por si; o vínculo é imutável e check_intent revalida sob as cercas existentes. Os produtores anteriores e o helper Auth não mudam.

Depois do port, o módulo exige confirmed, operação/ator/sessão correspondentes, UUIDs e prazo válido. Reconfere expiração do bearer/prazo da intenção, projeta somente operação/alvo/clínica/prazo e congela o resultado. Não copia campo extra/credencial/linha inteira. Um erro ou resposta inválida pode chegar depois do commit: a fronteira recusa a resposta sem afirmar rollback, repetir criação, excluir alvo ou renovar o prazo.

## Provas

35 unitários novos e34 regressões Auth passaram (69 em dois arquivos). A seleção final de sete arquivos também passou174 testes/um ignorado, incluindo estes35; não somar execuções repetidas. Primeiro RED: o módulo novo ainda não existia, portanto não é reprodução de falha de produção. Cobrem autoridade só do bearer, AAL1 com/sem fator, recepção, sub/role inválidos, campos extras/getters, port/DTO congelados, retorno divergente/atrasado, códigos SQL seguros e ausência de repetição. [Verificações locais](local-checks.json). Deno2.9.6 offline/cached-only do módulo e sintaxe/ESLint dos três scripts/módulo/teste aprovados.

Native Auth passou **42 grupos por versão,84 no total**, com fontes finais iguais e cleanup conferido: [v2.197.0](v2.197.0.json), [v2.189.0](v2.189.0.json) e [resumo](verification.json). Cada instalação aplica69 migrations congeladas em `fe407e31aebb93a68f19920237f045e4de49ee35`, overlays próprios e38 grupos anteriores mais quatro novos. O SDKshim encaminha o Authorization exato a /user real na rede interna. O módulo e requireUserContext são os mesmos do teste unitário; não é EdgeHTTP ou SDKsupabase HTTP genuíno, nem prova da leitura de stream do futuro handler.

Os quatro grupos novos acrescentam:

1. Bearer adulterado e campos de autoridade do cliente não alcançam SQL; ACL nega wrapper aos clientes/serviço/produtores.
2. Contexto Native AAL2 confirma nascimento real pelo wrapper, e replay conserva DTO/prazo.
3. B com Auth/TOTP reais e autorização sintética explícita na mesma clínica confirma intenção própria e é recusado na de A. Uma nova sessão legítima e operação desconhecida também são recusadas; ambas as intenções confirmadas permanecem. A clínica A nasce por Data API, a associação de B é fixture SQL do instalador, não fluxo produtivo. Prova o vínculo conjunto ator/sessão, sem alegar isolar a comparação actor_id da comparação session_id.
4. Logout Native concluído entre getUser e SQL vence: a única confirmação falha, intenção fica prepared e alvo/receipt permanecem. Nenhuma filiação, paciente, consulta ou escopo é criado para os alvos; sem retry/credencial.

O port do ensaio usa envelope SQLSTATE em tabela temporária, sem mensagem crua do banco. O procedimento autoritativo é executado de verdade; a subtransação de erro reverte a tentativa e a transação bem-sucedida faz commit. Não simula a recusa. Não mantém transação durante HTTP.

## Revisão e limites

Contrato e implementação tiveram revisões fresh-context sem defeito concreto no recorte. A revisão das provas identificou que B sem autorização seria recusado antes do vínculo; foi acrescentada autorização válida da mesma clínica e confirmação própria positiva. Segunda leitura sem questão concreta remanescente. Revisão externa dispensada pelo usuário.

O typecheck global foi executado e falhou com13 TS2322 no teste de assinatura do Claude (`ReturnType` de função que se tornou assíncrona), sem erro apontado nos caminhos novos. Enviado ao dono na mensagem07:36. Não afirmar tipos/build globais verdes. O módulo experimental passou no Deno; build e navegador não se aplicam a uma tela nova nesta rodada, pois nenhuma foi criada. A revisão D17 tem evidências e commit separados.

```powershell
node scripts/test-initial-password-auth.mjs --provision-clinic --ledger --session-fixture --birth-producer --reservation-keys --confirmation-producer --creation-producer --confirmation-boundary --all --source=fe407e31aebb93a68f19920237f045e4de49ee35
```

M2 segue aberta para adaptador/endpoint produtivo, custódia/retenção/instalação/upgrade com histórico, recuperação e namespace externo do Auth, integração de filiação/pedidos, corte/reconciliação/gate/UI. Nenhum teste SQL global, build, navegador, envio, provedor ou banco hospedado novo. Somente sintéticos, Docker local/rede interna/sem portas, imagens existentes/sem pull, labels próprios e cleanup. PersonalMed/SaaS e arquivos Claude preservados, sem push.
