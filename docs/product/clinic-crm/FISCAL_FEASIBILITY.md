# Viabilidade de NFS-e para a Haddad Nicola

Pesquisa: 03/11/2026. Cenário confirmado: Curitiba, emissão pelo CNPJ da clínica. Regime tributário, inscrição municipal, certificado e regras de faturamento ainda não foram informados. As estimativas abaixo são de engenharia, não cotação de fornecedor ou definição tributária.

## O que muda na escolha da integração

Curitiba migrou a emissão para a NFS-e Nacional: sociedades uniprofissionais no ISS fixo em 01/10/2025, Simples em 01/11/2025 e demais contribuintes em 01/01/2026. A integração nova deve mirar esse ambiente, sem investir no antigo emissor municipal. [Guia oficial de Curitiba](https://lp.curitiba.pr.gov.br/notanacional/).

No plano federal, a Receita informa obrigatoriedade do Emissor Nacional para ME/EPP do Simples a partir de 01/11/2026 e regras de IBS/CBS aplicáveis a esse regime a partir de 01/01/2027. Isso não muda o fato de Curitiba já ter estabelecido seu cronograma. O regime da clínica precisa ser confirmado antes de parametrizar tributos. [Orientação da Receita Federal](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/agosto/simples-nacional-nfs-e-nacional-sera-obrigatoria-para-me-e-epp-a-partir-de-1o-de-novembro-de-2026).

O CGNFS-e informa que a ausência de informações de IBS/CBS não provocará rejeição pelo sistema nacional até 31/12/2026. Uma autorização técnica não demonstra, por si, que o preenchimento cumpriu todas as obrigações do contribuinte. O plano contempla configuração por regime e vigência, revisada pelo contador. [Orientação do CGNFS-e](https://www.gov.br/nfse/pt-br/noticias/cgnfs-e-orienta-sobre-os-prazos-para%20destaque-de-ibs-cbs-nas-notas-fiscais-de-servico).

Receita Saúde trata de profissionais que prestam serviços como pessoa física. Não é a integração central para o CNPJ informado. [Receita Federal — despesas médicas e Receita Saúde](https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/preenchimento/manual-mir/pagamentos-ou-doacoes/despesas-dedutiveis).

## “Uma nota para cada coisa”: requisito a formalizar

A Prefeitura descreve emissão de NFS-e a cada operação realizada. Isso não permite concluir automaticamente “um PDF para cada item digitado”, “uma nota por parcela” ou “uma nota mensal para tudo”. [Serviço oficial de Curitiba](https://servicos.curitiba.pr.gov.br/iss-curitiba-acesso-ao-sistema-emissao-da-nota-curitibana-nfs-e/601).

A estrutura deve individualizar cada serviço e permitir que o contador configure sua correspondência com documentos fiscais. Casos a validar: consulta mais procedimento, vários códigos de serviço, pacotes de sessões, adiantamento, pagamento parcial, responsável financeiro diferente do paciente, convênio, cancelamento e reembolso. Não ativar agrupamento automático de serviços heterogêneos nem emissão automática para históricos migrados.

Separação proposta:

| Objeto | O que representa | Exemplo sintético |
|---|---|---|
| Agendamento | Reserva de tempo | Consulta em 10/11 às 14h |
| Serviço realizado | O que efetivamente foi prestado | Consulta e procedimento, cada um com valor e classificação |
| Cobrança | Obrigação financeira | R$ 600 a receber |
| Recebimento/alocação | Dinheiro recebido e onde foi aplicado | R$ 200 agora e R$ 400 depois |
| NFS-e | Documento fiscal autorizado | Emissão conforme política aprovada, com chave e XML |

Esses valores são exemplos; não preços da clínica. Nota autorizada não implica pagamento recebido. Estornar um pagamento não cancela automaticamente a nota. Retorno sem cobrança e falta do paciente não devem gerar automaticamente um documento fiscal por simples mudança de status.

## Alternativas técnicas

| Alternativa | Evidência | Complexidade e decisão proposta |
|---|---|---|
| Focus NFe | API específica de NFS-e Nacional, emissão assíncrona e consulta por referência. [Emissão](https://doc.focusnfe.com.br/reference/emitir_dps_nacional), [consulta](https://doc.focusnfe.com.br/reference/consultar_nfse_nacional) | Média/alta: bom candidato a uma prova de integração. Validar cadastro, certificado, cancelamento/substituição, webhooks e custo para este CNPJ |
| PlugNotas/TecnoSpeed | Documenta fluxo nacional, certificado do emitente, identificador de integração e consulta/webhook. [Documentação oficial](https://docs.plugnotas.com.br/) | Média/alta: segundo candidato. Confirmar homologação e suporte do cenário de Curitiba; não assumir cobertura a partir da marca |
| API nacional direta | Recebe DPS em XML; possui consulta por chave e por identificador da DPS. [Manual oficial](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf) | Alta: mais controle, maior responsabilidade com assinatura, certificado, schemas e manutenção fiscal |

Recomendação: primeira prova com um integrador, usando uma interface interna que não exponha o fornecedor à tela da recepção. Decisão final após teste, análise de contrato/custódia do certificado e cotação. Nenhum dos dois fornecedores foi contratado ou homologado nesta pesquisa.

Na API nacional direta, o manual descreve emissão síncrona; nos integradores citados, o processamento pode ser assíncrono. O Cortex deve aceitar os dois comportamentos sem confundir “recebido para processamento” com “autorizado”. As versões de produção, esquemas e regras devem ser fixadas na implementação a partir da [documentação atual](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual), separada dos [ambientes de teste e produção](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao).

## Fluxo fiscal proposto

1. Usuário autorizado revisa serviços realizados, competência, valores, emissor, tomador e política fiscal vigente.
2. Servidor cria um pedido imutável com chave idempotente, versão da configuração e snapshot do payload aprovado.
3. Trabalhador envia o pedido ao adaptador fiscal; segredos e certificado nunca vão ao navegador.
4. Em caso de timeout, marcar situação desconhecida e consultar a mesma referência/DPS antes de qualquer reenvio. Nunca criar outra referência apenas porque a resposta se perdeu.
5. Confirmada a autorização, guardar chave, protocolo, XML e DANFSe, com acesso restrito. PDFs de prévia devem estar claramente identificados e não se apresentar como notas autorizadas.
6. Entrega ao tomador é uma operação separada e auditada; não enviar diagnóstico, CID ou evolução no texto da nota nem na mensagem por padrão.
7. Cancelamento/substituição passa por permissão financeira e justificativa; preservar original e eventos, inclusive quando o órgão exige procedimento fora da API.

Estados mínimos: `draft`, `awaiting_review`, `queued`, `processing`, `unknown`, `authorized`, `rejected`, `cancel_requested`, `cancelled`, `substituted`. Para rejeição, exibir motivo utilizável pela equipe; para desconhecido, oferecer consulta/reconciliação em vez de outro botão de emissão.

## Dados e proteção

- Perfil fiscal: CNPJ como texto, IM, município, regime, cadastro de serviços/classificações, vigência, retenções e referências seguras às credenciais.
- CNPJ novo pode conter letras; não projetar um validador que aceite exclusivamente 14 dígitos. O formato existente da clínica continua válido. [Receita Federal — CNPJ alfanumérico](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/cnpj-alfanumerico).
- Paciente, pagador e tomador fiscal são papéis separados. O contador valida quais campos são obrigatórios em cada caso.
- Guardar documentos autorizados de forma imutável, com trilha de cancelamento e retenção fiscal definida. Pedido de exclusão de cadastro não deve apagar documento sujeito a obrigação de guarda.
- Não usar IA para decidir classificação fiscal, alíquota, agrupamento de serviços ou momento da emissão.

## Estimativa de engenharia

Hipóteses: um CNPJ, Curitiba, serviços particulares iniciais, financeiro mínimo disponível, um integrador aprovado e uma pessoa desenvolvedora experiente com apoio da equipe/contador. Dias de trabalho, não prazo garantido de calendário. Margem de incerteza relevante até conhecer o cadastro fiscal e fazer a prova.

| Entrega | Estimativa inicial |
|---|---|
| Financeiro mínimo ausente hoje: serviços, cobranças, pagamentos e alocações | 6–10 dias |
| Integração fiscal completa via fornecedor, depois desse mínimo: revisão, emissão, consulta, arquivos, falhas e cancelamento suportado | 10–18 dias |
| Total incremental financeiro + fiscal via fornecedor | 16–28 dias, cerca de 3–6 semanas |
| Integração direta nacional, substituindo o adaptador do fornecedor, após financeiro mínimo | 25–45 dias, com maior custo contínuo de manutenção |

Não somar as alternativas direta e via fornecedor. Homologação, certificado, liberações, suporte do fornecedor e validação contábil podem alongar o calendário sem corresponder a dias de programação. Emissor manual com registro de chave/XML pode servir como transição controlada, sem ser chamado de emissão integrada.

## Respostas necessárias do contador

1. Regime atual: Simples, lucro presumido, outro; ISS fixo/SUP se aplicável; mudanças previstas em 2027.
2. IM e emissor nacional habilitados? Existe certificado/procuração adequado ao meio escolhido? Quem será responsável por sua custódia e renovação?
3. Quais serviços são prestados, códigos e classificações vigentes? Como tratar consulta + procedimento, sessões e pacotes?
4. Momento de competência/emissão em adiantamentos, parcelas, faltas, retornos e convênios.
5. Quem é o tomador em pagamento por familiar/empresa? Quais dados de beneficiário/pagador precisam ser preservados para obrigações como Dmed?
6. Cancelamento, substituição, correções e reembolso: regras, prazos e responsáveis.
7. Há repasse aos médicos? Ele deve ser controlado separadamente, sem reduzir automaticamente o valor fiscal ao paciente.
8. Como são emitidas as notas atuais e quais dados históricos precisam somente de consulta/importação, sem reemissão?
