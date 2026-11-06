# WhatsApp na recepção do Cortex: opções, custos e caminho recomendado

> **Status:** pesquisa e recomendação para a decisão D24 do [PLANO](../PLANO.md). Nada aqui foi contratado.
> **Acesso de todas as fontes:** 2026-11-06. Os números entre colchetes remetem à lista de fontes no fim do arquivo.
> **Legenda:** "(terceiros)" indica número publicado por fornecedor ou blog e não confirmado em página da Meta. "Não verificado" indica que não achamos fonte primária. Nenhum preço foi inventado. As estimativas de volume aparecem marcadas como **premissa**.

## 0. Resumo

- **Agora, na clínica piloto:** usar a Cloud API direto com a Meta. O app, a conta WhatsApp (WABA) e o número ficam no portfólio Meta da clínica, e o Cortex atua como "desenvolvedor direto". Nesse modelo não há App Review [25]. O número deve ser dedicado à API. Coexistência com o app WhatsApp Business exige que o Cortex seja Tech Provider ou que a clínica use um parceiro [26].
- **Em paralelo:** a empresa que vende o Cortex inicia o processo de **Tech Provider** (verificação por CNPJ, App Review, Access Verification) e implementa o **Embedded Signup v4**. É assim que o Cortex escala para várias clínicas, cada uma com o próprio número e o próprio cartão na Meta [27][28][29].
- **Parceiro (BSP) não é recomendado como padrão.** Ele soma taxa por mensagem ou mensalidade e acrescenta mais um operador de dados (LGPD). Zenvia e Blip vendem a própria caixa de entrada, que concorre com a do Cortex.
- **Custo de Meta para uma clínica** com cerca de 1.200 consultas por mês: **≈ R$ 165 a 312/mês (≈ US$ 32 a 61)**. Veja a seção 7.

## 1. Regras da Meta que valem para qualquer caminho

**Preço.** Desde 01/07/2025 a Meta cobra por mensagem **entregue** enviada pela empresa. Mensagens recebidas do paciente são grátis [1]. São quatro categorias: marketing, utility e authentication (sempre por modelo) e serviço (texto livre dentro da janela de atendimento). A janela de 24 h abre a cada mensagem ou ligação do usuário e se renova a cada nova mensagem dele [1].

**Mudança de 01/10/2026** [2]: cada número tem **1.000 mensagens de serviço grátis por mês** (cobrança a partir da 1.001ª), e **utility enviada dentro da janela deixou de ser grátis** (era desde 01/07/2025). No webhook de status, o tipo de preço passa de `free_customer_service` para `regular`. A página de preços do whatsappbusiness.com ainda dizia que serviço é grátis [39]; a documentação de desenvolvedor prevalece.

| Brasil (+55) | Tarifa | Fonte |
|---|---|---|
| Utility | **US$ 0,0068** ("0.68¢", exemplo oficial para Brasil). R$ 0,035 (terceiros) | [1][40][41] |
| Authentication | US$ 0,0068 (oficial). R$ 0,035 (terceiros) | [1][40] |
| Marketing | US$ 0,0625 / R$ 0,3217 (terceiros) | [40][41] |
| Serviço | 1.000 grátis por número por mês. Depois disso, R$ 0,035 (terceiros). A página oficial diz apenas "per published rates" | [1][40][41] |

Não conseguimos ler a tabela oficial em CSV/PDF (links sem `href` no texto, e a página bloqueia download automatizado). O valor em BRL deve ser confirmado na conta da clínica.

**Demais regras de preço e cobrança:**
- Há faixas de volume só para utility e authentication, agregadas no portfólio [1]. As faixas do Brasil não foram verificadas. Com o volume de uma clínica, a expectativa é ficar na faixa base, mas isso também não foi verificado.
- O faturamento em **BRL** existe desde jul/2026 e é emitido pela Facebook Brasil. Clientes elegíveis precisam migrar para BRL até **30/06/2027**. A partir de 01/07/2027, contas não-BRL deixam de entregar mensagens [1][2].
- A Meta só muda preço em 1/jan, 1/abr, 1/jul e 1/out, com 1 a 6 meses de aviso [2].
- Sem forma de pagamento cadastrada, a entrega de serviço pode parar [1].

**Limites e capacidade.**
- O limite conta destinatários **únicos fora da janela** em 24 h móveis: **250** no portfólio novo, **2.000** após a verificação da empresa, depois 10 mil, 100 mil e ilimitado, por uso e qualidade. Vale para o **portfólio inteiro**, compartilhado entre os números [3].
- **Premissa:** cerca de 60 consultas por dia útil (até 120 lembretes por dia) cabem em 250.
- Números por portfólio: 2, passando a 20 com verificação ou limite de 2.000 [4]. Vazão: 80 msg/s por número, ou **20 msg/s em coexistência** [5].

**Número e cadastro.**
- O número precisa ser próprio, ter DDD e receber SMS ou ligação; número curto não serve. Número em uso no WhatsApp só entra se for apagado antes ou por coexistência. Um número que enviou mensagem paga só pode ser excluído 30 dias depois [4][26].
- **PIN de duas etapas de 6 dígitos** no registro, que aceita 10 tentativas por número a cada 72 h [6][7]. A Meta está descontinuando o PIN para números elegíveis [6].
- **Nome de exibição:** revisado automaticamente quando o limite sobe; pode ser trocado 10 vezes a cada 30 dias [8].

**Modelos (templates).**
- Revisão automática, que "pode levar até 24 horas". Limite de 250 modelos por conta sem verificação e 6.000 com verificação [9].
- **Utility** não pode ser promocional e deve tratar de transação, conta ou serviço do próprio usuário. A Meta **reclassifica utility como marketing** de forma automática, às vezes imediata, com escalonamento de sanções [10]. Marketing custa cerca de 9× mais.

**Webhooks.**
- Assinatura no `X-Hub-Signature-256` (`sha256=` + HMAC-SHA256 do corpo com o App Secret). Verificação por GET com `hub.mode`, `hub.verify_token` e `hub.challenge` [11][12].
- Retentativas por **até 7 dias**, com **duplicatas possíveis**, em lotes de até 1.000 atualizações; o endpoint responde 200. mTLS é opcional [12].
- A URL pode ser sobrescrita por WABA ou por número só para `messages`, `smb_message_echoes`, `history` e similares. Webhooks de modelo e de conta vão **sempre** à URL padrão do app [13].

**Identidade do paciente.** Desde abril/2026 os webhooks trazem o **BSUID** (`user_id`), e o telefone (`wa_id`/`from`) **pode faltar** quando o usuário tem nome de usuário. O envio para BSUID funciona desde jul/2026. A Meta avisa que quem não suportar BSUID pode deixar de processar mensagens [14].

**Opt-in e opt-out.** É preciso ter opt-in antes de iniciar contato, com o nome da empresa dito claramente; pode ser coletado em papel, site ou telefone [15][16]. A empresa deve atender **todo pedido de saída, dentro ou fora do WhatsApp** [16]. O webhook `user_preferences` avisa só sobre parar ou retomar **marketing** [17].

**Sanções.** A escala começa em aviso. Bloqueio de 1 ou 3 dias impede modelos; de 5, 7 ou 30 dias, impede qualquer envio. Depois vêm bloqueio indefinido e desativação. O recurso leva de 24 a 48 h [18]. A qualidade do modelo (GREEN/YELLOW/RED) leva a pausa ou desativação [19]. A página sobre qualidade do número (alta/média/baixa) retornou 404: não verificado.

## 2. Política do WhatsApp para clínicas e dados de saúde

A Business Messaging Policy foi atualizada em 23/09/2026 [16]. Ela diz: "Don't use WhatsApp for telemedicine or to send or request any health related information". A proibição se aplica onde a regulação impede enviar esse dado a sistemas sem requisitos reforçados [16]. A política também proíbe pedir **número de documento de identidade**, de cartão ou de conta e "outros identificadores sensíveis" [16].

Consequências práticas:
- Os modelos levam apenas o nome da clínica, a data e hora, o endereço e os botões **Confirmar/Remarcar**. Ficam de fora especialidade, procedimento, exame e resultado.
- A recepção não pede CPF nem foto de documento pelo WhatsApp e encaminha para formulário seguro ou atendimento presencial. Se a carteirinha de convênio conta como "identificador sensível", **não foi verificado**.
- "Produtos médicos e de saúde" estão entre os bens proibidos para comércio [16]. Agendar serviço não é venda de produto, mas o canal não pode vender medicamento nem dispositivo.
- Automação é permitida dentro da janela, desde que haja escalonamento para humano [16]. O Cortex já é operado por humanos e não agenda sozinho.

## 3. LGPD

- **Dado de saúde é sensível** (art. 5º, II). A base legal "tutela da saúde, exclusivamente, em procedimento realizado por profissionais de saúde" está no art. 11, II, "f". A transferência internacional exige garantias, como cláusulas-padrão (art. 33, II, "b") [20].
- **Papéis:**
  - a clínica é controladora;
  - o fornecedor do Cortex é operador, e o contrato com a clínica precisa de DPA;
  - o WhatsApp é processador da empresa pelos Business Data Processing Terms (atualizados em 22/08/2025). Esses termos autorizam suboperadores da Meta, preveem aviso de incidente "sem demora indevida" e exclusão ao término [21].
- **Transferência internacional:** para contrato com a WhatsApp LLC vale o "Global Data Transfer Addendum" [21]. Se ele incorpora as cláusulas-padrão da ANPD **não foi verificado**. O prazo para adotar essas cláusulas (Res. CD/ANPD 19/2024) terminou em 23/08/2025 [22] (fonte: escritório de advocacia). Pedir parecer jurídico.
- **Onde os dados ficam:**
  - a Cloud API processa em data centers da Meta; a página não nomeia os países;
  - retenção máxima de **30 dias**, cifra em repouso, SOC 2 Type II e ISO 27001 [23];
  - existe **armazenamento local no Brasil** (`data_localization_region=BR`). Ele mantém o dado em uso fora do país por até 60 min e depois só no Brasil, e **só pode ser ativado com o número ainda não registrado**. Decida antes do registro [24][7];
  - a agenda de contatos fica nos data centers da Meta independentemente dessa opção [24].
- **Impacto de um BSP:** acrescenta mais um operador e, em geral, mais uma transferência internacional.
- **No próprio Cortex:** a produção atual está em us-west-2, segundo o PLANO. As mensagens guardadas no Cortex herdam essa transferência. Na v1, o conteúdo das conversas fica fora do pipeline de IA até haver decisão explícita.

## 4. Caminhos comparados

| Caminho | Entrada | Coexistência | Custo além da Meta | Observação |
|---|---|---|---|---|
| **A. Cloud API direta** (app no portfólio da clínica) | Portfólio da clínica, verificação por CNPJ, número, token de usuário do sistema. **Sem App Review** [25] | **Não**: exige Solution Partner ou Tech Provider [26] | R$ 0 | Um app e um App Secret por clínica. Combina com o "ambiente dedicado por clínica" (D21) |
| **B. Cortex Tech Provider + Embedded Signup** | Verificação da empresa do Cortex, App Review (2 vídeos), acesso avançado a `whatsapp_business_messaging` e `whatsapp_business_management` [27][25] | Sim [26] | R$ 0. Cada clínica cadastra o próprio pagamento, porque Tech Provider não tem linha de crédito [29] | 10 clientes novos a cada 7 dias. Sobe para 200 após verificação, App Review e Access Verification [28]. **ES v2/v3 descontinuados em 15/10/2026: usar v4** [28] |
| **C. Tech Provider com Solution Partner** | Como em B, mais o app do parceiro [27] | Sim | Ex.: 360dialog Partner Platform a partir de €250/mês + €49 por canal [32] | Linha de crédito do parceiro [29]. Verificação feita pelo parceiro só com Select/Premier, em média 5 min [30] |
| **D. BSP ou plataforma pronta** | Cadastro no fornecedor | Depende do fornecedor | Ver tabela abaixo | O fornecedor vira operador de dados. Zenvia e Blip trazem a própria caixa de entrada |

| BSP (só os verificados) | Taxa publicada | Presença no Brasil | Fonte |
|---|---|---|---|
| Twilio | US$ 0,005 por mensagem **recebida ou enviada**, mais US$ 0,001 por falha. "Pricing current as of September 2026" | Não verificada | [31] |
| 360dialog | Regular €49, Premium €99 e Scale €500 por número por mês. "No markup on Meta fees". Página de 29/10/2026 | Não verificada. Coexistência documentada, mas há nota conflitante de indisponibilidade | [32][33] |
| Gupshup | US$ 0,001 por mensagem (modelo e sessão, recebida e enviada) | Não verificada | [34] |
| Zenvia | Planos de R$ 0 a R$ 3.900/mês e setup de R$ 649 a R$ 3.999. Modelo a R$ 0,47–0,55 (**sem distinguir categoria**). Serviço a R$ 0,056–0,069 depois de 1.000 grátis | Sim (BRL, exige CNPJ). O status de BSP não aparece na página | [35] |
| Blip (Take) | Plus: até 30 atendentes e 2.000 conversas únicas por mês, excedente de R$ 1,40. Mensalidade base não publicada | Sim. Declara-se parceira oficial da Meta com selo BSP | [36] |
| Infobip | Sem preço público. A página ainda fala em "conversas" | Não verificada | [37] |
| Sinch | A página de preços não pôde ser lida (retornou imagem) | Não verificada | [38] |

## 5. Coexistência: manter o app WhatsApp Business no mesmo número

- **Exige** Solution Partner ou Tech Provider e Embedded Signup. O app precisa estar na versão 2.24.17 ou superior [26].
- **O que sincroniza:** contatos e conversas 1:1 dos últimos **180 dias**, com aceite e **em até 24 h**. Fora desse prazo, é preciso refazer o fluxo. Grupos não sincronizam [26].
- **O que fica desativado:** mensagens temporárias, visualização única, localização em tempo real e listas de transmissão (passam a somente leitura). Chamadas e ferramentas do app não funcionam via API. Os aparelhos conectados são desvinculados, e Windows e WearOS não são suportados [26].
- **Desconexão:** se o celular principal ficar cerca de **14 dias** sem uso, o número desconecta [26].
- **Vazão:** fixa em 20 msg/s [5].
- **Mensagens enviadas pelo app** continuam grátis e chegam ao Cortex como `smb_message_echoes`. Elas **não abrem a janela** de atendimento [26].
- **Brasil:** a página da Meta não lista restrição de país, e isso não foi verificado na Meta. A 360dialog diz que contas em coexistência não têm "Classic Business Verification", o que também não foi verificado na Meta [33].

## 6. Recomendação

1. **Piloto agora: caminho A.**
   - A clínica cria e verifica o portfólio. O Cortex entra como desenvolvedor do app da clínica.
   - O registro usa armazenamento local BR.
   - O número deve ser **dedicado** à API: um número novo, ou o atual depois de apagar a conta do app.
   - Se a clínica exigir o número atual **e** o app ao mesmo tempo, há duas saídas: esperar o caminho B, ou usar um BSP com coexistência (ex.: 360dialog Regular, €49/mês [32]). Essa escolha é a decisão D24.
2. **Começar já o caminho B,** sem bloquear o piloto: verificação da empresa vendedora, App Review com vídeos, Access Verification e Embedded Signup v4 na tela Configurações → Conexões.
3. **Escala:**
   - cada clínica tem o próprio portfólio, WABA, número e cartão em BRL;
   - o Cortex não intermedia a fatura da Meta e repassa a orientação na implantação;
   - um único app do Cortex com **roteador central** de webhooks. Os webhooks de modelo e de conta sempre chegam à URL padrão [13]. As mensagens podem ir direto ao ambiente da clínica por sobrescrita da URL por WABA ou número [13].
4. **Quando faz sentido um BSP:** só se precisarmos de linha de crédito e fatura única, ou de coexistência antes de o Cortex ser aprovado como Tech Provider.

## 7. Custo mensal estimado (uma clínica, cerca de 1.200 consultas por mês)

**Premissas:** 1 a 2 modelos utility por consulta; 1.500 conversas recebidas, com **3 a 5 respostas da recepção** por conversa; cerca de 5.000 a 9.000 mensagens recebidas; tarifa de R$ 0,035 (terceiros), coerente com os US$ 0,0068 oficiais [1][40].

| Item | Volume | Meta (R$) | Meta (US$) |
|---|---|---|---|
| Lembretes e confirmações (utility, dentro ou fora da janela) | 1.200–2.400 | 42,00–84,00 | 8,16–16,32 |
| Respostas da recepção (serviço) | 4.500–7.500, menos 1.000 grátis, = 3.500–6.500 | 122,50–227,50 | 23,80–44,20 |
| Mensagens recebidas | ~5.000–9.000 | 0 | 0 |
| **Total Meta** | | **≈ 164,50–311,50** | **≈ 31,96–60,52** |

**Sensibilidade:** com só 2 respostas por conversa, o serviço cai para cerca de R$ 70. Se os lembretes forem reclassificados como marketing, passam a custar R$ 386 a 772 (terceiros [40]).

**Custo somado à Meta, por caminho:**

| Caminho | Acréscimo mensal |
|---|---|
| A ou B (direto) | R$ 0 de terceiros. A infra Supabase já existe, e o custo incremental não foi estimado |
| Twilio | 10.700–18.900 mensagens × US$ 0,005 = **US$ 53,50–94,50** [31] |
| Gupshup | **US$ 10,70–18,90** [34] |
| 360dialog Regular | **€49** por número [32] |
| Zenvia | Plano Specialist R$ 600 + modelos (R$ 588–1.320) + serviço (R$ 203–449): **≈ R$ 1.390–2.370**, mais setup de R$ 649. Conta feita a partir da página [35]. A página não diz se a tarifa da Meta está incluída: confirmar com o comercial |
| Blip | Sob consulta [36] |

## 8. Passo a passo para entrar no ar

**A clínica fornece:**
1. CNPJ e documentos com razão social e endereço iguais aos do portfólio. Terceiros citam Cartão CNPJ, contrato social e comprovante em nome da empresa (não verificado na Meta: a página de ajuda veio sem conteúdo [42]).
2. Um administrador do portfólio Meta Business, que cria ou escolhe o portfólio, inicia a verificação e dá ao Cortex o papel de desenvolvedor.
3. O número dedicado, capaz de receber SMS ou ligação, e a decisão sobre coexistência.
4. Um nome de exibição coerente com a marca.
5. Um cartão na conta WhatsApp, com moeda BRL na criação (a moeda não pode ser trocada depois) [1].
6. Texto de opt-in na ficha e no cadastro, atualização do aviso de privacidade e DPA com o fornecedor.
7. Aprovação do texto dos modelos e definição de quem atende, em que horário e como funciona a saída.

**O fornecedor (Cortex) faz:**
1. Cria o app com o caso de uso WhatsApp no portfólio da clínica (caminho A) e gera o token de usuário do sistema [25].
2. Publica o webhook em HTTPS com verify token e App Secret nos segredos do ambiente, e inscreve o app na WABA.
3. Registra o número com PIN e `data_localization_region=BR` [7][24].
4. Submete os modelos utility em pt_BR e testa com o número de teste da Meta.
5. Faz o piloto com a equipe e depois libera para pacientes que deram opt-in.

**Prazos:** revisão de modelos em até 24 h [9]. A Meta não informa prazo de verificação da empresa nas páginas acessadas, e o prazo do App Review do Tech Provider não foi verificado. **Estimativa nossa, não oficial:** 1 a 3 semanas para o piloto no caminho A; o que mais pesa é a verificação.

## 9. O que construir no app

1. **`whatsapp-webhook` público** (sem JWT do Supabase): GET de verificação; POST que valida `X-Hub-Signature-256` sobre o **corpo bruto**, com comparação em tempo constante, e rejeita com 401 quando não confere.
2. **Gravação idempotente:** evento bruto salvo antes do 200; chave única por `wamid` (mensagem) e por (`wamid`, status); processamento item a item do lote, sem efeito duplicado nas retentativas, que duram até 7 dias [12].
3. **Identidade:** contato indexado pelo **BSUID**, com telefone opcional; tratamento de `user_changed_number`/`user_changed_user_id` [14]; vínculo com o paciente confirmado pela recepção. Isso **corrige** o PLANO, que hoje liga "pelo telefone normalizado".
4. **Relógio da janela de 24 h:** por número da clínica e por usuário, a partir da última mensagem recebida. A interface mostra o tempo restante; fora da janela, só modelo. Ecos do app (coexistência) não abrem a janela [26].
5. **Modelos:** catálogo sincronizado via `message_template_status_update` e `template_category_update`, com alerta quando a categoria muda. Botões Confirmar/Remarcar, cuja resposta vira status revisável (K3).
6. **Opt-in e opt-out:** registro do consentimento (data, canal e versão do texto); palavras-chave SAIR/PARAR, botão para a recepção e lista de supressão consultada antes de cada modelo; `user_preferences` para marketing [17].
7. **Status e custo:** sent, delivered, read e failed, com `pricing.category` e `type`, alimentando o painel de uso e o contador das 1.000 mensagens grátis [2].
8. **Mídia:** baixada logo para o bucket privado, porque a Meta retém por no máximo 30 dias [23].
9. **Multi-clínica:** token cifrado e App Secret por ambiente no caminho A. No caminho B, roteador central por `entry.id` (WABA) [13] e Embedded Signup v4: troca do code no servidor, `subscribed_apps`, registro e sincronização de coexistência em até 24 h [28][26].
10. **Monitoração:** `account_update`, qualidade de modelo, limite de mensagens, falhas por código (ex.: 131062 para BSUID não suportado [14]) e alerta para a clínica.

## 10. Riscos

- **Qualidade e sanções:** bloqueios e denúncias pausam modelos ou bloqueiam o número por até 30 dias, e um número banido exige recurso [18][19][4]. Mitigação: só enviar a quem deu opt-in, com texto neutro e saída fácil.
- **Reclassificação para marketing:** pode multiplicar o custo dos lembretes por cerca de 9 [10][40].
- **Preço:** a Meta revisa a cada trimestre. A cobrança de serviço e de utility dentro da janela é recente (01/10/2026) [2].
- **Política de saúde:** a proibição de "health related information" e de pedir documentos limita o que a recepção pode tratar pelo canal [16].
- **Prazos da Meta:** Embedded Signup v4 desde 15/10/2026 [28] e moeda BRL obrigatória até 30/06/2027 [1].
- **BSUID:** o telefone pode faltar no webhook [14].
- **Coexistência:** desconecta depois de cerca de 14 dias sem abrir o app, e a sincronização só pode ser feita uma vez [26].
- **Dependência do número:** ele fica preso por 30 dias depois da última mensagem paga [4], e o limite de mensagens vale para o portfólio inteiro [3].

## Fontes (todas acessadas em 2026-11-06)

1. Meta, Pricing: https://developers.facebook.com/docs/whatsapp/pricing e https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md
2. Meta, Pricing updates: https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing
3. Meta, Messaging limits: https://developers.facebook.com/docs/whatsapp/messaging-limits e https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits.md
4. Meta, Phone numbers: https://developers.facebook.com/docs/whatsapp/cloud-api/phone-numbers
5. Meta, Throughput: https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput.md
6. Meta, Two-step verification: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/two-step-verification.md
7. Meta, Registration: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/registration
8. Meta, Display names: https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names.md
9. Meta, Message templates: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
10. Meta, Template categorization: https://developers.facebook.com/docs/whatsapp/updates-to-pricing/new-template-guidelines
11. Meta, Webhooks (Graph API): https://developers.facebook.com/docs/graph-api/webhooks/getting-started
12. Meta, Create webhook endpoint: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint.md e https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks
13. Meta, Webhook overrides: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override/
14. Meta, Business-scoped user IDs: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids.md
15. Meta, Getting opt-in: https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in.md
16. WhatsApp Business Messaging Policy (atualizada em 23/09/2026): https://whatsappbusiness.com/policy/ (pt-BR: https://whatsappbusiness.com/pt-br/policy/)
17. Meta, user_preferences webhook: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/user_preferences.md
18. Meta, Policy enforcement: https://developers.facebook.com/documentation/business-messaging/whatsapp/policy-enforcement.md
19. Meta, Template quality: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-quality.md
20. Lei 13.709/2018 (LGPD): http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
21. WhatsApp Business Data Processing Terms (22/08/2025): https://www.whatsapp.com/legal/business-data-processing-terms
22. Lefosse, prazo das cláusulas-padrão ANPD: https://lefosse.com/noticias/transferencia-internacional-de-dados-prazo-para-adocao-das-clausulas-padrao-da-anpd-se-encerra-em-23-de-agosto/ (secundária)
23. Meta, Data privacy and security: https://developers.facebook.com/documentation/business-messaging/whatsapp/data-privacy-and-security.md
24. Meta, Local storage: https://developers.facebook.com/docs/whatsapp/cloud-api/overview/local-storage
25. Meta, Permissions: https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions
26. Meta, Coexistence: https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users e https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users.md
27. Meta, Tech Providers: https://developers.facebook.com/docs/whatsapp/solution-providers/get-started-for-tech-providers
28. Meta, Embedded Signup: https://developers.facebook.com/docs/whatsapp/embedded-signup/overview
29. Meta, Solution providers overview: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview.md
30. Meta, Partner-led business verification: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/partner-led-business-verification.md
31. Twilio, WhatsApp pricing: https://www.twilio.com/en-us/whatsapp/pricing
32. 360dialog, Pricing: https://360dialog.com/pricing
33. 360dialog, Coexistence: https://docs.360dialog.com/docs/hub/embedded-signup/coexistence-onboarding
34. Gupshup, pricing: https://www.gupshup.ai/channels/self-serve/whatsapp/pricing
35. Zenvia, Preços: https://www.zenvia.com/precos/
36. Blip, Preços: https://www.blip.ai/precos/
37. Infobip, WhatsApp pricing: https://www.infobip.com/whatsapp-business/pricing
38. Sinch, WhatsApp pricing: https://sinch.com/pricing/whatsapp/ (não foi possível ler)
39. WhatsApp, Platform pricing: https://whatsappbusiness.com/pt-br/products/platform-pricing/ (tabela interativa sem números no texto)
40. Zynfo, tabela Brasil (terceiros, "checked 9 Oct 2026"): https://zynfo.ai/whatsapp-pricing/brazil
41. CRMiner, cobrança out/2026 (terceiros): https://www.crminer.com.br/en/blog/whatsapp-business-api-cobranca-outubro-2026
42. Meta, documentos para verificação (sem conteúdo na leitura): https://www.facebook.com/business/help/159334372093366
