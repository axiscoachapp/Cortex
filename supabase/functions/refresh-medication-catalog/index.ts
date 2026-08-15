/**
 * Monthly refresh of the Anvisa medication catalog.
 *
 * NOT user-facing: accepts ONLY the service-role key as bearer (the pg_cron
 * job sends it from Vault; a doctor's JWT is rejected). Downloads the open
 * dataset, parses active registrations, and upserts the catalog.
 *
 * Source: https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv
 * (semicolon-separated, latin1, ~8 MB).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CSV_URL = 'https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv';

/** dados.anvisa.gov.br serves its leaf cert WITHOUT the intermediate; browsers
 *  fix that via AIA-chasing but Deno's rustls does not, failing with
 *  UnknownIssuer. Pinning the Sectigo OV R36 intermediate (expires 2036) as a
 *  trust anchor lets the fetch verify. */
const SECTIGO_INTERMEDIATE_PEM = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQLBo8dulD3d3/GRsxiQrtcTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgT1YgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEApkMtJ3R06jo0fceI0M52B7K+TyMeGcv2BQ5AVc3j
lYt76TvHIu/nNe22W/RJXX9rWUD/2GE6GF5x0V4bsY7K3IeJ8E7+KzG/TGboySfD
u+F52jqQBbY62ofhYjMeiAbLI02+FqwHeM8uIrUtcX8b2RCxF358TB0NHVccAXZc
FYgZndZCeXxjuca7pJJ20LLUnXtgXcjAE1vY4WvbReW0W6mkeZyNGdmpTcFs5Y+s
yy6LtE5Zocji9J9NlNnReox2RWVyEXpA1ChZ4gqN+ZpVSIQ0HBorVFbBKyhdZyEX
gZgNSNtBRwxqwIzJePJhYd4ZUhO1vk+/uP3nwDk0p95q/j7naXNCSvESnrHPypaB
WRK066nKfPRPi9m9kIOhMdYfS8giFRTcdgL24Ycilj7ecAK9Trh0VbjwouJ4WH+x
bt47u68ZFCD/ac55I0DNHkCpaPruj6e9Rmr7K46wZDAYXuEAqB7tGG/jd6JAA+H2
O44CV98NRsU213f1kScIZntNAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQU42Z0u3BojSxdTg6mSo+bNyKcgpIw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgIw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
BZXWDHWC3cubb/e1I1kzi8lPFiK/ZUoH09ufmVOrc5ObYH/XKkWUexSPqRkwKFKr
7r8OuG+p7VNB8rifX6uopqKAgsvZtZsq7iAFw04To6vNcxeBt1Eush3cQ4b8nbQR
MQLChgEAqwhuXp9P48T4QEBSksYav7+aFjNySsLYlPzNqVM3RNwvBdvp6vgDtGwc
xlKQZVuuNVIaoYyls8swhxDeSHKpRdxRauTLZ+pl+wGvy0pnrLEJGSz9mOEmfbod
e/XopR2NGqaHJ6bIjyxPu6UtyQGI26En7UAEozACrHz06Nx2jTAY9E6NeB6XuobE
wLK025ZRmvglcURG1BrV24tGHHTgxCe8M3oGlpUSMTKQ2dkgljZVYt+gKdFtWELZ
MuRdi+X3XsrR8LFz+aLUiDRfQqhmw3RxjIyVKvvu9UPYY1nsvxYmFnUSeM+2q1z/
iPUry+xDY9MC6+IhleKT094VKdFVp7LXH42+wvU+17lRolQ2mK2N/nBLVBwaIhib
QXw4VYKwB86Bc6eS6iqsc94KEgD/U4VsjmgfhK+Xp4NM+VYzTTa3QeV3p8xOM0cw
q1p8oZFA+OBcz3FYWpDIe5j0NWKlw9hXsTyPY/HeZUV59akskSOSRSmDfe8wJDPX
58uB9/7lud0G3x0pxQAcffP0ayKavNwDTw4UfJ34cEw=
-----END CERTIFICATE-----`;

const ANTIMICRO = /ANTIBIOTIC|ANTIBACTER|CEFALOSPORIN|PENICILIN|QUINOLONA|MACROLID|SULFONAMID|SULFAS\b|TETRACICLIN|CARBAPENEM|MONOBACT|GLICOPEPT|AMINOGLICOS|ANFENICOL|TUBERCULOST|ANTIMICOBACT|LINCOSAMID|POLIMIXIN|NITROFURAN/i;

function parseLine(l: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) { if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ';') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const clean = (s: string | undefined) => (s ?? '').trim().replace(/\s+/g, ' ');

serve(async (req) => {
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  // Service-role only — this is an internal maintenance job. The platform
  // gateway (verify_jwt) has already validated the JWT signature, so reading
  // the role claim is safe; exact-match on the env key also accepted.
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  let role = '';
  try { role = JSON.parse(atob(token.split('.')[1] ?? '')).role ?? ''; } catch { /* not a JWT */ }
  if (token !== SERVICE_KEY && role !== 'service_role') {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const httpClient = Deno.createHttpClient({ caCerts: [SECTIGO_INTERMEDIATE_PEM] });
    const res = await fetch(CSV_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      client: httpClient,
    } as RequestInit & { client: Deno.HttpClient });
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    const buffer = await res.arrayBuffer();
    const raw = new TextDecoder('latin1').decode(buffer);
    const lines = raw.split(/\r?\n/);

    const rows = new Map<string, {
      product: string; ingredient: string | null; cls: string | null;
      cat: string | null; company: string | null; reg: string | null; anti: boolean;
    }>();
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const f = parseLine(lines[i]);
      if (f[9]?.trim() !== 'Ativo') continue;
      const product = clean(f[1]).toUpperCase();
      if (!product) continue;
      const ingredient = clean(f[10]).toLowerCase() || null;
      const key = product + '|' + (ingredient ?? '');
      if (rows.has(key)) continue;
      rows.set(key, {
        product,
        ingredient,
        cls: clean(f[7]) || null,
        cat: clean(f[3]) || null,
        company: clean(f[8]).replace(/^\d{14}\s*-\s*/, '') || null,
        reg: clean(String(f[4] ?? '')) || null,
        anti: ANTIMICRO.test(f[7] ?? ''),
      });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY);
    const all = [...rows.values()];
    const BATCH = 500;
    let upserted = 0;
    for (let i = 0; i < all.length; i += BATCH) {
      const chunk = all.slice(i, i + BATCH).map(r => ({
        product_name: r.product,
        active_ingredient: r.ingredient,
        therapeutic_class: r.cls,
        regulatory_category: r.cat,
        company: r.company,
        anvisa_registration: r.reg,
        is_antimicrobial: r.anti,
      }));
      const { error } = await supabase
        .from('medication_catalog')
        .upsert(chunk, { onConflict: 'product_name,active_ingredient', ignoreDuplicates: false });
      if (error) throw new Error(`upsert batch ${i / BATCH}: ${error.message}`);
      upserted += chunk.length;
    }

    console.log(`refresh-medication-catalog: upserted ${upserted} rows`);
    return new Response(
      JSON.stringify({ upserted, totalActive: all.length }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('refresh-medication-catalog error:', error instanceof Error ? error.message : 'unknown');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
