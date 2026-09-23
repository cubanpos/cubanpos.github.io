# CUBANPOS — web y tienda

Página de **cubanpos.github.io**: portada tipo landing y tienda con pedido por
WhatsApp. Es un sitio estático (GitHub Pages), sin servidor ni base de datos.

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Todo el contenido (textos, productos, precios, horario, contactos, monedas) | `datos/catalogo.json` |
| Fotos de los productos | `img/productos/` |
| Fotos de la portada, logo e imagen para compartir | `img/marca/` |
| Estilos y lógica de la web | `assets/sitio.css`, `assets/sitio.js` |
| Panel de edición | `editar/` → **cubanpos.github.io/editar** |

## Cómo se edita

Desde **cubanpos.github.io/editar**, con una llave de acceso de GitHub
(token de grano fino, solo para este repositorio, permiso *Contents: Read and
write*). El panel explica cómo sacarla. Al pulsar **Publicar**, guarda
`catalogo.json` y las fotos nuevas en un solo commit; la web se actualiza en
uno o dos minutos. La llave queda solo en el navegador de quien edita: en el
código no hay contraseñas.

Cada publicación queda en el historial de commits y se puede deshacer.

## Herramientas

- `herramientas/importar_elyerro.py` hizo la carga inicial desde el catálogo
  de El Yerro. **Volver a correrlo pisa lo editado en el panel.**
- `herramientas/captura.sh URL ANCHO ALTO salida.png` saca una captura con
  Edge sin ventana; con `?quieto` en la dirección la página sale sin animaciones.
- `herramientas/marco.html?u=/&w=390` muestra la web con ancho de teléfono.

Si se cambian `assets/sitio.css` o `assets/sitio.js`, hay que subir el número
`?v=` en `index.html` para que los navegadores no usen la versión vieja.
