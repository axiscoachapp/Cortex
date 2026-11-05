# Conta removida antes da confirmação: correção do laboratório

Recorte M2 do [contrato de custódia](../../../product/clinic-crm/PROVISIONING_CUSTODY_CONTRACT.md). A confirmação já recusava o alvo removido; o defeito restante era devolver uma intenção pendente em consultas/replays depois de a conta ter nascido e sido removida. Não foi observado grant ou confirmação indevida nesse RED.

## Reprodução e mudança

[RED Native v2.197.0](RECEIPT_RED-v2.197.0.json): criar reserva com contexto AAL2 real, nascer via Auth Admin, manter intenção `prepared`, remover a conta via Native DELETE (200). Tanto `check_intent(...,false)` quanto replay de `begin_intent` devolvem `prepared`. Os ledgers ficam preservados e o ambiente descartável é removido com verificação. RED sobre fontes anteriores à correção; os testes finais incluem o controle adicional de snapshot pré-nascimento sugerido na revisão.

A cerca passa a ler e travar a operação exata/alvo com `FOR SHARE NOWAIT` antes de distinguir os estados. O terceiro argumento tem default estrito: somente uma consulta/replay explicitamente não confirmadora pode aceitar operação ainda `prepared` sem XID de nascimento. Depois do nascimento, exige o recibo Auth atual, mesmo quando a intenção ainda está pendente. Os chamadores conservam o relógio depois da última aquisição.

As definições dos quatro overlays foram alinhadas. Privilégios EXECUTE e verificações de assinatura usam o novo parâmetro; produtores não recebem SELECT adicional sobre Auth/operações. As allowlists continuam exatas e os cinco pins normalizados alterados foram atualizados no instalador atômico. A troca do leitor booleano de existência continua sendo a única diferença autorizativa entre o corpo anterior e o corpo do produtor de criação.

É instalação nova de protótipos: não é migration ou upgrade de schema produtivo, nem mudança da API Auth global. Não há concessão automática, vínculo clínico, alteração dos helpers do Claude ou publicação.

## Provas

[v2.197.0](v2.197.0.json) e [v2.189.0](v2.189.0.json): **62 grupos por versão,124 no total**, com 42 regressões anteriores, quatro grupos de instalação e 16 novos em cada uma. [Conferência final](verification.json):69 migrations congeladas, hashes dos 20 arquivos de protocolo/suporte idênticos entre versões, fontes finais conferidas e cleanup aprovado. RED e inicialização falha não entram nessa soma. A ausência dos recursos próprios foi conferida nas quatro tentativas (RED, GREEN197, inicialização189 falha, retry189).

O novo ensaio cobre reserva válida antes do nascimento, alvo vivo ainda pendente, remoção concluída, tentativa Native de reutilizar UUID e metadata alterada; RC/RR com snapshots antes e depois do nascimento; Native DELETE em andamento observado pelo PID bloqueador; preservação dos ledgers em cada recusa.

Dois controles estreitos:

- Remover apenas a distinção `prepared`/sem XID faz as duas consultas antigas voltarem a aceitar o histórico removido. Rollback restaura a função.
- Remover apenas o lock da operação permite que um snapshot RR anterior ao nascimento veja `prepared` depois de nascer/remover e devolva esse estado. A função original é restaurada em `finally` e sua definição conferida.

O segundo controle surgiu da revisão independente: snapshots somente posteriores ao nascimento não provariam a necessidade desse lock. A proposta foi ajustada antes do GREEN. Leitura final independente sem achado funcional remanescente. Revisão externa dispensada; sem abrir novas famílias especulativas ou reabrir R2.

## Verificação local e limites

[Verificações locais](local-checks.json):50 testes direcionados do instalador atômico/fronteira do servidor passaram em dois arquivos; ESLint/sintaxe dos seis scripts alterados terminaram com 0, com o parent rechecado após o seletor. Não houve teste global de frontend, build, typecheck, Deno ou matriz SQL geral nova; o incremento altera protótipos e laboratório Node/SQL.

```powershell
node scripts/test-initial-password-auth.mjs --provision-clinic --ledger --session-fixture --birth-producer --reservation-keys --confirmation-producer --creation-producer --confirmation-boundary --atomic-install --pending-receipt --all --source=fd8eed00d9d2760ca011445aba99aadd0341d059
node scripts/test-initial-password-auth.mjs --provision-clinic --ledger --session-fixture --birth-producer --reservation-keys --confirmation-producer --creation-producer --confirmation-boundary --atomic-install --pending-receipt --auth-version=v2.189.0 --source=fd8eed00d9d2760ca011445aba99aadd0341d059
```

A primeira chamada passou em v2.197.0, mas a inicialização seguinte falhou no cliente HTTP Docker (`spawnSync` com status null), antes dos casos funcionais de v2.189.0. Duas falhas de limpeza automática deixaram o container REST e sua rede próprios; labels foram conferidos, ambos removidos e a ausência verificada. [Registro](FAILED_ATTEMPT.json), sem contar essa tentativa como prova funcional.

Para repetir somente a versão faltante, o runner ganhou um seletor restrito às duas tags já suportadas; recusa versão desconhecida, duplicidade e combinação com `--all` antes de inicializar Docker (três verificações passaram). Os protocolos/overlays não mudaram para esse retry. O hash do runner difere entre os relatórios por essa adição: retirar somente o bloco do seletor e sua opção de allowlist reconstrói exatamente o hash do primeiro runner. Todos os demais arquivos são idênticos e os hashes do retry correspondem às fontes finais. Não foi necessário repetir a versão197 concluída.

As 69 migrations do app são congeladas no SHA acima; overlays próprios são capturados com hashes por execução. Imagens locais sem pull, rede interna sem portas, recursos rotulados e limpeza conferida. Nenhum dado real, hosted, carga PersonalMed, integração paga, envio, emissão, deploy ou push. Custódia/retenção/upgrade produtivos continuam pendentes; M2 não está encerrada.

Por orientação do usuário repassada em 09:11, o próximo incremento prioriza o caminho utilizável de pedidos/decisão de permissão para contas existentes, sem deixar toda a interface esperando novo provisionamento. D17/R2 encerrado em `d567df6`; Claude segue a tela de assinatura, e sua revisão será focada em efeitos reais.
