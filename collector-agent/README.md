# Agente de captura — Ferretería

Servicio de Windows que corre en DESKTOP-BJ2JFAA y detecta automáticamente cada trabajo de impresión/copia en:

- **PaperCut Print Logger** (CSV) → impresiones desde el PC hacia Epson L5590, L395 y la cola UPD del Konica.
- **SNMP del Konica bizhub C558** → copias walk-up (que no pasan por el PC).

**Modo actual: 100% local, sin Firebase.** No guarda nada en la nube — mantiene los últimos trabajos detectados en memoria y los sirve por `http://localhost:4000/jobs`, para que la app web (abierta en esa misma PC) los lea, muestre un aviso, y decida asignarlos a una venta o ignorarlos.

## 1. Instalar

```
cd collector-agent
npm install
```

Requiere Node.js instalado en el PC (LTS, 18+).

## 2. Configurar

```
cp config.example.json config.json
```

Revisa/ajusta en `config.json`:
- `konica.ip` / `konica.community` si cambian.
- `papercut.logsFolder` (ruta exacta de los CSV; confírmala en tu instalación real).
- `papercut.ignoredPrinterContains`: textos que, si aparecen en el nombre de la impresora, hacen que esa fila se ignore (fax, PDF/XPS/OneNote, colas viejas del Konica).
- `localServer.allowedOrigin`: los dominios exactos de las apps que consultan al agente, como lista: la app de impresiones (`https://llsonyll.github.io`) y el POS en Vercel (`https://<tu-app>.vercel.app`). También acepta un solo texto (formato anterior). Después de cambiarlo, reinicia el servicio.

## 3. Correr

```
npm start
```

Deja esto corriendo y prueba imprimir algo o hacer una copia en el Konica. En la consola vas a ver líneas como:

```
[servidor local] escuchando en http://localhost:4000 (origen permitido: https://llsonyll.github.io)
[konica] línea base establecida: BN=235588 Color=27831
trabajo detectado (#1): pc-print · 3 hojas · color=false
```

Si algo falla, revisa `state/agent.log`. Corta con Ctrl+C cuando quieras.

## 4. Probar desde el navegador

Sube `test-agente.html` (en la raíz de este paquete, junto a este README) a tu repositorio de GitHub Pages, junto a `index.html`. Ábrelo en `https://llsonyll.github.io/constructora-impresiones/test-agente.html` **en la misma PC** donde corre `npm start`:

- Botón "Probar conexión" → confirma que la página HTTPS puede hablarle al agente.
- Botón "Empezar a escuchar trabajos" → hace polling a `/jobs` cada 5s y va listando lo que el agente detecta, en vivo.

## 5. Instalar como servicio de Windows (para que corra siempre)

Ejecuta **como administrador**:

```
npm run install-service
```

Para quitarlo más adelante: `npm run uninstall-service` (también como administrador).

## Endpoints que expone el agente

- `GET /health` → `{ ok: true, agente, hora }` — solo para confirmar que está vivo.
- `GET /jobs` → arreglo con los últimos trabajos detectados (hasta `localServer.bufferSize`, 300 por defecto). Cada uno: `{ seq, id, fuente, impresora, timestamp, hojas, color, ... }`. No hay forma de "marcar como leído" desde el agente — eso lo maneja la app web con su propio localStorage.

## Cómo funciona la detección (resumen)

- **Konica (SNMP)**: cada 30s lee los contadores de copias B/N y color. Cuando detecta que subieron y luego dejan de moverse por 60s seguidos, registra la(s) captura(s) con la cantidad de hojas que subió cada contador. Los contadores de *impresión* del Konica solo se usan como referencia en el log (cross-check), nunca generan un trabajo — las impresiones PC vienen únicamente de PaperCut.
- **PaperCut (CSV)**: cada 90s busca el CSV más reciente, lo relee completo, y usa una clave (hora+impresora+documento+páginas+copias) para no reportar dos veces la misma fila — sobrevive a reinicios sin duplicar ni perder trabajos.
- Ambos loops guardan su estado de deduplicación en `state/*.json`, así que un reinicio del PC o del servicio no genera duplicados. El buffer de `/jobs` en cambio es solo en memoria: si reinicias el agente, se vacía (pero no se pierden trabajos "de verdad", porque nunca llegaron a asignarse a una venta).

## ⚠️ Cosas a verificar en tu entorno real (no pude probarlas desde aquí)

- El parseo del CSV asume el encabezado exacto que me pasaste; si tu versión de PaperCut agrega/quita una columna, revisa `HEADER` en `src/papercutWatcher.js`.
- Las colas de red del Epson (`L5590 Series(Network)`, `L395 Series(Network)`) y el contador `printsColor` del Konica están sin confirmar.
- Copias duplex o A3 en el Konica: no sabemos aún si mueven los mismos OIDs. Si ves conteos raros, avísame y ajustamos.
- `node-windows` necesita permisos de administrador para instalar el servicio la primera vez.

## Nota sobre Firebase

Por ahora el proyecto no tiene ninguna dependencia de Firebase (se sacó `firebase-admin` para no cargar peso ni vulnerabilidades de más mientras no se usa). Si más adelante deciden sincronizar a la nube, se agrega de nuevo con `npm install firebase-admin` y se retoma sin rehacer nada de la detección — este chat queda con el código de esa integración por si se necesita.

