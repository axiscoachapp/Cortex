// All business data of the site, in one place. Values come from environment
// variables at build time (see .env.example). Empty values never break the build:
// each page hides or replaces what is missing, and the prerender prints a list.

const env = import.meta.env;

const text = (value: string | undefined): string => (value ?? '').trim();

const priceOrNull = (value: string | undefined): number | null => {
  const raw = text(value).replace(',', '.');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const digitsOnly = (value: string | undefined): string => text(value).replace(/\D/g, '');

export type Pricing = {
  /** One-time implementation fee, "a partir de" (BRL). */
  implementationFrom: number | null;
  /** Monthly fee per doctor, "a partir de" (BRL). */
  perDoctorFrom: number | null;
  /** Short text about the AI usage allowance, e.g. "300 consultas por médico/mês". */
  aiAllowance: string | null;
};

export const siteConfig = {
  siteUrl: text(env.VITE_SITE_URL).replace(/\/+$/, ''),
  salesEmail: text(env.VITE_SALES_EMAIL),
  salesWhatsapp: digitsOnly(env.VITE_SALES_WHATSAPP),
  companyName: text(env.VITE_COMPANY_NAME),
  companyCnpj: text(env.VITE_COMPANY_CNPJ),
  privacyEmail: text(env.VITE_PRIVACY_EMAIL) || text(env.VITE_SALES_EMAIL),
  legalReviewed: text(env.VITE_LEGAL_REVIEWED) === 'true',
  pricing: {
    implementationFrom: priceOrNull(env.VITE_PRICE_IMPLEMENTATION_FROM),
    perDoctorFrom: priceOrNull(env.VITE_PRICE_PER_DOCTOR_FROM),
    aiAllowance: text(env.VITE_PRICE_AI_ALLOWANCE) || null,
  } satisfies Pricing,
  /** Year shown in the footer; fixed at build time. */
  year: new Date().getFullYear(),
} as const;

export type SiteConfig = typeof siteConfig;

export const hasContactChannel = (c: SiteConfig = siteConfig): boolean => Boolean(c.salesEmail || c.salesWhatsapp);

/** Human-readable list of missing values, printed by scripts/prerender.mjs. */
export function missingConfig(c: SiteConfig = siteConfig): string[] {
  const missing: string[] = [];
  if (!c.siteUrl) missing.push('VITE_SITE_URL (sem ele não há canonical, og:url/og:image absolutos nem sitemap.xml)');
  if (!c.salesEmail) missing.push('VITE_SALES_EMAIL');
  if (!c.salesWhatsapp) missing.push('VITE_SALES_WHATSAPP');
  if (!c.salesEmail && !c.salesWhatsapp) missing.push('→ sem e-mail e sem WhatsApp, o formulário de contato fica desativado');
  if (!c.companyName) missing.push('VITE_COMPANY_NAME (rodapé e textos legais mostram um marcador)');
  if (!c.companyCnpj) missing.push('VITE_COMPANY_CNPJ');
  if (!c.legalReviewed) missing.push('VITE_LEGAL_REVIEWED != true (termos e privacidade mostram "Versão preliminar")');
  if (c.pricing.implementationFrom === null) missing.push('VITE_PRICE_IMPLEMENTATION_FROM (mostra "Sob proposta")');
  if (c.pricing.perDoctorFrom === null) missing.push('VITE_PRICE_PER_DOCTOR_FROM (mostra "Sob proposta")');
  if (c.pricing.aiAllowance === null) missing.push('VITE_PRICE_AI_ALLOWANCE (mostra "Sob proposta")');
  return missing;
}

export const formatBRL = (value: number): string =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);

/** Formats an E.164 Brazilian number (digits only) for display. */
export function formatPhone(digits: string): string {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${digits}`;
}

export const absoluteUrl = (path: string): string | null => (siteConfig.siteUrl ? `${siteConfig.siteUrl}${path}` : null);
