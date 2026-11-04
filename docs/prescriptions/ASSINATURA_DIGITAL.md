# Assinatura digital ICP-Brasil no Cortex (D17)

**Decisão do usuário (04/11/2026):** o Cortex assina com o certificado em nuvem do próprio médico. A Mevo fica como plano B. A implementação é do Claude.

Este documento é o contrato técnico da Fase 1. A pesquisa com fontes e datas está em `reports/Assinatura digital de receitas.md`, que não está versionado; o que importa dela está resumido aqui.

## Escopo

| Fase | Documentos | Depende de |
|---|---|---|
| **1** | Receita simples, atestado e pedido de exame, assinados com ICP-Brasil (VIDaaS do CFM primeiro) | Credenciais de homologação da Valid; certificado real de um médico para o teste de aceite |
| **2** | Receita de controle especial e de antimicrobiano eletrônicas, com número do SNCR (obrigatório a partir de 04/03/2027) | API do SNCR (ambiente de treinamento) e login gov.br do médico. Portão em 15/01/2027 |
| **3** | Outros PSCs (BirdID, SafeID, NeoID, RemoteID), carimbo do tempo (AD-RT), LTV | Pedido de algum médico |

Até a Fase 2, controlados e antimicrobianos continuam em papel: as duas vias impressas e assinadas à mão. O papel continua sendo a contingência de qualquer fase.

**Regras que valem para tudo o que o Cortex assinar:**
- é sempre ICP-Brasil, porque a Res. CFM 2.299/2021, art. 4, exige NGS2 em todo documento médico eletrônico;
- a assinatura é feita no documento eletrônico original; um PDF impresso e digitalizado não vira documento eletrônico.

## Fluxo para o médico

1. **No início do turno**, em "Configurações → Assinatura digital", o médico clica em "Iniciar sessão de assinatura" e aprova no aplicativo do VIDaaS, com biometria ou PIN.
   - O Cortex recebe um token de sessão (`signature_session`) válido por **até 12 horas**. O padrão permite 7 dias; pedimos menos de propósito.
   - O Cortex nunca vê senha, PIN nem biometria, porque o PSC fala direto com o celular do médico.
2. **No compositor**, "Gerar documento" passa a ter a opção "Gerar e assinar".
   - O médico vê o PDF final e confirma; cada assinatura é uma ação explícita dele.
   - Sem sessão ativa, o documento sai como hoje, para imprimir e assinar à mão.
3. **Um aviso fixo** mostra "Sessão de assinatura ativa até 19:30 · Encerrar". Encerrar revoga o token no servidor na hora.

## Componentes

### `_shared/pades.ts`: montagem do PDF assinado

Funções puras, sem dependência externa: DER próprio e WebCrypto. Rodam igual em Deno e em Node, para os testes.

- **`preparePades(pdf, options)`** devolve `{ prepared, signedAttributesDer, digest }`:
  - acrescenta, em atualização incremental, o dicionário de assinatura e um `/Contents` reservado (16 KB), sem alterar os bytes originais;
  - define o `/ByteRange` cobrindo tudo menos o `/Contents`;
  - calcula o SHA-256 dessa faixa (`messageDigest`);
  - monta os atributos assinados exigidos pela **AD-RB v1.1** (OID `2.16.76.1.7.1.11.1.1`): `contentType`, `messageDigest`, `signingCertificateV2` (ESSCertIDv2, com o SHA-256 do certificado) e `sigPolicyId` (OID e hash do artefato da política);
  - **não** inclui `signingTime`: a hora vai em `/M` no dicionário de assinatura;
  - devolve o SHA-256 dos atributos assinados em DER, que é o hash enviado ao PSC.
- **`finalizePades(prepared, signatureValue, certificateChain)`** monta o `SignedData` CMS: certificado e cadeia, `SignerInfo` com os mesmos atributos e a assinatura RSA ou ECDSA devolvida pelo PSC. Grava o CMS em hexadecimal no `/Contents` reservado e recusa se não couber.
- **Perfil do PDF:**
  - `/Filter /Adobe.PPKLite` e `/SubFilter /ETSI.CAdES.detached`;
  - DocMDP com `/Reference` → `/TransformMethod /DocMDP` e `/TransformParams` `/P 2 /V /1.2`, sem `/Perms`;
  - `/M` com data e hora.
- **OIDs de saúde:**
  - médico: CRM `2.16.76.1.4.2.2.1`, UF `2.16.76.1.4.2.2.2` e especialidade `2.16.76.1.4.2.2.3`;
  - tipo de documento: prescrição `2.16.76.1.12.1.1`, atestado `.2` e pedido de exame `.3`;
  - o lugar certo (dicionário Info, XMP ou os dois) **só se confirma no validador do ITI com certificado real**. A primeira versão grava no dicionário Info; o XMP entra se o teste de aceite mostrar que é preciso.
- **Configuração, não código:** OID e hash da política (o hash do artefato LPA do ITI ainda precisa ser obtido), algoritmo e tamanho reservado. A AD-RB v1.1 vale até 02/03/2029.

### `_shared/psc.ts`: cliente DOC-ICP-17.01

É a API OAuth 2.0 com PKCE que todo PSC credenciado expõe. Os endpoints vêm de configuração por PSC, e a Fase 1 usa só o VIDaaS.

- `authorizeUrl({ psc, state, codeChallenge, lifetimeSeconds, loginHint })`: escopo `signature_session`, PKCE S256, `lifetime` de até 43.200 s (12 h).
- `exchangeCode({ code, codeVerifier })`: devolve `access_token`, `expires_in` e `authorized_identification` (CPF), que é conferido com o CPF do médico no Cortex.
- `signHash({ token, hashes })`: `signature_format: RAW`, `hash_algorithm` SHA-256 (`2.16.840.1.101.3.4.2.1`); devolve a assinatura crua.
- `certificateDiscovery({ token })`: devolve o certificado do médico e a cadeia, usados no `signingCertificateV2` antes de assinar.
- **Verificação obrigatória (§7.2.3 do DOC-ICP-17.01):** antes de usar, a assinatura devolvida é conferida com a chave pública do certificado sobre o hash enviado. Se não bater, nada é gravado.

### Edge Functions

As três são novas, no domínio do Claude. Revisão do Codex de 04/11 12:41 incorporada abaixo.

| Função | Faz |
|---|---|
| `signature-session` | `POST start` (JWT, clínico e MFA): cria um `state` de uso único e devolve a URL de autorização. `POST complete` (JWT, clínico e MFA): recebe `{code, state}` do frontend, consome o `state`, troca o código, confere o CPF e o certificado, e ativa a sessão. `POST revoke` (JWT): revoga na hora |
| `sign-document` | `POST` (JWT, clínico e MFA), com `{prescriptionId, operationId, shownPdfSha256}`. Segue a máquina de estados abaixo |
| `validate-prescription` (já existe) | A resposta `_format=application/validador-iti+json` passa a apontar `signatureFiles[].url` para o PDF assinado, por URL assinada de curta duração |

**Callback do PSC:** o redirecionamento comum do OAuth é um GET sem o Bearer do Cortex. Por isso:
- o PSC volta para uma rota do **frontend** (`/assinatura/retorno`), cadastrada no PSC como o único `redirect_uri`;
- o frontend envia `{code, state}` por `POST complete`, com o JWT do médico;
- o servidor confere que o `state` foi criado por esse mesmo médico, para esse PSC, há menos de 10 minutos e nunca foi usado (CAS em `used_at`).

**Endpoints e destinos do PSC:** vêm só de uma lista fixa no servidor, por PSC. Nenhuma URL vinda do cliente ou do próprio PSC (redirect) recebe token.

### Banco (migration reservada `20261105100000`, faixa do Claude)

O número mudou de `20261104140000` para `20261105100000` porque a migration estende funções de custódia do Codex criadas em `20261104200000` e redefinidas até `20261104240000`, e precisa rodar depois delas.

**Guarda do token: cifra na aplicação, sem Vault.**
- Este é o contraponto à revisão: o Vault expõe o texto claro numa view e exigiria provar a habilitação da extensão no projeto alvo.
- O token é cifrado na Edge Function com **AES-256-GCM**:
  - as chaves ficam em `SIGNATURE_TOKEN_KEYS` (`k2:<base64>,k1:<base64>`), um segredo das Edge Functions, como os outros. A primeira cifra; as anteriores só abrem enquanto estiverem na lista, o que permite a rotação. Nenhum valor do cliente escolhe a chave;
  - o dado associado é versionado e tem um espaço por uso: `cortex/signature-token/v1|sessão|conta|geração` para o token e `cortex/oauth-verifier/v1|hash do state|conta|PSC` para o verificador do PKCE. Um nunca abre como o outro. O nonce tem 96 bits aleatórios a cada cifra;
- No banco ficam só o texto cifrado, o nonce e o `key_id`, numa tabela sem nenhum grant para `anon` ou `authenticated`.
- A leitura e a gravação passam por duas funções `SECURITY DEFINER` com `search_path=''` e `EXECUTE` só para `service_role`. Elas recebem o **id da sessão** (nunca um id de segredo) e só devolvem o texto cifrado se a sessão estiver ativa e na geração pedida.
- O token nunca vai ao navegador, ao log, a nomes, a descrições nem a DTOs.

**Tabelas** (todas com `user_id` → `auth.users` `ON DELETE CASCADE` e o guard de custódia de T33 nas colunas de conta):

| Tabela | Conteúdo | Ciclo de vida |
|---|---|---|
| `signature_oauth_states` | Hash do `state`, `user_id`, `psc`, `code_verifier` cifrado (mesma chave), `expires_at` (10 min), `used_at` | Transitória: apagada ao usar ou vencer |
| `signature_sessions` | `id`, `user_id`, `psc`, `status` (`active`, `revoked`, `expired`, `suspended`), `generation`, `expires_at` (no máximo 12 h), `cert_sha256` do certificado descoberto, `token_ciphertext`, `nonce`, `key_id`, `created_at` | O texto cifrado é apagado ao revogar ou vencer; a linha fica com o status |
| `signature_operations` | `operation_id` (idempotência, vindo do cliente), `prescription_id`, `user_id`, `session_id`, `session_generation`, `shown_pdf_sha256`, `signing_time`, `to_be_signed_sha256`, `state`, `signed_storage_path`, `signed_pdf_sha256`, horários | Máquina de estados abaixo |
| `prescription_signatures` | Auditoria: `prescription_id` (FK `ON DELETE CASCADE`), `operation_id`, `psc`, `pdf_sha256_before`, `pdf_sha256_after`, `cert_sha256`, `cert_serial`, `cert_issuer`, `policy_oid`, `signed_at` | Só INSERT. UPDATE é sempre recusado; DELETE direto é recusado por trigger e só passa quando a prescrição já foi apagada (cascata da exclusão de conta ou de paciente que existe hoje). Não cria bloqueio novo de exclusão |

- **Sem CPF nem digest de CPF no banco:**
  - o `authorized_identification` do PSC é comparado, na ativação, com `user_settings.prescriber_cpf`, que passa a ser obrigatório para assinar, e é descartado em seguida;
  - a auditoria identifica o signatário pelo hash, série e emissor do certificado.
- **Custódia (T33):**
  - as quatro tabelas entram no inventário de exclusão (`assert_deletion_scope`) e no guard `guard_custody_reference` com as colunas de conta;
  - `prescription_id` precisa ser acrescentado como pai indireto em `custody_reference_accounts`. Essa função é do Codex e fica como pedido.
  - teste de exclusão nos dois sentidos, de conta e de paciente, e em RR antiga.
- **`prescriptions`:**
  - acrescenta `signed_storage_path`, com check `rx/<user>/<id>/signed-<operation>.pdf`, no bucket privado e sem overwrite;
  - o original continua em `storage_path`;
  - quem preenche `status='signed'`, `signed_at`, `signature_verified_at` e `signed_storage_path` é **só** `cortex_private.complete_signature(operation_id, ...)`, com `EXECUTE` apenas para `service_role`, que confere a operação. Nenhuma RPC de cliente nem update genérico pode preencher esses campos.

### Máquina de estados de uma assinatura

Nenhuma transação ou lock SQL fica aberto durante chamadas de rede.

1. **Reserva** (`reserve_signature`: transação curta, `SECURITY DEFINER`, só `service_role`, chamada pela função com o `auth.uid()` conferido):
   - documento do próprio médico, `status='generated'` e tipo elegível na Fase 1: `receita_simples`, `atestado` ou `solicitacao_exames`;
   - `issuance_snapshot` válido;
   - `shown_pdf_sha256` igual ao `pdf_sha256` do snapshot;
   - sessão `active`, dentro do prazo, e certificado da sessão igual ao esperado;
   - limite de ritmo, com contador próprio (`pg_advisory_xact_lock` por médico, contagem de operações reservadas nos últimos 60 min, limite de 60);
   - grava a operação `reserved` com a `generation` da sessão.

   Um `operation_id` repetido devolve a operação existente e não consome outra reserva. Um índice único parcial impede duas operações abertas para o mesmo documento.
2. **Preparação** (sem transação):
   - baixa o original e confere o SHA-256 de novo;
   - roda `preparePades` com o certificado da sessão e um `signing_time` fixado na operação;
   - grava `to_be_signed_sha256` e o estado `prepared`.
3. **PSC:**
   - relê o estado da sessão (`active` e mesma `generation`); se mudou, a operação vira `cancelled` e não chama o PSC;
   - grava `psc_requested` e chama o PSC.
   - **Resposta perdida:**
     - a operação vira `ambiguous`, e nada é repetido sozinho;
     - repetir exige uma nova ação do médico, com o mesmo `operation_id`;
     - como a assinatura RSA PKCS#1 v1.5 é determinística para o mesmo hash e a mesma chave, a repetição produz a mesma assinatura sobre os mesmos bytes, e não um segundo documento;
     - cada repetição fica registrada.
4. **Verificação e montagem** (sem transação):
   - `verifyRawSignature` com o certificado da sessão;
   - `finalizePades`;
   - **conferência do artefato final**: relê o PDF assinado; o `/ByteRange` cobre tudo menos o `/Contents`; o SHA-256 da faixa é igual ao `messageDigest` assinado; o CMS relido traz o certificado esperado e a política AD-RB, e a assinatura confere.
   - Se qualquer conferência falhar, a operação vira `failed` e nada é publicado.
5. **Upload:** `signed-<operation>.pdf` no bucket privado, com `upsert: false`; o SHA-256 é guardado na operação (`stored`).
6. **Conclusão** (`complete_signature`, transação curta). Confere:
   - a operação está em `stored`;
   - a prescrição continua `generated`, com o mesmo `pdf_sha256`;
   - a sessão está na **mesma `generation` da reserva**.

   Então marca a prescrição como `signed`, grava a auditoria e passa a operação a `completed`.
   - **Revogação entre a reserva e a conclusão:** a operação vira `cancelled_by_revocation`, o arquivo assinado é apagado e nada é publicado. A revogação vence sempre.
   - **Edição ou exclusão do documento durante a operação:** a conclusão falha, a operação vira `cancelled` e o arquivo é apagado.

## Segurança

O ponto principal é a guarda do token: enquanto vale, a sessão é a "caneta" do médico.

- **Duração:** no máximo 12 horas.
- **Revogação:**
  - local e imediata: `status='revoked'` e `generation+1`, e todas as etapas conferem o status;
  - a revogação no PSC é tentada em seguida, mas o Cortex não depende dela.
- **Vencimento:** o prazo é conferido em cada etapa; o job de limpeza só apaga textos cifrados já inúteis.
- **Cada assinatura:**
  - exige uma sessão autenticada do Cortex com MFA (`assert_session_assurance`);
  - parte de um clique do médico sobre um documento dele, já gerado e visto (hash do PDF mostrado);
  - nunca assina em lote nem em segundo plano.
- **Limite de ritmo:**
  - 60 por hora por médico, num contador próprio da assinatura e não nos créditos de IA (`_shared/quota.ts` não é usado);
  - a reserva acontece depois da autorização do documento e antes do PSC;
  - acima do limite, a sessão vira `suspended` e o médico precisa abrir uma sessão nova no aplicativo do PSC.
- **Sem arquivo A1 (.pfx):** o Cortex não aceita upload, para não guardar a chave do médico.
- **O hash que vai ao PSC** é recalculado no servidor a partir do PDF guardado, nunca recebido do navegador.
- **Catálogo e ACL:**
  - as funções e tabelas novas entram no catálogo de segurança e nos testes de ACL quando os endpoints forem integrados;
  - os módulos novos ficarem fora do harness atual não dispensa isso.

**Estado em 04/11/2026:** `_shared/pades.ts` está implementado.
- Assina só PDFs com tabela de referência clássica; por isso, desde já, o `generate-prescription` grava com `useObjectStreams: false`. PDFs antigos com xref comprimida são recusados com o pedido de gerar de novo.
- Aceita só certificados RSA, que é o caso dos certificados de pessoa física ICP-Brasil.
- Testes em `src/lib/pades.test.ts`: os 6 primeiros itens abaixo, mais a verificação externa com `openssl cms -verify` (aceita o conteúdo assinado e recusa o PDF alterado).
- Conferido também com um PDF gerado pela pdf-lib 1.17.1, a mesma versão do Edge, com cópia de página como na receita retida. A pdf-lib relê o arquivo assinado e o OpenSSL aprova.

`_shared/psc.ts` também está implementado, com testes em `src/lib/psc.test.ts` contra um PSC falso em memória.
- O PSC falso confere o PKCE, usa o código uma vez só e assina o hash RAW com RSA bruto, como um PSC real.
- A assinatura que ele devolve é idêntica à assinatura local dos atributos, o que mostra o determinismo usado na regra de `ambiguous`.
- Cobre também: resposta perdida (`ambiguous`, sem repetição), assinatura que não confere, token revogado, CPF ausente, sessão limitada a 12 h e base sem HTTPS.
- O token só viaja no cabeçalho `Authorization`, e o PDF nunca vai ao PSC.
- A cifra do token (AES-256-GCM, com sessão, conta e geração como dado associado) recusa outra geração, outra chave e texto alterado.

Os nomes dos campos seguem o DOC-ICP-17.01 e precisam ser confirmados na homologação do VIDaaS.

## Testes

### Locais, só com material sintético

Usam uma AC de teste e um certificado "Médica Sintética", gerados em memória a cada execução e nunca gravados.

1. **Atualização incremental:** os bytes originais do PDF continuam idênticos no início do arquivo assinado.
2. **ByteRange:** cobre o arquivo inteiro menos o `/Contents`, e o `messageDigest` é igual ao SHA-256 dessa faixa.
3. **CMS:** o SignedData relido traz os quatro atributos assinados, nenhum `signingTime`, o OID da política e o ESSCertIDv2 igual ao SHA-256 do certificado. A assinatura confere com a chave pública de teste.
4. **DocMDP:** P=2 presente, sem `/Perms`.
5. **PSC falso:** um servidor local sintético cobre:
   - o fluxo PKCE com `state` de uso único e vencido;
   - o CPF ou certificado divergente (recusado);
   - a assinatura que não confere (recusada, nada gravado);
   - o token vencido ou revogado;
   - a revogação entre cada par de etapas;
   - a resposta perdida (`ambiguous`, sem repetição automática);
   - o `operation_id` repetido (não consome reserva);
   - duas assinaturas concorrentes do mesmo documento;
   - o limite de ritmo.
6. **Vazamento:** o token não aparece em resposta, log nem `content`.
7. **Banco:**
   - ACL das funções novas (só `service_role`);
   - UPDATE e DELETE direto recusados na auditoria;
   - exclusão de conta e de paciente em cascata, nos dois sentidos e em RR antiga;
   - nenhum caminho de cliente preenche os campos de assinatura.

### De aceite, com certificado real (só com o médico presente)

1. O PDF de cada tipo aparece como **"Aprovado"** no validar.iti.gov.br e é reconhecido como prescrição, atestado ou pedido de exame, com CRM e UF.
2. O app VALIDAR lê o QR, pede o código e baixa o PDF; código errado devolve 401 e documento inexistente, 404.
3. Uma segunda assinatura não invalida a primeira.
4. Três farmácias de Curitiba dispensam uma receita simples assinada.

## O que depende do usuário ou da clínica (Fase 0)

- [ ] Saber quais dos 6 médicos já têm o certificado em nuvem gratuito do CFM (VIDaaS) e quais têm a carteira de médico com chip, necessária para pedi-lo (certificadodigital.cfm.org.br).
- [ ] Cadastrar o Cortex como aplicativo na Valid (homologação do VIDaaS). Isso pede os dados da empresa e, talvez, um certificado SSL ICP-Brasil para o registro. O Cortex não cria conta em nome de ninguém.
- [ ] Parecer jurídico sobre a Res. CFM 2.299/2021, art. 5: inscrição no CRM e diretor técnico de quem oferece a plataforma.
- [ ] Cada médico que for assinar precisa ter o próprio CPF em Configurações, que passa a ser obrigatório para assinar: é conferido com o CPF que o PSC autoriza.
- [ ] Um médico disponível para o teste de aceite com o certificado real.
- [ ] Definir `SIGNATURE_TOKEN_KEYS` (uma chave de 32 bytes aleatórios, em base64, com um id) nos segredos das Edge Functions, quando houver deploy. Quem configura é o usuário; o valor nunca entra no repositório nem em mensagens.

## Ordem de implementação

1. `_shared/pades.ts` com os testes locais 1 a 4, só com material sintético. Não precisa de nada externo.
2. `_shared/psc.ts` e o PSC falso, com o teste 5.
3. Migration `20261105100000` (contrato v2 aceito pelo Codex em 04/11 13:21, com as condições da mensagem), as funções `signature-session` e `sign-document`, e os testes 6 e 7. O DDL vai para a revisão de integração e custódia do Codex antes de qualquer aplicação; nada é aplicado em banco hospedado.
4. Tela de sessão e "Gerar e assinar" no compositor.
5. Homologação com a Valid e testes de aceite, quando a Fase 0 estiver pronta.
