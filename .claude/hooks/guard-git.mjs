#!/usr/bin/env node
// PreToolUse (Bash): el repo es público. Antes de cada `git commit` revisa lo que se va a subir y lo bloquea si
// trae documentos, fotos, planillas o claves secretas. Así la regla no depende de que Claude se acuerde.
// También frena el push directo o forzado a main (main = producción en Vercel).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const input = JSON.parse(readFileSync(0, 'utf8'))
const cmd = input.tool_input?.command ?? ''
const cwd = input.cwd || process.cwd()

const block = (msg) => { process.stderr.write(msg + '\n'); process.exit(2) }
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] })

// Cada tramo del comando por separado: "cd web && git commit -m …" → ["cd web", "git commit -m …"].
const parts = cmd.split(/&&|\|\||;|\n/).map((s) => s.trim())

// ---------- push a main ----------
for (const p of parts) {
  if (!/^git\b.*\bpush\b/.test(p)) continue
  if (/(\s|^)(-f|--force|--force-with-lease)(\s|=|$)/.test(p)) block('Bloqueado: no se hace push forzado. Si de verdad hace falta, que lo haga el usuario.')
  if (/\s(origin\s+)?(HEAD:)?(refs\/heads\/)?main(\s|$)/.test(p)) block('Bloqueado: main es producción (Vercel despliega cada cambio). Sube una rama y abre un PR.')
}

// ---------- commit ----------
const commit = parts.find((p) => /^git\b(?:\s+-C\s+\S+)?.*\bcommit\b/.test(p))
if (!commit) process.exit(0)

let files
try {
  files = git('diff', '--cached', '--name-only', '--diff-filter=ACMR').split('\n').filter(Boolean)
  // "commit -a" también sube lo modificado sin agregar.
  if (/\s-[a-zA-Z]*a[a-zA-Z]*(\s|$)|--all\b/.test(commit)) {
    files.push(...git('diff', '--name-only', '--diff-filter=ACMR').split('\n').filter(Boolean))
  }
} catch {
  process.exit(0) // no es un repo git o git falló: que el propio commit dé el error
}
files = [...new Set(files)]
if (files.length === 0) process.exit(0)

// Imágenes permitidas: íconos y recursos de la app, nunca escaneos ni fotos.
const imagenPermitida = (f) => /^web\/(public|src)\//.test(f)
const reglas = [
  [/\.(pdf)$/i, 'PDF (facturas, hojas escaneadas, pedidos)'],
  [/\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/i, 'imagen (escaneo o foto)', imagenPermitida],
  [/\.(xlsx?|xlsm|ods|csv|tsv)$/i, 'planilla o export de datos'],
  [/\.(docx?|odt)$/i, 'documento de Word'],
  [/\.(zip|7z|rar|tar|gz|bak|dump|backup)$/i, 'archivo comprimido o respaldo'],
  [/(^|\/)\.env(\.local)?$/i, 'archivo .env local'],
  [/^collector-agent\/(config\.json|state\/)/, 'configuración local del agente'],
]

const problemas = []
for (const f of files) {
  for (const [re, motivo, excepcion] of reglas) {
    if (re.test(f) && !(excepcion && excepcion(f))) problemas.push(`  ${f}: ${motivo}`)
  }
}

// Claves secretas en el contenido que se agrega (no la publicable, que es pública por diseño).
try {
  const diff = git('diff', '--cached', '-U0', '--no-color')
  const secretos = [
    [/sb_secret_[A-Za-z0-9_-]{10,}/, 'clave secreta de Supabase (sb_secret_…)'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clave privada'],
  ]
  for (const linea of diff.split('\n')) {
    if (!linea.startsWith('+') || linea.startsWith('+++')) continue
    for (const [re, motivo] of secretos) if (re.test(linea)) problemas.push(`  contenido: ${motivo}`)
    // Claves antiguas de Supabase: son JWT; la anon es pública, la service_role no.
    for (const [, payload] of linea.matchAll(/eyJ[\w-]+\.(eyJ[\w-]+)\.[\w-]+/g)) {
      try {
        if (JSON.parse(Buffer.from(payload, 'base64url').toString()).role === 'service_role') {
          problemas.push('  contenido: clave service_role de Supabase')
        }
      } catch { /* no era un JWT */ }
    }
  }
} catch { /* sin diff legible: seguimos con la revisión por nombres */ }

if (problemas.length) {
  block(
    'Bloqueado: el repo es público y este commit trae cosas que no deben subirse:\n' +
    [...new Set(problemas)].join('\n') +
    '\nSácalas del área de preparación (git restore --staged <archivo>) y guárdalas fuera del repo. ' +
    'Si el usuario confirma que alguna es segura (p. ej. un ícono nuevo de la app), que la suba él o ajuste esta regla en .claude/hooks/guard-git.mjs.'
  )
}
process.exit(0)
