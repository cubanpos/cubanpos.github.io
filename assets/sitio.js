/* CUBANPOS — lógica del sitio. Todo el contenido sale de datos/catalogo.json,
   que se edita desde /editar. */
(function () {
  "use strict";

  var D = null;               // datos del catálogo
  var moneda = "USD";         // moneda que ve el cliente
  var pedido = {};            // { idProducto: cantidad }
  var filtro = { cat: "todo", texto: "", ofertas: false, disponibles: false, orden: "rel" };
  var PRIMEROS = 12, completo = false;   // en «Todo» se ven primero 12 productos
  var CLAVE_PEDIDO = "cubanpos.pedido";
  var CLAVE_MONEDA = "cubanpos.moneda";
  // ?quieto desactiva las animaciones (capturas de pantalla y revisión)
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches || /[?&]quieto\b/.test(location.search);
  if (reduce) document.documentElement.classList.remove("js");

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var ICONOS = {
    codigo: '<path d="M8 8 4 12l4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
    caja: '<rect x="4" y="3" width="16" height="11" rx="2"/><path d="M8 21h8M12 14v7"/>',
    escudo: '<path d="M12 3 20 6v6c0 4.5-3.3 7.6-8 9-4.7-1.4-8-4.5-8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
    tableta: '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    llave: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/>',
    qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 18v2"/>',
    rollo: '<ellipse cx="9" cy="8" rx="5" ry="5"/><circle cx="9" cy="8" r="1.6"/><path d="M9 13h9v8H6"/>',
    todo: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'
  };
  var ICONOS_PASOS = [
    '<path d="M4 5h2l2.2 10.2a1.6 1.6 0 0 0 1.6 1.3h7.4a1.6 1.6 0 0 0 1.6-1.2L20 8H7"/><circle cx="10" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/>',
    '<path d="M20 11.6A8.4 8.4 0 0 1 7.6 19l-3.6 1 1-3.5A8.4 8.4 0 1 1 20 11.6Z"/><path d="M8.5 10.5h7M8.5 13.5h4.5"/>',
    '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3.5 17.5 6.5 20.5l5.8-5.8a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.1-.9-.9-2.1Z"/>'
  ];
  function svg(cuerpo) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + cuerpo + "</svg>"; }

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function normal(t) {
    return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function leer(clave, porDefecto) {
    try { var v = localStorage.getItem(clave); return v ? JSON.parse(v) : porDefecto; } catch (e) { return porDefecto; }
  }
  function guardar(clave, valor) { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) {} }
  function obtener(obj, ruta) {
    return ruta.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, obj);
  }

  /* ---------------- monedas y precios ---------------- */
  function infoMoneda(cod) {
    var l = (D.monedas && D.monedas.lista) || [];
    for (var i = 0; i < l.length; i++) if (l[i].codigo === cod) return l[i];
    return { codigo: cod, simbolo: "$", tasa: 1 };
  }
  function convertir(v) {
    var base = infoMoneda(D.monedas.base).tasa || 1;
    return v / base * (infoMoneda(moneda).tasa || 1);
  }
  function numero(v) {
    var dec = moneda === "CUP" ? 0 : 2;
    return convertir(v).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function precioFinal(p) { return p.precioOferta && p.precioOferta < p.precio ? p.precioOferta : p.precio; }
  function precioHtml(p) {
    if (!p.precio) return '<span class="consultar">Precio a consultar</span>';
    var html = "";
    if (p.precioOferta && p.precioOferta < p.precio) html += "<s>" + numero(p.precio) + "</s>";
    return html + "<span>" + numero(precioFinal(p)) + " <small>" + esc(moneda) + "</small></span>";
  }

  /* ---------------- horario (siempre en hora de Cuba) ---------------- */
  var DIAS = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
  var NOMBRES = { lun: "Lunes", mar: "Martes", mie: "Miércoles", jue: "Jueves", vie: "Viernes", sab: "Sábado", dom: "Domingo" };
  function ahoraEnZona() {
    var zona = (D.horario && D.horario.zona) || "America/Havana";
    try {
      var partes = new Intl.DateTimeFormat("en-US", { timeZone: zona, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
      var o = {}; partes.forEach(function (x) { o[x.type] = x.value; });
      var dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday);
      return { dia: dia, min: parseInt(o.hour, 10) * 60 + parseInt(o.minute, 10) };
    } catch (e) { var d = new Date(); return { dia: d.getDay(), min: d.getHours() * 60 + d.getMinutes() }; }
  }
  function aMin(h) { var p = h.split(":"); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }
  function duracion(m) { var h = Math.floor(m / 60), r = m % 60; return (h ? h + " h " : "") + (r ? r + " min" : "").trim(); }
  function estadoHorario() {
    var H = D.horario || {};
    if (H.modo === "24h") return { abierto: true, texto: "Abierto las 24 horas", sub: "" };
    if (H.modo === "cerrado") return { abierto: false, texto: "Cerrado temporalmente", sub: H.nota || "" };
    var a = ahoraEnZona(), hoy = H.dias[DIAS[a.dia]];
    if (hoy && a.min >= aMin(hoy[0]) && a.min < aMin(hoy[1])) {
      return { abierto: true, texto: "Abierto ahora", sub: "Cierra a las " + hoy[1] + " · en " + duracion(aMin(hoy[1]) - a.min) };
    }
    if (hoy && a.min < aMin(hoy[0])) return { abierto: false, texto: "Cerrado ahora", sub: "Abre hoy a las " + hoy[0] + " · en " + duracion(aMin(hoy[0]) - a.min) };
    for (var i = 1; i <= 7; i++) {
      var k = DIAS[(a.dia + i) % 7];
      if (H.dias[k]) return { abierto: false, texto: "Cerrado ahora", sub: "Abre " + (i === 1 ? "mañana" : "el " + NOMBRES[k].toLowerCase()) + " a las " + H.dias[k][0] };
    }
    return { abierto: false, texto: "Cerrado", sub: "" };
  }
  function pintarHorario() {
    var e = estadoHorario();
    var b = $("#estadoBarra");
    b.hidden = false; b.textContent = e.abierto ? "Abierto ahora" : "Cerrado ahora";
    b.classList.toggle("abierto", e.abierto);
    var H = D.horario, hoy = DIAS[ahoraEnZona().dia];
    var filas = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"].map(function (k) {
      var v = H.modo === "24h" ? "24 horas" : (H.dias[k] ? H.dias[k][0] + " – " + H.dias[k][1] : "Cerrado");
      return '<tr class="' + (k === hoy ? "hoy" : "") + '"><td>' + NOMBRES[k] + "</td><td>" + v + "</td></tr>";
    }).join("");
    $("#horario").innerHTML = "<h3>Horario de atención</h3>" +
      '<span class="horario-estado ' + (e.abierto ? "abierto" : "cerrado") + '">' + esc(e.texto) + "</span>" +
      (e.sub ? '<p class="horario-sub">' + esc(e.sub) + " (hora de Cuba)</p>" : "") +
      "<table>" + filas + "</table>";
  }

  /* ---------------- WhatsApp ---------------- */
  function enlaceWa(numero, texto) {
    return "https://wa.me/" + String(numero || "").replace(/\D/g, "") + (texto ? "?text=" + encodeURIComponent(texto) : "");
  }

  /* ---------------- textos fijos ---------------- */
  function pintarTextos() {
    $$("[data-t]").forEach(function (el) { var v = obtener(D, el.getAttribute("data-t")); if (v) el.textContent = v; });
    $$("[data-wa]").forEach(function (a) { a.href = enlaceWa(D.contacto.whatsapp, "Hola CUBANPOS, quiero información para mi negocio."); });
    $("#anio").textContent = new Date().getFullYear();
    $("#selloAutorizado").hidden = !(D.portada && D.portada.sello);
    if (D.marca && D.marca.descripcion) {
      var m = $('meta[name="description"]'); if (m) m.setAttribute("content", D.marca.descripcion);
    }
  }

  function pintarAviso() {
    var A = D.aviso;
    if (!A || !A.activo || !A.texto) return;
    var destino = A.producto ? "#p/" + A.producto : (A.enlace || "#tienda");
    var uno = '<a href="' + esc(destino) + '">' + esc(A.texto) + " <b>Ver</b></a>";
    $(".aviso-pista").innerHTML = new Array(8).join(uno + "<span aria-hidden=\"true\">✦</span>") ;
    $("#aviso").hidden = false;
  }

  function pintarPortada() {
    var fotos = (D.portada.fotos || []).filter(Boolean);
    var caja = $("#escenaFotos");
    caja.innerHTML = fotos.map(function (f, i) {
      return '<img src="' + esc(f) + '" alt="" ' + (i ? 'loading="lazy"' : 'fetchpriority="high"') + (i === 0 ? ' class="activa"' : "") + ">";
    }).join("");
    var imgs = $$("img", caja), actual = 0;
    if (imgs.length > 1 && !reduce) setInterval(function () {
      imgs[actual].classList.remove("activa");
      actual = (actual + 1) % imgs.length;
      imgs[actual].classList.add("activa");
    }, 5000);

    var palabras = D.portada.rotativas || [], r = $("#rotativa"), n = 0;
    if (!palabras.length) { $(".rotativo").hidden = true; return; }
    r.textContent = palabras[0];
    if (palabras.length > 1 && !reduce && r.animate) setInterval(function () {
      r.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(-100%)", opacity: 0 }],
        { duration: 380, easing: "ease-in", fill: "forwards" }).onfinish = function () {
        n = (n + 1) % palabras.length;
        r.textContent = palabras[n];
        r.animate([{ transform: "translateY(100%)", opacity: 0 }, { transform: "none", opacity: 1 }],
          { duration: 480, easing: "cubic-bezier(.2,.7,.2,1)", fill: "forwards" });
      };
    }, 2600);
  }

  function visibles() { return D.productos.filter(function (p) { return p.visible !== false; }); }

  function pintarCifras() {
    var nProd = visibles().length, nCat = D.categorias.filter(function (c) {
      return visibles().some(function (p) { return p.categoria === c.id; });
    }).length;
    $("#cifras").innerHTML = (D.cifras || []).map(function (c) {
      var v = String(c.valor).replace("{productos}", nProd).replace("{categorias}", nCat);
      return '<div class="cifra rv"><b data-cuenta="' + esc(v) + '">' + esc(v) + "</b><span>" + esc(c.texto) + "</span></div>";
    }).join("");
  }
  function animarCuenta(el) {
    var txt = el.getAttribute("data-cuenta"), m = /^(\d+)(.*)$/.exec(txt);
    if (!m || reduce) return;
    var fin = parseInt(m[1], 10), resto = m[2], t0 = null;
    function paso(t) {
      if (!t0) t0 = t;
      var k = Math.min(1, (t - t0) / 1400), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(fin * e) + resto;
      if (k < 1) requestAnimationFrame(paso);
    }
    requestAnimationFrame(paso);
  }

  function nombreCat(id) {
    for (var i = 0; i < D.categorias.length; i++) if (D.categorias[i].id === id) return D.categorias[i].nombre;
    return "";
  }
  function resumen(p) {
    if (p.resumen) return p.resumen;
    var t = (p.descripcion || "").replace(/\s+/g, " ").trim();
    return t.length > 150 ? t.slice(0, 147).replace(/\s\S*$/, "") + "…" : t;
  }

  function pintarSoluciones() {
    var cat = (D.soluciones && D.soluciones.categoria) || (D.categorias[0] && D.categorias[0].id);
    var lista = visibles().filter(function (p) { return p.categoria === cat; }).sort(function (a, b) { return a.orden - b.orden; }).slice(0, 9);
    $("#bento").innerHTML = lista.map(function (p, i) {
      var clase = i === 0 ? "grande" : (i < 3 ? "medio" : "");
      return '<button type="button" class="bloque rv ' + clase + '" data-abrir="' + esc(p.id) + '">' +
        '<div class="bloque-foto"><img src="' + esc(p.foto) + '" alt="" loading="lazy"></div>' +
        '<div class="bloque-txt"><h3>' + esc(p.nombre) + "</h3><p>" + esc(resumen(p)) + "</p>" +
        '<div class="bloque-precio">' + (p.precio ? precioHtml(p) : "Consultar") + "</div></div></button>";
    }).join("");
    if (!reduce && window.matchMedia("(hover:hover)").matches) {
      $$("#bento .bloque").forEach(function (b) {
        b.addEventListener("pointermove", function (ev) {
          var r = b.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
          b.style.setProperty("--mx", x * 100 + "%"); b.style.setProperty("--my", y * 100 + "%");
          b.style.transform = "perspective(900px) rotateX(" + ((0.5 - y) * 4) + "deg) rotateY(" + ((x - 0.5) * 5) + "deg)";
        });
        b.addEventListener("pointerleave", function () { b.style.transform = ""; });
      });
    }
  }

  function pintarCinta() {
    var items = D.categorias.map(function (c) { return c.nombre; }).concat(["Instalación en tu local", "Pedidos por WhatsApp", "Santiago de Cuba"]);
    var html = items.map(function (t) { return "<span>" + esc(t) + "</span>"; }).join("");
    $("#cinta").innerHTML = html + html;
  }

  /* ---------------- tienda ---------------- */
  function pintarChips() {
    var cuenta = {};
    visibles().forEach(function (p) { cuenta[p.categoria] = (cuenta[p.categoria] || 0) + 1; });
    var chips = [{ id: "todo", nombre: "Todo", icono: "todo", n: visibles().length }].concat(
      D.categorias.filter(function (c) { return cuenta[c.id]; }).map(function (c) { return { id: c.id, nombre: c.nombre, icono: c.icono, n: cuenta[c.id] }; }));
    $("#chips").innerHTML = chips.map(function (c) {
      return '<button type="button" role="tab" class="chip" data-cat="' + esc(c.id) + '" aria-selected="' + (filtro.cat === c.id) + '">' +
        svg(ICONOS[c.icono] || ICONOS.todo) + esc(c.nombre) + "<small>" + c.n + "</small></button>";
    }).join("");
    $("#pieCategorias").innerHTML = D.categorias.filter(function (c) { return cuenta[c.id]; }).map(function (c) {
      return '<a href="#tienda" data-ir-cat="' + esc(c.id) + '">' + esc(c.nombre) + "</a>";
    }).join("");
  }

  function filtrados() {
    var q = normal(filtro.texto).split(/\s+/).filter(Boolean);
    var l = visibles().filter(function (p) {
      if (filtro.cat !== "todo" && p.categoria !== filtro.cat) return false;
      if (filtro.ofertas && !(p.precioOferta && p.precioOferta < p.precio)) return false;
      if (filtro.disponibles && p.agotado) return false;
      if (q.length) {
        var h = normal(p.nombre + " " + nombreCat(p.categoria) + " " + p.descripcion);
        for (var i = 0; i < q.length; i++) if (h.indexOf(q[i]) < 0) return false;
      }
      return true;
    });
    var catIdx = {}; D.categorias.forEach(function (c, i) { catIdx[c.id] = i; });
    var cmp = {
      rel: function (a, b) {
        return (a.agotado - b.agotado) || ((b.destacado ? 1 : 0) - (a.destacado ? 1 : 0)) ||
          ((catIdx[a.categoria] || 0) - (catIdx[b.categoria] || 0)) || (a.orden - b.orden);
      },
      asc: function (a, b) { return (precioFinal(a) || 1e9) - (precioFinal(b) || 1e9); },
      desc: function (a, b) { return precioFinal(b) - precioFinal(a); },
      az: function (a, b) { return a.nombre.localeCompare(b.nombre, "es"); }
    };
    return l.sort(cmp[filtro.orden] || cmp.rel);
  }

  function sellos(p) {
    var s = [];
    if (p.agotado) s.push('<span class="sello agotado">Agotado</span>');
    if (p.precioOferta && p.precioOferta < p.precio) s.push('<span class="sello oferta">−' + Math.round((1 - p.precioOferta / p.precio) * 100) + " %</span>");
    if (p.nuevo) s.push('<span class="sello nuevo">Nuevo</span>');
    if (p.destacado) s.push('<span class="sello destacado">Popular</span>');
    return s.length ? '<div class="sellos">' + s.join("") + "</div>" : "";
  }

  function tarjeta(p) {
    return '<article class="producto rv' + (p.agotado ? " agotado" : "") + '" data-id="' + esc(p.id) + '">' +
      '<button type="button" class="producto-abrir" data-abrir="' + esc(p.id) + '" aria-label="Ver ' + esc(p.nombre) + '">' +
      '<div class="producto-foto">' + sellos(p) + (p.foto ? '<img src="' + esc(p.foto) + '" alt="" loading="lazy" decoding="async" width="400" height="400">' : "") + "</div>" +
      '<div class="producto-txt"><span class="producto-cat">' + esc(nombreCat(p.categoria)) + "</span><h3>" + esc(p.nombre) + "</h3><p>" + esc(resumen(p)) + "</p></div></button>" +
      '<div class="producto-pie"><div class="precio">' + precioHtml(p) + "</div>" +
      '<button type="button" class="agregar" data-agregar="' + esc(p.id) + '" aria-label="Agregar ' + esc(p.nombre) + ' al pedido"' + (p.agotado ? " disabled" : "") + ">" +
      svg('<path d="M12 5v14M5 12h14"/>') + "</button></div></article>";
  }

  function pintarCatalogo(conTransicion) {
    function hacer() {
      var l = filtrados();
      var recortar = !completo && filtro.cat === "todo" && !filtro.texto && l.length > PRIMEROS + 4;
      $("#catalogo").innerHTML = (recortar ? l.slice(0, PRIMEROS) : l).map(tarjeta).join("");
      $("#verMasCaja").hidden = !recortar;
      $("#verMas").textContent = "Ver los " + (l.length - PRIMEROS) + " productos restantes";
      $("#vacio").hidden = l.length > 0;
      var total = visibles().length;
      $("#resultado").textContent = l.length === total ? total + " productos y servicios" : l.length + " de " + total + " productos";
      observar($$("#catalogo .rv"));
    }
    if (conTransicion && document.startViewTransition && !reduce) document.startViewTransition(hacer);
    else hacer();
    $$("#chips .chip").forEach(function (c) { c.setAttribute("aria-selected", String(c.getAttribute("data-cat") === filtro.cat)); });
  }

  function elegirCategoria(id, desplazar) {
    filtro.cat = id;
    pintarCatalogo(true);
    var chip = $('#chips [data-cat="' + id + '"]');
    if (chip) chip.scrollIntoView({ block: "nearest", inline: "center", behavior: reduce ? "auto" : "smooth" });
    if (desplazar) $("#tienda").scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  }

  /* ---------------- ficha ---------------- */
  function porId(id) { for (var i = 0; i < D.productos.length; i++) if (D.productos[i].id === id) return D.productos[i]; return null; }

  function descripcionHtml(t) {
    var lineas = String(t || "").split("\n"), html = "", enLista = false;
    lineas.forEach(function (l, i) {
      var s = l.trim();
      if (!s) { if (enLista) { html += "</ul>"; enLista = false; } return; }
      var viñeta = /^([•\-–*✅✔️👉▪️·]|\d+[.)])\s*/.exec(s);
      if (viñeta) {
        if (!enLista) { html += "<ul>"; enLista = true; }
        html += "<li>" + esc(s.slice(viñeta[0].length)) + "</li>"; return;
      }
      if (enLista) { html += "</ul>"; enLista = false; }
      var sig = (lineas[i + 1] || "").trim();
      var clave = /^([^:]{2,28}):\s+(.+)$/.exec(s);
      if (clave) { html += "<p><b>" + esc(clave[1]) + ":</b> " + esc(clave[2]) + "</p>"; return; }
      var esTitulo = s.length <= 40 && s.indexOf(":") < 0 && !/[.,;]$/.test(s) && sig.length > s.length && i > 0;
      html += esTitulo ? '<p class="subtitulo">' + esc(s) + "</p>" : "<p>" + esc(s) + "</p>";
    });
    return html + (enLista ? "</ul>" : "");
  }

  var fichaActual = null, fichaCant = 1;
  function abrirFicha(id, sinHash) {
    var p = porId(id); if (!p) return;
    fichaActual = p; fichaCant = 1;
    var ahorro = p.precioOferta && p.precioOferta < p.precio ? '<span class="ahorro">Ahorras ' + numero(p.precio - p.precioOferta) + " " + esc(moneda) + "</span>" : "";
    var url = location.origin + location.pathname + "#p/" + p.id;
    $("#fichaCuerpo").innerHTML =
      '<div class="ficha-foto">' + sellos(p) + (p.foto ? '<img src="' + esc(p.foto) + '" alt="' + esc(p.nombre) + '">' : "") + "</div>" +
      '<div class="ficha-info"><span class="producto-cat">' + esc(nombreCat(p.categoria)) + "</span>" +
      '<h2 id="fichaNombre">' + esc(p.nombre) + "</h2>" +
      '<div class="ficha-precio">' + (p.precio ? precioHtml(p).replace(/<\/?small>/g, "") : '<span class="consultar">Precio a consultar</span>') + ahorro + "</div>" +
      '<div class="ficha-desc">' + descripcionHtml(p.descripcion) + "</div>" +
      '<div class="ficha-extra"><a href="' + enlaceWa(D.contacto.whatsapp, "Hola CUBANPOS, me interesa «" + p.nombre + "». " + url) + '" target="_blank" rel="noopener">Preguntar por WhatsApp</a>' +
      '<button type="button" id="copiarEnlace">Copiar enlace</button></div>' +
      '<div class="ficha-comprar">' + (p.agotado ? '<button class="btn btn-tinta" disabled>Agotado por ahora</button>' :
        '<div class="cantidad"><button type="button" data-fc="-1" aria-label="Menos">−</button><output id="fichaCant">1</output><button type="button" data-fc="1" aria-label="Más">+</button></div>' +
        '<button type="button" class="btn btn-tinta" id="fichaAgregar">Agregar al pedido</button>') + "</div></div>";
    var dlg = $("#ficha");
    if (!dlg.open) dlg.showModal();
    $(".ficha-info").scrollTop = 0; $("#fichaCuerpo").scrollTop = 0;
    if (!sinHash && location.hash !== "#p/" + p.id) history.pushState(null, "", "#p/" + p.id);
    document.title = p.nombre + " — CUBANPOS";
  }
  function cerrarFicha() {
    var dlg = $("#ficha");
    if (dlg.open) dlg.close();
  }

  /* ---------------- pedido ---------------- */
  function cantidadTotal() { return Object.keys(pedido).reduce(function (s, k) { return s + pedido[k]; }, 0); }
  function totalPedido() {
    return Object.keys(pedido).reduce(function (s, k) { var p = porId(k); return s + (p ? precioFinal(p) * pedido[k] : 0); }, 0);
  }
  function agregar(id, n) {
    var p = porId(id); if (!p || p.agotado) return;
    pedido[id] = (pedido[id] || 0) + (n || 1);
    if (pedido[id] <= 0) delete pedido[id];
    guardar(CLAVE_PEDIDO, pedido);
    pintarPedido();
    var c = $("#contador"); c.classList.remove("salta"); void c.offsetWidth; c.classList.add("salta");
    if (n > 0) tostada("Agregado: " + p.nombre);
  }
  function pintarPedido() {
    Object.keys(pedido).forEach(function (k) { if (!porId(k)) delete pedido[k]; });
    var n = cantidadTotal(), c = $("#contador");
    c.hidden = !n; c.textContent = n;
    var pf = $("#pedidoFlotante");
    pf.hidden = !n || $("#pedido").open;
    $("#pfCantidad").textContent = n + (n === 1 ? " producto" : " productos");
    $("#pfTotal").textContent = numero(totalPedido()) + " " + moneda;
    var ids = Object.keys(pedido);
    $("#pedidoLista").innerHTML = ids.length ? ids.map(function (id) {
      var p = porId(id);
      return '<div class="linea"><img src="' + esc(p.foto) + '" alt="" loading="lazy"><div><b>' + esc(p.nombre) + "</b><small>" +
        (p.precio ? numero(precioFinal(p)) + " " + esc(moneda) : "A consultar") + "</small></div>" +
        '<div class="cantidad"><button type="button" data-lc="-1" data-id="' + esc(id) + '" aria-label="Quitar uno">−</button><output>' + pedido[id] +
        '</output><button type="button" data-lc="1" data-id="' + esc(id) + '" aria-label="Agregar uno">+</button></div></div>';
    }).join("") : '<div class="pedido-vacio"><b>Tu pedido está vacío</b><span>Agrega productos desde la tienda con el botón +.</span></div>';
    $("#pedidoTotal").textContent = numero(totalPedido()) + " " + moneda;
    var hayConsulta = ids.some(function (id) { return !porId(id).precio; });
    $("#pedidoNota").textContent = (hayConsulta ? "Algunos productos tienen el precio a consultar y no suman al total. " : "") +
      (D.condiciones && D.condiciones.entrega ? D.condiciones.entrega : "");
    $("#pedidoForm button[type=submit]").disabled = !ids.length;
  }
  function enviarPedido(ev) {
    ev.preventDefault();
    var ids = Object.keys(pedido); if (!ids.length) return;
    var l = ["Hola CUBANPOS, quiero hacer este pedido:", ""];
    ids.forEach(function (id) {
      var p = porId(id);
      l.push("• " + pedido[id] + " × " + p.nombre + " — " + (p.precio ? numero(precioFinal(p) * pedido[id]) + " " + moneda : "precio a consultar"));
    });
    l.push("", "Total estimado: " + numero(totalPedido()) + " " + moneda);
    var nom = $("#pNombre").value.trim(), neg = $("#pNegocio").value.trim();
    if (nom) l.push("Nombre: " + nom);
    if (neg) l.push("Negocio: " + neg);
    l.push("", "Enviado desde " + location.host);
    window.open(enlaceWa(D.contacto.whatsappPedidos || D.contacto.whatsapp, l.join("\n")), "_blank", "noopener");
  }

  var tTostada;
  function tostada(t) {
    var e = $("#tostada"); e.textContent = t; e.classList.add("ver");
    clearTimeout(tTostada); tTostada = setTimeout(function () { e.classList.remove("ver"); }, 2200);
  }

  /* ---------------- secciones de texto ---------------- */
  function pintarPasos() {
    $("#pasos").innerHTML = (D.pasos || []).map(function (p, i) {
      return '<li class="paso rv"><span class="paso-icono">' + svg(ICONOS_PASOS[i % 3]) + "</span><h3>" + esc(p.titulo) + "</h3><p>" + esc(p.texto) + "</p></li>";
    }).join("");
  }
  function pintarPreguntas() {
    var l = (D.preguntas || []).slice();
    if (D.condiciones && D.condiciones.pedido) l.push({ pregunta: "¿Qué recibo al pedir por WhatsApp?", respuesta: D.condiciones.pedido });
    $("#acordeon").innerHTML = l.map(function (q, i) {
      return '<details class="rv"' + (i === 0 ? " open" : "") + "><summary>" + esc(q.pregunta) + '</summary><div class="respuesta">' + esc(q.respuesta) + "</div></details>";
    }).join("");
    var T = (D.testimonios || []).filter(function (t) { return t.texto; });
    if (T.length) {
      $("#testimonios").hidden = false;
      $("#testimoniosRejilla").innerHTML = T.map(function (t) {
        return '<figure class="testimonio rv"><blockquote>«' + esc(t.texto) + '»</blockquote><cite>' + esc(t.nombre) + "<small>" + esc(t.negocio || "") + "</small></cite></figure>";
      }).join("");
    }
  }
  function pintarContacto() {
    var C = D.contacto, l = [];
    function tel(n) { var d = String(n).replace(/\D/g, ""); return "+" + d.slice(0, 2) + " " + d.slice(2); }
    if (C.whatsapp) l.push(['<path d="M20 11.6A8.4 8.4 0 0 1 7.6 19l-3.6 1 1-3.5A8.4 8.4 0 1 1 20 11.6Z"/>', "WhatsApp", '<a href="' + enlaceWa(C.whatsapp) + '" target="_blank" rel="noopener">' + tel(C.whatsapp) + "</a>"]);
    if (C.whatsappPedidos && C.whatsappPedidos !== C.whatsapp) l.push(['<path d="M5 4h14v17l-3.5-2-3.5 2-3.5-2L5 21Z"/>', "Pedidos", '<a href="' + enlaceWa(C.whatsappPedidos) + '" target="_blank" rel="noopener">' + tel(C.whatsappPedidos) + "</a>"]);
    if (C.telefono2) l.push(['<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', "Teléfono", '<a href="tel:+' + C.telefono2.replace(/\D/g, "") + '">' + tel(C.telefono2) + "</a>"]);
    if (C.correo) l.push(['<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', "Correo", '<a href="mailto:' + esc(C.correo) + '">' + esc(C.correo) + "</a>"]);
    if (C.telegram) l.push(['<path d="m21 4-18 7 6 2 2 6 3-4 5 4Z"/>', "Telegram", '<a href="https://t.me/' + esc(C.telegram.replace(/^@/, "")) + '" target="_blank" rel="noopener">@' + esc(C.telegram.replace(/^@/, "")) + "</a>"]);
    if (C.facebook) l.push(['<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v2H8v4h2v7h4v-7h3l1-4h-4V8Z"/>', "Facebook", '<a href="' + esc(C.facebook) + '" target="_blank" rel="noopener">Facebook</a>']);
    if (C.instagram) l.push(['<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/>', "Instagram", '<a href="' + esc(C.instagram) + '" target="_blank" rel="noopener">Instagram</a>']);
    if (C.direccion) {
      var mapa = C.coordenadas ? "https://www.openstreetmap.org/?mlat=" + C.coordenadas[0] + "&mlon=" + C.coordenadas[1] + "#map=15/" + C.coordenadas[0] + "/" + C.coordenadas[1] : "";
      l.push(['<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>', "Dónde estamos", mapa ? '<a href="' + mapa + '" target="_blank" rel="noopener">' + esc(C.direccion) + "</a>" : esc(C.direccion)]);
    }
    $("#datosContacto").innerHTML = l.map(function (x) { return "<li>" + svg(x[0]) + "<div><small>" + x[1] + "</small>" + x[2] + "</div></li>"; }).join("");
  }

  function pintarMonedas() {
    var activas = D.monedas.lista.filter(function (m) { return m.activa || m.codigo === D.monedas.base; });
    var guardada = leer(CLAVE_MONEDA, null);
    moneda = activas.some(function (m) { return m.codigo === guardada; }) ? guardada : (D.monedas.porDefecto || D.monedas.base);
    var sel = $("#moneda");
    sel.innerHTML = activas.map(function (m) { return "<option" + (m.codigo === moneda ? " selected" : "") + ">" + esc(m.codigo) + "</option>"; }).join("");
    $("#monedaCaja").hidden = activas.length < 2;
    $("#pieMoneda").textContent = moneda;
  }

  /* ---------------- datos estructurados para Google ---------------- */
  function datosEstructurados() {
    var s = document.createElement("script");
    s.type = "application/ld+json";
    s.textContent = JSON.stringify({
      "@context": "https://schema.org", "@type": "Store", name: "CUBANPOS", url: "https://cubanpos.github.io/",
      description: D.marca.descripcion, telephone: "+" + String(D.contacto.whatsapp).replace(/\D/g, ""), email: D.contacto.correo,
      address: { "@type": "PostalAddress", addressLocality: "Santiago de Cuba", addressCountry: "CU" },
      hasOfferCatalog: { "@type": "OfferCatalog", name: "Tienda CUBANPOS", itemListElement: visibles().filter(function (p) { return p.precio; }).map(function (p) {
        return { "@type": "Offer", price: precioFinal(p), priceCurrency: D.monedas.base, availability: p.agotado ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
          itemOffered: { "@type": "Product", name: p.nombre, image: "https://cubanpos.github.io/" + p.foto } };
      }) }
    });
    document.head.appendChild(s);
  }

  /* ---------------- aparición y navegación ---------------- */
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (ents) {
    ents.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add("in");
      var c = e.target.querySelector("[data-cuenta]"); if (c) animarCuenta(c);
      io.unobserve(e.target);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }) : null;
  function observar(els) {
    els.forEach(function (el, i) {
      if (!io) { el.classList.add("in"); return; }
      el.style.transitionDelay = Math.min(i % 8, 6) * 60 + "ms";
      io.observe(el);
    });
  }

  function navegacion() {
    var btn = $("#btnMenu"), menu = $("#menu");
    btn.addEventListener("click", function () {
      var abierto = menu.classList.toggle("abierto");
      btn.setAttribute("aria-expanded", String(abierto));
    });
    $$("#menu a").forEach(function (a) { a.addEventListener("click", function () { menu.classList.remove("abierto"); btn.setAttribute("aria-expanded", "false"); }); });
    if ("IntersectionObserver" in window) {
      var enlaces = $$("#menu a");
      var obs = new IntersectionObserver(function (ents) {
        ents.forEach(function (e) {
          if (!e.isIntersecting) return;
          enlaces.forEach(function (a) { a.classList.toggle("activo", a.getAttribute("href") === "#" + e.target.id); });
          $("#barra").classList.toggle("sobre-papel", e.target.classList.contains("papel"));
        });
      }, { rootMargin: "-45% 0px -50% 0px" });
      $$("main > section[id]").forEach(function (s) { obs.observe(s); });
    }
    if (!(window.CSS && CSS.supports && CSS.supports("animation-timeline: scroll()"))) {
      var barra = $(".progreso"), pend = false;
      window.addEventListener("scroll", function () {
        if (pend) return; pend = true;
        requestAnimationFrame(function () {
          var h = document.documentElement.scrollHeight - innerHeight;
          barra.style.setProperty("--p", h > 0 ? scrollY / h : 0); pend = false;
        });
      }, { passive: true });
    }
  }

  function segunHash() {
    var m = /^#p\/(.+)$/.exec(location.hash);
    if (m) abrirFicha(decodeURIComponent(m[1]), true);
    else if ($("#ficha").open) cerrarFicha();
  }

  function eventos() {
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest("[data-abrir],[data-agregar],[data-cat],[data-ir-cat],[data-fc],[data-lc],[data-cerrar],#fichaAgregar,#copiarEnlace,#abrirPedido,#pedidoFlotante,#verMas,#vaciar,#limpiar,.aviso a");
      if (!t) return;
      if (t.hasAttribute("data-agregar")) { agregar(t.getAttribute("data-agregar"), 1); t.classList.add("hecho"); setTimeout(function () { t.classList.remove("hecho"); }, 900); }
      else if (t.hasAttribute("data-abrir")) abrirFicha(t.getAttribute("data-abrir"));
      else if (t.hasAttribute("data-cat")) elegirCategoria(t.getAttribute("data-cat"));
      else if (t.hasAttribute("data-ir-cat")) { ev.preventDefault(); elegirCategoria(t.getAttribute("data-ir-cat"), true); }
      else if (t.hasAttribute("data-fc")) { fichaCant = Math.max(1, fichaCant + parseInt(t.getAttribute("data-fc"), 10)); $("#fichaCant").textContent = fichaCant; }
      else if (t.hasAttribute("data-lc")) agregar(t.getAttribute("data-id"), parseInt(t.getAttribute("data-lc"), 10));
      else if (t.hasAttribute("data-cerrar")) { var d = t.closest("dialog"); if (d.id === "ficha") history.replaceState(null, "", location.pathname + "#tienda"); d.close(); }
      else if (t.id === "fichaAgregar" && fichaActual) { agregar(fichaActual.id, fichaCant); cerrarFicha(); }
      else if (t.id === "copiarEnlace" && fichaActual) {
        var url = location.origin + location.pathname + "#p/" + fichaActual.id;
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { tostada("Enlace copiado"); }, function () { tostada(url); });
      }
      else if (t.id === "abrirPedido" || t.id === "pedidoFlotante") { $("#pedido").showModal(); pintarPedido(); }
      else if (t.id === "verMas") { completo = true; pintarCatalogo(false); }
      else if (t.id === "vaciar") { pedido = {}; guardar(CLAVE_PEDIDO, pedido); pintarPedido(); }
      else if (t.id === "limpiar") { filtro = { cat: "todo", texto: "", ofertas: false, disponibles: false, orden: filtro.orden }; $("#buscar").value = ""; $("#fOfertas").setAttribute("aria-pressed", "false"); $("#fDisponibles").setAttribute("aria-pressed", "false"); pintarCatalogo(true); }
    });
    $$("dialog").forEach(function (d) {
      d.addEventListener("click", function (ev) { if (ev.target === d) d.close(); });
      d.addEventListener("close", function () {
        if (d.id === "ficha") { document.title = "CUBANPOS — Sistemas POS y equipos para negocios en Santiago de Cuba"; if (/^#p\//.test(location.hash)) history.replaceState(null, "", location.pathname + "#tienda"); }
        pintarPedido();
      });
    });
    var tb;
    $("#buscar").addEventListener("input", function (e) {
      clearTimeout(tb); tb = setTimeout(function () {
        filtro.texto = e.target.value;
        if (filtro.texto && filtro.cat !== "todo") filtro.cat = "todo";
        pintarCatalogo(false);
      }, 160);
    });
    [["#fOfertas", "ofertas"], ["#fDisponibles", "disponibles"]].forEach(function (x) {
      $(x[0]).addEventListener("click", function (e) {
        filtro[x[1]] = !filtro[x[1]]; e.currentTarget.setAttribute("aria-pressed", String(filtro[x[1]])); pintarCatalogo(true);
      });
    });
    $("#orden").addEventListener("change", function (e) { filtro.orden = e.target.value; pintarCatalogo(true); });
    $("#moneda").addEventListener("change", function (e) {
      moneda = e.target.value; guardar(CLAVE_MONEDA, moneda); $("#pieMoneda").textContent = moneda;
      pintarSoluciones(); pintarCatalogo(false); pintarPedido(); observar($$("#bento .rv"));
    });
    $("#pedidoForm").addEventListener("submit", enviarPedido);
    window.addEventListener("hashchange", segunHash);
  }

  function arrancar(datos) {
    D = datos;
    D.productos.sort(function (a, b) { return a.orden - b.orden; });
    pedido = leer(CLAVE_PEDIDO, {}) || {};
    pintarMonedas();
    pintarTextos(); pintarAviso(); pintarPortada(); pintarCifras(); pintarSoluciones(); pintarCinta();
    pintarChips(); pintarCatalogo(false); pintarPasos(); pintarPreguntas(); pintarContacto(); pintarHorario();
    pintarPedido(); datosEstructurados();
    setInterval(pintarHorario, 60000);
    navegacion(); eventos();
    observar($$(".rv:not(.in)"));
    segunHash();
  }

  fetch("datos/catalogo.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(arrancar)
    .catch(function (e) {
      console.error(e);
      $("#catalogo").innerHTML = '<p class="vacio">No se pudo cargar el catálogo. Recarga la página o escríbenos por WhatsApp al +53 58146895.</p>';
      $$(".rv").forEach(function (el) { el.classList.add("in"); });
    });
})();
