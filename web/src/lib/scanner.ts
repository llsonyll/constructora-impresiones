import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

// Formatos de códigos de barras de retail/ferretería (EAN/UPC) + Code128/39/ITF de etiquetas internas.
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'] as const

export interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}

let detectorPromise: Promise<Detector> | null = null

/**
 * Detector nativo (Chrome/Android) si soporta EAN-13; si no (iPhone/Safari, Firefox), el ponyfill
 * ZXing en WebAssembly. El .wasm se sirve desde la propia app (no CDN) para que funcione offline.
 */
export function getDetector(): Promise<Detector> {
  detectorPromise ??= (async () => {
    const Native = (globalThis as { BarcodeDetector?: { new (o: object): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector
    if (Native && (await Native.getSupportedFormats()).includes('ean_13')) {
      return new Native({ formats: [...FORMATS] })
    }
    const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill')
    prepareZXingModule({
      overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
    })
    return new BarcodeDetector({ formats: [...FORMATS] }) as Detector
  })()
  return detectorPromise
}
