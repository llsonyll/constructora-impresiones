#!/usr/bin/env python3
"""Genera los PDF de un pedido a proveedor a partir de un JSON (ver SKILL.md, paso 4).

    python3 -I pedido_pdf.py <pedido.json> <carpeta_salida>

Crea en <carpeta_salida>:
  - solicitud_<proveedor>_<fecha>.pdf  -> para enviar al proveedor (sin datos internos).
  - cotejo_<proveedor>_<fecha>.pdf     -> interno: estado de cada línea frente al catálogo
                                          (+ el escaneo original como anexo, si se indica).
Solo necesita reportlab (y Pillow para el anexo).
"""
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)

NEGOCIO = {  # respaldo si el JSON no trae "negocio" (valores de business_info a 11/2026)
    "nombre": "La Constructora",
    "ruc": "10238796771",
    "direccion": "Av. 28 de Julio S/N, costado del 3er puente de Ttio, Wanchaq, Cusco",
    "telefono": "959282738",
}
ESTADOS = {  # clave -> (etiqueta, color de fondo)
    "registrado": ("Registrado", colors.HexColor("#d9f2dd")),
    "confirmar": ("Por confirmar", colors.HexColor("#fff1c2")),
    "nuevo": ("No registrado", colors.HexColor("#f9d6d5")),
}
INK = colors.HexColor("#1f2933")
MUTED = colors.HexColor("#5f6b76")
LINE = colors.HexColor("#c9d1d9")
HEAD = colors.HexColor("#e8edf2")

ss = getSampleStyleSheet()
S = {
    "h1": ParagraphStyle("h1", parent=ss["Title"], fontSize=17, leading=21, alignment=0, textColor=INK, spaceAfter=2),
    "sub": ParagraphStyle("sub", parent=ss["Normal"], fontSize=9, leading=12, textColor=MUTED),
    "b": ParagraphStyle("b", parent=ss["Normal"], fontSize=9.5, leading=12.5, textColor=INK),
    "cell": ParagraphStyle("cell", parent=ss["Normal"], fontSize=9, leading=11.5, textColor=INK),
    "cell_sm": ParagraphStyle("cell_sm", parent=ss["Normal"], fontSize=8.4, leading=10, textColor=INK),
    "cell_xs": ParagraphStyle("cell_xs", parent=ss["Normal"], fontSize=7.9, leading=9.2, textColor=INK),
    "small": ParagraphStyle("small", parent=ss["Normal"], fontSize=7.8, leading=10, textColor=MUTED),
    "th": ParagraphStyle("th", parent=ss["Normal"], fontSize=8.5, leading=11, textColor=INK, fontName="Helvetica-Bold"),
    "h2": ParagraphStyle("h2", parent=ss["Heading2"], fontSize=12, leading=15, textColor=INK, spaceBefore=8, spaceAfter=4),
    "right": ParagraphStyle("right", parent=ss["Normal"], fontSize=9, leading=12, textColor=MUTED, alignment=TA_RIGHT),
}


def esc(t):
    return (str(t or "")).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def slug(t):
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]+", "_", t).strip("_").lower()[:40] or "proveedor"


def fecha_larga(iso):
    meses = "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split()
    d = date.fromisoformat(iso)
    return f"{d.day} de {meses[d.month - 1]} de {d.year}"


def pie(negocio):
    def draw(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(doc.leftMargin, 10 * mm, f"{negocio['nombre']} · RUC {negocio.get('ruc', '')} · "
                                                    f"Tel. {negocio.get('telefono', '')}")
        canvas.drawRightString(A4[0] - doc.rightMargin, 10 * mm, f"Página {doc.page}")
        canvas.restoreState()
    return draw


def encabezado(p, titulo):
    neg, prov = p["negocio"], p["proveedor"]
    izq = [Paragraph(esc(titulo), S["h1"]),
           Paragraph(f"<b>{esc(neg['nombre'])}</b> · RUC {esc(neg.get('ruc'))}<br/>{esc(neg.get('direccion'))}"
                     f"<br/>Tel. {esc(neg.get('telefono'))}", S["sub"])]
    der = [Paragraph(f"Cusco, {fecha_larga(p['fecha'])}", S["right"])]
    if p.get("numero"):
        der.append(Paragraph(f"N.° {esc(p['numero'])}", S["right"]))
    t = Table([[izq, der]], colWidths=[120 * mm, 60 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    prov_txt = f"<b>Proveedor:</b> {esc(prov['nombre'])}"
    if prov.get("ruc"):
        prov_txt += f" · RUC {esc(prov['ruc'])}"
    if prov.get("contacto"):
        prov_txt += f"<br/><b>Atención:</b> {esc(prov['contacto'])}"
    return [t, Spacer(1, 3 * mm), Paragraph(prov_txt, S["b"]), Spacer(1, 2 * mm)]


def tabla(rows, widths, zebra=True, fondos=None, pad=3):
    t = Table(rows, colWidths=widths, repeatRows=1)
    st = [("GRID", (0, 0), (-1, -1), 0.4, LINE), ("BACKGROUND", (0, 0), (-1, 0), HEAD),
          ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), pad),
          ("BOTTOMPADDING", (0, 0), (-1, -1), pad), ("LEFTPADDING", (0, 0), (-1, -1), 4),
          ("RIGHTPADDING", (0, 0), (-1, -1), 4)]
    for i in range(1, len(rows)):
        if fondos and fondos[i - 1] is not None:
            st.append(("BACKGROUND", (fondos[i - 1][0], i), (fondos[i - 1][1], i), fondos[i - 1][2]))
        elif zebra and i % 2 == 0:
            st.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#f6f8fa")))
    t.setStyle(TableStyle(st))
    return t


def solicitud(p, out):
    doc = SimpleDocTemplate(str(out), pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=12 * mm,
                            bottomMargin=16 * mm, title=f"Solicitud de pedido - {p['proveedor']['nombre']}",
                            author=p["negocio"]["nombre"])
    el = encabezado(p, p.get("titulo", "Solicitud de pedido"))
    el.append(Paragraph(esc(p.get("saludo", "Por medio de la presente solicitamos cotizar y atender el siguiente "
                                             "pedido:")), S["b"]))
    el.append(Spacer(1, 3 * mm))
    precio = p.get("columna_precio", True)
    head = [Paragraph(h, S["th"]) for h in (["N.°", "Descripción", "Cantidad"] +
                                            (["P. unit. (S/)", "Total (S/)"] if precio else []))]
    rows = [head]
    n = len(p["items"])  # listas largas: letra y relleno menores para que quepan en una hoja
    cs = S["cell_xs"] if n > 30 else S["cell_sm"] if n > 26 else S["cell"]
    for it in p["items"]:
        desc = esc(it["descripcion"])
        if it.get("detalle"):
            desc += f"<br/><font size=7.8 color='#5f6b76'>{esc(it['detalle'])}</font>"
        r = [Paragraph(esc(it["n"]), cs), Paragraph(desc, cs), Paragraph(esc(it.get("cantidad") or "—"), cs)]
        rows.append(r + (["", ""] if precio else []))
    w = [11 * mm, 99 * mm, 28 * mm, 21 * mm, 21 * mm] if precio else [12 * mm, 128 * mm, 40 * mm]
    el.append(tabla(rows, w, pad=1.2 if n > 30 else 1.8 if n > 26 else 3))
    if p.get("notas_solicitud"):
        el.append(Spacer(1, 4 * mm))
        el.append(Paragraph("<b>Notas</b>", S["b"]))
        for n in p["notas_solicitud"]:
            el.append(Paragraph(f"• {esc(n)}", S["b"]))
    el.append(Spacer(1, 1 * mm))
    firma = Table([["", "", ""], [Paragraph("Solicitado por<br/>" + esc(p["negocio"]["nombre"]), S["sub"]), "",
                                  Paragraph("Recibido / conforme<br/>" + esc(p["proveedor"]["nombre"]), S["sub"])]],
                  colWidths=[75 * mm, 30 * mm, 75 * mm], rowHeights=[9 * mm, None])
    firma.setStyle(TableStyle([("LINEABOVE", (0, 1), (0, 1), 0.6, MUTED), ("LINEABOVE", (2, 1), (2, 1), 0.6, MUTED),
                               ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    el.append(KeepTogether([firma]))
    doc.build(el, onFirstPage=pie(p["negocio"]), onLaterPages=pie(p["negocio"]))


def cotejo(p, out):
    doc = SimpleDocTemplate(str(out), pagesize=A4, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=14 * mm,
                            bottomMargin=18 * mm, title=f"Cotejo con catálogo - {p['proveedor']['nombre']}",
                            author=p["negocio"]["nombre"])
    el = encabezado(p, "Cotejo del pedido con el catálogo")
    if p.get("referencia"):
        el.append(Paragraph(f"<b>Origen:</b> {esc(p['referencia'])}", S["sub"]))
    cuenta = {k: sum(1 for it in p["items"] if it.get("estado") == k) for k in ESTADOS}
    res = Table([[Paragraph(f"<b>{cuenta[k]}</b><br/>{ESTADOS[k][0]}", S["cell"]) for k in ESTADOS] +
                 [Paragraph(f"<b>{len(p['items'])}</b><br/>Líneas del pedido", S["cell"])]],
                colWidths=[45 * mm] * 4)
    res.setStyle(TableStyle([("BACKGROUND", (i, 0), (i, 0), ESTADOS[k][1]) for i, k in enumerate(ESTADOS)] +
                            [("BOX", (0, 0), (-1, -1), 0.4, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
                             ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    el += [Spacer(1, 3 * mm), res, Spacer(1, 2 * mm),
           Paragraph("<b>Registrado</b>: el producto ya existe en el catálogo. <b>Por confirmar</b>: hay un producto "
                     "muy parecido, falta confirmar que es el mismo (marca, medida, modelo). <b>No registrado</b>: no "
                     "hay nada equivalente; habría que crearlo al recibir la compra.", S["small"])]

    head = [Paragraph(h, S["th"]) for h in ["N.°", "Pedido (hoja)", "Cant.", "Estado", "En el catálogo",
                                            "Stock", "Precio"]]
    rows, fondos = [head], []
    for it in p["items"]:
        e = it.get("estado", "nuevo")
        cat = ""
        if it.get("sku"):
            cat = f"<b>{esc(it['sku'])}</b> {esc(it.get('catalogo'))}"
            if it.get("inactivo"):
                cat += " <font color='#9a3412'>(inactivo)</font>"
        if it.get("obs"):
            cat += ("<br/>" if cat else "") + f"<font size=7.8 color='#5f6b76'>{esc(it['obs'])}</font>"
        desc = esc(it["descripcion"]) + (" <font color='#b45309'><b>(?)</b></font>" if it.get("duda") else "")
        stock = it.get("stock")
        precio = it.get("precio")
        rows.append([Paragraph(esc(it["n"]), S["cell"]), Paragraph(desc, S["cell"]),
                     Paragraph(esc(it.get("cantidad") or "—"), S["cell"]),
                     Paragraph(ESTADOS[e][0], S["cell"]), Paragraph(cat or "—", S["cell"]),
                     Paragraph("" if stock is None else f"{stock:g} {esc(it.get('unidad', ''))}", S["cell"]),
                     Paragraph("" if precio is None else f"S/ {precio:.2f}", S["cell"])])
        fondos.append((3, 3, ESTADOS[e][1]))
    el.append(Spacer(1, 3 * mm))
    el.append(tabla(rows, [10 * mm, 46 * mm, 17 * mm, 20 * mm, 57 * mm, 15 * mm, 21 * mm], fondos=fondos))

    if p.get("dudas"):
        el.append(Paragraph("Lecturas dudosas de la hoja", S["h2"]))
        for d in p["dudas"]:
            el.append(Paragraph(f"• {esc(d)}", S["b"]))
    if p.get("notas_cotejo"):
        el.append(Paragraph("Notas", S["h2"]))
        for d in p["notas_cotejo"]:
            el.append(Paragraph(f"• {esc(d)}", S["b"]))

    # "anexo_imagen": una ruta, o una lista de rutas / {"ruta", "titulo"} (p. ej. la hoja original y la revisión).
    anexos = p.get("anexo_imagen") or []
    for a in anexos if isinstance(anexos, list) else [anexos]:
        ruta, titulo = (a["ruta"], a.get("titulo")) if isinstance(a, dict) else (a, None)
        if not Path(ruta).exists():
            continue
        from PIL import Image as PILImage
        iw, ih = PILImage.open(ruta).size
        maxw, maxh = A4[0] - 24 * mm, A4[1] - 50 * mm
        k = min(maxw / iw, maxh / ih)
        el += [PageBreak(), Paragraph(esc(titulo or "Anexo: hoja original escaneada"), S["h2"]),
               Image(ruta, width=iw * k, height=ih * k)]
    doc.build(el, onFirstPage=pie(p["negocio"]), onLaterPages=pie(p["negocio"]))


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    p = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    p.setdefault("negocio", NEGOCIO)
    p.setdefault("fecha", date.today().isoformat())
    for it in p["items"]:
        if it.get("estado", "nuevo") not in ESTADOS:
            sys.exit(f"Estado inválido en la línea {it.get('n')}: {it.get('estado')} (usar {', '.join(ESTADOS)})")
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    base = f"{slug(p['proveedor'].get('corto') or p['proveedor']['nombre'])}_{p['fecha']}"
    a, b = out / f"solicitud_{base}.pdf", out / f"cotejo_{base}.pdf"
    solicitud(p, a)
    cotejo(p, b)
    print(a)
    print(b)


if __name__ == "__main__":
    main()
