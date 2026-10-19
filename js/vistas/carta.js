/* ============================================================
   PESTAÑA: MENÚ — la carta
   Se ve como una carta de verdad: arranca vacía y se arma con secciones
   (menú del día, carnes, guarniciones, bebidas…) y los platos que ya están
   cargados, con su precio. Se guarda sola mientras se edita. Desde acá se
   comparte como imagen por WhatsApp y se actualiza el link fijo, que
   siempre muestra la última versión publicada.
   Los platos salen del Stock (la única lista, con su precio y su stock):
   tocar un plato abre su ficha, y uno nuevo queda también en el Stock.
============================================================= */
let cartaGuardarT = null;

// categorías que se ofrecen para sumar a la carta (si todavía no existen)
const CATEGORIAS_SUGERIDAS = ['Entradas', 'Carnes', 'Pollo', 'Pastas', 'Tartas', 'Ensaladas', 'Bebidas', 'Postres', 'Promociones'];
const nuevoIdSeccion = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// el título de una sección nueva: el de su categoría (la vieja "Del día" → "Menú del día")
const tituloDeCategoria = (cat) => esCategoriaDelDia(cat) ? 'Menú del día' : cat;

/* Cada sección de platos es de una categoría y muestra solo sus platos. Las cartas armadas antes de
   las categorías no la tienen guardada: sale del título ("Menú del día" → Del día). */
function categoriaDeSeccion(s){
  if(!s || s.tipo === 'guarniciones') return null;
  if(s.categoria) return nombreCategoria(s.categoria);
  return categorias().find(c => esCategoriaDelDia(s.titulo) ? esCategoriaDelDia(c) : mismaCategoria(c, s.titulo)) || null;
}
// los platos activos de una categoría (se cargan solos al agregar su sección)
const platosParaCategoria = (cat) => state.menus.filter(m => m.activo && m.categoria && mismaCategoria(m.categoria, cat)).sort(ordenMenus);

/* Una sola vez, en una carta armada antes de las categorías: cada sección queda con la suya. Si el
   título no es una categoría (ej. "Tartas", con tartas de "Varios"), se crea y sus platos pasan ahí,
   salvo los que son de la categoría de otra sección. */
let cartaAlineada = false;
async function alinearCartaConCategorias(){
  const c = cartaActual();
  if(cartaAlineada || !esDueno() || !usaCarta() || !usaCategorias() || !c.secciones.some(s => s.tipo !== 'guarniciones' && !s.categoria)) return;
  cartaAlineada = true;
  try{
    const deSeccion = (cat) => c.secciones.some(o => mismaCategoria(categoriaDeSeccion(o) || '', cat));
    // si la lista todavía no se guardó, arranca en el orden de la carta
    const lista = Array.isArray(state.config.categorias) ? categorias()
      : [...c.secciones.map(categoriaDeSeccion).filter(Boolean), ...categorias()];
    let movidos = 0;
    for(const s of c.secciones.filter(x => x.tipo !== 'guarniciones' && !x.categoria)){
      const cat = categoriaDeSeccion(s);
      if(cat){ s.categoria = cat; continue; }
      s.categoria = s.titulo.trim();
      if(!lista.some(x => mismaCategoria(x, s.categoria))){
        // en su lugar de la carta: antes de la categoría de la sección que le sigue
        const sig = c.secciones.slice(c.secciones.indexOf(s) + 1).map(categoriaDeSeccion).find(Boolean);
        const k = sig ? lista.findIndex(x => mismaCategoria(x, sig)) : -1;
        if(k >= 0) lista.splice(k, 0, s.categoria); else lista.push(s.categoria);
      }
      const ids = s.items.map(i => menuPorId(i.menuId)).filter(m => m && !mismaCategoria(m.categoria, s.categoria) && !(m.categoria && deSeccion(m.categoria))).map(m => m.id);
      if(ids.length){
        const { error } = await sb.from('menus').update({ categoria: s.categoria }).in('id', ids);
        if(error) throw error;
        state.menus.forEach(m => { if(ids.includes(m.id)) m.categoria = s.categoria; });
        movidos += ids.length;
      }
    }
    await guardarCategorias(lista);
    await guardarCarta(c);
    if(movidos) toast(`Ordené la carta por categorías: ${plural(movidos, 'plato pasó', 'platos pasaron')} a la categoría de su sección.`, 'info');
    if(activeTab === 'menus' || activeTab === 'stock') render();
  }catch(e){ console.error('No se pudo ordenar la carta por categorías', e); }
}
/* Cambia la carta: se ve enseguida y se guarda sola un momento después. */
function cambiarCarta(fn){
  const c = cartaActual();
  fn(c);
  state.config.carta = c;
  const est = document.getElementById('carta-estado'); if(est) est.textContent = 'Guardando…';
  clearTimeout(cartaGuardarT);
  cartaGuardarT = setTimeout(async () => {
    try{ await guardarCarta(state.config.carta); const e = document.getElementById('carta-estado'); if(e) e.textContent = 'Guardado'; }
    catch(err){ toastError('No se pudo guardar la carta', err); const e = document.getElementById('carta-estado'); if(e) e.textContent = 'Sin guardar'; }
  }, 600);
  if(activeTab === 'menus') render();
}

/* ---------- la carta en HTML (para editar y para la imagen) ---------- */
// en una sección "Sin TACC" o "Menú del día" no hace falta repetirlo en cada plato
function nombreEnSeccion(m, s){
  const t = normalizarNombre(s.titulo);
  let n = m.nombre;
  if(t === 'sin tacc') n = n.replace(/\s*\bsin\s*tacc\b/i, '').trim();
  if(t === 'menu del dia') n = n.replace(/\s*\(del d[ií]a\)/i, '').trim();
  return n || m.nombre;
}
function seccionHtml(s, { edita, imagen }){
  const acts = (attr, extra = '') => edita ? `<span class="c-acts">${extra}
      <button type="button" data-subir="${attr}" aria-label="Subir" title="Subir">${icon('up', 13)}</button>
      <button type="button" data-bajar="${attr}" aria-label="Bajar" title="Bajar">${icon('down', 13)}</button>
      <button type="button" class="rojo" data-quitar="${attr}" aria-label="Quitar de la carta" title="Quitar de la carta">${icon('x', 13)}</button></span>` : '';
  let cuerpo = '', precioSec = '';
  if(s.tipo === 'guarniciones'){
    const gs = s.items.map((it, i) => ({ i, p: state.productos.find(x => x.id === it.productoId) })).filter(x => x.p && (!imagen || x.p.activo));
    cuerpo = gs.length ? `<p class="c-guarn">${gs.map(x => `<span class="c-g ${x.p.activo ? '' : 'off'}">${esc(x.p.nombre)}${edita ? `<button type="button" class="c-gx" data-quitar="${s.id}:${x.i}" aria-label="Quitar ${esc(x.p.nombre)}" title="Quitar">${icon('x', 11)}</button>` : ''}</span>`).join('<span class="c-sep">·</span>')}</p>` : '';
  }else{
    const ps = s.items.map((it, i) => ({ i, m: menuPorId(it.menuId) })).filter(x => x.m && (!imagen || x.m.activo));
    const activos = ps.filter(x => x.m.activo && !esMenuDelDia(x.m));
    // todos al mismo precio (como el menú del día): el precio va una sola vez, al lado del título
    const precios = new Set(ps.filter(x => x.m.activo).map(x => x.m.precio));
    // el menú del día (y el sin TACC) tiene su precio: va una sola vez, al lado del título
    const cat = categoriaDeSeccion(s);
    const fijo = esCategoriaDelDia(cat) ? state.config.precioMenuDia : normalizarNombre(cat) === 'sin tacc' ? state.config.precioMenuSinTacc : null;
    const unico = fijo != null || (activos.length > 1 && precios.size === 1 && [...precios][0] != null);
    if(unico) precioSec = fmtPlata(fijo != null ? fijo : [...precios][0]);
    const extra = (m) => `${m.llevaGuarnicion ? '<span class="c-gn"> + guarnición</span>' : ''}${m.descripcion ? `<small>${esc(m.descripcion)}</small>` : ''}`;
    const off = (m) => m.activo ? '' : '<span class="c-off">desactivado: no sale en la imagen</span>';
    if(unico){
      const lista = ps.filter(x => !(esMenuDelDia(x.m) && x.m.activo));
      cuerpo = `<ul class="c-lista">${lista.map(x => `<li class="${x.m.activo ? '' : 'off'}" data-item="${s.id}:${x.i}">
          <span class="c-n" ${edita ? `data-editar="${x.m.id}" role="button" tabindex="0" title="Editar el plato"` : ''}>${esc(nombreEnSeccion(x.m, s))}${extra(x.m)}${off(x.m)}</span>${acts(`${s.id}:${x.i}`)}</li>`).join('')}</ul>`;
    }else{
      cuerpo = ps.map(x => `<div class="c-item ${x.m.activo ? '' : 'off'}" data-item="${s.id}:${x.i}">
          <span class="c-n" ${edita ? `data-editar="${x.m.id}" role="button" tabindex="0" title="Editar el plato (precio, stock)"` : ''}>${esc(nombreEnSeccion(x.m, s))}${extra(x.m)}${off(x.m)}</span>
          <span class="c-dots"></span><span class="c-p">${x.m.precio != null ? fmtPlata(x.m.precio) : ''}</span>${acts(`${s.id}:${x.i}`)}</div>`).join('');
    }
  }
  if(imagen && !cuerpo) return '';
  return `<section class="c-sec" data-sec="${s.id}">
    <div class="c-sec-h"><h2 class="c-sec-t" ${edita ? `contenteditable="plaintext-only" spellcheck="false" data-sec-titulo="${s.id}"` : ''}>${esc(s.titulo)}</h2>
      ${precioSec ? `<span class="c-sec-precio">${precioSec}</span>` : ''}${acts(s.id)}</div>
    ${cuerpo || (edita ? `<p class="c-vacio-sec">Todavía no tiene ${s.tipo === 'guarniciones' ? 'guarniciones' : 'platos'}.</p>` : '')}
    ${edita ? `<button type="button" class="c-add" data-agregar="${s.id}">${icon('plus', 13)} Agregar ${s.tipo === 'guarniciones' ? 'guarnición' : 'plato'}</button>` : ''}
  </section>`;
}
function cartaHtml(carta, { edita = false, imagen = false } = {}){
  const ce = (campo, ph) => edita ? `contenteditable="plaintext-only" spellcheck="false" data-campo="${campo}" data-ph="${esc(ph)}"` : '';
  const secs = carta.secciones.map(s => seccionHtml(s, { edita, imagen })).join('');
  return `<article class="carta ${edita ? 'edita' : ''} ${imagen ? 'para-imagen' : ''}">
    <header class="c-head">
      <div class="c-negocio">${esc(state.config.nombre || '')}</div>
      <h1 class="c-titulo" ${ce('titulo', 'Nuestro menú')}>${esc(carta.titulo || (edita ? '' : 'Nuestro menú'))}</h1>
      ${carta.subtitulo || edita ? `<p class="c-sub" ${ce('subtitulo', 'Agregá una frase: de lunes a sábado, con envío…')}>${esc(carta.subtitulo || '')}</p>` : ''}
    </header>
    ${secs || (edita ? `<div class="c-vacia">${icon('menu', 22)}<b>Tu carta está vacía</b><span>Agregá la primera sección acá abajo: el menú del día, carnes, guarniciones, bebidas…
      Si ya tenés platos de esa categoría, se cargan solos.</span></div>` : '')}
    ${carta.pie || edita ? `<footer class="c-pie" ${ce('pie', 'Cómo pedir: teléfono, alias para transferir, horarios…')}>${esc(carta.pie || '')}</footer>` : ''}
  </article>`;
}

/* ---------- la pestaña ---------- */
function renderMenuTab(bar, main){
  bar.innerHTML = `<h1>Menú</h1><div class="sp"></div>
    ${usaCarta() ? `<span class="muted carta-estado" id="carta-estado"></span>
      ${puedeElegirCartaDia(todayStr()) ? `<button class="btn" id="elegir-menu-dia">${icon('menu', 14)} Menú del día</button>` : ''}
      <button class="btn primary" id="carta-compartir">${icon('wa', 14)} Compartir</button>` : ''}`;
  const on = (sel, fn) => { const b = bar.querySelector(sel); if(b) b.addEventListener('click', fn); };
  on('#elegir-menu-dia', () => abrirCartaDia(todayStr()));
  on('#carta-compartir', () => abrirCompartirCarta());
  // sin la base en la v15 no hay dónde guardar la carta
  if(!usaCarta()){
    main.innerHTML = `<div class="page"><div class="clist"><div class="stub" style="margin:28px auto"><div class="ico">${icon('menu', 20)}</div><h2>Falta actualizar la base de datos</h2>
      <p>Para armar la carta hay que correr <b>actualizar-base.sql</b> en Supabase. Mientras tanto, los platos y sus precios están en <b>Stock</b>.</p>
      <button class="btn lg" type="button" id="ir-stock">${icon('caja', 14)} Ir a Stock</button></div></div></div>`;
    main.querySelector('#ir-stock').addEventListener('click', () => irA('stock'));
    return;
  }
  alinearCartaConCategorias();
  renderCarta(main);
}

function renderCarta(main){
  const carta = cartaActual(), edita = esDueno(), cats = categorias();
  const usadas = carta.secciones.map(categoriaDeSeccion).filter(Boolean);
  const libres = cats.filter(c => !usadas.some(u => mismaCategoria(u, c)));
  const sugeridas = CATEGORIAS_SUGERIDAS.filter(t => !cats.some(c => mismaCategoria(c, t)));
  main.innerHTML = `<div class="page carta-page"><div class="carta-mesa">
    ${cartaHtml(carta, { edita })}
    ${edita ? `<section class="carta-agregar">
      <h3>${icon('plus', 14)} Agregar una sección</h3>
      <div class="carta-chips">${libres.map(c => `<button type="button" class="chip" data-sec-cat="${esc(c)}">${esc(tituloDeCategoria(c))}</button>`).join('')}
        ${carta.secciones.some(s => s.tipo === 'guarniciones') ? '' : '<button type="button" class="chip" data-sec-guarn>Guarniciones</button>'}
        ${sugeridas.map(t => `<button type="button" class="chip sug" data-sec-nueva="${esc(t)}" title="Crea la categoría ${esc(t)}">+ ${esc(t)}</button>`).join('')}
        <button type="button" class="chip sug" data-sec-nueva="">Otra…</button></div>
      <p class="help">Cada sección es una categoría y muestra solo sus platos del Stock: los que ya tenés se cargan solos, y después sacás o sumás los que quieras.
        Tocá un plato para cambiar su precio, y los títulos para escribir encima. <button type="button" class="pn-link" id="editar-categorias">Editar categorías</button></p>
    </section>` : ''}
  </div></div>`;
  bindCarta(main);
}

function bindCarta(main){
  const seccion = (c, id) => c.secciones.find(s => s.id === id);
  // títulos, frase y pie: se escriben encima; al salir se guardan
  main.querySelectorAll('[contenteditable]').forEach(el => {
    el.addEventListener('keydown', (e) => { if(e.key === 'Enter' && !el.matches('[data-campo="pie"]')){ e.preventDefault(); el.blur(); } });
    el.addEventListener('blur', () => {
      const v = el.textContent.replace(/\s+\n/g, '\n').trim();
      if(el.dataset.secTitulo){
        const id = el.dataset.secTitulo, ant = seccion(cartaActual(), id);
        if(!v){ el.textContent = ant ? ant.titulo : ''; return; }
        if(ant && ant.titulo !== v) cambiarCarta(c => { seccion(c, id).titulo = v; });
      }else if(el.dataset.campo){
        if((cartaActual()[el.dataset.campo] || '') !== v) cambiarCarta(c => { c[el.dataset.campo] = v; });
      }
    });
  });
  // secciones nuevas: una categoría, con los platos que ya tiene
  const agregarSeccion = (cat) => {
    const items = platosParaCategoria(cat).map(m => ({ menuId: m.id })), titulo = tituloDeCategoria(cat);
    cambiarCarta(c => { c.secciones.push({ id: nuevoIdSeccion(), titulo, tipo: 'platos', categoria: cat, items }); });
    toast(items.length ? `<b>${esc(titulo)}</b> agregada con ${plural(items.length, 'plato', 'platos')} de esa categoría.` : `<b>${esc(titulo)}</b> agregada: sumale platos con "Agregar plato".`);
  };
  main.querySelectorAll('[data-sec-cat]').forEach(b => b.addEventListener('click', () => agregarSeccion(b.dataset.secCat)));
  // una categoría que todavía no existe: se crea (y queda para los platos)
  main.querySelectorAll('[data-sec-nueva]').forEach(b => b.addEventListener('click', async () => {
    const nombre = b.dataset.secNueva || await pedirNombreCategoria();
    if(!nombre) return;
    try{ agregarSeccion(await agregarCategoria(nombre) || nombre); }
    catch(e){ toastError('No se pudo crear la categoría', e); }
  }));
  const bg = main.querySelector('[data-sec-guarn]');
  if(bg) bg.addEventListener('click', () => {
    const items = guarniciones().map(p => ({ productoId: p.id }));
    cambiarCarta(c => { c.secciones.push({ id: nuevoIdSeccion(), titulo: 'Guarniciones', tipo: 'guarniciones', items }); });
    toast(items.length ? `<b>Guarniciones</b> agregada con ${plural(items.length, 'guarnición', 'guarniciones')}.` : '<b>Guarniciones</b> agregada: sumale con "Agregar guarnición".');
  });
  const ec = main.querySelector('#editar-categorias'); if(ec) ec.addEventListener('click', () => abrirCategorias());
  // subir, bajar y quitar: secciones ("id") o platos ("id:posición")
  const mover = (ref, paso) => cambiarCarta(c => {
    const [id, i] = ref.split(':');
    const lista = i === undefined ? c.secciones : seccion(c, id).items, k = i === undefined ? c.secciones.findIndex(s => s.id === id) : Number(i), j = k + paso;
    if(j < 0 || j >= lista.length) return;
    [lista[k], lista[j]] = [lista[j], lista[k]];
  });
  main.querySelectorAll('[data-subir]').forEach(b => b.addEventListener('click', () => mover(b.dataset.subir, -1)));
  main.querySelectorAll('[data-bajar]').forEach(b => b.addEventListener('click', () => mover(b.dataset.bajar, 1)));
  main.querySelectorAll('[data-quitar]').forEach(b => b.addEventListener('click', async () => {
    const [id, i] = b.dataset.quitar.split(':');
    if(i === undefined){
      const s = seccion(cartaActual(), id);
      if(!(await confirmar('Sacar la sección', `¿Sacar <b>${esc(s.titulo)}</b> de la carta? Los platos siguen en el Stock; solo dejan de verse en la carta.`, { ok: 'Sacar', peligro: true }))) return;
      cambiarCarta(c => { c.secciones = c.secciones.filter(x => x.id !== id); });
    }else cambiarCarta(c => { seccion(c, id).items.splice(Number(i), 1); });
  }));
  // tocar un plato: se abre su ficha del stock (precio, guarnición, stock); la carta se actualiza sola
  main.querySelectorAll('[data-editar]').forEach(el => {
    const abrir = () => abrirPlato(el.dataset.editar);
    el.addEventListener('click', abrir);
    el.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); abrir(); } });
  });
  main.querySelectorAll('[data-agregar]').forEach(b => b.addEventListener('click', () => dialogoAgregarACarta(b.dataset.agregar)));
}

/* Los platos de la categoría de una sección (o las guarniciones): los que ya están aparecen tildados;
   se tilda lo que se suma y se destilda lo que se saca. La categoría de la sección se puede cambiar
   acá. Si falta un plato, se crea (queda también en el Stock, en esa categoría). */
function dialogoAgregarACarta(secId){
  const s = cartaActual().secciones.find(x => x.id === secId); if(!s) return;
  const guarn = s.tipo === 'guarniciones';
  const idDe = (it) => it.menuId || it.productoId;
  const ya = s.items.map(idDe);
  let cat = guarn ? null : categoriaDeSeccion(s);
  // los que ya están (aunque sean de otra categoría, para poder sacarlos) y después los de su categoría
  const yaObjs = ya.map(id => guarn ? productoDe(id) : menuPorId(id)).filter(x => x && x.activo);
  const deLaSeccion = () => guarn ? guarniciones() : cat ? platosParaCategoria(cat) : [];
  // con lo que dice el stock: cuántos quedan (o "sin stock"), si se cuenta
  const stockTxt = (x) => guarn ? (x.stock !== 0 ? `hay ${fmtNum(x.stock)} ${x.unidad}` : '') : textoDisponible(x);
  const fila = (x, marcado) => { const st = stockTxt(x), det = [!guarn && cat && !mismaCategoria(x.categoria, cat) && x.categoria, st].filter(Boolean);
    return `<label class="check ca-op" data-busca="${esc(normalizarNombre(x.nombre))}">
      <input type="checkbox" value="${x.id}" ${marcado ? 'checked' : ''}><span class="t">${esc(x.nombre)}${det.length ? `<small>${esc(det.join(' · '))}</small>` : ''}</span>
      ${!guarn && x.precio != null ? `<b>${fmtPlata(x.precio)}</b>` : ''}</label>`; };
  const listaHtml = (marcados) => {
    const ops = [...yaObjs, ...deLaSeccion().filter(x => !ya.includes(x.id))];
    const vacio = guarn ? 'Todavía no hay guarniciones cargadas.' : cat ? `Todavía no hay platos en <b>${esc(cat)}</b>: creá el primero con "Crear plato nuevo".` : 'Elegí la categoría de esta sección para ver sus platos.';
    return ops.map(x => fila(x, marcados.has(x.id))).join('') + (deLaSeccion().length ? '' : `<div class="calm">${icon('info')}<span>${vacio}</span></div>`);
  };
  dialogo({
    titulo: `${guarn ? 'Guarniciones' : 'Platos'} de "${s.titulo}"`,
    texto: guarn ? 'Tildá lo que va en esta sección y destildá lo que querés sacar.' : 'Aparecen solo los platos de su categoría. Tildá lo que va y destildá lo que querés sacar.',
    html: `${guarn ? '' : `<div class="field ca-cat"><label for="ca-cat">Categoría de la sección</label>
        <select id="ca-cat"><option value="">Elegí una categoría</option>${categorias().map(c => `<option value="${esc(c)}" ${cat && mismaCategoria(c, cat) ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>`}
      <div class="pn-buscar" style="margin-bottom:8px">${icon('buscar', 15)}<input class="inp" id="ca-busca" placeholder="Buscar…" autocomplete="off"></div>
      <div class="ca-lista" id="ca-lista">${listaHtml(new Set(ya))}</div>`,
    botones: [{ id: 'nuevo', label: guarn ? 'Crear guarnición nueva' : 'Crear plato nuevo' }, { id: 'cancelar', label: 'Cancelar' }, { id: 'ok', label: 'Listo', clase: 'primary', domId: 'ca-agregar' }],
    onMount: (el) => {
      const bq = el.querySelector('#ca-busca'), lista = el.querySelector('#ca-lista'), btn = el.querySelector('#ca-agregar');
      const tildados = () => [...lista.querySelectorAll('.ca-op input')].filter(x => x.checked).map(x => x.value);
      const filtrar = () => { const q = normalizarNombre(bq.value); lista.querySelectorAll('.ca-op').forEach(o => { o.hidden = !!q && !o.dataset.busca.includes(q); }); };
      // el botón cuenta lo que cambia
      const contar = () => {
        const tild = tildados(), suma = tild.filter(id => !ya.includes(id)).length, saca = ya.filter(id => lista.querySelector(`.ca-op input[value="${id}"]`) && !tild.includes(id)).length;
        btn.textContent = suma || saca ? [suma && `Sumar ${suma}`, saca && `sacar ${saca}`].filter(Boolean).join(' y ') : 'Listo';
      };
      const bind = () => { lista.querySelectorAll('.ca-op input').forEach(x => x.addEventListener('change', contar)); filtrar(); contar(); };
      bq.addEventListener('input', filtrar);
      const sc = el.querySelector('#ca-cat');
      if(sc) sc.addEventListener('change', () => { const marcados = new Set(tildados()); cat = sc.value || null; lista.innerHTML = listaHtml(marcados); bind(); });
      bind();
    }
  }).then(async (r) => {
    if(!r) return;
    if(r.boton === 'nuevo'){
      const sumar = (id, catNueva) => cambiarCarta(c => { const x = c.secciones.find(y => y.id === secId); if(!x) return;
        if(!guarn && !x.categoria && catNueva) x.categoria = catNueva;
        x.items.push(guarn ? { productoId: id } : { menuId: id }); });
      if(!guarn){ abrirPlato(null, { categoria: cat || '', alGuardar: (m) => sumar(m.id, m.categoria) }); return; }
      const q = await dialogo({ titulo: 'Guarnición nueva', html: `<div class="field"><label for="f-gn">Nombre${REQ}</label><input type="text" id="f-gn" placeholder="Ej: Calabaza al horno" autofocus></div>`,
        botones: [{ id: 'cancelar', label: 'Cancelar' }, { id: 'ok', label: 'Crear', clase: 'primary' }],
        onMount: (el) => { el._validar = () => el.querySelector('#f-gn').value.trim() ? true : marcarFalta(el.querySelector('#f-gn'), 'Poné el nombre.'); } });
      if(!q) return;
      try{
        const p = await guardarProducto(null, { nombre: q.el.querySelector('#f-gn').value.trim(), unidad: 'porciones', minimo: 0, porVianda: 0, activo: true, esGuarnicion: true });
        sumar(p.id);
      }catch(e){ toastError('No se pudo crear la guarnición', e); }
      return;
    }
    const inputs = [...r.el.querySelectorAll('.ca-op input')], enLista = new Set(inputs.map(x => x.value));
    const tild = inputs.filter(x => x.checked).map(x => x.value);
    cambiarCarta(c => {
      const x = c.secciones.find(y => y.id === secId); if(!x) return;
      if(!guarn && cat) x.categoria = cat;
      // se sacan los destildados (los desactivados, que no están en la lista, quedan) y se suman los nuevos al final
      x.items = x.items.filter(it => !enLista.has(idDe(it)) || tild.includes(idDe(it)));
      x.items.push(...tild.filter(id => !ya.includes(id)).map(id => guarn ? { productoId: id } : { menuId: id }));
    });
  });
}

/* ---------- compartir: la imagen y el link fijo ---------- */
async function cargarHtml2canvas(){
  if(window.html2canvas) return;
  await new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = ok; s.onerror = () => mal(new Error('No se pudo cargar lo que arma la imagen. Revisá la conexión.'));
    document.head.appendChild(s);
  });
}
/* La imagen de la carta (PNG), armada con la versión para imagen: más grande y sin botones. */
async function imagenCarta(){
  await cargarHtml2canvas();
  const caja = document.createElement('div');
  caja.className = 'carta-render';
  caja.innerHTML = cartaHtml(cartaActual(), { imagen: true });
  document.body.appendChild(caja);
  try{
    if(document.fonts && document.fonts.ready) await document.fonts.ready;
    const lienzo = await window.html2canvas(caja.firstElementChild, { scale: 1.5, backgroundColor: null, logging: false, useCORS: true });
    return await new Promise((ok, mal) => lienzo.toBlob(b => b ? ok(b) : mal(new Error('No se pudo armar la imagen.')), 'image/png'));
  }finally{ caja.remove(); }
}
const nombreArchivoCarta = () => `carta-${normalizarNombre(state.config.nombre || 'menu').replace(/[^a-z0-9]+/g, '-')}.png`;
function descargarBlob(blob, nombre){
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function copiarImagen(blob){
  if(!navigator.clipboard || !window.ClipboardItem) return false;
  try{ await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); return true; }catch(_){ return false; }
}

/* Compartir: arma la imagen, la publica en el link fijo y ofrece mandarla por WhatsApp. */
function abrirCompartirCarta(){
  const carta = cartaActual();
  if(!carta.secciones.length){ toast('La carta está vacía: agregá al menos una sección antes de compartirla.', 'err'); return; }
  abrirPanel({
    ancho: 'medio',
    titulo: `${icon('wa', 14)} Compartir la carta`,
    html: `<div class="cc"><div class="cc-prev" id="cc-prev"><div class="boot" style="min-height:280px"><div>${LOADER_HTML}<span class="boot-txt">Armando la imagen…</span></div></div></div>
      <div class="cc-lado">
        <div class="psec" style="margin-top:0"><h3>Por WhatsApp</h3>
          <button class="btn lg primary" type="button" id="cc-wa" disabled>${icon('wa', 15)} Mandar la imagen</button>
          <div class="cc-fila"><button class="btn" type="button" id="cc-copiar" disabled>${icon('copiar', 13)} Copiar imagen</button>
            <button class="btn" type="button" id="cc-bajar" disabled>${icon('backup', 13)} Descargar</button></div>
          <p class="help" id="cc-ayuda">En el celular se abre WhatsApp para elegir a quién. En la compu, copiala y pegala en WhatsApp Web (Ctrl+V), o descargala.</p></div>
        <div class="psec"><h3>Link fijo</h3>
          <p class="help" style="margin:0 0 8px">Mandalo una vez: siempre muestra la última versión que compartiste desde acá.</p>
          <div class="cc-link"><input class="inp" id="cc-url" readonly value="${esc(linkCarta())}"><button class="btn" type="button" id="cc-copiar-link">${icon('copiar', 13)} Copiar</button></div>
          <a class="btn" id="cc-wa-link" href="${waTexto(`${carta.titulo || 'Nuestro menú'}: ${linkCarta()}`)}" target="_blank" rel="noopener">${icon('wa', 13)} Mandar el link</a>
          <p class="cc-estado" id="cc-estado"><span class="muted">Actualizando el link…</span></p></div>
      </div></div>`,
    pie: '<span class="sp"></span><button class="btn lg" id="cc-listo">Listo</button>',
    onMount: async (el) => {
      el.querySelector('#cc-listo').addEventListener('click', () => cerrarPanel());
      el.querySelector('#cc-copiar-link').addEventListener('click', async () => {
        copiarConAviso(linkCarta(), 'Link copiado.', el.querySelector('#cc-copiar-link'));
      });
      let blob;
      try{ blob = await imagenCarta(); }
      catch(e){ el.querySelector('#cc-prev').innerHTML = `<div class="calm">${icon('alerta')} ${esc(e.message || 'No se pudo armar la imagen.')}</div>`; return; }
      if(!el.isConnected) return;
      const archivo = new File([blob], nombreArchivoCarta(), { type: 'image/png' });
      el.querySelector('#cc-prev').innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="La carta como imagen">`;
      ['#cc-wa', '#cc-copiar', '#cc-bajar'].forEach(s => { el.querySelector(s).disabled = false; });
      el.querySelector('#cc-bajar').addEventListener('click', () => descargarBlob(blob, nombreArchivoCarta()));
      el.querySelector('#cc-copiar').addEventListener('click', async () => toast(await copiarImagen(blob) ? 'Imagen copiada: pegala en WhatsApp (Ctrl+V).' : 'No se pudo copiar: descargala.', 'info'));
      el.querySelector('#cc-wa').addEventListener('click', async () => {
        // en el celular se comparte la imagen (WhatsApp aparece en la lista); en la compu, se copia y se descarga
        if(navigator.canShare && navigator.canShare({ files: [archivo] })){
          try{ await navigator.share({ files: [archivo], title: carta.titulo || 'Nuestro menú' }); }catch(_){ /* la cerró */ }
          return;
        }
        const copiada = await copiarImagen(blob);
        descargarBlob(blob, nombreArchivoCarta());
        toast(`${copiada ? 'Imagen copiada y descargada' : 'Imagen descargada'}: abrí WhatsApp Web, elegí el chat y ${copiada ? 'pegala (Ctrl+V)' : 'adjuntala'}.`, 'info', 8000);
        window.open('https://web.whatsapp.com/', '_blank', 'noopener');
      });
      // el link fijo pasa a mostrar esta versión
      try{
        await publicarImagenCarta(blob);
        const hora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
        el.querySelector('#cc-estado').innerHTML = `<span class="ok">${icon('check', 13)} Listo: el link ya muestra esta versión (${hora}).</span>`;
      }catch(e){
        el.querySelector('#cc-estado').innerHTML = `<span class="bad">${icon('alerta', 13)} No se pudo actualizar el link: ${esc(traducirError(e.message || String(e)))}</span>`;
      }
    }
  });
}
