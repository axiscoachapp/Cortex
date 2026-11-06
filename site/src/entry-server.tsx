import { renderToStaticMarkup } from 'react-dom/server';
import { SiteShell } from './components/Layout';
import { absoluteUrl, missingConfig, siteConfig } from './config';
import { routes, type RouteDef } from './routes';

export { missingConfig, routes, siteConfig };

export type Assets = {
  css: string[];
  js: string[];
  fontPreloads: string[];
};

const OG_IMAGE = '/og-image.png';
const OG_ALT = 'Cortex — O prontuário que trabalha junto com o médico.';

function jsonLd(): string {
  const url = siteConfig.siteUrl || undefined;
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: siteConfig.companyName || 'Cortex',
        ...(url ? { url, logo: `${url}/apple-touch-icon.png` } : {}),
        ...(siteConfig.salesEmail ? { email: siteConfig.salesEmail } : {}),
      },
      {
        '@type': 'SoftwareApplication',
        name: 'Cortex',
        applicationCategory: 'HealthApplication',
        operatingSystem: 'Web',
        inLanguage: 'pt-BR',
        description:
          'Sistema clínico para clínicas de especialidade: prontuário, consulta com IA revisada pelo médico, receitas e pedidos, agenda e recepção, com implantação feita pela equipe do Cortex.',
        ...(url ? { url } : {}),
      },
    ],
  };
  // Escape "<" so the JSON can never close the script element.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function Document({ route, assets }: { route: RouteDef; assets: Assets }) {
  const canonical = route.index ? absoluteUrl(route.path) : null;
  const ogImage = absoluteUrl(OG_IMAGE);
  const { Page } = route;
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{route.title}</title>
        <meta name="description" content={route.description} />
        {route.index ? null : <meta name="robots" content="noindex" />}
        {canonical ? <link rel="canonical" href={canonical} /> : null}
        <meta name="theme-color" content="#0E2A33" />
        <meta name="format-detection" content="telephone=no" />

        <meta property="og:type" content="website" />
        <meta property="og:locale" content="pt_BR" />
        <meta property="og:site_name" content="Cortex" />
        <meta property="og:title" content={route.title} />
        <meta property="og:description" content={route.description} />
        {canonical ? <meta property="og:url" content={canonical} /> : null}
        {ogImage ? (
          <>
            <meta property="og:image" content={ogImage} />
            <meta property="og:image:width" content="1200" />
            <meta property="og:image:height" content="630" />
            <meta property="og:image:alt" content={OG_ALT} />
          </>
        ) : null}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={route.title} />
        <meta name="twitter:description" content={route.description} />
        {ogImage ? <meta name="twitter:image" content={ogImage} /> : null}

        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {assets.fontPreloads.map((href) => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
        {assets.css.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        {assets.js.map((src) => (
          <script key={src} type="module" src={src} />
        ))}
        {route.path === '/' ? (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd() }} />
        ) : null}
      </head>
      <body>
        <SiteShell current={route.path}>
          <Page />
        </SiteShell>
      </body>
    </html>
  );
}

export function render(path: string, assets: Assets): string {
  const route = routes.find((r) => r.path === path);
  if (!route) throw new Error(`Rota desconhecida: ${path}`);
  return `<!doctype html>${renderToStaticMarkup(<Document route={route} assets={assets} />)}`;
}
