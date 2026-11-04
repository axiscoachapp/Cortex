# T31 — contrato de segurança da credencial inicial (proposta técnica)

Estado em 04/11/2026: requisitos para o próximo incremento; **não implementado**. A correção independente do gate visual de MFA é T31/2. O fluxo de senha no servidor será T31/3, mantendo Supabase Auth e os domínios atuais. Nenhuma migration reservada por este documento.

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

## Provas e divisão

Reproduzir com identidades sintéticas: alteração maliciosa do metadata; chamada direta antes da troca; dois clientes com credencial inicial; JWT antigo após troca; refresh antigo; falhas parciais em cada etapa; concorrência; senha rejeitada pelo Auth; recuperação; MFA; regras de clínica/recepção e prontuários privados. Usar banco/Auth descartáveis e navegador isolado, sem projeto hospedado.

Codex é responsável pelo fluxo, guardas compartilhadas, RLS/ACL e frontend de senha. Claude mantém funções/componentes de documentos; antes de alterar seu domínio, alinhar como cada operação herda o bloqueio e a conclusão. A próxima decisão técnica precisa escolher estado confiável, vínculo da sessão e confirmação/idempotência do Auth como um conjunto. **Não basta acrescentar um booleano no JWT ou um gate visual.**

Este documento registra o aceite e as opções rejeitadas; não afirma que uma estratégia de implementação específica já foi comprovada. Não altera arquitetura, privilégios, assinaturas de RPC, migrations ou dados.
