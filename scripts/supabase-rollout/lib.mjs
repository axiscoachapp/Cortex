// Shared helpers for the production rollout tools: Management API access with the Supabase CLI's
// own token (Windows Credential Manager "Supabase CLI:supabase", or SUPABASE_ACCESS_TOKEN), and
// small utilities. The token never leaves the process: it is not printed or written.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export const REPO = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
export const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing --${name}`);
}

export function project() {
  const ref = arg('project');
  if (!/^[a-z]{20}$/.test(ref)) throw new Error('--project must be a Supabase project ref (20 lowercase letters)');
  return ref;
}

export function backupDir(ref, label) {
  return join(process.env.LOCALAPPDATA ?? process.env.HOME, 'CortexBackups', `${ref}-${label}`);
}

const PS = `
$sig = @'
using System; using System.Runtime.InteropServices;
public class CortexCredRead {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string t) { IntPtr p; if (!CredRead(t, 1, 0, out p)) return null;
    var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL)); var b = new byte[c.CredentialBlobSize];
    Marshal.Copy(c.CredentialBlob, b, 0, b.Length); CredFree(p); return Convert.ToBase64String(b); }
}
'@
Add-Type -TypeDefinition $sig
[CortexCredRead]::Read('Supabase CLI:supabase')
`;

let token;
function getToken() {
  if (token) return token;
  if (process.env.SUPABASE_ACCESS_TOKEN) return (token = process.env.SUPABASE_ACCESS_TOKEN.trim());
  if (process.platform !== 'win32') throw new Error('Set SUPABASE_ACCESS_TOKEN (or run `supabase login` on Windows)');
  const out = execFileSync('powershell', ['-NoProfile', '-Command', PS], { encoding: 'utf8' }).trim();
  if (!out) throw new Error('No Supabase CLI credential: run `supabase login`');
  let raw = Buffer.from(out, 'base64').toString('utf8');
  if (raw.includes('\u0000')) raw = Buffer.from(out, 'base64').toString('utf16le');
  if (raw.startsWith('go-keyring-base64:')) raw = Buffer.from(raw.slice(18), 'base64').toString('utf8');
  token = raw.trim();
  if (!/^sbp_/.test(token)) throw new Error('Unexpected credential format: run `supabase login`');
  return token;
}

async function api(path, init = {}) {
  const res = await fetch(`https://api.supabase.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (res.status === 401) throw new Error('Supabase token rejected (401): run `supabase login`');
  if (!res.ok) { const e = new Error(`HTTP ${res.status}: ${text.slice(0, 2000)}`); e.status = res.status; e.body = text; throw e; }
  return text ? JSON.parse(text) : null;
}

export const query = (ref, sql) => api(`/projects/${ref}/database/query`, { method: 'POST', body: JSON.stringify({ query: sql }) });
export const listFunctions = (ref) => api(`/projects/${ref}/functions`);
export const listSecretNames = async (ref) => ((await api(`/projects/${ref}/secrets`)) ?? []).map((s) => s.name);
