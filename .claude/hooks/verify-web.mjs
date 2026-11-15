#!/usr/bin/env node
// Verificación del POS antes de dar un trabajo por terminado.
//   mark  (PostToolUse Edit|Write|MultiEdit): si se tocó código de web/, deja una marca para esta sesión.
//   check (Stop): si hay marca, corre `npm run typecheck` y `npm test` en web/. Si fallan, Claude no puede
//         terminar: recibe los errores y debe corregirlos. Sin cambios en web/ no corre nada.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const mode = process.argv[2]
const input = JSON.parse(readFileSync(0, 'utf8'))
const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
const webDir = join(projectDir, 'web')
const marker = join(tmpdir(), `lc-web-cambios-${String(input.session_id ?? 'x').replace(/\W/g, '')}`)

const out = (obj) => { process.stdout.write(JSON.stringify(obj)); process.exit(0) }

if (mode === 'mark') {
  const rel = relative(projectDir, input.tool_input?.file_path ?? '').replace(/\\/g, '/')
  if (/^web\/(src\/|package\.json$|tsconfig[^/]*\.json$|vite\.config\.ts$)/.test(rel)) {
    writeFileSync(marker, rel + '\n', { flag: 'a' })
  }
  process.exit(0)
}

if (mode !== 'check' || !existsSync(marker)) process.exit(0)

// Ya se le pidió corregir una vez en este turno: no lo dejamos en un bucle, pero el usuario queda avisado.
const segundoIntento = input.stop_hook_active === true

if (!existsSync(join(webDir, 'node_modules'))) {
  if (segundoIntento) out({ systemMessage: 'Verificación del POS omitida: faltan las dependencias de web/ (npm ci).' })
  out({
    decision: 'block',
    reason: 'Cambiaste código de web/ y no está verificado: faltan las dependencias. Corre `npm ci` en web/ y ' +
      'termina de nuevo para que se ejecuten typecheck y pruebas. Si no hay red, dilo en tu respuesta.',
  })
}

const fallos = []
for (const script of ['typecheck', 'test']) {
  try {
    execSync(`npm run --silent ${script}`, { cwd: webDir, stdio: 'pipe', encoding: 'utf8', timeout: 240_000 })
  } catch (e) {
    const log = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim().split('\n').slice(-40).join('\n')
    fallos.push(`### npm run ${script}\n${log || e.message}`)
  }
}

if (fallos.length === 0) {
  rmSync(marker, { force: true })
  out({ systemMessage: 'POS verificado: typecheck y pruebas en verde.' })
}

if (segundoIntento) {
  out({ systemMessage: 'Atención: el POS sigue con errores de typecheck o pruebas. Revisa la respuesta de Claude antes de aprobar el PR.' })
}

out({
  decision: 'block',
  reason: 'Cambiaste código de web/ y la verificación falló. Corrige esto antes de terminar ' +
    '(si el error no lo causaste tú, explícalo en tu respuesta):\n\n' + fallos.join('\n\n'),
})
