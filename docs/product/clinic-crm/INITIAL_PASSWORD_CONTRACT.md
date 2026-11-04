# T31 — contrato de segurança da credencial inicial (proposta técnica)

Estado em 04/11/2026: **fluxo de produção não implementado**. T31/3a rejeitou duas estratégias insuficientes em Auth/Data API reais. T31/3b/1 ensaiou vínculo canônico por sessão: 24 grupos em duas versões, sem aprovação de produção; [resultados e limites](../../reviews/2026-11-04/credential-session-binding/IMPLEMENTATION.md). T31/3b/2a comparou o link nativo: dois consumos concorrentes produziram duas sessões em ambas as versões; [prova e limites](../../reviews/2026-11-04/single-use-setup/IMPLEMENTATION.md). T31/3b/2b provou apenas a escrita reservada da senha por CAS e reconciliação sem repetir a mutação: 16 grupos nas duas versões, [provas e limites](../../reviews/2026-11-04/initial-setup-cas/IMPLEMENTATION.md). A conclusão autorizativa, sessões tardias e recuperação continuam pendentes; consumo do link não é mutex e `password_set` não libera dados. T31/2 de MFA visual está em `a12a561`. Nenhuma migration reservada por este documento.

## Falha atual e fronteira

As funções de criação de médico/recepção retornam uma credencial temporária e marcam `user_metadata.must_change_password`. `PasswordChangeGate` troca a senha e limpa esse campo pelo cliente. Isso orienta a interface, mas não impede chamadas diretas nem prova que outra sessão emitida com a senha temporária perdeu acesso.

O usuário pode editar `user_metadata`; a autorização deve usar estado confiável no servidor. Os [metadados de usuário da Supabase](https://supabase.com/docs/guides/auth/users) distinguem esse campo de `app_metadata`, administrado pelo servidor. Também não basta fazer logout: [access tokens já emitidos continuam válidos até expirar](https://supabase.com/docs/guides/auth/signout). Uma claim antiga ou a revogação isolada de refresh tokens não comprova o bloqueio imediato na Data API.

## Aceite obrigatório

1. Contas novas provisionadas pela clínica entram pendentes **antes** de poder acessar dados. O estado pendente não pode ser removido por `updateUser({data: ...})`, request body, claim antiga ou RPC autenticado genérico.
2. A pendência vale para RLS, RPCs SECURITY DEFINER, storage e Edge Functions que usam service-role. Documentos do Claude seguem o mesmo contrato por guardas compartilhadas; nenhuma exceção silenciosa por domínio.
3. Antes da troca, permitir somente operações estritas de autenticação/troca/recuperação e saída. A eventual exceção não dá acesso a prontuário, recepção, exportação ou IA. Não criar um parâmetro público genérico que desative a proteção.
4. Só liberar após confirmação confiável da mudança pelo Auth. Não persistir plaintext, senha temporária, cópia de hash de senha ou token em tabela/log/mensagem. Sucesso do cliente ou mudança de user_metadata não é confirmação.
5. Depois da troca, sessões antigas emitidas com a credencial temporária devem continuar bloqueadas, inclusive JWT ainda válido e refresh de outra sessão. Uma sessão atual precisa receber nova autorização verificável. A solução precisa demonstrar isso na Data API e nas funções Edge, não só em `getUser()` ou na interface.
6. Falha parcial/timeout entre Auth e estado do aplicativo permanece fechada e recuperável. Retry não sobrescreve a senha novamente por inferência, nem libera uma operação sem confirmação. Duas trocas concorrentes não podem confirmar estados incompatíveis.
7. Recovery legítimo e MFA continuam utilizáveis com os privilégios mínimos necessários. Provar ausência de dead-end se senha mudar mas a resposta/atualização do estado se perder. Nenhum envio de e-mail real é autorizado por este contrato.
8. Política de contas existentes exige fatos confiáveis: um `must_change_password=false` editável não prova rotação anterior. Não marcar todas como seguras por inferência; identificar o recorte e a remediação antes da publicação. A migração do PersonalMed não participa desta decisão.

## Integração de documentos e exceção explícita

Revisão do Claude de 04/11 04:42 incorporada: estender as guardas existentes `session_assurance_ok()`, `assert_session_assurance()` e `requireUser()`, preservando suas assinaturas. RLS de `user_settings`/`document_snippets`/`prescriptions` e RPCs de configurações/modelos devem herdar a barreira. `generate-prescription` usa service-role e precisa da verificação dentro de `requireUser()`, pois RLS sozinha não o protege. Nenhuma dessas operações precisa de exceção antes da troca.

`validate-prescription` permanece fora deste bloqueio de sessão: é a validação pública por código de acesso usada por paciente/farmácia, sem conta do médico. Isso não autoriza pesquisa de pacientes, novos dados públicos nem ampliação do endpoint. URLs já assinadas são capacidades de portador e não são invalidadas pelo estado do JWT; esse resíduo precisa ser declarado. Claude reduziu a prévia gerada para 300 s em `d14f0e4`, revisado com cinco testes de documentos aprovados pelo Codex.

## Estratégias rejeitadas pela prova nativa

- **Mudança de `encrypted_password` → liberar pendência:** rejeitada. O Auth pode recifrar a representação durante login sem trocar a senha. A trigger candidata liberou a conta; refresh e outro login com a senha inicial leram a linha protegida no laboratório. Não usar igualdade/diferença de hash como confirmação suficiente. O [caminho oficial do Auth](https://github.com/supabase/auth/blob/v2.197.0/internal/api/token.go) distingue explicitamente recifragem de troca.
- **Estado global livre + claim livre + sessão existente, acrescentando `session.created_at >= credential_rotated_at`:** insuficiente. Um login pausado depois de validar a senha antiga criou a sessão após a troca; seu refresh passou também pela regra de data. Isso foi reproduzido em duas versões, com espera observada em banco. Pedir novo login após a troca continua útil ao usuário, mas o servidor não pode inferir que uma sessão mais recente usou a senha mais recente.

Essas provas isoladas não escolhem uma solução definitiva. O contrato precisa vincular a verificação da credencial ao estado confiável de cada sessão, incluindo login em andamento, refresh e confirmação real da troca. A cobertura experimental posterior e seus limites estão abaixo. Nenhum dos protótipos rejeitados entra em migration de produção.

## Candidato de vínculo ensaiado e comparação seguinte

O experimento com autoridade privada, hook nativo e evento transacional passou TOTP/recuperação OTP, resposta descartada após commit, duas trocas simultâneas e recifragem concorrente. Ele revoga todas as sessões e exige novo login; OTP/recovery são somente reparação, sem leitura direta de dados. A aquisição do lock do usuário é sem espera, e contenção refresh/troca foi ensaiada. A confirmação não persiste senha, hash ou token: usa geração e ID da transação.

Isso não elimina os limites: recuperação PKCE autenticada antes da rotação ainda precisa de prova/política; a constraint contra escritas tardias exige procedimento para manutenção da criptografia de contas concluídas. A revisão adicional por agente foi interrompida automaticamente, portanto não há aprovação de produção. O protocolo não está escolhido para o aplicativo.

Comparar agora a proposta de `auth.admin.generateLink` sem envio: conta sem senha temporária, link entregue manualmente pela clínica, consumo concorrente provado, finalização no servidor com exclusão mútua/revisão e estado pendente confiável. A validade curta do JWT não substitui checar sessão viva depois do encerramento global. Não presumir segurança de duas conclusões concorrentes apenas porque a última senha vence; não enviar e-mail nem ativar fluxo hospedado neste ensaio.

## Provas e divisão

Reproduzir com identidades sintéticas: alteração maliciosa do metadata; chamada direta antes da troca; dois clientes com credencial inicial; JWT antigo após troca; refresh antigo; falhas parciais em cada etapa; concorrência; senha rejeitada pelo Auth; recuperação; MFA; regras de clínica/recepção e prontuários privados. Usar banco/Auth descartáveis e navegador isolado, sem projeto hospedado.

Codex é responsável pelo fluxo, guardas compartilhadas, RLS/ACL e frontend de senha. Claude mantém funções/componentes de documentos; antes de alterar seu domínio, alinhar como cada operação herda o bloqueio e a conclusão. A próxima decisão técnica precisa escolher estado confiável, vínculo da sessão e confirmação/idempotência do Auth como um conjunto. **Não basta acrescentar um booleano no JWT ou um gate visual.**

Este documento registra o aceite e as opções rejeitadas; não afirma que uma estratégia de implementação específica já foi comprovada. Não altera arquitetura, privilégios, assinaturas de RPC, migrations ou dados.
