# Site do Cortex

Site público de marketing do Cortex: início, funcionalidades, implantação, segurança, preços, contato, termos de uso e política de privacidade. É um pacote npm separado do app, com deploy próprio.

- **HTML estático pré-renderizado.** As páginas são componentes React renderizados no build (`renderToStaticMarkup`), uma `index.html` por rota. Nenhum React vai para o navegador.
- **JavaScript mínimo.** Um arquivo pequeno (≈5 kB) cuida do menu no celular e do formulário de contato.
- **Sem terceiros.** Não há cookies, ferramentas de análise, Google Fonts nem CDN. A fonte Manrope é servida pelo próprio site.
- **Marca.** Cores, logotipos e favicon vêm de [`../brand/`](../brand/), e as regras estão em [`docs/brand/IDENTIDADE.md`](../docs/brand/IDENTIDADE.md).
- **Afirmações.** Toda frase sobre o produto precisa estar liberada em [`docs/product/cortex-comercial/AFIRMACOES.md`](../docs/product/cortex-comercial/AFIRMACOES.md).

## Como rodar

É preciso ter Node 20.19 ou mais novo (a Vercel usa o 22 por padrão).

```bash
cd site
npm install
npm run dev        # http://localhost:5173: renderiza a página a cada acesso, então basta recarregar depois de editar
npm run build      # gera o site estático em dist/
npm run preview    # serve dist/ em http://localhost:4173 como a Vercel serviria (URLs limpas, 404 e cabeçalhos do vercel.json, incluindo a CSP)
```

Outros comandos:

| Comando | O que faz |
|---|---|
| `npm run screenshots` | Serve `dist/` com a CSP e tira capturas de todas as páginas em 390×844 e 1280×800. Confere se há rolagem horizontal, erros no console, requisições com falha e links internos quebrados, e testa o menu do celular e o formulário. Usa o Playwright da raiz do repositório e o Microsoft Edge instalado. As capturas vão para `SHOTS_DIR`, ou para a pasta temporária do sistema se a variável não for definida. |
| `npm run og` | Gera de novo `public/og-image.png` (1200×630) e `public/apple-touch-icon.png`. Rode quando mudar o título ou o logotipo. Os PNGs ficam versionados. |
| `npm run sync-brand` | Copia logotipos, favicon e tokens de `../brand/` para `public/brand/`, `public/favicon.svg` e `src/styles/tokens.css`. O `build` e o `dev` já rodam esse passo. |

### Como o build funciona

`npm run build` roda, nesta ordem:

1. `sync-brand`: copia a marca de `../brand/`. As cópias ficam versionadas, então o build também funciona se `../brand` não estiver disponível.
2. `tsc --noEmit`: confere os tipos. Não pode haver erro.
3. `vite build`: gera o CSS (Tailwind) e o JS do navegador com nomes com hash, mais o manifest.
4. `vite build --ssr src/entry-server.tsx`: compila as páginas React para o Node (`dist-ssr/`).
5. `scripts/prerender.mjs`: escreve `dist/<rota>/index.html` e `dist/404.html` com o CSS e o JS do manifest, gera `robots.txt` e, se `VITE_SITE_URL` estiver definida, `sitemap.xml`. No fim, **avisa quais dados do site ainda faltam**.

### Estrutura

```
site/
├── src/
│   ├── config.ts            # todos os dados do negócio (lidos das variáveis de ambiente)
│   ├── routes.tsx           # rotas, títulos e descrições
│   ├── entry-server.tsx     # documento HTML (head, Open Graph, JSON-LD) usado no build
│   ├── entry-client.ts      # único JS do navegador: menu e formulário
│   ├── client/              # menu.ts, contact-form.ts
│   ├── components/          # layout, seções, marca e telas ilustrativas (mockups)
│   ├── pages/               # uma página por rota
│   └── styles/              # main.css e tokens.css (cópia de ../brand/tokens.css)
├── public/                  # favicon, logotipos, og-image.png, apple-touch-icon.png
├── scripts/                 # sync-brand, prerender, dev, serve, screenshots, og-image
├── vercel.json              # URLs limpas e cabeçalhos de segurança
└── .env.example             # variáveis de ambiente, com comentários
```

As telas do produto mostradas no site são ilustrações em HTML/CSS com dados fictícios ("Paciente Exemplo", "Dra. Ana Exemplo"). Não use capturas do app real.

## Variáveis de ambiente

Copie `.env.example` para `.env` no desenvolvimento ou cadastre as variáveis na Vercel. Elas entram no build, então é preciso gerar o site de novo depois de mudar qualquer uma. Nenhuma é obrigatória para o build passar.

| Variável | Para que serve | Se ficar vazia |
|---|---|---|
| `VITE_SITE_URL` | Domínio público, sem barra no final | Sem canonical, sem `og:url`/`og:image` absolutos e sem `sitemap.xml` |
| `VITE_SALES_EMAIL` | E-mail comercial que recebe os pedidos | O formulário só usa o WhatsApp |
| `VITE_SALES_WHATSAPP` | WhatsApp comercial, só dígitos (E.164 sem `+`) | O formulário só usa o e-mail |
| *(e-mail e WhatsApp vazios)* | — | O botão do formulário fica desativado, com um aviso |
| `VITE_COMPANY_NAME`, `VITE_COMPANY_CNPJ` | Razão social e CNPJ de quem vende | O rodapé omite o ©, e os textos legais mostram `[razão social]` e `[CNPJ]` |
| `VITE_PRIVACY_EMAIL` | Contato do encarregado de dados | Usa o e-mail comercial |
| `VITE_LEGAL_REVIEWED` | `true` depois da revisão jurídica | Termos e privacidade mostram "Versão preliminar — em revisão jurídica" |
| `VITE_PRICE_IMPLEMENTATION_FROM`, `VITE_PRICE_PER_DOCTOR_FROM` | Preços "a partir de", em reais | "Sob proposta" |
| `VITE_PRICE_AI_ALLOWANCE` | Texto da franquia de IA | "Sob proposta" |

## Formulário de contato

Nada é enviado a um servidor. Depois da validação, o formulário abre o aplicativo de e-mail do visitante (`mailto:`) com assunto e mensagem preenchidos e oferece um link "Falar pelo WhatsApp" (`wa.me`) com um resumo. A política de privacidade do site descreve esse funcionamento. Se um dia o formulário passar a enviar dados para um servidor, atualize a política, a CSP (`connect-src`/`form-action`) e a frase abaixo do formulário.

## Deploy na Vercel

Faça o deploy só quando o usuário pedir.

1. Na Vercel, crie um **projeto novo** a partir do mesmo repositório GitHub.
2. Em **Root Directory**, escolha `site`.
3. Em **Framework Preset**, escolha **Other**. Build Command: `npm run build`. Output Directory: `dist`. Install Command: padrão (`npm install`).
4. Em **Environment Variables**, cadastre as variáveis acima, no mínimo em Production.
5. Faça o deploy e ligue o domínio definido em D22. `VITE_SITE_URL` precisa ser igual a esse domínio.

O `vercel.json` já liga as URLs limpas (`cleanUrls`, sem barra final) e os cabeçalhos de segurança: CSP restrita (`default-src 'self'`, sem script ou estilo inline), HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy` sem câmera, microfone e localização, e bloqueio de iframe. Os arquivos em `/assets/` têm cache longo, porque o nome muda a cada build.

## Checklist antes de publicar

- [ ] **D22:** domínio definido, `VITE_SITE_URL`, e-mail e WhatsApp comerciais, razão social e CNPJ cadastrados. O `npm run build` não lista mais nenhum desses itens.
- [ ] **D23:** preços decididos. Cadastre os valores ou deixe "Sob proposta" de propósito.
- [ ] **Revisão jurídica** dos termos de uso e da política de privacidade do site, incluindo foro e base legal. Depois disso, `VITE_LEGAL_REVIEWED=true`.
- [ ] **Registro de afirmações:** releia o site com o [AFIRMACOES.md](../docs/product/cortex-comercial/AFIRMACOES.md) aberto. Assinatura digital continua "em implantação", WhatsApp "em breve" e Google Agenda "opcional"? Nada sobre dados no Brasil, sobre a IA não treinar com os dados, certificações, economia de tempo, nomes de clientes ou depoimentos?
- [ ] **Marca por clínica:** a página de implantação diz que cada clínica tem ambiente e marca próprios. Confirme que isso vale na prática (decisão D21 e tarefa K5 do Codex).
- [ ] **D25:** busca do nome "Cortex" no INPI (classes 9, 42 e 44) antes de investir em domínio e divulgação.
- [ ] `npm run build` e `npm run screenshots` sem problemas, com as variáveis de produção.
- [ ] Se o título mudou, gere a imagem de compartilhamento de novo com `npm run og`.
