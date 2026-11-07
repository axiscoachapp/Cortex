# Implantação da assinatura digital na Clínica Haddad Nicola (D17, P4)

**Situação em 07/11/2026:** o código está pronto. Inclui:
- a sessão de assinatura em Configurações → Conexões;
- "Gerar e assinar" para receita simples, atestado e pedido de exame;
- a validação pelo VALIDAR do ITI;
- o executor que fecha sessões vencidas e operações presas.

Falta a parte que depende de pessoas e contratos (Fase 0), e um teste com certificado real e o médico presente. Contrato técnico: [ASSINATURA_DIGITAL.md](ASSINATURA_DIGITAL.md) e [ASSINATURA_HANDLERS.md](ASSINATURA_HANDLERS.md).

## O que cada um faz

| # | Passo | Quem | Observação |
|---|---|---|---|
| 1 | Levantar quais dos 6 médicos têm o certificado em nuvem gratuito do CFM (VIDaaS) | Clínica | Para pedir o certificado é preciso a carteira de médico com chip, em certificadodigital.cfm.org.br. Quem não tiver continua imprimindo e assinando à mão |
| 2 | Cadastrar o Cortex como aplicativo na Valid (VIDaaS), primeiro em homologação | Usuário, com os dados da empresa | O PSC pede razão social, CNPJ, URL de retorno e, talvez, um certificado SSL ICP-Brasil. Em troca, devolve `client_id` e `client_secret`. O Cortex não cria contas em nome de ninguém |
| 3 | Informar a URL de retorno na Valid: `https://<domínio do app>/assinatura/retorno` | Usuário | Precisa ser exatamente a URL do app em produção. Mudar o domínio (por exemplo, `clinica.haddadnicola.com.br`) obriga a atualizar a Valid |
| 4 | Cada médico preenche o próprio CPF em Configurações → Perfil profissional | Médicos | É conferido com o CPF que o PSC autoriza; sem ele, a sessão não abre |
| 5 | Ativar o segundo fator na conta de cada médico que vai assinar | Médicos | A sessão de assinatura exige MFA na conta do Cortex |
| 6 | Criar os segredos das Edge Functions (tabela abaixo) | Usuário | Os valores nunca entram no repositório nem em mensagens |
| 7 | Aplicar a migration `20261107100000` e publicar `signature-maintenance` | Claude, com autorização explícita | As demais (`20261105100000`, `signature-session`, `sign-document`) já subiram na migração de produção de 06/11; conferir antes |
| 8 | Agendar o executor (SQL abaixo) | Claude, com autorização explícita | Sem ele, as sessões vencidas só se encerram quando o médico tenta assinar |
| 9 | Teste de aceite com um médico e o certificado real | Médico + Claude | Roteiro abaixo |

## Segredos

| Segredo | Valor |
|---|---|
| `SIGNATURE_PSC_BASE_URL` | URL base da API do VIDaaS informada pela Valid (homologação primeiro, depois produção) |
| `SIGNATURE_PSC_CLIENT_ID`, `SIGNATURE_PSC_CLIENT_SECRET` | Recebidos no cadastro do passo 2 |
| `SIGNATURE_PSC_REDIRECT_URI` | A mesma URL do passo 3 |
| `SIGNATURE_TOKEN_KEYS` | `k1:<base64 de 32 bytes aleatórios>`. A primeira chave cifra; as outras só abrem, o que permite trocar a chave |
| `SIGNATURE_POLICY_SHA256` | Hash da política AD-RB v1.1 publicada pelo ITI, conforme `ASSINATURA_DIGITAL.md` |
| `SIGNATURE_CRON_SECRET` | 32 ou mais caracteres aleatórios. Fica também no Vault como `signature_cron_secret` |

Sem esses segredos, Configurações mostra a assinatura como "não configurada" e o compositor só oferece imprimir.

## Agendamento do executor

O executor roda a cada 10 minutos (precisa de `pg_cron` e `pg_net`). Ele:
- encerra as sessões vencidas e apaga o token;
- fecha as operações paradas: preparo há mais de 15 min vira falha, pedido ao PSC sem resposta há mais de 15 min vira "ambígua", e resposta guardada há mais de 24 h vira cancelada;
- remove o arquivo temporário das operações que terminaram sem concluir.

Ele nunca conclui uma assinatura, nunca publica e nunca chama o PSC.

```sql
select cron.schedule('signature-maintenance', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/signature-maintenance',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cortex-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'signature_cron_secret')),
    body := '{}'::jsonb)
$$);
```

A resposta traz só contagens, por exemplo `{expiredSessions, failed, ambiguous, cancelled, removed, busy, errors}`, sem dado de paciente.

## Teste de aceite (com o médico presente)

1. O médico abre a sessão em Configurações → Conexões e aprova no aplicativo do VIDaaS.
2. Gera e assina uma receita simples, um atestado e um pedido de exame de um paciente de teste.
3. Cada PDF aparece como **"Aprovado"** em validar.iti.gov.br, reconhecido como prescrição, atestado ou pedido de exame, com CRM e UF.
4. O app VALIDAR lê o QR, pede o código e baixa o PDF. Um código errado mostra "não encontrado".
5. Encerrar a sessão no Cortex impede a próxima assinatura na hora.
6. Uma farmácia de Curitiba dispensa uma receita simples assinada.

Se o validador mostrar "Indeterminado", o plano B é um hub de assinatura (BRy ou Lacuna). Ele monta o PDF, e a tela do Cortex fica igual.

## Fora desta fase

Receita de controle especial e de antimicrobiano eletrônicas, com número do SNCR (Fase 2). A obrigação do número começa em 04/03/2027 (RDC 1.046/2026). Até lá, controlados e antimicrobianos continuam no papel.
