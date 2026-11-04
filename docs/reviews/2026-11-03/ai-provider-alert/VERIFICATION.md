# D13 — verificação técnica do alerta sobre IA

Conferido em 03/11/2026, após mensagem do Claude. Leitura de código e fontes públicas oficiais; nenhuma chamada de inferência, mudança de provedor ou implantação.

| Evidência | Resultado confirmado | Consequência para o projeto |
|---|---|---|
| `supabase/functions/_shared/gemini.ts`, `BASE_URL` | Developer API e `gemini-2.5-flash` | O aviso abaixo corresponde ao endpoint usado; não é somente uma possibilidade do Vertex |
| [Descontinuações do Google](https://ai.google.dev/gemini-api/docs/deprecations) | Em 01/12/2026, pedidos para esse modelo passam automaticamente a `gemini-3.5-flash-lite`, com tarifas e mudanças de API do substituto | Escolher e validar o caminho antes dessa data; não presumir equivalência clínica |
| [Termos da Developer API](https://ai.google.dev/gemini-api/terms) | Restrição ao uso em prática clínica/aconselhamento médico | Avaliar finalidade e contrato antes do uso clínico, mesmo com entradas sem nomes |
| [Google Cloud, §20(e)](https://cloud.google.com/terms/service-terms) | Restrição clínica e exceção explícita de pesquisa não clínica, agendamento e outras tarefas administrativas | Não confundir uma área administrativa com apoio clínico; Vertex não representa liberação automática |
| [Resolução CFM 2.454/2026](https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2026/2454_2026.pdf) e [vigência confirmada pelo CFM](https://portal.cfm.org.br/noticias/regras-sobre-uso-da-ia-na-medicina-entram-em-vigor-no-dia-26-de-agosto) | Em vigor; trata registro de apoio à decisão, informação/recusa, segurança e risco | Planejar esses controles com a direção clínica antes de habilitar o uso real |

A página atual do Google Cloud falhou no leitor web, mas foi obtida por HTTP direto. A [versão arquivada de 27/10/2026](https://cloud.google.com/legal/archive/terms/service-terms/index-20261027) foi consultada como referência de seção e está explicitamente marcada como arquivo; ela não substitui a conferência do contrato aplicável.

Inferência de engenharia: a validação de D13 precisa separar transcrição/documentação, assistência clínica e tarefas administrativas por finalidade e risco. Um contrato público com exceção administrativa não autoriza automaticamente resumo clínico, reconciliação de medicamentos ou perguntas ao prontuário. A confirmação de enquadramento/condições contratuais deve acompanhar o comparativo do Claude e a decisão do usuário.

Entregas de recepção sem IA seguem independentes. Código/modelo continuam como estão nesta verificação; nenhum fornecedor foi contratado ou recomendado como decisão final. Acesso a dados reais e ativação clínica continuam fora do ensaio sintético.
