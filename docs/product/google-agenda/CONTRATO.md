# Google Agenda: contrato

Funções: `google-oauth-start`, `google-oauth-callback`, `sync-google-calendar`; revogação em `delete-user-data`. Código comum em `supabase/functions/_shared/oauth.ts`.

## Segredos das Edge Functions

| Segredo | Conteúdo |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Cliente OAuth do Google Cloud (escopo `calendar.events`). |
| `GOOGLE_TOKEN_KEYS` | Chave de cifra dos tokens: `k1:<base64 de 32 bytes aleatórios>`, mesmo formato de `WHATSAPP_TOKEN_KEYS` e `SIGNATURE_TOKEN_KEYS`. Para trocar a chave: `k2:<nova>,k1:<antiga>`; a primeira cifra, as outras só abrem enquanto estiverem na lista. Gerar com `openssl rand -base64 32`. |
| `ALLOWED_ORIGIN` | Origem do app (ex.: `https://app.exemplo.com.br`). Também define o único `redirect_uri` aceito, salvo `GOOGLE_OAUTH_REDIRECT_URIS`. |

Sem `GOOGLE_TOKEN_KEYS` válida, as três funções respondem 503 com `code: "not_configured"` e a mensagem "A conexão com o Google Agenda ainda não está configurada no servidor. Fale com a equipe Cortex." Nada é gravado e a tentativa de conexão não é consumida.

## Tokens em repouso

- `user_integrations.google_refresh_token` e `google_access_token` guardam `cortex-sealed:v1:` seguido do envelope AES-256-GCM `{v, keyId, nonce, ciphertext}`. O dado associado é `cortex/google-token/v1|<refresh|access>|<user_id>`: um valor copiado para outra conta ou outra coluna não abre.
- A coluna continua não nula quando há conexão, então `get_integration_status` segue mostrando "conectado".
- Linhas antigas, com o token em texto, continuam sendo lidas. Na próxima sincronização o token de acesso é renovado e os dois tokens são regravados cifrados (só se a linha não mudou desde a leitura, para não sobrescrever uma reconexão).
- Um token que não abre (chave retirada da lista ou outra conta) responde 409 "Reconecte pela agenda".
- A exclusão da conta abre o token para revogá-lo no Google. Um token cifrado sem a chave configurada interrompe a exclusão (503), que pode ser repetida depois de configurar a chave.
