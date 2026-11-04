# T28 — fundação privada das solicitações de delegação

04/11/2026. Migration `20261104230000_reception_delegation_requests.sql`, reservada antes da criação. **Implementação real do armazenamento privado de solicitações, ainda sem aprovação, concessão de acesso ou API autenticada nova.** O setter legado continua pendente de corte; M2 não está concluída.

## Comportamento

Tabelas de solicitações e operações ficam em `cortex_private`, com RLS e privilégios revogados de PUBLIC/anon/authenticated/service_role. Helpers internos também não têm EXECUTE para esses papéis. Nenhum tipo/endpoint público foi acrescentado. O único contrato público modificado internamente é o preflight existente de exclusão de conta, preservando assinatura, OID e verificações anteriores.

Solicitação tem identidade imutável, capacidade fixa, UUID e revisão; aceita somente `pending` e `cancelled`. Estado `approved` é explicitamente recusado. Operações registram parâmetros canônicos e resultado; repetição idêntica não duplica solicitação/cancelamento. Operações diferentes para o mesmo par pendente recebem a mesma identidade com aliases persistidos; depois de cancelada, nenhuma dessas operações recria o pedido. Nova solicitação usa outro UUID.

Cancelamento humano exige gestão ativa da clínica e registra ator/causa. Inativação do médico ou da recepção encerra pendentes uma vez, como evento de sistema, sem fingir uma decisão médica. Reativação não restaura pedidos. Filiações referenciadas têm FK restritiva; não há trigger BEFORE DELETE que suprima silenciosamente a operação.

Referências de solicitante, destinatários, cancelador e ator das operações entram nas barreiras de conta existentes. História/identidade são imutáveis; retenção excepcional depende do contrato T24/T32. A checagem de exclusão passa a considerar essa custódia administrativa apenas para exclusão da conta. A exclusão de prontuário privado mantém o recorte anterior. Não se move CPF/endereço/outro campo legal nem se cria vínculo clínico ou carregador.

## Instalação e autorização

Instalação transacional força READ COMMITTED e toma locks de instalação NOWAIT sobre os pais/entrypoints relevantes. Banco ocupado recusa sem tabela parcial; transação RR com snapshot estabelecido recusa antes do schema. Sessão fresca com default RR instala corretamente em RC. Não há aplicação hospedada nesta entrega.

A autorização humana/MFA usa as guardas SQL existentes. O papel de gestor é conferido na linha real de associação, com `FOR SHARE NOWAIT`, além dos epochs. Isso cobre remoção de associação ou `admin→doctor` com status ainda ativo, que não passa pelo lifecycle de inativação. A validação ocorre novamente após a barreira; conflitos recusam a transação inteira. Escritas não aguardam conta enquanto seguram a linha/CAS de um pedido.

Revisão adversarial local conferiu NULLs, imutabilidade, idempotência, lifecycle, custódia e ACL. O ponto de perda de papel foi identificado e corrigido durante a revisão; a leitura final não encontrou outro defeito concreto. Revisor não executou banco nem aprovou produção. Revisão externa dispensada pelo usuário.

## Verificação

Comando principal: `node scripts/test-reception-delegation-requests.mjs`. `--red` reproduz separadamente a ausência da funcionalidade no predecessor. O runner recusa alvo externo/override Docker, verifica e pina pipe/socket local, usa imagem em cache, rede interna sem portas e confere labels antes de limpar recursos. Bootstrap/migrations/suítes vêm de um commit imutável mais overlays próprios com SHA-256, capturados antes do banco; código paralelo não entra durante a enumeração.

Resultado final em `verification.json`:

- **62 migrations/40 suítes SQL**, incluindo a nova suíte e todas as anteriores;
- **16 cenários concorrentes novos em RC/RR**: solicitação contra inativação nas duas ordens; cancelamento/lifecycle com espera realmente observada; remoção de papel/associação administrativa;
- sete falhas simuladas de fronteira com rollback, regressões de fila/reserva/vínculos/contato, dez corridas de agenda/conclusão, 20 de lifecycle médico, 20 de recepção, duas de modelos e **oito ordens de exclusão**;
- instalação ocupada e snapshot antigo recusados sem schema parcial, instalação fresca com default RR e cleanup confirmados;
- sintaxe Node/ESLint dos dois scripts aprovados; nenhuma alteração de frontend pelo Codex nesta fundação.

`npm run test:db:custody` também passou: **37 grupos dirigidos com 62 migrations**, cleanup e compatibilidade da instalação real da barreira de custódia. Resultado em [TARGETED.json](../custody-upgrade/TARGETED.json); esse modo não repete as suítes SQL.

Conferência final: quatro hashes dos overlays correspondem aos arquivos verificados; 125 links locais em oito documentos sem destino ausente e `git diff --check` aprovado. Mudanças concorrentes da interface foram preservadas e ficaram fora da migration.

O SQL novo entra na enumeração normal do CI; as 16 provas concorrentes estão no comando protegido acima. O bootstrap usa fixtures SQL de identidade/MFA, sem serviço Auth/JWT nativo. Esta entrega não repete build/typecheck de frontend nem os 49 testes históricos da RCE.

O primeiro ensaio precisou aguardar o servidor TCP final do PostgreSQL, em vez do socket temporário de inicialização, e preencher o status obrigatório na fixture sintética de paciente. Ambos erros de preparação foram rejeitados pela asserção específica do RED; não foram contados como prova de segurança.

## Próximo incremento

Adicionar decisão exclusiva do próprio médico, concessão vinculada ao pedido aprovado, revogação e reconciliação explícita, com novo contrato/migration e corte atômico do setter/provisionamento anteriores. Provar leitores/escritores reais, custódia, instalação frente a versões antigas, liberação de trabalho e frontend antes de disponibilizar o fluxo. **Não habilitar os helpers privados diretamente ao cliente e não considerar pendente uma autorização.** T31/credenciais e T34/cadastro único continuam separados; sem carga real, envio ou publicação.
