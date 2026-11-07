# Pesquisa técnica — Faturamento de convênios (Padrão TISS/ANS) para o Cortex

- **Data da pesquisa:** 07/11/2026 (todos os acessos nesta data).
- **Cliente de referência:** Clínica Haddad Nicola (Curitiba-PR) — GO/obstetrícia e urologia, ~6 médicos, consultas + procedimentos/exames de consultório.
- **Método:** leitura das fontes oficiais da ANS (página do Padrão TISS, Componente Organizacional 202609, Componente de Conteúdo e Estrutura 202511, schemas XSD do Componente de Comunicação 04.03.00) e consulta à API oficial de terminologias TUSS (OCL, linkada pela ANS). Os XSDs foram abertos localmente; dois XMLs de exemplo (dados fictícios) foram **validados contra o XSD oficial 4.03.00** com `System.Xml.Schema` (.NET), com 0 erros, e um teste negativo confirmou que a validação rejeita campos indevidos.
- **Legenda:** **[confirmado]** = lido na fonte oficial citada; **[terceiros]** = fonte não oficial; **não confirmado** = não encontrei na fonte.
- Nenhum dado de paciente foi usado. Os exemplos usam números fictícios (registro ANS `999999`, código do prestador `123456`).

---

## 1. Versão vigente do Padrão TISS

### 1.1 Resposta curta
- **Versão de XML (Componente de Comunicação) vigente e obrigatória em nov/2026: `4.03.00`** **[confirmado]**.
  - Início de vigência: **01/12/2025**. Limite de implantação: **30/06/2026**. Ou seja, obrigatória a partir de **01/07/2026**.
  - Fontes:
    - TUSS tabela 69, termo `027`: `04.03.00`, `inicio_vigencia 2025-12-01`, `fim_implantacao 2026-06-30`.
    - Histórico de versões da ANS: competência nov/2025, publicada em 28/11/2025, vigência a partir de 01/12/2025, limite de implantação em 30/06/2026.
    - O próprio XSD comenta "4.03.00 de 01/12/2025".
- **Pacote vigente: "Padrão TISS – Setembro/2026"**, publicado em 30/09/2026 e atualizado em 03/11/2026 **[confirmado]**. Versões dos componentes:

  | Componente | Versão |
  |---|---|
  | Organizacional | 202609 |
  | Representação de Conceitos em Saúde (TUSS) | 202609 |
  | Conteúdo e Estrutura | 202511 |
  | Segurança e Privacidade | 202511 |
  | Comunicação | **04.03.00** (prestador↔operadora) e 01.06.00 (Monitoramento TISS, operadora→ANS) |

  O Componente Organizacional 202609, §7, lista exatamente essas versões. O pacote Set/2026 tem vigência a partir de 01/10/2026 e limite de implantação em 31/12/2026, mas **não troca a versão do XML**: as mudanças são de TUSS e regras.
- **Versão nova próxima:** nenhuma versão de XML posterior à 4.03.00 foi anunciada até 07/11/2026.
  - Indícios: o pacote Set/2026 mantém o Componente de Comunicação 202511/04.03.00 e a tabela TUSS 69 não tem termo além de `04.03.00`.
  - Existe o arquivo "Solicitações de aprimoramento 202611", com pedidos ainda em análise.
  - Na reunião do COPISS de 26/02/2026, segundo notícia da ANS reproduzida pela Legismap em 03/03/2026, não apareceu nova versão de XML.
  - Fica **não confirmado** que não haja uma versão em preparação. Recomendação: revisar a página da ANS a cada publicação bimestral.

### 1.2 Linha do tempo das versões 4.x
Fonte: TUSS 69, via API OCL.

| Versão | Início de vigência | Fim de implantação |
|---|---|---|
| 04.00.00 | 2021-08-01 | 2023-02-28 |
| 04.00.01 | 2021-12-01 | 2023-02-28 |
| 04.01.00 | 2022-10-01 | 2023-02-28 |
| 04.02.00 | 2025-06-01 | 2025-11-30 |
| **04.03.00** | **2025-12-01** | **2026-06-30** |

- O enumerado `dm_versao` do XSD 4.03.00 aceita `4.00.00`, `4.00.01`, `4.01.00`, `4.02.00` e `4.03.00`. Pela validação do schema, a operadora pode aceitar versões anteriores da série 4.
- Na prática, o Sistema Unimed passou a aceitar **somente 04.03.00 a partir de 01/07/2026** **[terceiros: Unimed Planalto Médio, Informativo TISS nº 04/2026, de 19/05/2026]**. O informativo cita o Ofício-Circular nº 6/2025/COEST/GPIND/DIRAD-DIDES/DIDES, que não localizei no gov.br.
- **Formato do campo `Padrao` no XML:** `4.03.00`, **sem zero à esquerda**. O valor `04.03.00` foi testado e **é rejeitado** pelo XSD (falha na restrição de enumeração). A tabela TUSS 69 usa `04.03.00` só como rótulo.

### 1.3 Links oficiais
- Página do Padrão TISS: https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss (atualizada em 30/09/2026)
- Padrão TISS – Setembro/2026: https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/padrao-tiss-setembro-2026
- **Pacote de schemas XSD/WSDL (Componente de Comunicação 04.03.00 + 01.06.00):** https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/PadroTISSComunicao_202511.zip
  - Tamanho: cerca de 100 KB. MD5 do zip baixado em 07/11/2026: `ceb5433fb8342add5c53071559ac0d28`.
  - Pasta `040300/`: `tissV4_03_00.xsd` (raiz `mensagemTISS`), `tissSimpleTypesV4_03_00.xsd`, `tissComplexTypesV4_03_00.xsd`, `tissGuiasV4_03_00.xsd`, `tissWebServicesV4_03_00.xsd`, `xmldsig-core-schema.xsd`, `tissAssinaturaDigital_v1.01.xsd` e 11 WSDLs (por exemplo `tissLoteGuiasV4_03_00.wsdl`, `tissSolicitacaoDemonstrativoRetornoV4_03_00.wsdl`, `tissRecursoGlosaV4_03_00.wsdl`).
- Componente Organizacional 202609 (PDF): https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/PadroTISS_ComponenteOrganizacional_202609.pdf
- Componente de Conteúdo e Estrutura 202511 (zip com PDF + XLSX; cerca de 8,5 MB): https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/PadroTISS_ComponentedeContedoeEstrutura_202511.zip
- Componente de Representação de Conceitos (TUSS) 202609 (zip com mais de 10 MB; não baixei, usei a API): https://www.ans.gov.br/arquivos/extras/tiss/Padrao_TISS_Representacao_de_Conceitos_em_Saude_202609.zip
- Componente de Segurança e Privacidade 202511: https://www.gov.br/ans/pt-br/arquivos/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-tiss/padrao-tiss/PadroTISS_segurana_202511.zip
- Histórico de versões: https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/padrao-tiss-historico-das-versoes-dos-componentes-do-padrao-tiss
- Códigos da TUSS (página publicada em 09/07/2026 e atualizada em 15/07/2026): https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/codigos-da-tuss
  - Ela aponta para a consulta OCL (https://consulta-ocl.apps.sa-1a.mendixcloud.com/p/ocl) e para a API REST JSON (`/rest/oclservice/ANS/source` e `/rest/oclservice/ANS/concepts/tuss-NN?page=N&q=...`). A API serve para sincronizar a TUSS no Cortex.

---

## 2. XML de envio de lote de guias (`ENVIO_LOTE_GUIAS`)

### 2.1 Estrutura
Fonte: `tissV4_03_00.xsd` **[confirmado]**.
- Namespace: `http://www.ans.gov.br/padroes/tiss/schemas`. Com `elementFormDefault="qualified"`, **todos os elementos levam o prefixo** (por convenção, `ans:`).
- Os XSDs declaram `encoding="ISO-8859-1"`.

```
ans:mensagemTISS
├─ ans:cabecalho                       (ct cabecalhoTransacao)
│  ├─ ans:identificacaoTransacao
│  │  ├─ ans:tipoTransacao             dm_tipoTransacao  → "ENVIO_LOTE_GUIAS"
│  │  ├─ ans:sequencialTransacao       st_texto12 (1..12 caracteres)
│  │  ├─ ans:dataRegistroTransacao     xs:date  (AAAA-MM-DD)
│  │  └─ ans:horaRegistroTransacao     xs:time  (HH:MM:SS)
│  ├─ ans:falhaNegocio                 0..1 (tabela 38; usado no retorno da operadora)
│  ├─ ans:origem                       choice:
│  │  ├─ ans:identificacaoPrestador    choice: ans:CNPJ | ans:CPF | ans:codigoPrestadorNaOperadora (texto14)
│  │  └─ ans:registroANS               (só nas mensagens da operadora)
│  ├─ ans:destino                      choice:
│  │  ├─ ans:identificacaoPrestador    (só nas mensagens da operadora)
│  │  └─ ans:registroANS               st_registroANS = [0-9]{6}  ← prestador→operadora
│  ├─ ans:Padrao                       dm_versao → "4.03.00"
│  └─ ans:loginSenhaPrestador          0..1 (loginPrestador texto20, senhaPrestador texto32) — só webservice
├─ choice:
│  ├─ ans:operadoraParaPrestador
│  └─ ans:prestadorParaOperadora
│     └─ ans:loteGuias                 (ctm_guiaLote)
│        ├─ ans:numeroLote             st_texto12
│        └─ ans:guiasTISS              choice (UM tipo por lote), cada um maxOccurs=100:
│           guiaSP-SADT | guiaResumoInternacao | guiaHonorarios | guiaConsulta | guiaOdonto
├─ ans:epilogo
│  └─ ans:hash                         xs:string
└─ ds:Signature                        0..1 (XMLDSig, assinatura digital opcional)
```

Regras de negócio:
- O Componente de Conteúdo e Estrutura (págs. 11–12) diz, para a origem, que o "Código do contratado executante na operadora" é **obrigatório**.
  - O XSD aceita CNPJ, CPF ou código na operadora. Use o que o contrato com cada operadora definir; em geral, o código do prestador na operadora.
  - Login e senha são "Condicionado": só quando o webservice é consumido sem certificado digital.
- Componente Organizacional §147: a senha no cabeçalho "deverá ser informada obrigatoriamente na forma de hash MD5".
- Componente Organizacional §209 (pág. 59): "A mensagem LoteGuias deve ter, no máximo, 100 guias em cada lote, sendo todas as guias do mesmo tipo." O XSD reforça a regra com `choice` + `maxOccurs=100`.
- `st_CNPJ` = `[A-Z0-9]{12}[0-9]{2}`, já preparado para o **CNPJ alfanumérico**. Componente Organizacional §314: tem eficácia a partir de 01/07/2026. O Cortex deve armazenar CNPJ como texto, não como número.

### 2.2 Regra oficial do hash
Fonte: Componente Organizacional 202609, seção "HASH MD-5", §148, págs. 48–49 **[confirmado]**. Trechos literais:

> "No Padrão TISS o cálculo do hash deve considerar apenas a concatenação do conteúdo das tags desprezando as tags XML propriamente ditas."

> "…sem qualquer inserção, supressão, modificação ou ajuste, respeitando maiúsculas e minúsculas, pontuação, acentuação e caracteres especiais, mesmo invisíveis que eventualmente existam (CR,LF,tabs etc). O encoding a ser utilizado será sempre o ISO-8859-1."

> "O hash de uma transação deve conter, em hexadecimal, a representação MD5 dos valores contidos na transação, justapostos, lidos da esquerda para a direita. Não devem ser incluídos no cálculo os nomes dos elementos ou dos atributos da transação."

Algoritmo de implementação, com a interpretação usada no mercado:
1. Montar o XML completo, com `<ans:hash>` vazio.
2. Percorrer em ordem de documento todos os **elementos-folha** de `ans:cabecalho` e `ans:prestadorParaOperadora` (ou seja, tudo exceto `ans:epilogo` e `ds:Signature`) e concatenar o **texto** de cada um, literalmente.
3. Codificar a string em **ISO-8859-1** e calcular o **MD5**.
4. Escrever o resultado em hexadecimal (32 caracteres) em `ans:hash`.
5. Serializar o arquivo em ISO-8859-1, com `<?xml version="1.0" encoding="ISO-8859-1"?>`.

Pontos de atenção:
- **Espaços entre tags:** a regra não trata explicitamente a indentação. Recomendação: **gerar o XML sem indentação nem quebras entre tags**, para que as duas leituras deem o mesmo resultado.
- **Caixa do hex:** não especificada pela ANS (**não confirmado**). Uma biblioteca de terceiros usa minúsculas.
- **Divergência ISO-8859-1 × UTF-8:**
  - A biblioteca Rust `tiss-hash` (https://docs.rs/crate/tiss-hash/0.1.0/source/README.md) diz ter validado contra arquivos reais que o MD5 é calculado sobre os bytes **UTF-8**, contrariando o texto da ANS **[terceiros]**.
  - Coerente com isso, a Amplimed oferece por convênio uma opção para "alterar o hash" **[terceiros]**.
  - Sem acentos o resultado é idêntico. Com acentos diverge. No exemplo SP/SADT abaixo, "cérvice" gera `7d702e04…` em ISO-8859-1 e `33c48f31…` em UTF-8.
  - **Decisão para o MVP:** usar ISO-8859-1 (regra oficial), deixar a codificação do hash como **configuração por operadora** (padrão ISO-8859-1) e testar no validador do portal de cada operadora antes do primeiro envio real.
- **Erro de hash:** o arquivo é rejeitado pela operadora (prática geral). O §240 do Componente Organizacional trata disso, mas no contexto do envio operadora→ANS.

### 2.3 Exemplo mínimo validado: lote com 1 guia de consulta (dados fictícios)
Validado contra o XSD 4.03.00 com 0 erros. Hash ISO-8859-1 = `0fce16173a551ed979ad09b71f710627`; como não há acentos, é igual ao UTF-8. Indentado aqui só para leitura; o hash foi calculado sobre os valores das folhas.

```xml
<?xml version="1.0" encoding="ISO-8859-1"?>
<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">
  <ans:cabecalho>
    <ans:identificacaoTransacao>
      <ans:tipoTransacao>ENVIO_LOTE_GUIAS</ans:tipoTransacao>
      <ans:sequencialTransacao>1</ans:sequencialTransacao>
      <ans:dataRegistroTransacao>2026-11-07</ans:dataRegistroTransacao>
      <ans:horaRegistroTransacao>10:30:00</ans:horaRegistroTransacao>
    </ans:identificacaoTransacao>
    <ans:origem><ans:identificacaoPrestador><ans:codigoPrestadorNaOperadora>123456</ans:codigoPrestadorNaOperadora></ans:identificacaoPrestador></ans:origem>
    <ans:destino><ans:registroANS>999999</ans:registroANS></ans:destino>
    <ans:Padrao>4.03.00</ans:Padrao>
  </ans:cabecalho>
  <ans:prestadorParaOperadora>
    <ans:loteGuias>
      <ans:numeroLote>1</ans:numeroLote>
      <ans:guiasTISS>
        <ans:guiaConsulta>
          <ans:cabecalhoConsulta>
            <ans:registroANS>999999</ans:registroANS>
            <ans:numeroGuiaPrestador>1</ans:numeroGuiaPrestador>
          </ans:cabecalhoConsulta>
          <ans:dadosBeneficiario>
            <ans:numeroCarteira>00000000000000000</ans:numeroCarteira>
            <ans:atendimentoRN>N</ans:atendimentoRN>
          </ans:dadosBeneficiario>
          <ans:contratadoExecutante>
            <ans:codigoPrestadorNaOperadora>123456</ans:codigoPrestadorNaOperadora>
            <ans:CNES>9999999</ans:CNES>
          </ans:contratadoExecutante>
          <ans:profissionalExecutante>
            <ans:nomeProfissional>MEDICA FICTICIA</ans:nomeProfissional>
            <ans:conselhoProfissional>06</ans:conselhoProfissional>
            <ans:numeroConselhoProfissional>00000</ans:numeroConselhoProfissional>
            <ans:UF>41</ans:UF>
            <ans:CBOS>225250</ans:CBOS>
          </ans:profissionalExecutante>
          <ans:indicacaoAcidente>9</ans:indicacaoAcidente>
          <ans:dadosAtendimento>
            <ans:regimeAtendimento>01</ans:regimeAtendimento>
            <ans:dataAtendimento>2026-11-06</ans:dataAtendimento>
            <ans:tipoConsulta>1</ans:tipoConsulta>
            <ans:procedimento>
              <ans:codigoTabela>22</ans:codigoTabela>
              <ans:codigoProcedimento>10101012</ans:codigoProcedimento>
              <ans:valorProcedimento>150.00</ans:valorProcedimento>
            </ans:procedimento>
          </ans:dadosAtendimento>
        </ans:guiaConsulta>
      </ans:guiasTISS>
    </ans:loteGuias>
  </ans:prestadorParaOperadora>
  <ans:epilogo><ans:hash>0fce16173a551ed979ad09b71f710627</ans:hash></ans:epilogo>
</ans:mensagemTISS>
```

String concatenada que entra no MD5:
```
ENVIO_LOTE_GUIAS12026-11-0710:30:001234569999994.03.001999999100000000000000000N1234569999999MEDICA FICTICIA0600000412252509012026-11-0612210101012150.00
```

Também validei com 0 erros um lote com 1 guia SP/SADT: colposcopia `41301102`, `tipoAtendimento 23`, com senha e autorização. Os arquivos ficaram fora do repositório, em `C:\Users\ricab\AppData\Local\Temp\claude\d4520a39c0665682\35fea62a-e266-4fae-a0a9-59f2f21bd18a\scratchpad\tiss-scripts\`. Recomendo transformar os dois em fixtures de teste quando a implementação começar.

---

## 3. Campos das guias na versão 4.03.00

Notação: **O** = obrigatório; **C** = condicionado; **Op** = opcional. A obrigatoriedade vem do XSD (`minOccurs`) e a condição de preenchimento vem do Componente de Conteúdo e Estrutura 202511, "Mensagem: Envio de lote de guias para cobrança", págs. 179–204 **[confirmado]**.

### 3.1 Guia de Consulta (`ans:guiaConsulta`, tipo `ctm_consultaGuia`)
Uso, segundo o Componente Organizacional:
- §62.1: só para "Cobrança de consultas eletivas".
- §98: "devem ser utilizados apenas os códigos referentes a consultas eletivas". Consulta com exame ou procedimento vai em SP/SADT (§62.6).

| Ordem | Elemento XML | Tipo/tamanho | Card. | Regra |
|---|---|---|---|---|
| 1 | `cabecalhoConsulta/registroANS` | `[0-9]{6}` | O | Registro ANS da operadora |
| 2 | `cabecalhoConsulta/numeroGuiaPrestador` | texto 1–20 | O | Número da guia no prestador, único por operadora |
| 3 | `numeroGuiaOperadora` | texto 20 | C | Quando a operadora atribui outro número |
| 4 | `ausenciaCodValidacao` | tab. 74 (01–07) | C | Quando operadora e prestador usam código de validação e ele não pôde ser obtido |
| 5 | `codValidacao` | texto 10 | Op | Código ou token de presença do beneficiário |
| 6 | `dadosBeneficiario/numeroCarteira` | texto 20 | O | |
| 7 | `dadosBeneficiario/atendimentoRN` | `S`/`N` | O | `S` só quando o atendimento é do recém-nato no contrato do responsável |
| 8 | `dadosBeneficiario/tipoIdent` | tab. 72 (01–09) | C | Se `identificadorBeneficiario` for informado |
| 9 | `dadosBeneficiario/identificadorBeneficiario` | base64 | Op | |
| 10 | `contratadoExecutante/(codigoPrestadorNaOperadora \| cpfContratado \| cnpjContratado)` | texto 14 / 11 dígitos / CNPJ | O (escolher 1) | |
| 11 | `contratadoExecutante/CNES` | texto 7 | O | Sem CNES, usar `9999999` |
| 12 | `profissionalExecutante/nomeProfissional` | texto 70 | C | Obrigatório quando o contratado é PJ (caso da clínica) |
| 13 | `profissionalExecutante/conselhoProfissional` | tab. 26 | O | CRM = `06` |
| 14 | `profissionalExecutante/numeroConselhoProfissional` | texto 15 | O | |
| 15 | `profissionalExecutante/UF` | tab. 59 (código IBGE) | O | PR = `41` (não "PR") |
| 16 | `profissionalExecutante/CBOS` | tab. 24 | O | GO = `225250`; urologia = `225285` |
| 17 | `indicacaoAcidente` | tab. 36 | O | Não acidente = `9` |
| 18 | `dadosAtendimento/coberturaEspecial` | tab. 75 | C | Plano só hospitalar, gestante, pré ou pós-operatório |
| 19 | `dadosAtendimento/regimeAtendimento` | tab. 76 | O | Ambulatorial = `01`; telessaúde = `05` |
| 20 | `dadosAtendimento/saudeOcupacional` | tab. 77 | Op | |
| 21 | `dadosAtendimento/dataAtendimento` | xs:date | O | |
| 22 | `dadosAtendimento/tipoConsulta` | tab. 52 | O | 1 primeira, 2 retorno, 3 pré-natal, 4 por encaminhamento |
| 23 | `dadosAtendimento/procedimento/codigoTabela` | tab. 87, subconjunto `dm_tabela` | O | TUSS procedimentos = `22` |
| 24 | `dadosAtendimento/procedimento/codigoProcedimento` | texto 10 | O | `10101012` |
| 25 | `dadosAtendimento/procedimento/valorProcedimento` | decimal(10,2), ponto decimal | O | `0` se o contrato não permite definir o valor previamente |
| 26 | `observacao` | texto 500 | Op | |
| 27 | `assinaturaDigitalGuia` | XMLDSig | Op | |

O que **não** existe na guia de consulta 4.x:
- `caraterAtendimento` e `tipoAtendimento`: esses campos são da SP/SADT.
- Nome do beneficiário, CNS e nome do contratado foram **retirados na 4.00.00**. O XSD (`ct_beneficiarioDados`) mantém o comentário "retirados na versão 4.00.00" sobre `nomeBeneficiario`, `numeroCNS` e `templateBiometrico`, e `ct_contratadoDados` tem o mesmo comentário sobre `nomeContratado`. Teste: incluir `nomeBeneficiario` faz a validação falhar.
- `nomeSocialBeneficiario`: no XSD, só aparece em respostas da operadora (`ct_elegibilidadeRecibo`, `ctm_autorizacaoServico` e outras) e não nas guias de cobrança.

**Guia em papel / impressão (contingência):** no formulário da Guia de Consulta (Conteúdo e Estrutura), o campo 7 "Nome" é **obrigatório** e o campo 26 "Nome social" é **condicionado**. Também existem "Nome do contratado" (campo 10, obrigatório) e "Validade da carteira" (campo 5, só na contingência).
- Consequência para o Cortex: o PDF impresso da guia precisa do nome; o XML não leva o nome.

### 3.2 Guia SP/SADT (`ans:guiaSP-SADT`, tipo `ctm_sp-sadtGuia`)
Uso, segundo o Componente Organizacional §62.3–62.8: autorização e cobrança de exames e procedimentos em paciente não internado, e de consultas **com** procedimento.

| Bloco / elemento | Card. | Regra |
|---|---|---|
| `cabecalhoGuia/registroANS`, `cabecalhoGuia/numeroGuiaPrestador` | O | |
| `cabecalhoGuia/guiaPrincipal` | C | SADT de internado ou honorário separado |
| `dadosAutorizacao` (bloco inteiro) | 0..1 | Quando há autorização da operadora |
| ↳ `numeroGuiaOperadora` | C | Se a operadora atribuir |
| ↳ `dataAutorizacao` | O dentro do bloco | |
| ↳ `senha` | C | Autorização com senha |
| ↳ `dataValidadeSenha` | C | Senha com validade |
| ↳ `ausenciaCodValidacao` (tab. 74), `codValidacao` | C / Op | |
| `dadosBeneficiario` | O | Igual à guia de consulta; sem nome |
| `dadosSolicitante/contratadoSolicitante` | O | Código, CPF ou CNPJ; se o solicitante não informar, usar `99999999999999`, exceto quando solicitante = executante |
| `dadosSolicitante/nomeContratadoSolicitante` | **O** (texto 70) | Aqui o nome continua existindo |
| `dadosSolicitante/profissionalSolicitante` | O | `nomeProfissional` C, `conselhoProfissional` O, `numeroConselhoProfissional` O, `UF` O, `CBOS` O |
| `dadosSolicitacao/dataSolicitacao` | C | Em caso de autorização |
| `dadosSolicitacao/caraterAtendimento` | **O** | Tab. 23: `1` eletivo, `2` urgência/emergência |
| `dadosSolicitacao/indicacaoClinica` | C | Pequena cirurgia, terapia, alta complexidade, procedimentos com DUT |
| `dadosSolicitacao/indCobEspecial` | C | Tab. 75 |
| `dadosExecutante/contratadoExecutante` + `dadosExecutante/CNES` | O | CNES `9999999` se não houver |
| `dadosAtendimento/tipoAtendimento` | **O** | Tab. 50 |
| `dadosAtendimento/indicacaoAcidente` | **O** | Tab. 36 |
| `dadosAtendimento/tipoConsulta` | C | Obrigatório se `tipoAtendimento` = `04` (Consulta) |
| `dadosAtendimento/motivoEncerramento` | C | Óbito, tab. 39 |
| `dadosAtendimento/regimeAtendimento` | **O** | Tab. 76 |
| `dadosAtendimento/saudeOcupacional` | Op | |
| `procedimentosExecutados/procedimentoExecutado` (1..n) | C | Sempre que houver procedimento realizado |
| ↳ `sequencialItem` | | Não pode repetir na guia, incluindo outras despesas |
| ↳ `dataExecucao` | | |
| ↳ `horaInicial`, `horaFinal` | C | Urgência |
| ↳ `procedimento` (`codigoTabela`, `codigoProcedimento`, `descricaoProcedimento` texto 150) | | |
| ↳ `quantidadeExecutada` | | |
| ↳ `viaAcesso` (tab. 61), `tecnicaUtilizada` (tab. 48) | C | Cirúrgico |
| ↳ `reducaoAcrescimo` (decimal 3,2) | O no item | `1.00` quando não há redução nem acréscimo |
| ↳ `valorUnitario`, `valorTotal` | O no item | |
| ↳ `equipeSadt` (0..n) | C | `grauPart` tab. 35, `codProfissional`, `nomeProf`, `conselho`, `numeroConselhoProfissional`, `UF`, `CBOS` |
| `outrasDespesas` | 0..1 | Materiais, medicamentos, taxas: tabelas 18, 19, 20 + código de despesa (tab. 25) |
| `observacao` | Op | |
| `valorTotal/valorTotalGeral` | **O** | Os demais subtotais (`valorProcedimentos`, `valorDiarias`, `valorTaxasAlugueis`, `valorMateriais`, `valorMedicamentos`, `valorOPME`, `valorGasesMedicinais`) são 0..1 |

### 3.3 Domínios TUSS confirmados
Fonte: API OCL da ANS (`/concepts/tuss-NN`) e enumerados do XSD 4.03.00 **[confirmado]**.

**Tabela 87 — "Tabelas de domínio" (índice das terminologias):**
- Números das tabelas confirmados:

  | Nº | Terminologia |
  |---|---|
  | 18 | Diárias, taxas e gases medicinais |
  | 19 | Materiais e OPME |
  | 20 | Medicamentos |
  | 22 | Procedimentos e eventos em saúde |
  | 23 | Caráter do atendimento |
  | 24 | CBO |
  | 25 | Código da despesa |
  | 26 | Conselho profissional |
  | 35 | Grau de participação |
  | 36 | Indicador de acidente |
  | 38 | Mensagens (glosas, negativas e outras) |
  | 39 | Motivo de encerramento |
  | 47 | Status da guia e do protocolo |
  | 48 | Técnica utilizada |
  | 50 | Tipo de atendimento |
  | 52 | Tipo de consulta |
  | 53 | Tipo de demonstrativo |
  | 59 | Unidade da federação |
  | 61 | Via de acesso |
  | 69 | Versão do componente de comunicação |
  | 72 | Tipo de identificação do beneficiário |
  | 74 | Motivos de ausência do código de validação |
  | 75 | Cobertura especial |
  | 76 | Regime de atendimento |
  | 77 | Saúde ocupacional |
  | 00 | Tabela própria das operadoras |
  | 90 | Tabela própria pacote odontológico |
  | 98 | Tabela própria de pacotes |

- **Valores aceitos no campo `codigoTabela`** (`dm_tabela`): `18`, `19`, `20`, `22`, `90`, `98`, `00`.

| Domínio | Valores (código = termo) |
|---|---|
| **22 Procedimentos** (consultas) | `10101012` = Consulta em consultório (no horário normal ou preestabelecido), vigência desde 2009-02-13 · `10101020` = Consulta em domicílio · `10101039` = Consulta em pronto socorro |
| **22 Procedimentos** (GO e uro de consultório; exemplos para SP/SADT) | `41301102` Colposcopia (cérvice uterina e vagina) · `40901300` US transvaginal (útero, ovário, anexos e vagina) · `31303269` DIU não hormonal – inserção · `31303293` DIU hormonal – inserção · `31303382` / `31303374` remoção de DIU não hormonal / hormonal · `40201066` Cistoscopia e/ou uretroscopia |
| **23 Caráter do atendimento** | `1` Eletivo · `2` Urgência/Emergência |
| **24 CBO** | `225250` Médico ginecologista e obstetra · `225285` Médico urologista · `225125` Médico clínico · `999999` CBO-S desconhecido ou não informado pelo solicitante (só no XSD) |
| **26 Conselho profissional** | `01` CRESS · `02` COREN · `03` CRF · `04` CREFONO · `05` CREFITO · **`06` CRM** · `07` CRN · `08` CRO · `09` CRP · `10` Outros · `11` CRBio · `12` CRBM · `13` CREF · `14` CRMV · `15` CRTR |
| **36 Indicador de acidente** | `0` Trabalho · `1` Trânsito · `2` Outros · **`9` Não acidente** |
| **50 Tipo de atendimento** (SP/SADT) | `01` Remoção · `02` Pequena cirurgia · `03` Outras terapias · `04` Consulta · `08` Quimioterapia · `09` Radioterapia · `10` TRS · `13` Pequeno atendimento (sutura, gesso e outros) · **`23` Exame** (desde 2021-12-01). O código `05` Exames foi inativado; o XSD não aceita `05` |
| **52 Tipo de consulta** | `1` Primeira consulta · `2` Retorno (o XSD comenta "Seguimento") · `3` Pré-natal · `4` Por encaminhamento |
| **59 UF** | Código IBGE de 2 dígitos: **`41` Paraná**; `98` Países estrangeiros |
| **75 Cobertura especial** | `01` Gestante · `02` Pré-operatório · `03` Pós-operatório |
| **76 Regime de atendimento** | **`01` Ambulatorial** · `02` Domiciliar · `03` Internação · `04` Pronto-socorro · `05` Telessaúde |
| **72 Tipo de identificação do beneficiário** | `01` Tarja magnética · `02` Código de barras · `03` Cartão físico · `04` QR code · `05` Digital · `06` Facial · `07` Íris · `08` Geometria da mão · `09` Cartão virtual (fonte: XSD) |
| **74 Ausência do código de validação** | `01` Internado · `02` Urgência/emergência · `03` Instabilidade de sistemas · `04` Beneficiário se negou a transmitir o token · `05` Coleta domiciliar · `06` Material enviado por terceiros · `07` Não possui celular (fonte: XSD) |
| **35 Grau de participação** | `00` Cirurgião · `01`–`04` Auxiliares · `05` Instrumentador · `06` Anestesista · … · `12` Clínico · `13` Intensivista (fonte: XSD) |
| **Tipo de demonstrativo** (`dm_tipoDemonstrativo`) | `1` Pagamento · `2` Análise da conta médica · `3` Pagamento odontologia (fonte: XSD) |

**Preenchimento típico de uma consulta eletiva** (Unimed, Amil etc.):
```
codigoTabela=22  codigoProcedimento=10101012  conselhoProfissional=06  UF=41
CBOS=225250 (GO) | 225285 (uro)  indicacaoAcidente=9  regimeAtendimento=01
tipoConsulta=1|2|3|4  atendimentoRN=N
```
Pré-natal: `tipoConsulta=3`. Avaliar também `coberturaEspecial=01` (gestante) quando o plano for só hospitalar; regra da operadora **não confirmada**.

**Não confirmado:**
- Código TUSS específico de teleconsulta. Na 4.x, a telessaúde é sinalizada por `regimeAtendimento=05`; se o código de procedimento continua `10101012`, depende da operadora.
- Valores de tabela própria (`00`) de cada operadora.

---

## 4. Como funciona na prática e o que entra no MVP

### 4.1 Mensagens TISS relevantes
O Componente Organizacional §33 lista os processos de **implantação obrigatória** entre operadora e prestador:
- Cobrança de serviços de saúde.
- Autorização de serviços (somente a mensagem de lote de anexos).
- Comunicação de internação ou alta do beneficiário.
- **Demonstrativos de retorno.**
- **Recurso de glosas.**

São de implantação **opcional** (§34) a verificação de elegibilidade, a autorização de procedimentos e o envio de documentos.

| Mensagem (`tipoTransacao`) | Direção | No MVP? |
|---|---|---|
| `ENVIO_LOTE_GUIAS` (loteGuias: consulta, SP/SADT) | Prestador → operadora | **Sim**: gerar XML válido + hash, para download e upload no portal |
| `PROTOCOLO_RECEBIMENTO` (recebimentoLote → protocoloRecebimento: número do lote, data de envio, detalhe do protocolo) | Operadora → prestador | **Sim, manual**: registrar número do protocolo e data |
| `SOLIC_DEMONSTRATIVO_RETORNO` / `DEMONSTRATIVO_ANALISE_CONTA` / `DEMONSTRATIVO_PAGAMENTO` | Ida e volta | **Fase 1 manual** (lançar pago/glosado por guia e item com código da tabela 38). **Fase 2:** importar XML de demonstrativo (até 30 `demonstrativoAnaliseConta` por mensagem) |
| `RECURSO_GLOSA` / `RECEBIMENTO_RECURSO_GLOSA` / `RESPOSTA_RECURSO_GLOSA` | Ida e volta | **Fase 1:** controle de prazo e justificativa, com o recurso feito no portal. **Fase 2:** XML de recurso (§211: no máximo 1 guia por lote de recurso) |
| `CANCELA_GUIA` / `CANCELAMENTO_GUIA_RECIBO` | Ida e volta | Fora do MVP |
| `VERIFICA_ELEGIBILIDADE`, `SOLICITACAO_PROCEDIMENTOS`, `SOLICITA_STATUS_AUTORIZACAO` | Ida e volta | Fora do MVP: a autorização é feita no autorizador próprio de cada operadora; o Cortex só **registra** senha, validade, número da guia na operadora e token |
| Webservices SOAP (`tissLoteGuiasV4_03_00.wsdl`: operação `tissLoteGuias_Operation`, document/literal, `soapAction=""`) | — | Fase 3: exige credenciais e homologação por operadora |

### 4.2 Operadoras em Curitiba
Fontes públicas das operadoras **[terceiros]**, com pesquisa de apoio feita em 07/11/2026.

| Operadora | Envio do faturamento | Autorização | Prazos e observações | Fonte |
|---|---|---|---|---|
| Unimed Curitiba | Cobrança eletrônica TISS no portal do prestador (Portal TISS / SCE; o SCE é gratuito para quem não gera XML). Upload de XML provável, sem citação literal. Webservice não encontrado | Autorizador Web próprio; consulta eletiva normalmente passa por ele | 30 dias do atendimento; cronograma mensal; reapresentação até 30 dias após a glosa. Manual de 2019, antigo | https://www.unimedcuritiba.com.br/sites/default/files/public/2023-04/manual-do-prestador-07a-edicao-outubro-2019.pdf |
| Unimed (sistema) | WebC Prestador | — | Só 04.03.00 desde 01/07/2026 | https://www.unimed.coop.br/site/web/planaltomedio/informativo-tiss-n-04-2026 |
| Amil | Portal do Credenciado: digitação, upload de XML (TISS → Importação de arquivos XML) ou webservice | SP/SADT exige senha; glosas 894/896 para senha ou token inválido | Guia corrigida em até 90 dias do atendimento | https://credenciado.amil.com.br/gerdoc/1573156786263manual_faturamento_eletronico_amil_v3_(1).pdf |
| SulAmérica | Saúde Online, webservice ou **Orizon** (upload de XML) | — | Recurso de glosa eletrônico. Manual de 2020/2021 | https://saude.sulamericaseguros.com.br/prestador/informativos/manual_referenciado_TISS_2021.pdf |
| Paraná Clínicas | Portal **SAUDI** (Serviços → Guias XML), com protocolo eletrônico. Sem guia física | Até a consulta exige liberação | Entrega até o dia 20, atendimentos de até 60 dias, NF em até 2 dias úteis (cronograma 2026) | https://www.paranaclinicas.com.br/wp-content/uploads/2026/03/Rede-Credenciada-Comunicado-Geral-Cronograma-de-Faturamento.pdf |
| CASSI | Orizon "Fature" (XML), digitação ou webservice | Orizon "Autorize" | Recurso de glosa online | https://servicosonline.cassi.com.br/Prestador/ImpressaoGuia/Content/manual/ManualdePreenchimentodeGuiasTISS.pdf |
| Fundação Copel | Portal Tasy: digitação ou **XML compactado em .ZIP** + protocolo impresso junto com a fatura | Consulta eletiva também requisitada | Recurso em até 30 dias do pagamento (manual de 2024) | https://prestador.fcopel.org.br/wp-content/uploads/2024/11/Manual-Liberacao-e-Faturamento-Validado.pdf |
| Bradesco Saúde | Portal "Referenciado Saúde", com login | Não encontrado | Não encontrado | https://www.bradescoseguros.com.br/clientes/produtos/plano-saude/servicos/seja-um-referenciado |

Conclusão prática:
- O denominador comum é **XML TISS 4.03.00 válido, com hash correto, enviado por upload no portal de cada operadora**.
- Variações que precisam ser configuração por operadora:
  - versão aceita;
  - .ZIP;
  - prazo de envio e dia de corte;
  - prazo de recurso;
  - limite de guias por lote (máximo 100);
  - codificação do hash.
- A autorização prévia acontece fora do Cortex.

### 4.3 Concorrentes
Fontes: sites e centrais de ajuda dos fornecedores **[terceiros]**.

| Recurso | iClinic | Feegow | Amplimed | Ninsaúde | ProDoctor |
|---|---|---|---|---|---|
| Guia de consulta e SP/SADT | Sim | Sim (+ honorários e internação) | Sim (+ honorários e internação) | Sim (+ honorários) | Sim (+ internação e outras despesas) |
| Lote XML | Sim, até 100; baixa e envia | Sim, até 100; validação de XML | Sim; limite configurável; "alterar hash" | Sim; validador TISS embutido | Sim |
| Versão TISS anunciada | Ajuda cita 3.03.03 (desatualizada) | 04.01.00 | Configurável, número não confirmado | "4.1" | 04.02.00 |
| Webservice para envio do lote | Não confirmado | Não confirmado | Parcial (Unimed) | Não confirmado | Não confirmado |
| Autorização online | Não confirmado | Add-on pago, mais de 80 convênios | Sim (SP/SADT, Unimed) | Não confirmado | Não confirmado |
| Importa retorno/demonstrativo | Não confirmado | **Sim** ("Baixa de retorno (TISS)") | Não confirmado | Não confirmado | Não confirmado |
| Glosa | Parcial | Sim; "Gestão de Glosas" no plano Plus | Status + pagamento da glosa | Parcial | Controle manual + histórico |
| Tabela de preço por convênio | Sim | Sim | Sim (por plano) | Sim + tabelas próprias | TUSS/AMB/CBHPM |
| Contas a pagar e receber + caixa | Sim | Sim + DRE + caixa diário | Sim | Sim + DRE | Sim |
| Repasse médico | Sim (regras) | Sim + split Stone | Sim + split Zoop | Sim (comissão) | Sim |
| NFS-e | Não confirmado | Sim (plano VIP) | Sim | Sim (parceiro) | Não confirmado |
| Preço público | R$ 169 por profissional/mês (Pro: TISS + financeiro + repasse) | R$ 129 / 199 / 249 por profissional/mês | Clínica: sob consulta | R$ 199 para 1 agenda | "+Clínica" a partir de R$ 215 |

URLs principais:
- https://iclinic.com.br/precos/
- https://suporte.iclinic.com.br/pt-br/elaboracao-de-guia-de-consulta-tiss
- https://feegowclinic.com.br/precos-e-planos
- https://ajuda.feegow.com/support/solutions/articles/67000715357
- https://ajuda.feegow.com/support/solutions/articles/67000652344
- https://conhecimento.amplimed.com.br/configurando-tiss-no-conv%C3%AAnio-troca-de-informa%C3%A7%C3%B5es-outras-configura%C3%A7%C3%B5es
- https://www.ninsaude.com/pt-br/faturamento-de-convenios-software-clinica/
- https://prodoctor.net/funcionalidades/faturamento
- https://prodoctor.net/blog/atualizacao-compilacao-100-101/
- https://prodoctor.net/precos

Também vistos:
- **Shosp:** TISS, glosas, autorização por webservice, NFS-e; R$ 149–229 por prestador/mês. https://www.shosp.com.br/precos
- **Clínica nas Nuvens:** lote baixado e protocolado no portal, recurso de glosa, NFS-e; R$ 49,50 por profissional/mês, mínimo de 3. https://clinicanasnuvens.com.br/planos-e-precos

**Leitura do mercado:** nenhum concorrente documenta publicamente envio genérico do lote por webservice; o padrão é exportar o XML e o usuário subir no portal. Os diferenciais visíveis são:
- importação do retorno e conciliação de glosa (Feegow);
- autorizador online (add-on pago);
- NFS-e integrada (planos mais caros).

---

## 5. Convênios declarados pela Clínica Haddad Nicola
Somente informação pública institucional.

- **Site (http):** http://haddadnicola.com.br/convenios/
  - O HTTPS está com certificado inválido.
  - A página mostra só logotipos. Pelo nome dos arquivos de imagem: **Unimed**, **Amil**, **Copel** (provavelmente Fundação Copel), **Itaú** (provavelmente Itaú Saúde, não confirmado), **Sanepar** (provavelmente Fusan/Sanesaúde), **SINAM** (operadora não identificada), **SulAmérica** e **Judicimed**.
- **A lista provavelmente está desatualizada:** pela API do WordPress, a página foi criada em 18/09/2017 e alterada pela última vez em 05/06/2019. http://haddadnicola.com.br/wp-json/wp/v2/pages?slug=convenios
- **Não aparecem:** Bradesco, Cassi, Paraná Clínicas, Clinipam e MedSênior.
- **Doctoralia:** o perfil "Haddad E Nicola" não lista planos. https://www.doctoralia.com.br/clinicas/haddad-e-nicola
- **Ação:** confirmar com a faturista da clínica a lista atual, o volume por operadora, o código de prestador em cada uma e o CNES, antes de priorizar a configuração por operadora.

---

## 6. NFS-e: integrar ou deixar fora do MVP?

- **Padrão nacional:** a LC 214/2025, art. 62, §1º, obriga municípios e DF a autorizarem a NFS-e no padrão nacional "a partir de 1º de janeiro de 2026". https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm
- **Curitiba já migrou para o Emissor Nacional** [oficial]. https://lp.curitiba.pr.gov.br/notanacional
  - Datas por regime:
    - MEI: desde 2023;
    - sociedades uniprofissionais no ISS Fixo: 01/10/2025;
    - Simples Nacional: 01/11/2025;
    - demais contribuintes: 01/01/2026.
  - Para emissão em lote, a página indica integração via API do padrão nacional.
  - Detalhes técnicos da API **[terceiros]**: DPS assinada, mTLS e certificado A1.
- **IBS/CBS:** 2026 é ano de teste, com campos informativos. A data de exigência de penalidade depende de regulamento (**[terceiros]**; números de artigos não confirmados).
- **Concorrentes:** Feegow (só no VIP), Amplimed, Ninsaúde, Shosp e Clínica nas Nuvens integram NFS-e. Em geral, isso fica nos planos mais caros.
- **Recomendação: deixar a NFS-e fora do MVP.**
  - A clínica emite pelo Emissor Nacional ou pelo contador.
  - O Cortex só **registra número, data e valor da NFS-e** vinculada ao lote ou fatura do convênio, porque Paraná Clínicas e Fundação Copel pedem a NF por lote.
  - Fase 2: integrar a API nacional, que serve para todos os municípios aderentes, depois que o leiaute de IBS/CBS estabilizar e a custódia do certificado A1 estiver resolvida.
  - O regime tributário da Haddad Nicola (ISS Fixo de uniprofissional ou outro) é **não confirmado**.

---

## 7. MVP recomendado: faturamento TISS + financeiro básico

1. **Cadastro de operadora/convênio:**
   - registro ANS (6 dígitos), código do prestador na operadora, CNES da clínica (ou `9999999`);
   - versão TISS (padrão `4.03.00`) e codificação do hash (padrão ISO-8859-1);
   - limite de guias por lote (≤100), exigência de .ZIP;
   - dia de corte, prazo máximo após o atendimento, prazo de recurso.
2. **Cadastro do profissional:** conselho (tab. 26, CRM=`06`), número, UF IBGE (PR=`41`), CBO (tab. 24, `225250` / `225285`) e código na operadora, se houver.
3. **Tabela de preços por convênio/plano:** código TUSS (tab. 22) + tabela de referência (tab. 87: `22` / `00` / `18` / `19` / `20` / `98`) + valor. Importável por CSV. TUSS sincronizada pela API OCL da ANS, com datas de vigência.
4. **Guias geradas do atendimento ou da agenda:**
   - guia de consulta para consulta eletiva;
   - SP/SADT para consulta com procedimento e para exames e procedimentos de consultório;
   - campos de senha, validade, número da guia na operadora, código de validação ou motivo da ausência;
   - **validação de obrigatórios antes de fechar a guia**;
   - **PDF imprimível** (o papel ainda é exigido em contingência e em algumas operadoras; o PDF leva o nome do beneficiário).
5. **Lote XML 4.03.00:**
   - 1 tipo de guia por lote, no máximo 100 guias;
   - hash MD5 conforme §2.2;
   - **validação contra o XSD oficial** no backend antes do download;
   - XML sem indentação;
   - download em .xml ou .zip + orientação de upload por operadora.
   - Testes: os dois XMLs de exemplo como fixtures.
6. **Ciclo de status:**
   - guia: rascunho → pronta → em lote;
   - lote: fechado → enviado (nº de protocolo e data) → em análise → pago / glosa parcial / glosa total;
   - lançamento manual do demonstrativo (valor pago e glosa por item, com código da tabela 38);
   - alerta de prazo de recurso.
7. **Financeiro:**
   - contas a receber alimentado pelo fechamento do lote (previsto por convênio e competência) e pelo particular;
   - baixa por demonstrativo;
   - contas a pagar simples;
   - caixa diário;
   - fluxo de caixa realizado e previsto.
8. **Repasse médico:** regra por profissional, convênio e procedimento (percentual ou valor), com base "por recebimento" (só repassa o que foi pago e já líquido de glosa). Relatório por período.
9. **Relatórios:** produção por médico e por convênio; a receber por convênio; glosas por motivo e por operadora; exportação CSV.
10. **Fora do MVP:**
    - webservices SOAP;
    - elegibilidade e autorização online;
    - importação de XML de demonstrativo (fase 2, diferencial da Feegow);
    - recurso de glosa em XML;
    - NFS-e integrada (só registrar o número);
    - conciliação OFX, split e maquininha;
    - assinatura digital XMLDSig (opcional no padrão).

---

## 8. Registro de fontes
Todas acessadas em 07/11/2026.

| # | Fonte | Tipo | O que sustenta |
|---|---|---|---|
| 1 | gov.br/ans: página do Padrão TISS (atualizada em 30/09/2026) | Oficial | Pacote vigente Set/2026 |
| 2 | gov.br/ans: Padrão TISS – Setembro/2026 (publicada em 30/09/2026, atualizada em 03/11/2026) | Oficial | Versões dos componentes e links |
| 3 | gov.br/ans: Histórico das versões | Oficial | Datas de vigência e limite de implantação (nov/2025 → 30/06/2026) |
| 4 | PadroTISS_ComponenteOrganizacional_202609.pdf | Oficial | §7 versões, §33–34 processos, §62 e §98 uso das guias, §147–148 hash e senha, §149–178 mensagens, §209–211 limites de lote, §313–319 prazos |
| 5 | PadroTISSComunicao_202511.zip (XSD 4.03.00) | Oficial | Estrutura XML, obrigatoriedade, enumerados |
| 6 | PadroTISS_ComponentedeContedoeEstrutura_202511.zip | Oficial | Condições de preenchimento, págs. 11–12 e 179–204, e formulário da guia de consulta |
| 7 | API OCL da ANS (consulta-ocl…/rest/oclservice/ANS), linkada em "Códigos da TUSS" | Oficial | Tabelas 22, 23, 24, 26, 36, 50, 52, 59, 69, 75, 76, 87 |
| 8 | Unimed Planalto Médio, Informativo TISS 04/2026 (19/05/2026) | Operadora | 04.03.00 obrigatória a partir de 01/07/2026 |
| 9 | Legismap, 03/03/2026 (notícia da ANS sobre o COPISS) | Terceiros | Ausência de nova versão anunciada |
| 10 | docs.rs tiss-hash 0.1.0 README | Terceiros | Divergência UTF-8 × ISO-8859-1 no hash |
| 11 | Manuais de Unimed Curitiba, Amil, SulAmérica, Paraná Clínicas, CASSI e Fundação Copel (URLs na §4.2) | Operadoras | Fluxo prático |
| 12 | Sites e ajudas de iClinic, Feegow, Amplimed, Ninsaúde, ProDoctor, Shosp e Clínica nas Nuvens (URLs na §4.3) | Terceiros | Benchmark |
| 13 | haddadnicola.com.br/convenios e API do WordPress do site | Clínica | Convênios declarados |
| 14 | planalto.gov.br LC 214/2025; lp.curitiba.pr.gov.br/notanacional | Oficial | NFS-e |
