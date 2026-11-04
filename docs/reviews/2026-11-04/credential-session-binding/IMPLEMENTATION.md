# T31/3b/1 — vínculo de credencial e sessão no Auth nativo

## Resultado e limite da entrega

O laboratório passou **12 grupos por versão, 24 no total**, em Auth v2.197.0 e v2.189.0 com PostgreSQL e PostgREST reais. Inclui geração por sessão, login em andamento, duas trocas simultâneas, recifragem concorrente, refresh, TOTP, recuperação OTP, resposta descartada após commit e hook desabilitado. O relatório só é gravado depois da remoção dos recursos próprios.

**É um candidato experimental, sem aprovação para produção.** Não houve migration, configuração hospedada, alteração do login do app ou dos componentes do Claude. A recuperação PKCE autenticada antes da rotação e a operação de manutenção da criptografia continuam pendentes. A revisão adicional por agente foi interrompida automaticamente pela plataforma por possível risco de cibersegurança; essa interrupção não equivale a aprovação do protocolo.

## Protocolo ensaiado

- Estado canônico privado por usuário: geração aleatória, pendência e ID da transação de rotação. Não guarda senha, cópia do hash ou token. Metadados de Auth são espelho; escritas nativas com snapshots antigos não podem reverter os campos protegidos.
- O Custom Access Token Hook nativo registra a geração do snapshot autenticado na primeira emissão da sessão. Refresh e MFA preservam o vínculo. Snapshot obsoleto é recusado antes da emissão do JWT; não recebe uma sessão utilizável no Auth.
- O evento nativo `user_updated_password` avança a geração na mesma transação. Exige que o chamador sobrevivente da revogação nativa ainda tenha vínculo atual e remove **todas** as sessões. A conclusão exige novo login.
- Uma constraint diferida recusa mudança da representação da senha de conta concluída sem evento de rotação na mesma transação. Isso impediu que um login antigo recifrasse/restaurasse a senha inicial após outra requisição ter escolhido uma nova. Não é detecção por diferença do hash: a confirmação vem do evento e da transação autorizada.
- A guarda de dados exige sessão existente, geração canônica/claim/vínculo coincidentes, pendência encerrada e AAL2 quando há fator verificado. Sessões OTP/recovery têm propósito de reparação e não autorizam leitura clínica diretamente; novo login por senha continua necessário.
- Hook e triggers têm `search_path` fixo e permissões limitadas. O hook é SECURITY DEFINER exclusivo de `supabase_auth_admin`, para tomar locks sem conceder UPDATE da autoridade privada ao papel. Não há RPC de cliente que altere geração/vínculo.

O hook toma o lock do usuário sem espera (`NOWAIT`). A revisão identificou potencial inversão com locks de sessão do refresh/MFA. O ensaio de contenção observou a espera nativa e exigiu conclusão antes do detector de deadlock, configurado em 15 s. O refresh pode concluir primeiro ou falhar; se conclui, o JWT devolvido precisa estar revogado depois da troca. Não se afirma uma ordem global de locks de todo o Auth.

## Provas dirigidas

1. Conta pendente/metadata editável não lê a linha protegida; snapshot inicial recebe a geração correta.
2. Troca real muda geração, encerra todas as sessões e recusa JWT/refresh/operação Auth antigos; novo login funciona.
3. Escrita de metadados com geração antiga não reverte a autoridade.
4. Recifragem nativa sequencial da senha inicial não limpa pendência nem muda geração.
5. Login pausado depois de verificar a senha inicial é recusado na emissão após a rotação; novo login com senha atual funciona.
6. Duas alterações já autenticadas, paradas antes do UPDATE, resultam em uma confirmação, um rollback e apenas a senha vencedora utilizável.
7. Recifragem nativa parada antes de escrever não restaura a senha inicial após rotação concorrente.
8. Refresh/troca com contenção observada concluem antes de 15 s; o token renovado não lê depois da rotação e novo login recupera o acesso.
9. TOTP real preserva o vínculo; com fator verificado, nova sessão AAL1 não lê e AAL2 lê.
10. Link de recuperação gerado/verificado no Auth local permite trocar senha enquanto pendente, sem conceder dados e sem enviar e-mail.
11. Descartar o resultado HTTP depois do commit mantém estado consistente: login com senha nova funciona, sem repetir a mutação. É simulação de perda da resposta no cliente, não queda de rede aleatória.
12. Desabilitar o hook não cria fallback de autorização. Login nativo pode funcionar, mas a Data API nega a sessão sem prova; reativação recupera o login.

As barreiras de concorrência usam instruções nativas e esperas efetivamente observadas em `pg_locks`, não sleeps para supor a ordem. Os cenários isolam recifragem e rotação sem copiar hashes para outra tabela; uma fixture substitui a representação da mesma senha sintética apenas no campo original do Auth.

## Reprodução e revisão

```text
node scripts/test-initial-password-auth.mjs --binding --all
node scripts/test-initial-password-auth.mjs --all
node --check scripts/test-initial-password-auth.mjs
node --check scripts/test-credential-binding.mjs
node --check scripts/test-credential-binding-concurrency.mjs
npx eslint scripts/test-initial-password-auth.mjs scripts/test-credential-binding.mjs scripts/test-credential-binding-concurrency.mjs
```

O harness original mantém endpoint Docker local validado/pinado, rede interna sem portas, imagens em cache, segredos sintéticos em memória/env/stdin, ownership por label, limpeza completa e tratamento de rejeições assíncronas. A opção nova não aplica o protocolo ao aplicativo. SQL em `supabase/tests/prototypes/credential-session-binding.sql` só é carregado no modo `--binding`.

Dois ciclos locais apontaram recuperação OTP, sobrescrita de metadata, recifragem concorrente e ordem de locks; correções/provas incorporadas. O terceiro ciclo foi interrompido automaticamente. A revisão permanece incompleta para uma aprovação de produção. A suspeita de deadlock foi tratada com NOWAIT e ensaio, sem transformar inferência de fonte em falha runtime não observada.

O [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook) e sua [configuração nativa](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-hooks) são mecanismos oficiais. O protocolo também depende de detalhes de [emissão de tokens](https://github.com/supabase/auth/blob/v2.197.0/internal/tokens/service.go), [troca de senha](https://github.com/supabase/auth/blob/v2.197.0/internal/models/user.go) e [verificação de recuperação](https://github.com/supabase/auth/blob/v2.197.0/internal/api/verify.go). As duas imagens testadas não atestam o comportamento/configuração do projeto hospedado.

## Próximo incremento

Revalidação em 04/11 08:44, durante T31/3b/2b: duas execuções falharam ao observar a barreira de contenção de refresh/senha (uma paralela e outra sequencial). Uma execução posterior completou os 24 grupos nas duas versões e a limpeza. Acrescentado diagnóstico de status/código e locks por PID/categoria, sem queries, payloads ou credenciais; a exigência da espera não foi removida. A causa da intermitência ainda não foi determinada. O candidato permanece experimental, sem aprovação de produção; uma aprovação futura exige esclarecer essa observação, além dos limites abaixo.

Antes de escolher implementação, comparar a proposta do Claude de **provisionar sem senha temporária e entregar link de uso único**. Provar consumo concorrente, sessões emitidas, conclusão administrativa serializada, pendência confiável e Data API negando os JWTs anteriores. Prazo curto de JWT e signOut isolado não bastam.

Este candidato acopla o app a tabelas/eventos internos do Auth e bloqueia recifragem isolada de contas concluídas: mudança de chaves/representação exige procedimento explícito, com recuperação/rotação. PKCE verificado antes da troca ainda precisa de ensaio e política de revogação; propósito de reparação impede leitura direta, mas não resolve sozinho todas as capacidades de redefinição do provedor. Integração RLS/RPC/storage/Edge, contas existentes/backfill e reset administrativo não foram entregues. **T31/L2 permanece aberta.**
