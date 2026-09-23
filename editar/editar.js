/* Panel de edición de CUBANPOS.
   Lee datos/catalogo.json del repositorio, lo edita en memoria y publica
   todo en un solo commit con la API de GitHub. La llave (token) queda solo
   en este navegador; en el código no hay ninguna contraseña. */
(function () {
  "use strict";

  var RUTA_DATOS = "datos/catalogo.json";
  var CLAVE_CFG = "cubanpos.panel.cfg";
  var CLAVE_BORRADOR = "cubanpos.panel.borrador";

  var cfg = { token: "", repo: "cubanpos/cubanpos.github.io", rama: "main", modo: "github" };
  var D = null;          // datos en edición
  var original = "";     // JSON tal como se cargó (para saber si hay cambios)
  var shaDatos = null;   // sha del blob de catalogo.json cuando se cargó
  var fotos = {};        // { "img/productos/x.webp": "data:image/webp;base64,..." } por subir
  var pestana = "productos";
  var editando = null;   // producto abierto en el editor
  var busqueda = { texto: "", cat: "" };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function leerLS(k, d) { try { var v = localStorage.getItem(k) || sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function guardarLS(k, v, sesion) {
    try { (sesion ? sessionStorage : localStorage).setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  function borrarLS(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) {} }

  /* ---------------- ventana de mensajes (siempre con botón) ---------------- */
  function ventana(titulo, texto, botones) {
    return new Promise(function (resolver) {
      var v = $("#ventana");
      $("#ventanaTitulo").textContent = titulo;
      $("#ventanaTexto").textContent = texto;
      var bs = botones || [{ texto: "Aceptar", valor: true, clase: "primario" }];
      $("#ventanaBotones").innerHTML = bs.map(function (b, i) {
        return '<button type="button" class="btn ' + (b.clase || "claro") + '" data-i="' + i + '">' + esc(b.texto) + "</button>";
      }).join("");
      $$("#ventanaBotones button").forEach(function (btn) {
        btn.onclick = function () { v.close(); resolver(bs[+btn.getAttribute("data-i")].valor); };
      });
      v.oncancel = function () { resolver(null); };
      v.showModal();
    });
  }

  /* ---------------- base64 con acentos ---------------- */
  function aB64(texto) {
    var bytes = new TextEncoder().encode(texto), bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function deB64(b64) {
    var bin = atob(b64.replace(/\s/g, "")), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ---------------- API de GitHub ---------------- */
  function api(ruta, opciones) {
    opciones = opciones || {};
    return fetch("https://api.github.com/repos/" + cfg.repo + ruta, {
      method: opciones.method || "GET",
      headers: { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: opciones.body ? JSON.stringify(opciones.body) : undefined,
      cache: "no-store"
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = t ? JSON.parse(t) : {};
        if (!r.ok) { var e = new Error(j.message || ("Error " + r.status)); e.estado = r.status; throw e; }
        return j;
      });
    });
  }
  function explicarError(e) {
    if (e.estado === 401) return "GitHub no aceptó la llave de acceso. Puede estar mal copiada o vencida: genera una nueva y vuelve a entrar.";
    if (e.estado === 403) return "La llave no tiene permiso para escribir. Al crearla, en Permissions › Contents hay que elegir «Read and write».";
    if (e.estado === 404) return "No se encontró el repositorio " + cfg.repo + " (rama " + cfg.rama + "), o la llave no tiene acceso a él.";
    if (e.estado === 422) return "GitHub rechazó el cambio: " + e.message;
    if (e instanceof TypeError) return "No hay conexión con GitHub. Revisa internet e inténtalo de nuevo; tus cambios siguen guardados en este navegador.";
    return e.message || String(e);
  }
  function leerDatosRemotos() {
    return api("/contents/" + RUTA_DATOS + "?ref=" + encodeURIComponent(cfg.rama)).then(function (j) {
      return { sha: j.sha, texto: deB64(j.content) };
    });
  }

  /* Publica catalogo.json y las fotos nuevas en un único commit. */
  function publicarCommit(archivos, mensaje) {
    var base;
    return api("/git/ref/heads/" + cfg.rama).then(function (ref) {
      base = ref.object.sha;
      return api("/git/commits/" + base);
    }).then(function (commit) {
      return Promise.all(archivos.map(function (a) {
        return api("/git/blobs", { method: "POST", body: { content: a.b64, encoding: "base64" } }).then(function (b) {
          return { path: a.ruta, mode: "100644", type: "blob", sha: b.sha };
        });
      })).then(function (arbol) {
        return api("/git/trees", { method: "POST", body: { base_tree: commit.tree.sha, tree: arbol } });
      });
    }).then(function (arbol) {
      return api("/git/commits", { method: "POST", body: { message: mensaje, tree: arbol.sha, parents: [base] } });
    }).then(function (nuevo) {
      return api("/git/refs/heads/" + cfg.rama, { method: "PATCH", body: { sha: nuevo.sha } });
    });
  }

  /* ---------------- carga ---------------- */
  function empezar(texto, sha) {
    original = texto;
    shaDatos = sha;
    D = JSON.parse(texto);
    fotos = {};
    var b = leerLS(CLAVE_BORRADOR, null);
    $("#entrada").hidden = true;
    $("#panel").hidden = false;
    pintar();
    if (b && b.datos && JSON.stringify(b.datos) !== JSON.stringify(D)) {
      ventana("Tienes cambios sin publicar",
        "La última vez editaste cosas en este navegador y no las publicaste. ¿Quieres recuperarlas?",
        [{ texto: "Descartarlas", valor: false }, { texto: "Recuperar", valor: true, clase: "primario" }]).then(function (si) {
        if (si) { D = b.datos; fotos = b.fotos || {}; pintar(); }
        else borrarLS(CLAVE_BORRADOR);
      });
    }
  }

  function entrar(ev) {
    ev.preventDefault();
    cfg.token = $("#token").value.trim();
    cfg.repo = $("#repo").value.trim() || cfg.repo;
    cfg.rama = $("#rama").value.trim() || "main";
    cfg.modo = "github";
    var btn = $("#formEntrada button[type=submit]");
    btn.disabled = true; btn.textContent = "Conectando…";
    leerDatosRemotos().then(function (r) {
      guardarLS(CLAVE_CFG, cfg, !$("#recordar").checked);
      if (!$("#recordar").checked) try { localStorage.removeItem(CLAVE_CFG); } catch (e) {}
      empezar(r.texto, r.sha);
    }).catch(function (e) {
      ventana("No se pudo entrar", explicarError(e));
    }).then(function () { btn.disabled = false; btn.textContent = "Entrar"; });
  }

  function soloProbar() {
    cfg.modo = "prueba";
    fetch("../" + RUTA_DATOS, { cache: "no-store" }).then(function (r) { return r.text(); }).then(function (t) {
      empezar(t, null);
      ventana("Modo de prueba", "Puedes cambiar todo y ver cómo queda aquí, pero «Publicar» no guarda en la web. Para conservar lo hecho, usa Respaldo › Descargar.");
    }).catch(function () { ventana("No se pudo abrir", "No se encontró el archivo del catálogo."); });
  }

  /* ---------------- cambios y borrador ---------------- */
  var tBorrador;
  function cambio() {
    var hay = JSON.stringify(D) !== JSON.stringify(JSON.parse(original)) || Object.keys(fotos).length > 0;
    $("#publicar").disabled = !hay || cfg.modo !== "github";
    $("#cabEstado").innerHTML = cfg.modo === "prueba" ? "<b>Modo de prueba</b> · no se publica" :
      (hay ? "<b>Hay cambios sin publicar</b> · guardados en este navegador" : '<span class="ok">Todo publicado</span> · ' + esc(cfg.repo));
    clearTimeout(tBorrador);
    tBorrador = setTimeout(function () {
      if (hay) { try { localStorage.setItem(CLAVE_BORRADOR, JSON.stringify({ datos: D, fotos: fotos })); } catch (e) {
        try { localStorage.setItem(CLAVE_BORRADOR, JSON.stringify({ datos: D, fotos: {} })); } catch (e2) {} } }
      else borrarLS(CLAVE_BORRADOR);
    }, 300);
  }

  function resumenCambios() {
    var antes = JSON.parse(original), partes = [];
    var ids = {}; antes.productos.forEach(function (p) { ids[p.id] = JSON.stringify(p); });
    var nuevos = 0, editados = 0, borrados = 0, ahora = {};
    D.productos.forEach(function (p) {
      ahora[p.id] = 1;
      if (!ids[p.id]) nuevos++; else if (ids[p.id] !== JSON.stringify(p)) editados++;
    });
    Object.keys(ids).forEach(function (id) { if (!ahora[id]) borrados++; });
    if (nuevos) partes.push(nuevos + (nuevos === 1 ? " producto nuevo" : " productos nuevos"));
    if (editados) partes.push(editados + (editados === 1 ? " producto editado" : " productos editados"));
    if (borrados) partes.push(borrados + (borrados === 1 ? " producto borrado" : " productos borrados"));
    var secciones = { categorias: "categorías", portada: "portada", aviso: "aviso", cifras: "cifras", pasos: "pasos", soluciones: "soluciones", tienda: "textos de la tienda",
      contacto: "contacto", horario: "horario", monedas: "monedas", preguntas: "preguntas", testimonios: "opiniones", condiciones: "condiciones", marca: "descripción" };
    Object.keys(secciones).forEach(function (k) { if (JSON.stringify(antes[k]) !== JSON.stringify(D[k])) partes.push(secciones[k]); });
    return partes.length ? partes.join(", ") : "cambios del panel";
  }

  function publicar() {
    if (cfg.modo !== "github") return;
    var btn = $("#publicar");
    btn.disabled = true; btn.textContent = "Publicando…";
    var resumen = resumenCambios();
    leerDatosRemotos().then(function (r) {
      if (r.sha === shaDatos) return true;
      return ventana("El catálogo cambió en otro equipo",
        "Alguien publicó cambios después de que abriste el panel. Si publicas ahora, tu versión los reemplaza.",
        [{ texto: "Cancelar", valor: false }, { texto: "Publicar mi versión", valor: true, clase: "primario" }]);
    }).then(function (seguir) {
      if (!seguir) throw { cancelado: true };
      var texto = JSON.stringify(D, null, 1);
      var archivos = [{ ruta: RUTA_DATOS, b64: aB64(texto) }];
      Object.keys(fotos).forEach(function (ruta) {
        var usada = JSON.stringify(D).indexOf(ruta) >= 0;
        if (usada) archivos.push({ ruta: ruta, b64: fotos[ruta].split(",")[1] });
      });
      return publicarCommit(archivos, "Panel: " + resumen).then(function () { return texto; });
    }).then(function (texto) {
      original = texto; fotos = {};
      return leerDatosRemotos().then(function (r) { shaDatos = r.sha; });
    }).then(function () {
      borrarLS(CLAVE_BORRADOR);
      cambio();
      ventana("Publicado", "Se guardó: " + resumen + ".\n\nLa web se actualiza en uno o dos minutos. Si no ves el cambio, recarga la página.");
    }).catch(function (e) {
      if (e && e.cancelado) return;
      ventana("No se pudo publicar", explicarError(e) + "\n\nTus cambios siguen guardados en este navegador.");
    }).then(function () { btn.textContent = "Publicar"; cambio(); });
  }

  /* ---------------- utilidades de edición ---------------- */
  function obtener(ruta) { return ruta.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, D); }
  function fijar(ruta, valor) {
    var ks = ruta.split("."), o = D;
    for (var i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = {}; o = o[ks[i]]; }
    o[ks[ks.length - 1]] = valor;
  }
  /* Campos con data-ruta se leen y escriben solos. data-tipo: numero | lista | casilla */
  function vincular(raiz) {
    $$("[data-ruta]", raiz).forEach(function (el) {
      var ruta = el.getAttribute("data-ruta"), tipo = el.getAttribute("data-tipo"), v = obtener(ruta);
      if (tipo === "casilla") el.checked = !!v;
      else if (tipo === "lista") el.value = (v || []).join(", ");
      else el.value = v == null ? "" : v;
      el.addEventListener(tipo === "casilla" || el.tagName === "SELECT" ? "change" : "input", function () {
        var n;
        if (tipo === "casilla") n = el.checked;
        else if (tipo === "numero") n = el.value === "" ? 0 : parseFloat(el.value);
        else if (tipo === "lista") n = el.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        else n = el.value;
        fijar(ruta, n);
        cambio();
      });
    });
  }
  function campo(etiqueta, ruta, opciones) {
    opciones = opciones || {};
    var attrs = 'data-ruta="' + esc(ruta) + '"' + (opciones.tipo ? ' data-tipo="' + opciones.tipo + '"' : "") + (opciones.placeholder ? ' placeholder="' + esc(opciones.placeholder) + '"' : "");
    var control = opciones.area ? "<textarea " + attrs + ' rows="' + (opciones.filas || 3) + '"></textarea>' :
      opciones.select ? "<select " + attrs + ">" + opciones.select + "</select>" :
      "<input " + attrs + (opciones.tipo === "numero" ? ' type="number" step="any"' : "") + ">";
    return '<label class="campo"><span>' + etiqueta + "</span>" + control + "</label>";
  }
  function slug(t) {
    return String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "producto";
  }
  function fotoSrc(ruta) { return fotos[ruta] || (ruta ? "../" + ruta : ""); }
  function nombreCat(id) { var c = D.categorias.filter(function (x) { return x.id === id; })[0]; return c ? c.nombre : "Sin categoría"; }
  function numero(v) { return Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  /* Reduce una foto a 800 px y la pasa a WebP (o JPEG si el navegador no sabe WebP). */
  function comprimir(archivo, lado) {
    return new Promise(function (ok, mal) {
      var img = new Image(), url = URL.createObjectURL(archivo);
      img.onload = function () {
        var k = Math.min(1, lado / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var d = c.toDataURL("image/webp", 0.82);
        if (d.indexOf("data:image/webp") !== 0) d = c.toDataURL("image/jpeg", 0.85);
        ok(d);
      };
      img.onerror = function () { mal(new Error("No se pudo leer la imagen.")); };
      img.src = url;
    });
  }
  function rutaFoto(carpeta, base, dataUrl) {
    return "img/" + carpeta + "/" + base + "-" + Date.now().toString(36) + (dataUrl.indexOf("image/webp") > 0 ? ".webp" : ".jpg");
  }

  /* ---------------- pestañas ---------------- */
  function pintar() {
    $$("#pestanas button").forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-p") === pestana)); });
    ({ productos: pProductos, categorias: pCategorias, textos: pTextos, contacto: pContacto, monedas: pMonedas, preguntas: pPreguntas, respaldo: pRespaldo })[pestana]();
    $$(".mbase").forEach(function (e) { e.textContent = D.monedas.base; });
    cambio();
  }

  /* Productos */
  function pProductos() {
    var q = busqueda.texto.trim() ? slug(busqueda.texto).split("-").filter(Boolean) : [];
    var orden = {}; D.categorias.forEach(function (c, i) { orden[c.id] = i; });
    var antes = {}; JSON.parse(original).productos.forEach(function (p) { antes[p.id] = JSON.stringify(p); });
    var lista = D.productos.slice().sort(function (a, b) { return ((orden[a.categoria] || 0) - (orden[b.categoria] || 0)) || (a.orden - b.orden); })
      .filter(function (p) {
        if (busqueda.cat && p.categoria !== busqueda.cat) return false;
        var h = slug(p.nombre + " " + p.descripcion);
        return q.every(function (w) { return h.indexOf(w) >= 0; });
      });
    $("#cuerpo").innerHTML =
      '<div class="barra-lista"><label class="campo"><span>Buscar</span><input id="pBuscar" type="search" placeholder="Buscar producto…" value="' + esc(busqueda.texto) + '"></label>' +
      '<label class="campo" style="flex:0 1 240px"><span>Categoría</span><select id="pCat"><option value="">Todas las categorías</option>' +
      D.categorias.map(function (c) { return '<option value="' + esc(c.id) + '"' + (busqueda.cat === c.id ? " selected" : "") + ">" + esc(c.nombre) + "</option>"; }).join("") + "</select></label>" +
      '<button class="btn primario" id="pNuevo" type="button">+ Nuevo producto</button></div>' +
      '<p class="nota" style="margin:0 0 10px">' + lista.length + " de " + D.productos.length + " productos. Toca las etiquetas para cambiarlas al instante; ✎ abre la ficha completa.</p>" +
      '<div class="lista">' + lista.map(function (p) {
        var oferta = p.precioOferta && p.precioOferta < p.precio;
        return '<div class="fila-p' + (p.visible === false ? " oculto" : "") + (antes[p.id] !== JSON.stringify(p) ? " cambiado" : "") + '" data-id="' + esc(p.id) + '">' +
          (p.foto ? '<img src="' + esc(fotoSrc(p.foto)) + '" alt="" loading="lazy">' : '<span class="sin">Sin foto</span>') +
          "<div><b>" + esc(p.nombre) + "</b><small>" + esc(nombreCat(p.categoria)) + "</small></div>" +
          '<div class="marcas">' +
          '<button type="button" class="marca-e' + (p.visible === false ? " si oculto" : "") + '" data-alternar="visible">' + (p.visible === false ? "Oculto" : "Visible") + "</button>" +
          '<button type="button" class="marca-e' + (p.agotado ? " si agotado" : "") + '" data-alternar="agotado">' + (p.agotado ? "Agotado" : "Hay") + "</button>" +
          '<button type="button" class="marca-e' + (p.nuevo ? " si nuevo" : "") + '" data-alternar="nuevo">Nuevo</button>' +
          '<button type="button" class="marca-e' + (p.destacado ? " si popular" : "") + '" data-alternar="destacado">Popular</button></div>' +
          '<div class="precio">' + (p.precio ? (oferta ? "<s>" + numero(p.precio) + "</s>" + numero(p.precioOferta) : numero(p.precio)) : "Consultar") + "</div>" +
          '<div class="acciones"><button type="button" data-mover="-1" title="Subir">↑</button><button type="button" data-mover="1" title="Bajar">↓</button><button type="button" data-editar title="Editar">✎</button></div></div>';
      }).join("") + "</div>";
    $("#pBuscar").addEventListener("input", function (e) { busqueda.texto = e.target.value; var pos = e.target.selectionStart; pProductos(); var b = $("#pBuscar"); b.focus(); b.setSelectionRange(pos, pos); });
    $("#pCat").addEventListener("change", function (e) { busqueda.cat = e.target.value; pProductos(); });
    $("#pNuevo").addEventListener("click", function () { abrirEditor(null); });
  }
  function porId(id) { return D.productos.filter(function (p) { return p.id === id; })[0]; }
  function moverProducto(id, dir) {
    var p = porId(id);
    var hermanos = D.productos.filter(function (x) { return x.categoria === p.categoria; }).sort(function (a, b) { return a.orden - b.orden; });
    var i = hermanos.indexOf(p), j = i + dir;
    if (j < 0 || j >= hermanos.length) return;
    hermanos.splice(i, 1); hermanos.splice(j, 0, p);
    var base = Math.min.apply(null, hermanos.map(function (x) { return x.orden; }));
    hermanos.forEach(function (x, k) { x.orden = base + k; });
    pintar();
  }

  function abrirEditor(p) {
    editando = p;
    var nuevo = !p;
    $("#editorTitulo").textContent = nuevo ? "Nuevo producto" : "Editar producto";
    $("#eCategoria").innerHTML = D.categorias.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.nombre) + "</option>"; }).join("");
    var v = p || { nombre: "", categoria: busqueda.cat || D.categorias[0].id, precio: 0, precioOferta: null, resumen: "", descripcion: "", foto: "", agotado: false, nuevo: true, destacado: false, visible: true,
      orden: Math.max.apply(null, D.productos.map(function (x) { return x.orden; }).concat([0])) + 1 };
    $("#eNombre").value = v.nombre; $("#eCategoria").value = v.categoria; $("#eOrden").value = v.orden;
    $("#ePrecio").value = v.precio || 0; $("#eOferta").value = v.precioOferta || "";
    $("#eResumen").value = v.resumen || ""; $("#eDescripcion").value = v.descripcion || "";
    $("#eVisible").checked = v.visible !== false; $("#eAgotado").checked = !!v.agotado; $("#eNuevo").checked = !!v.nuevo; $("#eDestacado").checked = !!v.destacado;
    $("#fotoVista").innerHTML = v.foto ? '<img src="' + esc(fotoSrc(v.foto)) + '" alt="">' : "<span>Sin foto</span>";
    $("#fotoVista").setAttribute("data-foto", v.foto || "");
    $("#eBorrar").hidden = nuevo;
    $("#editor").showModal();
    $("#eNombre").focus();
  }
  function guardarEditor() {
    var nombre = $("#eNombre").value.trim();
    if (!nombre) { ventana("Falta el nombre", "Escribe el nombre del producto antes de guardar."); return false; }
    var p = editando;
    if (!p) {
      var id = slug(nombre), n = 2;
      while (porId(id)) id = slug(nombre) + "-" + n++;
      p = { id: id }; D.productos.push(p);
    }
    var precio = parseFloat($("#ePrecio").value) || 0, oferta = parseFloat($("#eOferta").value);
    if (oferta && oferta >= precio) { ventana("Revisa la oferta", "El precio de oferta tiene que ser menor que el precio normal. Si no hay oferta, deja el campo vacío."); if (!editando) D.productos.pop(); return false; }
    p.nombre = nombre; p.categoria = $("#eCategoria").value; p.orden = parseInt($("#eOrden").value, 10) || 0;
    p.precio = precio; p.precioOferta = oferta > 0 ? oferta : null;
    p.resumen = $("#eResumen").value.trim(); p.descripcion = $("#eDescripcion").value.replace(/\r/g, "").trim();
    p.foto = $("#fotoVista").getAttribute("data-foto") || "";
    p.visible = $("#eVisible").checked; p.agotado = $("#eAgotado").checked; p.nuevo = $("#eNuevo").checked; p.destacado = $("#eDestacado").checked;
    pintar();
    return true;
  }

  /* Categorías */
  var ICONOS = { codigo: "Código", caja: "Caja", escudo: "Escudo", tableta: "Tableta", llave: "Llave", qr: "QR", rollo: "Rollo de papel", todo: "Cuadrícula" };
  function pCategorias() {
    var cuenta = {}; D.productos.forEach(function (p) { cuenta[p.categoria] = (cuenta[p.categoria] || 0) + 1; });
    $("#cuerpo").innerHTML = '<div class="tarjeta"><h2>Categorías de la tienda</h2><p class="nota">El orden de esta lista es el de las pestañas de la tienda. Solo se puede borrar una categoría vacía.</p>' +
      D.categorias.map(function (c, i) {
        return '<div class="categoria-fila" data-i="' + i + '">' + campo("Nombre", "categorias." + i + ".nombre") +
          '<label class="campo"><span>Identificador</span><input value="' + esc(c.id) + '" disabled></label>' +
          campo("Icono", "categorias." + i + ".icono", { select: Object.keys(ICONOS).map(function (k) { return '<option value="' + k + '">' + ICONOS[k] + "</option>"; }).join("") }) +
          '<div class="botones-fila"><button type="button" data-cmover="-1" title="Subir">↑</button><button type="button" data-cmover="1" title="Bajar">↓</button>' +
          '<button type="button" data-cborrar title="Borrar">✕</button></div><small class="nota">' + (cuenta[c.id] || 0) + " productos</small></div>";
      }).join("") + '<button class="btn claro" type="button" id="cNueva">+ Nueva categoría</button></div>';
    vincular($("#cuerpo"));
    $("#cNueva").addEventListener("click", function () {
      var id = "categoria", n = 2; while (D.categorias.some(function (c) { return c.id === id; })) id = "categoria-" + n++;
      D.categorias.push({ id: id, nombre: "Nueva categoría", icono: "todo" }); pintar();
    });
  }

  /* Textos */
  function pTextos() {
    var opcionesProd = '<option value="">— Sin producto —</option>' + D.productos.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.nombre) + "</option>"; }).join("");
    var opcionesCat = D.categorias.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.nombre) + "</option>"; }).join("");
    if (!D.soluciones.categoria) D.soluciones.categoria = D.categorias[0].id;
    $("#cuerpo").innerHTML =
      '<div class="tarjeta"><h2>Franja de aviso (arriba de todo)</h2><label class="casilla"><input type="checkbox" data-ruta="aviso.activo" data-tipo="casilla"> Mostrar la franja</label>' +
      campo("Texto", "aviso.texto") + campo("Al tocarla abre este producto", "aviso.producto", { select: opcionesProd }) + "</div>" +
      '<div class="tarjeta"><h2>Portada</h2>' + campo("Etiqueta pequeña", "portada.etiqueta") + campo("Título grande", "portada.titulo") +
      campo("Palabras que van rotando después de «Para» (separadas por comas)", "portada.rotativas", { tipo: "lista" }) + campo("Texto", "portada.texto", { area: true }) + campo("Sello destacado bajo el texto (vacío = no se muestra)", "portada.sello") +
      '<h3>Fotos de la portada</h3><div class="fila3">' + (D.portada.fotos || []).map(function (f, i) {
        return '<div class="editor-foto"><div class="foto-vista"><img src="' + esc(fotoSrc(f)) + '" alt=""></div><label class="btn claro ancho"><input type="file" accept="image/*" hidden data-foto-portada="' + i + '">Cambiar</label></div>';
      }).join("") + "</div></div>" +
      '<div class="tarjeta"><h2>Cifras bajo la portada</h2><p class="nota">Puedes escribir {productos} o {categorias} y se cuentan solos.</p>' +
      (D.cifras || []).map(function (c, i) { return '<div class="fila2">' + campo("Valor", "cifras." + i + ".valor") + campo("Texto", "cifras." + i + ".texto") + "</div>"; }).join("") + "</div>" +
      '<div class="tarjeta"><h2>Soluciones (bloques grandes)</h2>' + campo("Título", "soluciones.titulo") + campo("Texto", "soluciones.texto", { area: true }) +
      campo("Categoría que se muestra (hasta 9 productos, en su orden)", "soluciones.categoria", { select: opcionesCat }) + "</div>" +
      '<div class="tarjeta"><h2>Tienda</h2>' + campo("Título", "tienda.titulo") + campo("Texto", "tienda.texto", { area: true }) + "</div>" +
      '<div class="tarjeta"><h2>Cómo trabajamos</h2>' + (D.pasos || []).map(function (p, i) {
        return "<h3>Paso " + (i + 1) + "</h3>" + campo("Título", "pasos." + i + ".titulo") + campo("Texto", "pasos." + i + ".texto", { area: true, filas: 2 });
      }).join("") + "</div>" +
      '<div class="tarjeta"><h2>Condiciones</h2>' + campo("Qué pasa al pedir (sale en Preguntas)", "condiciones.pedido", { area: true, filas: 4 }) +
      campo("Pago y entrega (sale al pie del pedido)", "condiciones.entrega", { area: true, filas: 4 }) + "</div>" +
      '<div class="tarjeta"><h2>Descripción del negocio</h2>' + campo("Sale en el pie de la web y en Google", "marca.descripcion", { area: true, filas: 3 }) + "</div>";
    vincular($("#cuerpo"));
  }

  /* Contacto y horario */
  var DIAS = [["lun", "Lunes"], ["mar", "Martes"], ["mie", "Miércoles"], ["jue", "Jueves"], ["vie", "Viernes"], ["sab", "Sábado"], ["dom", "Domingo"]];
  function pContacto() {
    var H = D.horario;
    $("#cuerpo").innerHTML = '<div class="tarjeta"><h2>Contacto</h2><p class="nota">Números con código de país y sin signos, por ejemplo 5358146895.</p><div class="fila2">' +
      campo("WhatsApp principal", "contacto.whatsapp") + campo("WhatsApp que recibe los pedidos", "contacto.whatsappPedidos") +
      campo("Otro teléfono", "contacto.telefono2") + campo("Correo", "contacto.correo") + campo("Dirección", "contacto.direccion") + campo("Telegram (usuario)", "contacto.telegram", { placeholder: "@usuario" }) +
      campo("Facebook (enlace)", "contacto.facebook", { placeholder: "https://facebook.com/…" }) + campo("Instagram (enlace)", "contacto.instagram", { placeholder: "https://instagram.com/…" }) + "</div></div>" +
      '<div class="tarjeta"><h2>Horario</h2><p class="nota">La web calcula «Abierto ahora» con la hora de Cuba, esté donde esté el cliente.</p>' +
      campo("Modo", "horario.modo", { select: '<option value="horario">Según el horario de abajo</option><option value="24h">Abierto las 24 horas</option><option value="cerrado">Cerrado temporalmente</option>' }) +
      campo("Nota cuando está cerrado temporalmente", "horario.nota", { placeholder: "Ej.: Volvemos el lunes 6" }) +
      DIAS.map(function (d) {
        var v = H.dias[d[0]];
        return '<div class="dia-fila" data-dia="' + d[0] + '"><b>' + d[1] + '</b><label class="casilla"><input type="checkbox" data-abre' + (v ? " checked" : "") + "> Abre</label>" +
          '<label class="campo"><span>Desde</span><input type="time" data-desde value="' + (v ? v[0] : "09:00") + '"' + (v ? "" : " disabled") + "></label>" +
          '<label class="campo"><span>Hasta</span><input type="time" data-hasta value="' + (v ? v[1] : "17:00") + '"' + (v ? "" : " disabled") + "></label></div>";
      }).join("") + "</div>";
    vincular($("#cuerpo"));
    $$(".dia-fila").forEach(function (fila) {
      function leer() {
        var abre = $("[data-abre]", fila).checked;
        $("[data-desde]", fila).disabled = !abre; $("[data-hasta]", fila).disabled = !abre;
        H.dias[fila.getAttribute("data-dia")] = abre ? [$("[data-desde]", fila).value || "09:00", $("[data-hasta]", fila).value || "17:00"] : null;
        cambio();
      }
      $$("input", fila).forEach(function (i) { i.addEventListener("change", leer); });
    });
  }

  /* Monedas */
  function pMonedas() {
    var M = D.monedas, ops = M.lista.map(function (m) { return '<option value="' + m.codigo + '">' + m.codigo + " — " + esc(m.nombre) + "</option>"; }).join("");
    $("#cuerpo").innerHTML = '<div class="tarjeta"><h2>Monedas</h2><p class="nota">Los precios se escriben en la moneda base. La tasa dice cuánto vale 1 de la moneda base en cada moneda (por ejemplo, 1 USD = 400 CUP). El cliente elige la moneda arriba a la derecha si hay más de una activa.</p><div class="fila2">' +
      campo("Moneda base de los precios", "monedas.base", { select: ops }) + campo("Moneda que se ve al entrar", "monedas.porDefecto", { select: ops }) + "</div>" +
      M.lista.map(function (m, i) {
        return '<div class="moneda-fila"><b>' + m.codigo + "</b>" + campo("Nombre", "monedas.lista." + i + ".nombre") + campo("Tasa", "monedas.lista." + i + ".tasa", { tipo: "numero" }) +
          '<label class="casilla"><input type="checkbox" data-ruta="monedas.lista.' + i + '.activa" data-tipo="casilla"> Activa</label></div>';
      }).join("") + "</div>";
    vincular($("#cuerpo"));
  }

  /* Preguntas y opiniones */
  function pPreguntas() {
    D.testimonios = D.testimonios || [];
    $("#cuerpo").innerHTML = '<div class="tarjeta"><h2>Preguntas frecuentes</h2>' + D.preguntas.map(function (q, i) {
      return '<div class="pregunta-fila"><div>' + campo("Pregunta", "preguntas." + i + ".pregunta") + campo("Respuesta", "preguntas." + i + ".respuesta", { area: true, filas: 2 }) + "</div>" +
        '<div class="botones-fila"><button type="button" data-lmover="preguntas,' + i + ',-1">↑</button><button type="button" data-lmover="preguntas,' + i + ',1">↓</button><button type="button" data-lborrar="preguntas,' + i + '">✕</button></div></div>';
    }).join("") + '<button class="btn claro" type="button" data-lnueva="preguntas">+ Nueva pregunta</button></div>' +
      '<div class="tarjeta"><h2>Opiniones de clientes</h2><p class="nota">La sección solo aparece si hay al menos una. Usa opiniones reales, con el nombre del negocio: dan mucha más confianza.</p>' +
      D.testimonios.map(function (t, i) {
        return '<div class="pregunta-fila"><div><div class="fila2">' + campo("Nombre", "testimonios." + i + ".nombre") + campo("Negocio y lugar", "testimonios." + i + ".negocio") + "</div>" +
          campo("Opinión", "testimonios." + i + ".texto", { area: true, filas: 2 }) + '</div><div class="botones-fila"><button type="button" data-lborrar="testimonios,' + i + '">✕</button></div></div>';
      }).join("") + '<button class="btn claro" type="button" data-lnueva="testimonios">+ Nueva opinión</button></div>';
    vincular($("#cuerpo"));
  }

  /* Respaldo */
  function pRespaldo() {
    $("#cuerpo").innerHTML = '<div class="tarjeta"><h2>Respaldo</h2><p class="nota">Descarga una copia de todo el contenido o recupera una anterior. Las fotos no van dentro: siguen en la web.</p>' +
      '<div class="barra-lista"><button class="btn claro" type="button" id="rBajar">Descargar copia (.json)</button>' +
      '<label class="btn claro"><input type="file" accept=".json,application/json" hidden id="rSubir">Cargar una copia</label>' +
      '<button class="btn peligro" type="button" id="rDescartar">Descartar cambios sin publicar</button></div>' +
      '<p class="nota">Cada publicación queda en el historial de GitHub: <a href="https://github.com/' + esc(cfg.repo) + '/commits/' + esc(cfg.rama) + '" target="_blank" rel="noopener">ver historial</a>.</p></div>';
    $("#rBajar").addEventListener("click", function () {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(D, null, 1)], { type: "application/json" }));
      a.download = "cubanpos-catalogo-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a); a.click(); a.remove();
    });
    $("#rSubir").addEventListener("change", function (e) {
      var f = e.target.files[0]; if (!f) return;
      f.text().then(function (t) {
        var j = JSON.parse(t);
        if (!j.productos || !j.categorias) throw new Error();
        D = j; pintar(); ventana("Copia cargada", "Revisa que todo esté bien y pulsa Publicar para ponerla en la web.");
      }).catch(function () { ventana("Archivo no válido", "Ese archivo no es una copia del catálogo de CUBANPOS."); });
    });
    $("#rDescartar").addEventListener("click", function () {
      ventana("¿Descartar los cambios?", "Se pierde todo lo que no publicaste y vuelve a quedar como está en la web.",
        [{ texto: "Cancelar", valor: false }, { texto: "Descartar", valor: true, clase: "peligro" }]).then(function (si) {
        if (si) { D = JSON.parse(original); fotos = {}; borrarLS(CLAVE_BORRADOR); pintar(); }
      });
    });
  }

  /* ---------------- eventos ---------------- */
  function eventos() {
    $("#formEntrada").addEventListener("submit", entrar);
    $("#soloProbar").addEventListener("click", soloProbar);
    $("#publicar").addEventListener("click", publicar);
    $("#salir").addEventListener("click", function () {
      ventana("Salir del panel", "¿Olvidar la llave de acceso en este equipo? Los cambios sin publicar se conservan.",
        [{ texto: "Cancelar", valor: null }, { texto: "Salir y olvidar la llave", valor: true, clase: "peligro" }]).then(function (si) {
        if (!si) return;
        borrarLS(CLAVE_CFG); location.reload();
      });
    });
    $("#pestanas").addEventListener("click", function (e) {
      var b = e.target.closest("[data-p]"); if (!b) return;
      pestana = b.getAttribute("data-p"); pintar(); window.scrollTo(0, 0);
    });
    $("#cuerpo").addEventListener("click", function (e) {
      var t = e.target.closest("[data-alternar],[data-mover],[data-editar],[data-cmover],[data-cborrar],[data-lmover],[data-lborrar],[data-lnueva]");
      if (!t) return;
      var fila = t.closest("[data-id]"), p = fila && porId(fila.getAttribute("data-id"));
      if (t.hasAttribute("data-alternar")) {
        var k = t.getAttribute("data-alternar");
        p[k] = k === "visible" ? p.visible === false : !p[k];
        pintar();
      } else if (t.hasAttribute("data-mover")) moverProducto(p.id, +t.getAttribute("data-mover"));
      else if (t.hasAttribute("data-editar")) abrirEditor(p);
      else if (t.hasAttribute("data-cmover")) {
        var i = +t.closest("[data-i]").getAttribute("data-i"), j = i + +t.getAttribute("data-cmover");
        if (j < 0 || j >= D.categorias.length) return;
        var c = D.categorias.splice(i, 1)[0]; D.categorias.splice(j, 0, c); pintar();
      } else if (t.hasAttribute("data-cborrar")) {
        var ci = +t.closest("[data-i]").getAttribute("data-i"), cat = D.categorias[ci];
        if (D.productos.some(function (x) { return x.categoria === cat.id; })) {
          ventana("La categoría tiene productos", "Pasa sus productos a otra categoría o bórralos antes de borrar «" + cat.nombre + "».");
        } else { D.categorias.splice(ci, 1); pintar(); }
      } else if (t.hasAttribute("data-lmover")) {
        var a = t.getAttribute("data-lmover").split(","), L = D[a[0]], x = +a[1], y = x + +a[2];
        if (y < 0 || y >= L.length) return;
        L.splice(y, 0, L.splice(x, 1)[0]); pintar();
      } else if (t.hasAttribute("data-lborrar")) {
        var b2 = t.getAttribute("data-lborrar").split(","); D[b2[0]].splice(+b2[1], 1); pintar();
      } else if (t.hasAttribute("data-lnueva")) {
        var cual = t.getAttribute("data-lnueva");
        D[cual].push(cual === "preguntas" ? { pregunta: "", respuesta: "" } : { nombre: "", negocio: "", texto: "" }); pintar();
      }
    });
    $("#cuerpo").addEventListener("change", function (e) {
      var i = e.target.getAttribute("data-foto-portada"); if (i == null || !e.target.files[0]) return;
      comprimir(e.target.files[0], 1000).then(function (d) {
        var ruta = rutaFoto("marca", "portada-" + (+i + 1), d);
        fotos[ruta] = d; D.portada.fotos[+i] = ruta; pintar();
      }).catch(function (err) { ventana("No se pudo usar la foto", err.message); });
    });
    $("#fotoArchivo").addEventListener("change", function (e) {
      var f = e.target.files[0]; if (!f) return;
      comprimir(f, 800).then(function (d) {
        var base = editando ? editando.id : slug($("#eNombre").value || "producto");
        var ruta = rutaFoto("productos", base, d);
        fotos[ruta] = d;
        $("#fotoVista").innerHTML = '<img src="' + d + '" alt="">';
        $("#fotoVista").setAttribute("data-foto", ruta);
        e.target.value = "";
      }).catch(function (err) { ventana("No se pudo usar la foto", err.message); });
    });
    $("#formProducto").addEventListener("submit", function (e) {
      if (e.submitter && e.submitter.value === "guardar" && !guardarEditor()) e.preventDefault();
    });
    $("#eBorrar").addEventListener("click", function () {
      var p = editando;
      ventana("¿Borrar este producto?", "«" + p.nombre + "» deja de aparecer en la web cuando publiques. Si solo quieres esconderlo un tiempo, desmarca «Visible».",
        [{ texto: "Cancelar", valor: false }, { texto: "Borrar", valor: true, clase: "peligro" }]).then(function (si) {
        if (!si) return;
        D.productos.splice(D.productos.indexOf(p), 1);
        $("#editor").close(); pintar();
      });
    });
    window.addEventListener("beforeunload", function (e) {
      if (D && !$("#publicar").disabled) { e.preventDefault(); e.returnValue = ""; }
    });
  }

  /* ---------------- arranque ---------------- */
  eventos();
  var guardada = leerLS(CLAVE_CFG, null);
  if (guardada && guardada.token) {
    cfg = guardada; cfg.modo = "github";
    $("#token").value = cfg.token; $("#repo").value = cfg.repo; $("#rama").value = cfg.rama;
    leerDatosRemotos().then(function (r) { empezar(r.texto, r.sha); })
      .catch(function (e) { ventana("No se pudo entrar", explicarError(e)); });
  }
})();
