# Revisão independente do domínio de prescrição

04/11/2026. Um revisor independente fez uma revisão adversarial só de leitura, sem acesso a dados reais nem a serviços externos. Claude conferiu os achados e fez as correções.

## Sem achado

- **`validate-prescription`:**
  - o acesso exige o UUID do documento e um código de 8 caracteres num alfabeto de 32 (40 bits), gerado sem viés;
  - ID desconhecido, ID malformado e código errado dão o mesmo 404;
  - o JSON do ITI não tem CPF nem dado do paciente;
  - o caminho do storage é conferido exatamente;
  - as respostas têm `no-store` e `no-referrer`.
- **`generate-prescription`:**
  - a posse do paciente e da consulta é verificada pela identidade autenticada, e a recepção é bloqueada;
  - os metadados são registrados antes do upload, e há limpeza em caso de falha;
  - o SHA-256 é calculado sobre os mesmos bytes enviados, e o snapshot é imutável.
- **`document_snippets`:** leitura só do dono, e escrita só por RPC com as guardas.
- **Layout:** o texto quebra e nunca invade o rodapé.

## Achados e correções (commit `ce2fa01`)

| # | Gravidade | Achado | Correção |
|---|---|---|---|
| 1 | Alta | Controlados e antimicrobianos passavam com nome comercial (Rivotril, Monuril, Bactrim F…), com grafias como "Ciprofloxacina" e com a dose colada ao nome ("Clonazepam2mg"). Um Rivotril saía em receita simples, válida por 30 dias. | O servidor consulta o catálogo Anvisa pelo nome exato do produto e confere o princípio ativo e a marcação de antimicrobiano; se o catálogo falhar, recusa. O detector conhece marcas frequentes, as grafias brasileiras e a dose colada. Testes cobrem marca do catálogo, marca sem catálogo e os exemplos do revisor. |
| 1b | Alta (legal) | A receita de antimicrobiano saía só com o nome comercial. A RDC 471/2021 pede a DCB. | O PDF imprime "Marca (substância)". |
| 2 | Média | O PDF dizia "Válida até 14/11", mas a validade terminava às 15:00 desse dia (emissão + N×24 h). A farmácia recusava no último dia. | `expires_at` passou a ser o fim do dia impresso em America/Sao_Paulo. |
| 3 | Média | Um 40001 da barreira de custódia virava erro 500 ou a mensagem falsa "paciente alterado". | Agora é 409 com mensagem verdadeira ("outra operação em andamento"); o 55000 também. A causa (trava global) foi para o Codex: mensagem `2026-11-04-0611`. |
| 4 | Baixa | A lista do médico marcava atestado e pedido de exames como "Expirada" após 90 dias, embora o validador público não os expire. | A lista usa a mesma regra do validador. |
| 5 | Baixa | `_format=application/validador-iti+json` com o "+" sem codificação virava espaço e devolvia o PDF. | As duas grafias são aceitas. |

Suíte completa depois das correções: 79 arquivos e 573 testes aprovados; typecheck do app e das funções e eslint limpos.

## Pendente

- ~~Aviso no compositor antes de gerar~~. Feito em `3a4e831`: o compositor avisa sobre controlado (também pela marca ou pelo princípio ativo do catálogo) e sugere o tipo antimicrobiano para marca digitada à mão.
- ~~A trava global da barreira de custódia (achado 3)~~. Resolvida pelo Codex em `a7b992c` (migration `20261104200000`, versões por conta e por recurso). O ensaio de corrida dos modelos de receita e as 36 suítes SQL continuam aprovados sobre ela (verificação do Claude em 04/11 07:55).
