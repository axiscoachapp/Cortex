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

As três são novas, no domínio do Claude. Todas exigem o JWT do médico e as guardas atuais (`assert_clinical_actor` e `assert_session_assurance`).

| Função | Faz |
|---|---|
| `signature-session` | `POST start`: gera `state` e `code_verifier` (guardados no servidor por 10 min) e devolve a URL de autorização. `GET callback`: troca o código, confere o CPF, guarda o token no Vault e grava a sessão. `POST revoke`: apaga o segredo e marca `revoked_at` |
| `sign-document` | Recebe `prescriptionId`. Confere dono, status `generated` e sessão ativa. Baixa o PDF, prepara, chama o PSC, verifica, finaliza e grava o PDF assinado. Marca `status='signed'`, `signed_at` e `signature_verified_at`, e grava a auditoria |
| `validate-prescription` (já existe) | A resposta `_format=application/validador-iti+json` passa a apontar `signatureFiles[].url` para o PDF assinado, por URL assinada de curta duração |

### Banco (migration reservada `20261104140000`, faixa do Claude)

- **`signature_sessions`:**
  - colunas: `id`, `user_id`, `psc`, `cpf_digest` (SHA-256 do CPF devolvido; o CPF em claro não é guardado), `vault_secret_id`, `expires_at`, `revoked_at` e `created_at`;
  - **sem leitura pelo cliente**: RLS fechada e acesso só pelas funções com service role;
  - o cliente vê apenas uma RPC `signature_session_status()` com `{ active, expires_at, psc }`.
- **Token no Supabase Vault** (`vault.create_secret`):
  - nunca vai ao navegador, ao log nem ao `content` do documento;
  - é apagado ao revogar e, quando vence, por um job.
- **`prescription_signatures`:** auditoria só de acréscimo, com `prescription_id`, `user_id`, `psc`, `pdf_sha256_before`, `pdf_sha256_after`, `cert_serial`, `cert_subject_cpf_digest`, `policy_oid`, `signed_at` e `session_id`. Não admite update nem delete.
- **`prescriptions`:**
  - continua com os campos que já existem (`status`, `signed_at` e `signature_verified_at`, com a checagem `signed_prescription_verified`);
  - acrescenta `signed_storage_path`, porque o PDF original fica preservado e o assinado é outro arquivo.

## Segurança

O ponto principal é a guarda do token: enquanto vale, a sessão é a "caneta" do médico.

- **Duração:** no máximo 12 horas, revogável a qualquer momento.
- **Vínculo com o médico:** o token fica preso ao `user_id` e ao CPF autorizado.
- **Cada assinatura:**
  - exige uma sessão autenticada do Cortex com MFA (`assert_session_assurance`);
  - parte de um clique do médico sobre um documento dele, já gerado;
  - nunca assina em lote nem em segundo plano.
- **Limite de ritmo:** no máximo 60 assinaturas por hora por médico (configurável). Acima disso, a sessão é suspensa e o médico é avisado.
- **Sem arquivo A1 (.pfx):** o Cortex não aceita upload, para não guardar a chave do médico.
- **O hash que vai ao PSC** é recalculado no servidor a partir do PDF guardado, nunca recebido do navegador.

**Estado em 04/11/2026:** `_shared/pades.ts` está implementado.
- Assina só PDFs com tabela de referência clássica; por isso, desde já, o `generate-prescription` grava com `useObjectStreams: false`. PDFs antigos com xref comprimida são recusados com o pedido de gerar de novo.
- Aceita só certificados RSA, que é o caso dos certificados de pessoa física ICP-Brasil.
- Testes em `src/lib/pades.test.ts`: os 6 primeiros itens abaixo, mais a verificação externa com `openssl cms -verify` (aceita o conteúdo assinado e recusa o PDF alterado).
- Conferido também com um PDF gerado pela pdf-lib 1.17.1, a mesma versão do Edge, com cópia de página como na receita retida. A pdf-lib relê o arquivo assinado e o OpenSSL aprova.

## Testes

### Locais, só com material sintético

Usam uma AC de teste e um certificado "Médica Sintética", gerados para os testes e guardados em `fixtures` como dado de teste, sem valor fora deles.

1. **Atualização incremental:** os bytes originais do PDF continuam idênticos no início do arquivo assinado.
2. **ByteRange:** cobre o arquivo inteiro menos o `/Contents`, e o `messageDigest` é igual ao SHA-256 dessa faixa.
3. **CMS:** o SignedData relido traz os quatro atributos assinados, nenhum `signingTime`, o OID da política e o ESSCertIDv2 igual ao SHA-256 do certificado. A assinatura confere com a chave pública de teste.
4. **DocMDP:** P=2 presente, sem `/Perms`.
5. **PSC falso:** um servidor local sintético cobre o fluxo PKCE, o CPF divergente (recusado), a assinatura que não confere (recusada, nada gravado), o token vencido ou revogado e o limite de ritmo.
6. **Vazamento:** o token não aparece em resposta, log nem `content`.

### De aceite, com certificado real (só com o médico presente)

1. O PDF de cada tipo aparece como **"Aprovado"** no validar.iti.gov.br e é reconhecido como prescrição, atestado ou pedido de exame, com CRM e UF.
2. O app VALIDAR lê o QR, pede o código e baixa o PDF; código errado devolve 401 e documento inexistente, 404.
3. Uma segunda assinatura não invalida a primeira.
4. Três farmácias de Curitiba dispensam uma receita simples assinada.

## O que depende do usuário ou da clínica (Fase 0)

- [ ] Saber quais dos 6 médicos já têm o certificado em nuvem gratuito do CFM (VIDaaS) e quais têm a carteira de médico com chip, necessária para pedi-lo (certificadodigital.cfm.org.br).
- [ ] Cadastrar o Cortex como aplicativo na Valid (homologação do VIDaaS). Isso pede os dados da empresa e, talvez, um certificado SSL ICP-Brasil para o registro. O Cortex não cria conta em nome de ninguém.
- [ ] Parecer jurídico sobre a Res. CFM 2.299/2021, art. 5: inscrição no CRM e diretor técnico de quem oferece a plataforma.
- [ ] Um médico disponível para o teste de aceite com o certificado real.

## Ordem de implementação

1. `_shared/pades.ts` com os testes locais 1 a 4, só com material sintético. Não precisa de nada externo.
2. `_shared/psc.ts` e o PSC falso, com o teste 5.
3. Migration `20261104140000`, as funções `signature-session` e `sign-document`, e o teste 6. Antes da migration, pedir revisão do Codex sobre RLS, Vault e auditoria.
4. Tela de sessão e "Gerar e assinar" no compositor.
5. Homologação com a Valid e testes de aceite, quando a Fase 0 estiver pronta.
