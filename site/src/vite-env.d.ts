/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string;
  readonly VITE_SALES_EMAIL?: string;
  readonly VITE_SALES_WHATSAPP?: string;
  readonly VITE_COMPANY_NAME?: string;
  readonly VITE_COMPANY_CNPJ?: string;
  readonly VITE_PRIVACY_EMAIL?: string;
  readonly VITE_LEGAL_REVIEWED?: string;
  readonly VITE_PRICE_IMPLEMENTATION_FROM?: string;
  readonly VITE_PRICE_PER_DOCTOR_FROM?: string;
  readonly VITE_PRICE_AI_ALLOWANCE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
