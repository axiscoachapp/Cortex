# Identidade visual do Cortex

Versão 1, 6 de novembro de 2026. Os arquivos estão em [`brand/`](../../brand/) (logotipos e tokens). As regras abaixo valem para o site, os materiais de venda e o padrão do app. A clínica que usa o Cortex mantém a própria marca no ambiente dela (ver "Co-marca").

## Posicionamento

**Para quem:** clínicas médicas privadas de especialidade, com 2 a 20 médicos e recepção própria, que querem sair de um sistema antigo sem perder o histórico.

**O que é:** o sistema clínico que reúne prontuário, consulta com IA revisada pelo médico, receitas e pedidos, agenda e recepção. Vem com implantação feita pela nossa equipe.

**Diferença:** o produto vem com implantação, e não pronto na prateleira. Migramos os dados do sistema anterior, configuramos os modelos de cada médico e treinamos a equipe. A recepção trabalha separada do conteúdo clínico, e o médico decide o que ela vê.

**Frase-guia:** *O prontuário que trabalha junto com o médico.*

## Voz

- Clara e calma. Frases curtas, verbos concretos. Fala com médico e gestor como colega, sem jargão de startup.
- Precisa: termos médicos e regulatórios corretos (CFM, ICP-Brasil, LGPD, TUSS, CID-10), sem exagero.
- Honesta. Sem "revolucione", "100% seguro" ou números de economia de tempo que não medimos. A IA *sugere* e o médico *revisa e assina*.
- Português do Brasil, com "você".

| Em vez de | Escreva |
|---|---|
| "IA que escreve o prontuário por você" | "A IA prepara um rascunho da evolução; você revisa antes de salvar" |
| "Totalmente seguro e em conformidade" | "Acesso por papel, segundo fator de autenticação e registro de quem acessou" |
| "Migração automática de qualquer sistema" | "Migramos seu histórico com conferência da sua equipe" |

## Logotipo

| Arquivo | Uso |
|---|---|
| `brand/logo/cortex-logo.svg` | Padrão, sobre fundo claro |
| `brand/logo/cortex-logo-inverse.svg` | Sobre o tinteiro (`--cx-ink`) ou foto escura |
| `brand/logo/cortex-logo-mono-ink.svg` | Impressão em uma cor |
| `brand/logo/cortex-symbol.svg` | Ícone de app, avatar, selo |
| `brand/logo/favicon.svg` | Navegador (traço reforçado para 16 px) |
| `brand/logo/cortex-wordmark.svg` | Só a palavra, quando o símbolo já aparece por perto |

**Símbolo:** duas camadas em arco formam um "C", como as camadas do córtex e a memória clínica que se acumula consulta a consulta. O ponto âmbar na abertura é o sinal: o que importa agora para aquele paciente.

**Palavra:** "cortex" em minúsculas, Manrope ExtraBold, convertida em contornos e com espaçamento −2%.

**Regras:**
- Área de proteção igual à altura do ponto âmbar × 2 em volta de todo o logotipo.
- Tamanho mínimo: logotipo com 96 px de largura; símbolo com 16 px (use o favicon).
- Não mudar as cores do símbolo, não girar, não aplicar sombra nem contorno, não recompor a palavra com outra fonte.

## Cores

| Token | Hex | Uso | Contraste |
|---|---|---|---|
| `--cx-ink` | `#0E2A33` | Texto, fundos escuros | 15,0:1 no branco |
| `--cx-teal-700` | `#0F6B63` | Cor primária: botões, links, símbolo | 6,4:1 no branco; 6,0:1 no `--cx-bg` |
| `--cx-teal-800` | `#0B5650` | Pressionado; texto sobre `teal-100` | 7,2:1 |
| `--cx-teal-600` | `#13847A` | Só texto grande ou fundo | 4,6:1 no branco |
| `--cx-teal-300` | `#9DE0D3` | Destaques sobre o tinteiro | 10,0:1 |
| `--cx-teal-100` / `-50` | `#D9F0EC` / `#EEF8F6` | Superfícies tingidas | — |
| `--cx-signal` | `#F2B23E` | O ponto âmbar: preenchimentos e destaques. Nunca texto sobre fundo claro | 8,0:1 sobre o tinteiro |
| `--cx-signal-700` | `#8A5300` | Texto sobre `signal-50` | 5,8:1 |
| `--cx-bg` / `--cx-surface` | `#F6F8F7` / `#FFFFFF` | Fundo e cartões | — |
| `--cx-border` | `#DDE5E3` | Bordas | — |
| `--cx-muted` | `#56676C` | Texto secundário | 5,9:1 no branco |
| `--cx-muted-on-ink` | `#B9C7CA` | Texto secundário no escuro | 8,7:1 |

Cores semânticas (sucesso, alerta, erro, informação) estão em `brand/tokens.css`. Proporção sugerida: 70% neutros, 20% verde-petróleo e tinteiro, até 10% âmbar.

## Tipografia

- **Manrope** (SIL Open Font License), servida pelo próprio site, sem Google Fonts em tempo de execução: menos terceiros recebendo o IP do visitante.
- Títulos em 700–800 com espaçamento −1% a −2%; texto em 400–500, entre 16 e 18 px no site; números de agenda e medidas com `font-variant-numeric: tabular-nums`.
- Escala do site: 14 / 16 / 18 / 20 / 24 / 32 / 44 / 56 px.

## Elementos

- **Ícones:** Lucide, com traço 1,75, o mesmo conjunto do app.
- **Imagens:** sem fotos de banco de imagens com médicos sorrindo. Use telas do produto com dados **fictícios** ("Paciente Exemplo") e o padrão de arcos do símbolo como textura.
- **Cantos:** 12 px nos cartões, 20 px nas seções em destaque e 999 px nos botões em formato de pílula.
- **Movimento:** discreto (150–250 ms) e respeitando `prefers-reduced-motion`.

## Co-marca com a clínica

O cliente é a clínica, e o ambiente dela leva a marca dela.

- **No app da clínica:** o logotipo da clínica vem primeiro, e o Cortex aparece como "com Cortex" no rodapé do login e em "Sobre". As cores da interface podem seguir a clínica. O padrão, quando a clínica não tem marca, é o verde-petróleo do Cortex.
- **Em documentos clínicos (receitas, atestados, pedidos):** só a identidade da clínica e do médico. O Cortex não aparece.
- **No site e nos materiais de venda:** o Cortex, sem logotipo nem nome de clínicas clientes enquanto não houver autorização por escrito.

A configuração da marca por implantação no app é a tarefa K5 do Codex ([plano](../product/cortex-comercial/PLANO.md)).
