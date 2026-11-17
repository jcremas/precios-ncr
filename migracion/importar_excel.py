"""
Migración única desde la planilla Excel a Supabase.

NO sube nada a internet ni necesita claves. Lee el Excel y genera un archivo
SQL (migracion/salida/carga_inicial.sql) que después se pega en el SQL Editor
de Supabase. Tanto el Excel como el SQL generado quedan FUERA de git porque
contienen precios reales.

Requiere haber corrido supabase/migrations 0001 y 0002.

Uso:
    python3 migracion/importar_excel.py RUTA/AL/ARCHIVO.xlsm

Opciones:
    --anio MES=AÑO   año para hojas/columnas de mes sin año (ej. --anio JUL=2024)
                     Se puede repetir. Sin esto, un mes sin año frena la migración.

Qué importa:
    * LISTA_REFERENCIA  -> skus + lista_general (precio LISTA; mes del título).
                           SKUs con igual precio en todos los niveles -> sin descuento.
                           La columna "Minimo" NO se importa (no es un precio piso).
    * SKU_MAESTRO       -> skus (si la hoja existe; pisa descripción/familia/estado)
    * BASE_CLIENTES     -> clientes (si la hoja existe)
    * INDICE + una hoja por cliente ESPECIAL -> clientes ESPECIAL, su grilla de
      SKUs y sus precios por mes.
    * ENVIO_MENSUAL NO se importa (es una hoja de trabajo, no historial).
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path

import openpyxl

MESES = {
    "ENE": 1, "ENERO": 1, "FEB": 2, "FEBRERO": 2, "MAR": 3, "MARZO": 3,
    "ABR": 4, "ABRIL": 4, "MAY": 5, "MAYO": 5, "JUN": 6, "JUNIO": 6,
    "JUL": 7, "JULIO": 7, "AGO": 8, "AGOSTO": 8, "SET": 9, "SEP": 9,
    "SEPT": 9, "SETIEMBRE": 9, "SEPTIEMBRE": 9, "OCT": 10, "OCTUBRE": 10,
    "NOV": 11, "NOVIEMBRE": 11, "DIC": 12, "DICIEMBRE": 12,
}
NIVELES_LISTA = ["LISTA", "MEDIO", "AGRESIVO", "DIEGO", "MATAR"]
HOJAS_SISTEMA = {"CODIGO_VBA", "README", "ENVIO_MENSUAL", "INDICE",
                 "LISTA_REFERENCIA", "BASE_CLIENTES", "SKU_MAESTRO"}


class ErrorMigracion(Exception):
    pass


def parse_mes(texto: str, anios: dict[str, int]) -> dt.date:
    """'MAY 2026' / 'MAYO2026' / 'JUL' (+ --anio JUL=2024) -> date(2026,5,1)."""
    t = str(texto).upper().strip()
    m = re.search(r"([A-ZÁÉÍÓÚ]+)\s*-?\s*(\d{4})?", t)
    if not m or m.group(1) not in MESES:
        raise ErrorMigracion(f"No entiendo el mes '{texto}'")
    nombre, anio = m.group(1), m.group(2)
    if anio is None:
        if nombre not in anios:
            raise ErrorMigracion(
                f"El mes '{texto}' no tiene año. Indicalo con --anio {nombre}=AAAA")
        anio = anios[nombre]
    return dt.date(int(anio), MESES[nombre], 1)


def a_sku(valor) -> int | None:
    if valor is None:
        return None
    s = str(valor).strip()
    if s.endswith(".0"):
        s = s[:-2]
    return int(s) if s.isdigit() else None


def a_precio(valor) -> float | None:
    if isinstance(valor, bool) or valor is None:
        return None
    if isinstance(valor, (int, float)):
        return round(float(valor), 2) if valor > 0 else None
    return None  # textos, '#N/A', etc.


def q(v) -> str:
    """Literal SQL seguro."""
    if v is None:
        return "null"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, dt.date):
        return f"'{v.isoformat()}'"
    return "'" + str(v).replace("'", "''") + "'"


def filas(ws):
    for r in ws.iter_rows(values_only=True):
        if any(c is not None for c in r):
            yield r


def limpiar(texto) -> str | None:
    if texto is None:
        return None
    t = re.sub(r"\s+", " ", str(texto)).strip()
    return t or None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("excel")
    ap.add_argument("--anio", action="append", default=[])
    ap.add_argument("--salida", default=str(Path(__file__).parent / "salida" / "carga_inicial.sql"))
    args = ap.parse_args()

    anios = {}
    for a in args.anio:
        k, _, v = a.partition("=")
        anios[k.strip().upper()] = int(v)

    wb = openpyxl.load_workbook(args.excel, data_only=True, read_only=True)
    avisos: list[str] = []
    skus: dict[int, dict] = {}
    lista: list[tuple] = []
    clientes: dict[str, dict] = {}       # clave: nombre completo en mayúsculas
    precios: list[tuple] = []            # (nombre_cliente, sku, mes, precio)
    grillas: dict[str, set[int]] = {}

    # ---- LISTA_REFERENCIA -> lista general (precio LISTA) ----
    # Un SKU con el mismo precio en todos los niveles se marca "sin descuento".
    if "LISTA_REFERENCIA" in wb.sheetnames:
        rows = list(filas(wb["LISTA_REFERENCIA"]))
        mes_lista = parse_mes(rows[0][0].split("-")[-1], anios)
        cab = [str(c).strip().upper() if c else "" for c in rows[[i for i, r in enumerate(rows) if str(r[0]).strip().upper() == "SKU"][0]]]
        for r in rows:
            sku = a_sku(r[0])
            if sku is None:
                continue
            s = skus.setdefault(sku, {"descripcion": limpiar(r[1]), "familia": None, "estado": "ACTIVO", "admite_descuento": True})
            precios_nivel = [a_precio(r[cab.index(n)]) for n in NIVELES_LISTA]
            p_lista = precios_nivel[0]
            if p_lista is None:
                avisos.append(f"Lista {mes_lista:%m/%Y}: SKU {sku} sin precio (se omite de la lista)")
                continue
            if all(p == p_lista for p in precios_nivel):
                s["admite_descuento"] = False
            else:
                for nivel, desc, p in zip(NIVELES_LISTA, [0, 3, 6, 10, 15], precios_nivel):
                    esperado = round(p_lista * (1 - desc / 100) + 1e-9, 1)
                    if p is None or abs(p - esperado) > 0.051:
                        avisos.append(f"Lista {mes_lista:%m/%Y}: SKU {sku} nivel {nivel} = {p}, se esperaba {esperado}")
            lista.append((mes_lista, sku, p_lista))

    # ---- SKU_MAESTRO (opcional) ----
    if "SKU_MAESTRO" in wb.sheetnames:
        rows = list(filas(wb["SKU_MAESTRO"]))
        i_cab = next(i for i, r in enumerate(rows) if str(r[0]).strip().upper() == "SKU")
        cab = [str(c).strip().upper() if c else "" for c in rows[i_cab]]
        for r in rows[i_cab + 1:]:
            sku = a_sku(r[0])
            if sku is None:
                continue
            d = dict(zip(cab, r))
            skus[sku] = {
                "admite_descuento": skus.get(sku, {}).get("admite_descuento", True),
                "descripcion": limpiar(d.get("DESCRIPCION") or d.get("DESCRIPCIÓN")) or skus.get(sku, {}).get("descripcion"),
                "familia": limpiar(d.get("FAMILIA")),
                "estado": (limpiar(d.get("ESTADO")) or "ACTIVO").upper(),
            }

    # ---- BASE_CLIENTES (opcional) ----
    if "BASE_CLIENTES" in wb.sheetnames:
        rows = list(filas(wb["BASE_CLIENTES"]))
        i_cab = next(i for i, r in enumerate(rows) if any(str(c).strip().upper() == "NIVEL" for c in r if c))
        cab = [limpiar(c).upper() if c else "" for c in rows[i_cab]]

        def col(d, *nombres):
            for n in nombres:
                for k, v in d.items():
                    if k.startswith(n):
                        return limpiar(v)
            return None

        for r in rows[i_cab + 1:]:
            d = dict(zip(cab, r))
            nombre = col(d, "CLIENTE", "NOMBRE", "RAZON")
            if not nombre:
                continue
            clientes[nombre.upper()] = {
                "nombre": nombre, "nro_cliente": col(d, "NRO", "N°", "NUMERO", "CODIGO"),
                "segmento": col(d, "SEGMENTO"), "contacto": col(d, "CONTACTO"),
                "email": col(d, "EMAIL", "MAIL", "CORREO"),
                "condicion_pago": col(d, "CONDICION", "CONDICIÓN", "PAGO"),
                "nivel": (col(d, "NIVEL") or "LISTA").upper(),
                "observaciones": col(d, "OBSERV"), "hoja": None,
            }

    # ---- INDICE + hojas de cliente ----
    hoja_a_nombre = {}
    if "INDICE" in wb.sheetnames:
        for r in filas(wb["INDICE"]):
            if isinstance(r[0], int) and r[1] and r[2]:
                hoja_a_nombre[str(r[2])] = limpiar(r[1])

    for hoja in wb.sheetnames:
        if hoja in HOJAS_SISTEMA:
            continue
        nombre = hoja_a_nombre.get(hoja) or limpiar(hoja)
        if hoja not in hoja_a_nombre:
            avisos.append(f"Hoja '{hoja}' no está en INDICE: se usa el nombre de la pestaña")
        clave = nombre.upper()
        # Si BASE_CLIENTES tiene el nombre recortado, unificar.
        if clave not in clientes and limpiar(hoja).upper() in clientes:
            clientes[clave] = clientes.pop(limpiar(hoja).upper())
            clientes[clave]["nombre"] = nombre
        c = clientes.setdefault(clave, {"nombre": nombre, "nivel": "ESPECIAL"})
        if c.get("nivel") != "ESPECIAL":
            avisos.append(f"'{nombre}' tiene hoja propia pero nivel {c.get('nivel')}: se importan sus precios igual")
        c["hoja"] = hoja

        rows = list(filas(wb[hoja]))
        i_cab = next(i for i, r in enumerate(rows) if str(r[0]).strip().upper() == "SKU")
        meses = {}
        for j, h in enumerate(rows[i_cab]):
            if j >= 2 and h:
                meses[j] = parse_mes(h, anios)
        if len(set(meses.values())) != len(meses):
            raise ErrorMigracion(f"Hoja '{hoja}': hay meses repetidos")
        grilla = grillas.setdefault(clave, set())
        for r in rows[i_cab + 1:]:
            sku = a_sku(r[0])
            if sku is None:
                continue
            if sku not in skus:
                skus[sku] = {"descripcion": limpiar(r[1]), "familia": None, "estado": "ACTIVO", "admite_descuento": True}
                avisos.append(f"SKU {sku} aparece en '{hoja}' pero no en la lista: se crea")
            for j, mes in meses.items():
                v = r[j] if j < len(r) else None
                p = a_precio(v)
                if p is not None:
                    precios.append((clave, sku, mes, p))
                    grilla.add(sku)
                elif v not in (None, 0, ""):
                    avisos.append(f"'{hoja}' SKU {sku} {mes:%m/%Y}: valor '{v}' no es precio (se omite)")

    # ---- Generar SQL ----
    out = Path(args.salida)
    out.parent.mkdir(parents=True, exist_ok=True)
    L = ["-- Generado por migracion/importar_excel.py. CONTIENE PRECIOS REALES: no subir a git.",
         "begin;"]
    for sku, s in sorted(skus.items()):
        L.append("insert into skus (sku, descripcion, familia, estado, admite_descuento) values "
                 f"({sku}, {q(s['descripcion'] or f'SKU {sku}')}, {q(s['familia'])}, {q(s['estado'])}, "
                 f"{'true' if s.get('admite_descuento', True) else 'false'});")
    for c in clientes.values():
        nivel = (c.get("nivel") or "LISTA").upper()
        modalidad = "ESPECIAL" if nivel == "ESPECIAL" else "GENERICO"
        cotiza = nivel != "NO COTIZA"
        nivel = nivel if nivel in NIVELES_LISTA else None
        L.append("insert into clientes (nombre, nombre_hoja_excel, nro_cliente, segmento, contacto, email, "
                 "condicion_pago, modalidad, nivel, cotiza, observaciones) values ("
                 + ", ".join(q(c.get(k)) for k in ["nombre", "hoja", "nro_cliente", "segmento", "contacto",
                                                   "email", "condicion_pago"])
                 + f", {q(modalidad)}, {q(nivel)}, {'true' if cotiza else 'false'}, {q(c.get('observaciones'))});")
    # La base tilda todos los SKUs activos al crear un cliente: para los que
    # tienen hoja propia se deja tildado solo lo que compran.
    for clave, g in grillas.items():
        nombre = clientes[clave]["nombre"]
        sel = f"(select id from clientes where upper(nombre) = upper({q(nombre)}))"
        L.append(f"delete from cliente_skus where cliente_id = {sel}"
                 + (f" and sku not in ({', '.join(map(str, sorted(g)))});" if g else ";"))
        for sku in sorted(g):
            L.append(f"insert into cliente_skus (cliente_id, sku) values ({sel}, {sku}) on conflict do nothing;")
    for mes, sku, p in lista:
        L.append(f"insert into lista_general (mes, sku, precio) values ({q(mes)}, {sku}, {p});")
    for clave, sku, mes, p in precios:
        nombre = clientes[clave]["nombre"]
        L.append("insert into precios_cliente (cliente_id, sku, mes, precio, origen) values "
                 f"((select id from clientes where upper(nombre) = upper({q(nombre)})), {sku}, {q(mes)}, {p}, 'MIGRACION');")
    L.append("commit;")
    out.write_text("\n".join(L) + "\n", encoding="utf-8")

    # ---- Resumen ----
    niveles = {}
    for c in clientes.values():
        niveles[c.get("nivel")] = niveles.get(c.get("nivel"), 0) + 1
    print(f"SKUs: {len(skus)}")
    print(f"Clientes: {len(clientes)}  por nivel: {niveles}")
    print(f"Lista general: {len(lista)} SKUs con precio; sin descuento: "
          f"{sorted(k for k, v in skus.items() if not v.get('admite_descuento', True))}")
    print(f"Precios de clientes: {len(precios)} en meses {sorted({m.strftime('%m/%Y') for _, _, m, _ in precios})}")
    print(f"Avisos: {len(avisos)}")
    for a in avisos:
        print("  -", a)
    print(f"\nSQL generado en: {out}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ErrorMigracion as e:
        print("ERROR:", e)
        sys.exit(1)
