/**
 * Monthly refresh of the reference catalogs: TUSS (ANS), CID-10 (DATASUS),
 * CMED presentations (Anvisa, prices dropped) and DCB (Anvisa).
 * Contract: docs/prescriptions/CATALOGOS_E_MANIPULADOS.md.
 *
 * NOT user-facing: accepts ONLY the service-role key as bearer, like
 * refresh-medication-catalog. Body (optional): {"sources": ["tuss", ...]}.
 * A source whose file did not change (same SHA-256) is skipped; a failing
 * source leaves its table untouched and does not stop the others.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import { fetchWithDeadline, readJsonObject } from '../_shared/http.ts';
import { refreshCatalog, type CatalogSource } from '../_shared/referenceCatalogs.ts';
import { bearerToken, secretEquals } from '../_shared/secrets.ts';

/** dados.anvisa.gov.br serves its leaf certificate without the intermediate;
 *  same pinned Sectigo OV R36 intermediate as refresh-medication-catalog. */
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

const SOURCES: CatalogSource[] = ['tuss', 'cid10', 'cmed', 'dcb'];

serve(async (req) => {
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!(await secretEquals(SERVICE_KEY, bearerToken(req.headers.get('Authorization'))))) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  let wanted = SOURCES;
  try {
    // Bounded streaming read (finding 16); an absent or unreadable body means "all sources".
    const body = req.method === 'POST' ? await readJsonObject(req, 4 * 1024).catch(() => ({})) : {};
    if (Array.isArray(body?.sources)) wanted = SOURCES.filter((s) => body.sources.includes(s));
  } catch { /* default: all */ }

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, { auth: { persistSession: false } });
  const anvisaClient = Deno.createHttpClient({ caCerts: [SECTIGO_INTERMEDIATE_PEM] });
  const ports = {
    async download(url: string) {
      const init = { headers: { 'User-Agent': 'Mozilla/5.0 (Cortex catalog refresh)' } } as RequestInit & { client?: Deno.HttpClient };
      if (new URL(url).hostname === 'dados.anvisa.gov.br') init.client = anvisaClient;
      const res = await fetchWithDeadline(url, init);
      if (!res.ok) throw new Error(`download ${new URL(url).hostname}: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async version(source: CatalogSource) {
      const { data, error } = await supabase.from('reference_catalog_versions').select('sha256').eq('source', source).maybeSingle();
      if (error) throw new Error(`version ${source}: ${error.message}`);
      return data;
    },
    async upsert(table: string, rows: Record<string, unknown>[], onConflict: string) {
      const { error } = await supabase.from(table).upsert(rows, { onConflict, ignoreDuplicates: false });
      if (error) throw new Error(`upsert ${table}: ${error.message}`);
    },
    async deleteOlder(table: string, refreshedBefore: string) {
      const { error } = await supabase.from(table).delete().lt('refreshed_at', refreshedBefore);
      if (error) throw new Error(`cleanup ${table}: ${error.message}`);
    },
    async saveVersion(row: Record<string, unknown>) {
      const { error } = await supabase.from('reference_catalog_versions').upsert(row, { onConflict: 'source' });
      if (error) throw new Error(`version save: ${error.message}`);
    },
    now: () => new Date(),
  };

  const results = [];
  for (const source of wanted) {
    try {
      results.push(await refreshCatalog(source, ports));
    } catch (error) {
      console.error(`refresh-reference-catalogs ${source}: ${error instanceof Error ? error.message : 'failed'}`);
      results.push({ source, status: 'failed', error: error instanceof Error ? error.message : 'failed' });
    }
  }
  const failed = results.some((r) => r.status === 'failed');
  return new Response(JSON.stringify({ results }), { status: failed ? 207 : 200, headers: { 'Content-Type': 'application/json' } });
});
