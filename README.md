# Cortex

> Assistente médico com IA — grave a consulta, a IA escreve o prontuário.

Cortex é um copiloto clínico em português brasileiro para profissionais de saúde. Grava a consulta, transcreve com identificação de falantes, gera a evolução SOAP e a mensagem de WhatsApp, organiza o briefing pré-consulta e responde perguntas sobre o histórico completo do paciente.

## Stack

- **Frontend**: Vite + React 18 + TypeScript, Tailwind CSS, shadcn/ui, TanStack Query, React Router
- **Backend**: Supabase (Postgres + Auth + Storage + Edge Functions em Deno)
- **IA**: Gemini 2.5 Flash via Files API para áudios longos, JSON-schema responses

## Estrutura

```
src/
  pages/        # Index, Auth, About, Calendar, PatientManagement
  components/   # ChatPanel, PatientSnapshot, PatientSidebar, modais…
  contexts/     # AuthContext (Supabase auth + dev bypass)
  hooks/        # useSeedPatients, useIsMobile, useToast
  integrations/supabase/   # client + typed schema
  lib/          # patientMapper, cn helper
supabase/
  functions/    # edge functions (Deno)
    chat-assistant/         # Pergunta com histórico de consultas
    generate-prebriefing/   # Briefing pré-consulta com cache
    process-consultation/   # Áudio → transcrição → SOAP → WhatsApp
    process-clinical-notes/ # Extrai sintomas/fatores estruturados
    sync-google-calendar/   # Sincronização bidirecional Google
    google-oauth-callback/  # OAuth do Google Calendar
    send-appointment-reminder/
  migrations/   # schema, RLS, índices
```

## Desenvolvimento

```sh
# Pré-requisitos: Node 20+, Supabase CLI
npm install
npm run dev          # http://localhost:8080
```

### Variáveis de ambiente

Crie `.env.local` na raiz (já presente como `.env.example`):

```sh
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

### Edge functions

Segredos exigidos no projeto Supabase:

| Segredo                      | Origem                       |
|------------------------------|------------------------------|
| `GEMINI_API_KEY`             | Google AI Studio             |
| `GOOGLE_CLIENT_ID/SECRET`    | OAuth para Google Calendar   |

Deploy:

```sh
supabase functions deploy chat-assistant
supabase functions deploy generate-prebriefing
supabase functions deploy process-consultation
supabase functions deploy process-clinical-notes
supabase functions deploy sync-google-calendar
supabase functions deploy google-oauth-callback
supabase functions deploy send-appointment-reminder
```

## Assets de marca

Favicon e imagem de compartilhamento são gerados a partir de SVGs em `public/`:

```sh
node scripts/generate-icons.mjs
```

Gera `favicon.ico` (multi-size), `favicon-{16,32,48}.png`, `apple-touch-icon.png` e `og-image.png`.

## Build

```sh
npm run build       # produção
npm run preview     # serve dist/
```

## Deploy

Frontend hospedado na Vercel (config em `vercel.json`). Edge functions são deployadas via Supabase CLI.

## Modo admin (dev only)

A página `/auth` mostra um botão "Admin — pular login (dev)" apenas em builds de desenvolvimento (`import.meta.env.DEV`). Em produção o atalho é ignorado e o botão não é renderizado.
