# Senha temporária: o que mudou e o que ainda falta

Correção dos achados 1 e 2 de [relatorios/seguranca-privacidade.md](relatorios/seguranca-privacidade.md) (item B7 do plano). Responsável: Claude, 11/11/2026. Migration `20261111110000_password_change_required.sql`.

## O que era possível

O administrador da clínica cria a conta do médico ou da secretária e recebe uma senha temporária para entregar. A obrigação de trocar essa senha era só uma marca em `user_metadata`, que a própria conta pode editar, e só a tela do navegador a lia. Quem tinha a senha temporária (o administrador) podia entrar pela API, apagar a marca e continuar usando a conta. A tela de troca nunca aparecia, o dono ficava com a senha que o administrador conhecia, e o administrador podia entrar como o médico quando quisesse e ler o prontuário privado.

Além disso, a conta criada já vinha com o e-mail "confirmado", e o convite para outra clínica confiava nessa confirmação. Uma conta criada com o e-mail de outra pessoa podia receber convites e compartilhamentos destinados a ela.

## O que é exigido agora, e onde

- **A marca fica onde só o servidor escreve.** `create-clinic-doctor`, `create-clinic-receptionist` e o novo `reissue-temporary-password` gravam em `app_metadata` (só a chave de serviço altera): `must_change_password: true`, `temporary_password_expires_at` (72 horas) e `provisioned_at`. Nada disso fica em `user_metadata`.
- **Enquanto a marca existe, o servidor recusa tudo, exceto a troca.**
  - Edge Functions: `supabase/functions/_shared/auth.ts` (`requireUser` e `requireUserContext`) responde 403 com `code: "password_change_required"`. Vale tanto para a conta no Auth quanto para o token apresentado.
  - Banco: `password_change_pending()` lê a marca no JWT assinado. As quatro guardas centrais por onde todas as políticas e RPCs já passam recusam a sessão: `session_assurance_ok()` (políticas restritivas `session_assurance` das tabelas clínicas e do storage, `reception_scope_ok`, `assert_reception_scope`, `reception_delegation_actor`, `sharing_actor`, `clinic_access`), `assert_session_assurance()` (mensagem própria, `hint = password_change_required`), `clinical_session_allowed()` (políticas `clinical_identity`) e `assert_clinical_actor()`. `usage_daily` recebeu a mesma restrição. Os catálogos de referência (CID, medicamentos) continuam abertos: são dados públicos.
  - Chamadas com a chave de serviço e do cron não têm marca e não mudam.
- **Só uma função aceita a conta marcada:** `change-initial-password`. Ela confere a sessão no Auth (inclusive o segundo fator, se houver), exige que a marca exista e que a senha temporária não tenha vencido, aplica a regra de senha (mínimo de 10 caracteres, máximo de 72, nada muito fácil, sem o e-mail, diferente da temporária), encerra as outras sessões, troca a senha e apaga marca e validade numa única atualização, grava `password_set_by_owner_at`, apaga a marca antiga de `user_metadata` e encerra as outras sessões de novo. O navegador renova a sessão em seguida.
- **Token antigo continua recusado.** Um token emitido antes da troca ainda carrega a marca e é recusado no banco e nas funções até ser renovado. A tela renova logo depois da troca.
- **Senha temporária vencida.** O Auth ainda aceita o login, mas o servidor recusa tudo, inclusive a troca. A tela mostra "Senha temporária vencida. Peça uma nova ao administrador da clínica." O administrador gera outra em Equipe (secretária) ou Compartilhamento (médico), o que renova a marca e a validade. Isso só funciona enquanto a pessoa não definiu a própria senha: o administrador nunca consegue trocar uma senha escolhida pelo dono.
- **Convites.** `invite_clinic_doctor` e o aceite (`respond_clinic_invitation`) recusam uma conta criada com senha temporária enquanto o dono não definiu a própria senha.
- **Contas antigas.** A migration marca no servidor as contas criadas antes da mudança: as que ainda não trocaram a senha ganham 72 horas a partir da aplicação; as que já trocaram pela tela antiga recebem a marca de senha definida pelo dono.
- **Tela.** `PasswordChangeGate` chama a função, renova a sessão e nunca escreve a marca. Também trata a marca antiga de `user_metadata` como pendente.

## O que continua possível

- **Tomada da conta antes do primeiro acesso do dono.** O administrador ainda pode entrar com a senha temporária e definir uma senha antes do dono. O dono percebe: a senha temporária deixa de funcionar, e a função recusa trocar pela própria senha temporária, para que essa troca não passe despercebida. Para recuperar a conta, a equipe de implantação precisa redefinir a senha pelo painel do Supabase.
- **A posse do e-mail não é comprovada.** Sem e-mail de saída, ninguém confirma que o endereço pertence ao médico. A exigência de senha definida pelo dono só prova que alguém com a senha temporária escolheu uma senha. Comprovar a caixa de e-mail exige uma confirmação enviada por e-mail, que fica para quando a implantação tiver e-mail configurado.
- **Contas antigas que já trocaram a senha.** Se o administrador apagou a marca antes desta mudança, a conta é tratada como de senha definida pelo dono. Não há como distinguir pelo histórico.
- **Janela da implantação.** Uma conta criada pela versão antiga da função entre a migration e a publicação das funções fica só com a marca antiga, que a própria conta pode apagar. Por isso as funções são publicadas antes da migration (abaixo).
- **Recuperação de senha pela tela de login** continua com a regra antiga de 6 caracteres do Auth, e não existe "Alterar senha" para quem está logado (item C24).

## O que a implantação precisa fazer

Nada novo para configurar: as funções usam só as variáveis da própria plataforma. Na ordem:

1. Publicar todas as Edge Functions (o `_shared/auth.ts` mudou para todas), incluindo as novas `change-initial-password` e `reissue-temporary-password`.
2. Aplicar a migration `20261111110000_password_change_required.sql`.
3. Publicar o frontend (o merge na `main` faz isso na Vercel).
