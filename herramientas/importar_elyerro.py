"""Arma datos/catalogo.json y las fotos de img/productos a partir del
catálogo de El Yerro (soluciones_para_negocios).

Se corre una sola vez para la carga inicial; después el catálogo se
mantiene desde el panel /editar. Volver a correrlo PISA lo editado.

    python herramientas/importar_elyerro.py [--bajar]

Con --bajar vuelve a descargar home.json, productos.json y las fotos.
"""
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "herramientas" / "origen-elyerro"
API = "https://elyerromenu.com/b/api/soluciones_para_negocios"
LADO_FOTO = 800  # px, lado mayor de las fotos publicadas

# Nombres cortos para las pestañas; el orden es el de El Yerro.
CATEGORIAS = {
    "sistema-de-control-de-ventas": ("software", "Software y apps", "codigo"),
    "equipamiento-para-negocios": ("equipos", "Equipos para negocios", "caja"),
    "seguridad-9ppe": ("seguridad", "Alarmas y seguridad", "escudo"),
    "otros-equipos-a-la-venta": ("otros", "Otros equipos", "tableta"),
    "servicios-anexos-al-yerro-menu": ("servicios", "Servicios", "llave"),
    "codigos-qr-del-negocio-lx": ("qr", "Códigos QR de pago", "qr"),
    "pepeleria-y-otros-insumos": ("insumos", "Papelería e insumos", "rollo"),
}


def bajar_json(url):
    pet = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(pet, timeout=60) as r:
        return json.load(r)


def bajar_archivo(url, destino):
    pet = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(pet, timeout=60) as r:
        destino.write_bytes(r.read())


def limpiar_texto(t):
    t = (t or "").replace("\r", "")
    t = re.sub(r"[ \t]+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


# Erratas y nombres poco claros de El Yerro, corregidos para la web.
NOMBRES = {
    "AxisCLoud Android": "AxisCloud Android",
    "APK Restaurante para Dptes": "APK Restaurante para dependientes",
    "AxisPos Version de Administración BackOffice": "AxisPos Administración (BackOffice)",
    "Bascula Digitales con Conexion RS232": "Básculas digitales con conexión RS232",
    "Escaner de Codigo de Barra Cableado USB": "Escáner de código de barras cableado USB",
    "Escáner de Codigo de Barras": "Escáner de código de barras",
    "Impresora Lasser 58mm / USB+Bluetooth": "Impresora térmica 58 mm USB + Bluetooth",
    "Impresora Térmica deTickets 80mm": "Impresora térmica de tiques 80 mm",
    "Impresora Térmica Para Tickets": "Impresora térmica para tiques",
    "Modelo: LTE MODELO TVS-1326 12V-2A 5.8G": "Router 4G LTE TVS-1326",
    "Módulo de Caja Para sistema de control de venta": "Módulo de caja para sistema de control de ventas",
    "Relojes para dependientes con botones 🛎️": "Relojes de llamado para dependientes 🛎️",
    "Tienda en Online AxisMarket": "Tienda online AxisMarket",
    "Tablet Android 7pulgadas": "Tablet Android 7 pulgadas",
    "Plan LLave 🔑en Mano Yerro Menú 😉👍": "Plan Llave en Mano Yerro Menú 🔑",
    "QR de Wallet Bitcoins (Trust Wallet)": "QR de billetera Bitcoin (Trust Wallet)",
    "Sistema de Alarma inalámbrico para seguridad del hogar": "Sistema de alarma inalámbrico para el hogar",
    "Alarma de seguridad personal, alarma personal portátil para mujeres": "Alarma de seguridad personal portátil",
}


def limpiar_nombre(n):
    n = re.sub(r"\s+", " ", n or "").strip().rstrip(",").strip()
    return NOMBRES.get(n, n)


def main():
    ORIGEN.mkdir(parents=True, exist_ok=True)
    (ORIGEN / "img").mkdir(exist_ok=True)
    if "--bajar" in sys.argv:
        inicio = bajar_json(f"{API}/home?view=index")
        (ORIGEN / "home.json").write_text(json.dumps(inicio, ensure_ascii=False), "utf-8")
        fichas = [bajar_json(f"{API}/product/{p['slug']}")["product"]
                  for p in inicio["products"]["products"]]
        (ORIGEN / "productos.json").write_text(json.dumps(fichas, ensure_ascii=False), "utf-8")
        for f in fichas:
            if f.get("logoUri"):
                bajar_archivo(f["logoUri"], ORIGEN / "img" / f"{f['slug']}.webp")

    inicio = json.loads((ORIGEN / "home.json").read_text("utf-8-sig"))
    fichas = {f["slug"]: f for f in json.loads((ORIGEN / "productos.json").read_text("utf-8-sig"))}
    cat_id_a_slug = {c["_id"]: c["slug"] for c in inicio["products"]["categories"]}

    salida_fotos = RAIZ / "img" / "productos"
    salida_fotos.mkdir(parents=True, exist_ok=True)

    productos = []
    for orden, p in enumerate(inicio["products"]["products"]):
        ficha = fichas.get(p["slug"], {})
        cat = CATEGORIAS[cat_id_a_slug[p["category"]]][0]
        foto = ""
        origen_foto = ORIGEN / "img" / f"{p['slug']}.webp"
        if origen_foto.exists():
            im = Image.open(origen_foto).convert("RGB")
            im.thumbnail((LADO_FOTO, LADO_FOTO), Image.LANCZOS)
            foto = f"img/productos/{p['slug']}.webp"
            im.save(RAIZ / foto, "WEBP", quality=80, method=6)
        oferta = p.get("offerPrice") if p.get("inOffer") and p.get("offerPrice") else None
        productos.append({
            "id": p["slug"],
            "nombre": limpiar_nombre(p["name"]),
            "categoria": cat,
            "precio": p.get("price") or 0,
            "precioOferta": oferta,
            "resumen": "",
            "descripcion": limpiar_texto(ficha.get("note") or p.get("note")),
            "foto": foto,
            "agotado": bool(p.get("soldOut")),
            "nuevo": bool(p.get("isNew")),
            "destacado": bool(p.get("trending")),
            "visible": True,
            "orden": orden,
        })

    c = inicio["catalogue"]
    datos = json.loads((RAIZ / "herramientas" / "plantilla-sitio.json").read_text("utf-8"))
    datos["condiciones"] = {
        "pedido": limpiar_texto(c.get("pickUpNote")),
        "entrega": limpiar_texto(c.get("deliveryNote")),
    }
    datos["categorias"] = [
        {"id": v[0], "nombre": v[1], "icono": v[2]} for v in CATEGORIAS.values()
    ]
    datos["productos"] = productos
    (RAIZ / "datos" / "catalogo.json").write_text(
        json.dumps(datos, ensure_ascii=False, indent=1), "utf-8")
    print(f"{len(productos)} productos, {sum(1 for p in productos if p['foto'])} con foto")


if __name__ == "__main__":
    main()
