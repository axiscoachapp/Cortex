# Plano de implementação

Este é o roteiro da equipe Cortex para implantar o sistema em uma clínica do zero. A implantação entrega o ambiente preparado e validado; médicos, secretaria e gestão recebem seus acessos e treinamento para a rotina. A clínica fornece informações e aprova decisões, sem precisar configurar credenciais técnicas.

Cada clínica precisa de uma cópia deste checklist em local privado, com responsável, data, evidência e pendências por etapa. Não preencher este arquivo do repositório com nomes de pacientes, documentos pessoais, exportações, senhas ou tokens. Uma etapa só fica concluída depois da validação indicada.

## 1 Alinhamento e escopo

Responsável Cortex: implantação. Aprovação: responsável designado pela clínica.

- [ ] Identificar decisor, contato operacional, responsável médico e responsável financeiro.
- [ ] Levantar unidades, médicos, especialidades praticadas, equipe de recepção, agendas, horários e volume aproximado de uso.
- [ ] Definir os módulos contratados: prontuário, agenda, recepção, pré-consulta, WhatsApp, financeiro, assinatura e integrações.
- [ ] Definir regras de implantação, treinamento, suporte e quem aprova alterações de escopo.
- [ ] Registrar o sistema anterior, quais dados serão migrados e quem tem autorização para fornecê-los.
- [ ] Definir piloto, critérios de entrada em operação e prazo de convivência com o sistema anterior.
- [ ] Confirmar responsabilidades sobre dados, retenção, acesso, comunicações e custos dos serviços externos com os responsáveis da clínica.

Aceite: escopo e responsáveis aprovados, com opcionais e dependências pendentes claramente identificados. Não prometer uma integração ou migração que ainda não foi validada.

## 2 Ambiente e operação técnica

Responsável: equipe técnica Cortex.

- [ ] Preparar ambiente correto, domínio, HTTPS e identidade visual autorizada.
- [ ] Conferir versão, configuração de serviços, origem dos callbacks e configuração pública do aplicativo.
- [ ] Guardar credenciais exclusivamente nos cofres/ambientes autorizados. Nenhuma chave privilegiada no navegador, repositório ou material de treinamento.
- [ ] Validar migrations e compatibilidade em banco descartável; definir backup e retorno antes de qualquer alteração real.
- [ ] Configurar monitoramento, registros sem conteúdo sensível, recuperação e canal de suporte.
- [ ] Ensaiar backup e restauração num ambiente isolado e registrar o resultado.
- [ ] Separar o acesso técnico do operador Cortex do papel de administrador da clínica. Definir escopo, auditoria e revogação; não compartilhar senhas de médicos nem improvisar acesso por email.

Aceite: ambiente acessível, recuperável e com acessos técnicos controlados. Publicação e alterações hospedadas exigem autorização específica da implantação correspondente.

## 3 Cadastro da clínica e acessos iniciais

Responsável Cortex: implantação. Conferência: administração e médicos.

- [ ] Cadastrar a clínica/unidades e conferir identificação, contatos e endereço com o responsável.
- [ ] Preparar contas individuais para médicos, secretaria e administração, conforme escopo autorizado.
- [ ] Validar que cada login abre a sua área; administrador acessa os ambientes permitidos pelo seu papel.
- [ ] Entregar convites ou credenciais temporárias por canal seguro e orientar a troca de senha pelo próprio usuário.
- [ ] Orientar a ativação do segundo fator e testar recuperação de acesso.
- [ ] Definir agendas visíveis, ações permitidas e quem pode administrar a equipe.
- [ ] Obter a aprovação explícita de cada médico para delegar sua agenda à recepção; não aprovar em nome dele.
- [ ] Testar dois médicos e uma conta de secretaria: prontuários privados por médico; compartilhar só quando houver decisão explícita e revogável.
- [ ] Testar revogação/desativação e confirmar que o acesso deixa de estar disponível.

Aceite: usuários acessam somente seu escopo; administrador de clínica ou de recepção não recebe acesso automático a prontuários privados.

## 4 Configuração clínica por médico

Responsável Cortex: implantação. Validação final: o próprio médico.

- [ ] Configurar a especialidade/estrutura clínica adequada para cada médico; não aplicar a especialidade de um profissional a todos por inferência.
- [ ] Cadastrar e conferir nome profissional, CRM e UF, endereço profissional e telefone.
- [ ] Conferir RQE e CPF quando necessários para os documentos e serviços habilitados. Coletar por canal seguro e somente no escopo necessário.
- [ ] Preparar os modelos iniciais de evolução e documentos combinados com a clínica.
- [ ] Manter o copiloto ao vivo desativado. A preferência legada não deve reativar análise em tempo real.
- [ ] Ensaiar registro manual, gravação, recuperação de rascunho e elaboração final com dados sintéticos.
- [ ] Gerar amostras dos documentos habilitados e pedir ao médico que confira identificação, estrutura e apresentação.
- [ ] Confirmar que a falta de dados obrigatórios bloqueia o documento e orienta a solicitar correção à implantação.

Aceite: médico conferiu os dados e as amostras; recursos não habilitados continuam indisponíveis. Cadastro preenchido, sozinho, não equivale a homologação clínica ou de assinatura.

## 5 Agenda e recepção

Responsável Cortex: implantação. Validação: secretaria e médicos.

- [ ] Preparar agendas, horários, tipos de consulta, duração e bloqueios acordados.
- [ ] Confirmar fuso horário e regras de disponibilidade e conflitos.
- [ ] Conferir o cadastro administrativo de contatos e a relação de responsáveis/beneficiários quando necessária.
- [ ] Testar demanda nova, responsável, notas, espera, conclusão e transferência, dentro das permissões da equipe.
- [ ] Testar agendamento, confirmação, remarcação, cancelamento e chegada; a confirmação continua sendo uma ação humana.
- [ ] Validar que contato administrativo não abre prontuário nem funde pacientes automaticamente.
- [ ] Ensaiar concorrência: horário ocupado, informação desatualizada, perda de acesso e nova tentativa orientada.
- [ ] Mostrar os indicadores disponíveis e explicar quais métricas não têm fonte válida. Não inferir faltas, abandono ou autoria por responsável atual.

Aceite: secretaria executa a rotina de ponta a ponta com usuários de teste, sem acesso clínico indevido e sem agendamento duplicado.

## 6 Pré-consulta e comunicação

Responsável Cortex: implantação. Aprovação: clínica e responsável médico.

- [ ] Preparar o formulário inicial, perguntas e textos que a clínica aprovar.
- [ ] Ensaiar link individual, preenchimento, expiração/indisponibilidade e leitura autorizada da resposta.
- [ ] Conferir o número dedicado e a titularidade do WhatsApp Business com a clínica.
- [ ] Configurar aplicação, credenciais, webhook e manutenção da conexão em ambiente seguro; a clínica não deve copiar token, PIN ou IDs na tela de rotina.
- [ ] Validar recebimento, destinatário, identificação do remetente e permissões de uso do canal.
- [ ] Preparar modelos de mensagem e acompanhar a aprovação pelo provedor.
- [ ] Conferir regras, horários, conteúdo e critérios de envio das automações com a clínica antes de ativá-las.
- [ ] Testar opt-out/retirada de consentimento e impedir envio quando não houver permissão ou elegibilidade.
- [ ] Demonstrar mensagens manuais e automações sem confundir link preparado com mensagem efetivamente enviada.

Aceite: mensagens e formulários aprovados; conexão e modelos válidos. Se faltar credencial, aprovação ou autorização de envio, manter a função correspondente pendente/desativada. Testes reais e custos do provedor precisam de autorização específica.

## 7 Financeiro e convênios

Responsável Cortex: implantação. Aprovação: responsável financeiro da clínica.

- [ ] Levantar fluxo particular/convênio, responsáveis e ações de cada papel.
- [ ] Preparar dados de faturamento da clínica e dos profissionais; conferir com quem responde por esses cadastros.
- [ ] Cadastrar convênios, contratos, códigos/tabelas, valores, prazos e informações de cobrança aplicáveis.
- [ ] Confirmar o que gera atendimento a faturar; chegada registrada não prova que a consulta aconteceu.
- [ ] Ensaiar cobrança, saldo, pagamento parcial/integral, despesas e relatórios com dados sintéticos.
- [ ] Conferir o período de cada fonte: atendimento, recebimento, vencimento e pagamento de despesa.
- [ ] Quando contratado, validar guias, lotes, arquivo de intercâmbio e retorno com o responsável do convênio.
- [ ] Definir conferência, correções e fechamento; explicar os dados que cada papel pode consultar ou alterar.
- [ ] Tratar emissão fiscal como integração separada, com responsáveis, homologação e autorização próprias. Não emitir documento fiscal ou enviar lote real para testar a interface.

Aceite: responsável financeiro conferiu os resultados dos casos acordados e as diferenças de datas/escopos; nenhuma métrica ou saldo depende de inferência sem fonte.

## 8 Agenda externa e assinatura

Responsável Cortex: equipe técnica. Autorizações pessoais: cada médico.

- [ ] Quando contratada, preparar a integração Google e validar domínios, callbacks e escopos.
- [ ] Orientar cada médico a autorizar sua conta; não solicitar a senha pessoal ao operador.
- [ ] Ensaiar criação/alteração e falha de sincronização, deixando claro qual agenda é a fonte do agendamento.
- [ ] Quando contratada, preparar o provedor de assinatura e confirmar tipos de documento suportados.
- [ ] Orientar o médico sobre sua autorização pessoal, certificado e segundo fator. Não usar o certificado de outro profissional.
- [ ] Validar estados pendente, autorização recusada, certificado divergente, expiração e documento concluído.
- [ ] Ensaiar o fluxo autorizado de conferência do arquivo assinado e sua integridade, sem afirmar assinatura concluída só porque uma solicitação foi enviada.

Aceite: cada integração habilitada foi validada e aprovada por seu titular. Recursos sem credenciamento/configuração permanecem pendentes; não declarar disponibilidade pelo fato de existir um botão.

## 9 Migração e conferência de dados

Responsável: equipe de migração Cortex. Aprovação: responsáveis autorizados pela clínica.

- [ ] Formalizar origem, finalidade, campos, escopo por médico e autorização de migração.
- [ ] Fazer inventário e cópia protegida da origem sem adicionar exportações ao repositório.
- [ ] Separar extração/transformação/staging do carregador e do schema de importação. Implementação de carregador exige contrato e escopo próprios.
- [ ] Mapear explicitamente titularidade, identidades, campos legais, contatos e documentos; não fundir pessoas por semelhança de nome/CPF/telefone ou deduzir autor/proprietário.
- [ ] Executar ensaio em base descartável, conferir contagens, amostras e permissões com os responsáveis.
- [ ] Definir o corte, eventual janela de atualização, retorno e guarda do sistema anterior.
- [ ] Autorizar separadamente a carga real, registrar resultado e reconciliar divergências antes do aceite.

Aceite: dados reconciliados, médicos e escopos preservados, divergências resolvidas ou explicitamente aceitas. Sem contrato de carga aprovado, esta etapa continua pendente; nenhum “importar CSV” substitui essa validação.

## 10 Treinamento e entrada em operação

Responsável Cortex: implantação e suporte. Aprovação: clínica.

- [ ] Treinar secretaria em contato, fila, agenda, pré-consulta e comunicações.
- [ ] Treinar médicos em atendimento, revisão da evolução, documentos, recuperação, autorização de agenda e compartilhamento.
- [ ] Treinar gestão em usuários, acessos, financeiro, indicadores disponíveis e solicitações à implantação.
- [ ] Demonstrar desktop e celular e fornecer material de consulta sem dados reais.
- [ ] Ensaiar falta de internet, erro de leitura, informação desatualizada e necessidade de suporte.
- [ ] Registrar as pendências por módulo e decidir quais impedem a entrada em operação.
- [ ] Obter autorização final da clínica para publicação/corte e para cada integração real habilitada.
- [ ] Fazer piloto com escopo limitado, conferir a operação e ampliar conforme o aceite combinado.
- [ ] Acompanhar os primeiros atendimentos e fechamento financeiro, registrar incidentes e corrigir bloqueios.
- [ ] Entregar responsáveis de suporte, rotina de manutenção, processo de mudança e termo/checklist de aceite.

Aceite: rotina demonstrada pelos próprios usuários, pendências impeditivas encerradas e plano de suporte/retorno disponível. Encerrar a implantação somente após o aceite combinado.

## Controle por clínica

| Etapa | Responsável | Estado | Evidência e critério de saída |
|---|---|---|---|
| Escopo e responsáveis | Implantação + clínica | A iniciar | Escopo aprovado e donos definidos |
| Ambiente e recuperação | Técnica Cortex | A iniciar | Acesso/backup/restauração validados |
| Contas e permissões | Implantação + titulares | A iniciar | Logins individuais e isolamento conferidos |
| Cadastro clínico | Implantação + médicos | A iniciar | Dados e documentos de exemplo conferidos |
| Agenda/recepção | Implantação + secretaria | A iniciar | Rotina e conflitos ensaiados |
| Pré-consulta/WhatsApp | Implantação + clínica | Conforme escopo | Formulário/canal/modelos aprovados |
| Financeiro | Implantação + financeiro | Conforme escopo | Casos e resultados reconciliados |
| Google/assinatura | Técnica + cada titular | Conforme escopo | Autorizações e estados validados |
| Migração | Migração + clínica | Conforme contrato | Carga autorizada e conferida |
| Treinamento/piloto | Implantação + suporte | A iniciar | Usuários aptos e aceite final |

Estados possíveis: a iniciar, em preparação, aguardando clínica, aguardando fornecedor, em validação, concluído ou não contratado. Registrar bloqueios com dono e próxima ação; não marcar um módulo como concluído para compensar a ausência de credencial, teste ou aprovação.

## Preparações do produto antes de repetir a implantação

- Separar formalmente o acesso de operador Cortex do administrador da clínica; a interface de consulta não substitui ACL/auditoria do servidor.
- Definir o procedimento seguro de cadastro e correção de dados profissionais por médico, com validação e trilha de auditoria. Não orientar operadores a entrar com a senha do médico.
- Manter um checklist privado por cliente e um catálogo claro de integrações prontas, em credenciamento e não contratadas.
- Manter os contratos de migração/assinatura/financeiro separados e não tratar revisão visual como homologação desses produtores.
- Melhorar a proteção de rascunhos financeiros ao sair/voltar, limitação já identificada, antes de prometer preservação desse trabalho.

Este plano orienta a execução; não executa deploy, concessão de acesso, carga, conexão externa, envio ou emissão. Cada implantação real segue seu escopo e suas autorizações.
