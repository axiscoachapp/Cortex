# Experiência por perfil — revisão e entrega local

Pedido manual de10/11/2026; referência inicial de Git b7be942. [Objetivo, pesquisa e critérios](../../../product/clinic-crm/WORKSPACE_UX.md). React/Tailwind/Radix existentes; sem dependências, SQL ou mudança de produtores.

## Resultado

- Médico: início com agenda de hoje também no desktop, abertura do paciente/agendamento, retomada, recentes e cadastro secundários. Largura antes ocupada pelo painel vazio aproveitada; painel clínico e gravação permanecem montados. Configuração recolhível. Navegação principal Início/Agenda/Pacientes separada das ferramentas.
- Secretaria: entrada operacional existente preservada; menu lateral agrupado por Rotina/Gestão, filtros maiores/alinhados e rodapé móvel com três destinos + Mais. Logout disponível também no cabeçalho compacto; todo o menu clínico pode rolar em telas baixas.
- Administrador: seletor Consultório/Recepção/Financeiro. Secretaria, inclusive uma administradora de recepção, não ganha consultório privado. Opções seguem clinic_access; nenhum email concede privilégio. Não foi alterada uma conta hospedada.
- Financeiro: contexto, período, explicação de seção e abas por papel do servidor; largura útil e formulários maiores. Datas de caixa explicadas conforme a fonte: recebimentos por pagamento; despesas abertas por vencimento, pagas por pagamento. Médico vê texto de consulta, secretaria só as ações permitidas. API, confirmações, valores e estados preservados.
- Correção descoberta na revisão: aliases reconhecidos pelo router (/RECEPCAO e /%72ecepcao) passam pela mesma restrição de recepção. Quatro regressões no gate.

## Pesquisa e julgamento de produto

Consultados [Cliniko](https://www.cliniko.com/features/), [Jane](https://jane.app/guide/staff-access-levels) e documentação de [agendas Feegow](https://ajuda.feegow.com/support/solutions/articles/67000663486-quais-os-tipos-de-agenda-que-o-sistema-disponibiliza-) e [recebimento Feegow](https://ajuda.feegow.com/support/solutions/articles/67000754729). A separação por função e o foco na próxima ação orientaram o desenho; não se copiou uma interface. Marca quente/dourada, fontes locais e escala135% mantidas. Sem gráficos ou métricas inventadas.

## Evidências

[Resumo verificável](QUALITY.json): **111 testes/9 arquivos**, tipos app/node, lint23 arquivos e build com ambiente exclusivamente sintético aprovados. Primeiro build sem configuração explícita foi recusado corretamente; o build aprovado usa somente domínio .invalid/chave fictícia. Avisos de desempenho das ferramentas não impediram o build.

**206 estados finais no Edge isolado**, fontes idênticas antes/depois de cada corrida (hashes em [main-summary](main-summary.json) e [whole-summary](whole-summary.json)):

| Corrida | Estados | Conteúdo |
|---|---:|---|
| [main-final](main-final/audit.json) |90| Início, recepção, financeiro separado/embutido, menus e formulários;320/375/1280/1920, alturas667/768, escala135%. Nova Consulta existente/novo; cobrança, pagamento, retorno de lote, despesa e cadastros. |
| [doctor-final](doctor-final/audit.json) |11| Médico comum com dois ambientes; abertura e modos do modal;375/1920. |
| [reception-final](reception-final/audit.json) |15| Entrada do login de secretaria redireciona para a operação; dois ambientes, Mais e abas de financeiro conforme o servidor;375/1920. Zero leitores privados de paciente/consulta/chat. |
| [whole-app-final](whole-app-final/audit.json) |90| Rotas registradas do consultório, pacientes/perfil/histórico/documentos, agenda, ferramentas, compartilhamento, segurança/privacidade, configuração/WhatsApp, pré-consulta pública/interna, recepção e financeiro;375/1280. |

Reteste suplementar de15 estados em [reception-private-final](reception-private-final/audit.json) ampliou a sentinela para incluir também workspace_directory/list_patient_chat_turns, além das tabelas privadas: zero leitores clínicos, desconhecidas ou erros. Apenas a sentinela do executor mudou; fontes do aplicativo idênticas às corridas principais.

Zero erros de JavaScript/console, campos visíveis sem rótulo, controles sem nome, imagens sem alt ou vazamentos laterais detectados nessas corridas. Zero chamadas sem fixture reconhecida no resultado final. Leituras vazias explícitas para arquivos, uso e solicitações de delegação; isso não prova um cenário populado desses módulos. Capturas principais, menus de altura curta e diálogo320 inspecionados visualmente.

Reprodução, na raiz: `node docs/reviews/2026-11-10/product-ux/run.mjs main` e `node docs/reviews/2026-11-10/product-ux/run.mjs whole`. O executor usa backend em memória na rota interceptada, servidor local, contexto novo, destinos externos bloqueados e encerra navegador/servidor. Nenhum banco foi necessário para este recorte de apresentação.

## Revisão independente e limites

Dois revisores fresh-context examinaram papéis/rotas/continuidade clínica e apresentação financeira. Achados incorporados: logout compacto, menu com altura limitada, textos por papel e datas reais do caixa; cabeçalho de modal reserva espaço para fechar. Releitura não encontrou outra regressão concreta. A conferência de altura curta mostrou Configurações acessível por rolagem. Usuário escolheu seguir com a revisão atual após a oferta de segunda opinião conforme DDD; nenhuma CLI/modelo externo foi executado.

A auditoria geral é uma revisão de UI e regressão das rotas listadas, não aceite integral dos produtores P1/P2/P4/C4/C5. Contatos/agenda/equipe/indicadores da recepção também tiveram revisão de fonte para compatibilidade com a moldura; não se alegam novos ensaios completos desses fluxos. Retornos OAuth/assinatura, concessão real de permissões, envio WhatsApp, emissão fiscal e operações financeiras hospedadas não foram executados. Formulários financeiros já não registravam o guard global de rascunho; esta entrega não muda nem promete proteção desse rascunho ao voltar/sair. Prontuário continua privado por médico.

As capturas são inteiramente sintéticas. Relatórios intermediários ficaram locais; os JSON finais e uma seleção de imagens antes/depois entram no commit. Nenhum push, deploy, alteração hospedada, envio externo ou reativação da automação. Trabalho SaaS alheio preservado.

## Capturas selecionadas

[Início antes](before/largo-inicio.png) · [Consultório depois](doctor-final/largo-inicio.png) · [Seletor do administrador](main-final/largo-inicio-areas.png) · [Recepção](main-final/largo-recepcao.png) · [Financeiro](main-final/largo-financeiro.png) · [Pagamento no celular](main-final/celular-financeiro-receber-dialogo.png). Somente dados sintéticos.
