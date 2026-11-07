# Pré-consulta própria (P1): contrato v1

**Pedido do usuário (07/11/2026):** um formulário de pré-consulta próprio do Cortex, no lugar de um formulário externo.
- **Dono:** Claude. **Revisão:** Codex.
- **Migration:** `20261107110000_intake.sql`.
- **Funções:** `intake-public` (sem login) e `intake-api` (equipe).
- **Telas:** `/pre-consulta/:token` (paciente), `/pre-consultas` (equipe) e Configurações → Pré-consulta (administração).

## Fluxo

1. **Formulário:** a administração edita o formulário da clínica e o ativa. O inicial já vem pronto para ginecologia, obstetrícia e urologia: dados pessoais, convênio e uma parte de saúde.
2. **Link:** cada agendamento da agenda da clínica (`appointments.clinic_id`) tem um link único. Ele chega ao paciente de dois jeitos:
   - a recepção copia em **Pré-consultas** e cola na conversa;
   - uma automação do WhatsApp envia, com o campo de modelo "Link da pré-consulta" (`link_pre_consulta`).
3. **Resposta do paciente:** o paciente abre o link, sem login, e responde.
   - A página mostra só o nome da clínica, o do médico e a data da consulta. Nunca mostra o nome do paciente nem respostas já enviadas.
   - Ele pode enviar de novo, e as respostas substituem as anteriores, até a recepção conferir os dados (no máximo 20 envios).
4. **Conferência:** a recepção confere os dados cadastrais e o convênio. Só o médico da consulta vê e marca como lida a parte de saúde.

## Link

- O token é `HMAC-SHA256(INTAKE_LINK_SECRET, "cortex/intake/v1|<id>|<nonce>")` em base64url, com 43 caracteres.
- O banco guarda só o SHA-256 do token e o nonce. Sem o segredo, o banco sozinho não reconstrói o link.
  - **Exceção conhecida:** a mensagem que a automação envia pelo WhatsApp fica guardada em `whatsapp_messages` com o link no texto, como qualquer mensagem enviada. Quem lê a conversa vê o link. Com ele, dá para reenviar respostas até a recepção conferir, mas não para ler as já enviadas.
- A automação e a recepção recebem o mesmo link enquanto ele não for trocado.
- "Trocar o link" grava um nonce novo, e o anterior para de funcionar na hora. As respostas já enviadas continuam guardadas.
- **Validade:** até 2 horas depois do fim da consulta, calculada sempre a partir do agendamento atual. Depois disso, com a consulta cancelada, marcada como falta ou realizada, ou com o formulário da clínica desligado, o formulário aparece como encerrado.
- **Remarcação:** a consulta remarcada mantém o link, e o prazo acompanha o novo horário na hora.
- **Troca de `INTAKE_LINK_SECRET`:** os links já enviados param de funcionar. Na próxima vez que a recepção copiar o link ou uma automação enviá-lo, o servidor percebe que o hash guardado não bate e emite um link novo (CAS sobre o hash antigo).
- **Privacidade da URL:** o app já envia `Referrer-Policy: no-referrer`, então o token não vai para terceiros. O token nunca é registrado em log.

## Quem vê o quê

| Parte | Quem vê |
|---|---|
| Lista e dados cadastrais | A mesma regra da agenda da recepção: `reception_actor_allowed(clínica, médico, ator)`. São o próprio médico e a recepção com escopo naquele médico. A administração **não** vê a agenda de outro médico por ser administração (T28), e por isso também não vê a pré-consulta dele |
| Respostas de saúde | Só o médico do agendamento (`appointments.user_id`), conferido no servidor. A recepção recebe `health: null` |
| Página pública | Ninguém lê respostas por ela |

## Consentimento do WhatsApp

A caixa "Aceito receber lembretes" grava `whatsapp_opt_ins` com `source='paciente'` para o celular **do contato cadastrado** do agendamento, nunca um número digitado no formulário. Se o número já pediu para sair (SAIR), o formulário **não** reverte a saída, nem quando ela está só na conversa (SAIR antes de qualquer autorização). A tela da recepção mostra o que o paciente marcou naquele envio; a autorização em vigor é a do WhatsApp.

## API

**`intake-public`** (`verify_jwt = false`): `POST {action, token, ...}`.
- `open`: devolve `{state: 'open'|'answered'|'reviewed'|'closed', clinicName, doctorName, start, form|null, formRevision, answeredAt, privacyVersion}`. Um token desconhecido devolve 404.
- `submit`: recebe `{formRevision, answers: {perguntaId: valor}, whatsappConsent, privacyAccepted: true}`.
  - O servidor valida pelas mesmas regras da tela (`_shared/intakeForm.ts`).
  - Erros: 400 com `errors[]`; 409 se o formulário mudou, encerrou ou a recepção já conferiu; 429 depois de 20 envios.
- Sem `INTAKE_LINK_SECRET` ou `INTAKE_APP_URL`, responde 503 `server_not_ready`.

**`intake-api`** (JWT e `clinic_access`): `POST {action, ...}`.
- `state`: `{ready, canEditForm, enabled}`.
- `form` (admin): o formulário salvo, ou o inicial com `starter: true` e `revision: 0`.
- `saveForm` (admin): recebe `{revision, enabled, form}`. Valida, guarda só os campos conhecidos e faz CAS pela revisão (409 se mudou). Os links criados antes continuam com a versão antiga, porque cada pedido guarda uma cópia do formulário.
- `list`: recebe `{from, to}`, com no máximo 15 dias. Devolve as consultas da agenda da clínica que o ator vê e o estado de cada pré-consulta.
- `link`: recebe `{appointmentId}` e devolve `{url, requestId, status, expiresAt}`. É criado no primeiro uso.
- `rotate`: recebe `{requestId}` e devolve um link novo.
- `response`: recebe `{appointmentId}` e devolve `{request: {..., registration, health|null, healthVisible}}`.
- `review`: recebe `{requestId, part: 'registration'|'health', revision}`.

## Formulário

- **Seções:** cada uma tem `audience: 'registration'` (recepção) ou `'health'` (só o médico).
- **Tipos de pergunta:** texto, texto longo, data, uma opção, várias opções, sim ou não, CPF, e-mail, telefone, CEP e número.
- **Campos do cadastro (`field`):** uma pergunta de cadastro pode apontar para um campo conhecido (nome, nascimento, CPF, endereço, convênio, carteirinha, entre outros), para a conferência e o faturamento. Uma pergunta de saúde não pode ter campo.
- **Condição:** `showIf` mostra a pergunta só quando outra tem certa resposta. Por exemplo, carteirinha só para quem escolheu "Convênio". Uma resposta a pergunta escondida ou inexistente é recusada.
  - As condições valem em cadeia: esconder uma pergunta esconde as que dependem dela.
  - Ciclos são recusados.
  - Uma pergunta da recepção não pode depender de uma resposta de saúde, porque mostrá-la revelaria a resposta.
  - O que é salvo passa de novo pela validação, depois de limpar os espaços.
- **Limites:** 12 seções, 60 perguntas, 2.000 caracteres por resposta longa.

## Segredos (por ambiente)

| Segredo | Valor |
|---|---|
| `INTAKE_LINK_SECRET` | 32 ou mais caracteres aleatórios. Trocar o segredo invalida todos os links já enviados |
| `INTAKE_APP_URL` | Origem https do app, sem barra final. Por exemplo, `https://clinica.exemplo.com.br` |

## Limites da v1 e próximos passos

- Aplicar os dados conferidos no contato ou no cadastro do paciente é feito pelo editor de correção de contato (Codex), a partir da proposta `registration` com `field`. Ainda não está integrado; hoje a recepção confere e corrige pelo fluxo atual.
- O painel do médico na consulta (`IntakeAnswersDialog`) existe em `src/features/intake/`. Montá-lo na consulta ou na página do paciente é um encaixe a pedir ao Codex (K7).
- **Retenção:** as respostas ficam com o agendamento e somem com ele (cascata). Uma regra de expurgo para respostas antigas não conferidas fica para depois.
- **Produção:** nada foi aplicado. É preciso a migration, as duas funções e os dois segredos.
