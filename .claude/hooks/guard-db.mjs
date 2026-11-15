#!/usr/bin/env node
// PreToolUse (MCP de Supabase: execute_sql, apply_migration). La base es la de producción y no hay otra.
//   - Lecturas (select): se aprueban sin preguntar.
//   - Cambios de esquema por execute_sql: se rechazan. Van en una migración del repo.
//   - Escrituras que rompen reglas del negocio (tocar stock a mano, recibir una OC): se rechazan.
//   - Escrituras sin la marca app.origen = 'claude': se rechazan, para que todo quede en Actividad «vía Claude».
//   - Las demás escrituras y toda migración: se le preguntan al usuario, mostrando qué se va a ejecutar.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const input = JSON.parse(readFileSync(0, 'utf8'))
const tool = input.tool_name ?? ''
const sql = String(input.tool_input?.query ?? '')
const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()

const decide = (permissionDecision, permissionDecisionReason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason },
  }))
  process.exit(0)
}
const resumen = (s) => (s.length > 600 ? s.slice(0, 600) + ' …' : s).trim()

// ---------- apply_migration ----------
if (tool.endsWith('__apply_migration')) {
  const name = String(input.tool_input?.name ?? '')
  let enRepo = true
  try {
    const dir = join(projectDir, 'supabase', 'migrations')
    enRepo = readdirSync(dir).some((f) => f.endsWith('.sql') && (f === name || f.replace(/^\d+_/, '').replace(/\.sql$/, '') === name))
  } catch { /* sin carpeta de migraciones a la vista: no lo exigimos */ }
  if (!enRepo) {
    decide('deny', `La migración "${name}" no está en supabase/migrations/. Primero crea el archivo ` +
      '(AAAAMMDDhhmmss_nombre.sql) en el repo y aplica ese mismo contenido con ese nombre: el repo es la fuente de verdad.')
  }
  decide('ask', `Aplicar la migración "${name}" a PRODUCCIÓN (fsrlcvuhcfbojbextoax).\n\n${resumen(sql)}`)
}

if (!tool.endsWith('__execute_sql')) process.exit(0)

// ---------- execute_sql ----------
const marcado = /set_config\(\s*'app\.origen'\s*,\s*'claude'/i.test(sql)

// Sin comentarios ni textos entre comillas, para no confundir "update" dentro de una nota con una sentencia.
const limpio = sql
  .replace(/--[^\n]*/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''")
  .replace(/'(?:[^']|'')*'/g, "''")
  .toLowerCase()

const ddl = /\b(create|alter|drop|truncate|grant|revoke|comment\s+on|reindex|vacuum)\b/.test(limpio)
if (ddl) {
  decide('deny', 'Los cambios de esquema no se hacen con execute_sql. Escribe una migración nueva en ' +
    'supabase/migrations/ y aplícala con apply_migration (o deja que el usuario la aplique).')
}

if (/\breceive_purchase_order\b/.test(limpio)) {
  decide('deny', 'Las órdenes de compra las recibe el admin en la app (Proveedores → Recibir). Déjala en borrador.')
}
if (/\bupdate\s+(public\.)?products\b[\s\S]*\bset\b[\s\S]*\bstock\s*=/.test(limpio) ||
    /\binsert\s+into\s+(public\.)?stock_movements\b/.test(limpio)) {
  decide('deny', 'El stock no se edita a mano: cambia solo por movimientos. Usa adjust_stock o bulk_adjust_stock ' +
    '(ver la habilidad /stock).')
}

// Escribe si modifica tablas o llama a una RPC que escribe (save_, create_, void_, adjust_…).
const escribe =
  /\b(insert\s+into|update\s+[\w."]+\s+set|delete\s+from|merge\s+into|copy\s+[\w."]+\s+from)\b/.test(limpio) ||
  /\b(public\.)?(save|create|register|void|adjust|bulk_adjust|close|reopen|reshape|link|import|set)_\w+\s*\(/.test(
    limpio.replace(/\bset_config\s*\(/g, ' '))

// Lectura: se aprueba aquí. execute_sql no está en los permisos de settings.json, así que si este hook fallara,
// Claude Code preguntaría por todo (falla hacia lo seguro), nunca dejaría pasar una escritura.
if (!escribe) decide('allow', 'Consulta de solo lectura.')

if (!marcado) {
  decide('deny', "Toda escritura empieza con los set_config de claims del admin y app.origen = 'claude' en la misma " +
    "llamada (ver /facturas, paso 5), para que quede en Actividad marcada «vía Claude». Agrégalos y vuelve a intentar.")
}

decide('ask', `Escritura en la base de PRODUCCIÓN:\n\n${resumen(sql)}`)
