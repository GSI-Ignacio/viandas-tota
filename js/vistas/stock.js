/* ============================================================
   PESTAÑA: STOCK — una sola lista con todo lo que se vende y se cuenta
   Cada plato tiene su precio y su stock (un producto con su mismo nombre);
   las promos y los combos descuentan de los productos que usan, y lo que no
   se vende solo (guarniciones, envases, insumos) va al final. La carta
   (pestaña Menú) y los pedidos eligen de esta lista.
   Un pedido descuenta su stock al cargarse, y una vianda de pack el de su
   tipo de vianda al entregarse (más lo que se usa en toda vianda, como
   envases). Con las viandas de los próximos días se calcula hasta cuándo alcanza.
============================================================= */
const UNIDADES = ['unidades', 'porciones', 'kg', 'cajones', 'bandejas', 'paquetes', 'docenas', 'litros'];
let stockBusca = '', stockInactivos = false;

function coberturaTxt(p){
  const cob = coberturaProducto(p);
  if(!cob) return { txt: 'No está en ningún plato', cls: 'muted' };
  if(p.stock <= 0 && !cob.faltaEl) return { txt: 'sin stock', cls: 'warn' };
  if(cob.faltaEl) return { txt: cob.faltaEl === todayStr() ? 'no alcanza para hoy' : `falta desde ${nombreDia(cob.faltaEl).toLowerCase() === 'mañana' ? 'mañana' : 'el ' + nombreDia(cob.faltaEl).toLowerCase()}`, cls: cob.faltaEl <= sumarDias(todayStr(), 2) ? 'bad' : 'warn' };
  return { txt: 'alcanza para más de 30 días', cls: 'ok' };
}

/* La lista: los platos por categoría y, al final, lo que no se vende solo (y el stock de un plato
   desactivado que todavía usan otros, como una promo). */
function gruposStock(){
  const ids = (ms) => new Set(ms.map(productoPropio).filter(Boolean).map(p => p.id));
  const deActivos = ids(state.menus.filter(m => m.activo)), deTodos = ids(state.menus);
  const porNombre = (a, b) => (b.activo - a.activo) || a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base', numeric: true });
  // en el orden de las categorías ("Carnes" y "carnes" van juntas); los que no tienen, al final
  const catDe = (m) => nombreCategoria(m.categoria) || 'Sin categoría';
  const cats = [...new Set(state.menus.filter(m => !esMenuDelDia(m)).map(catDe))].sort((a, b) => (a === 'Sin categoría') - (b === 'Sin categoría') || ordenPorCategoria(a, b));
  const precioGrupo = (cat) => esCategoriaDelDia(cat) ? state.config.precioMenuDia : normalizarNombre(cat) === 'sin tacc' ? state.config.precioMenuSinTacc : null;
  const grupos = cats.map(cat => ({ titulo: cat, nota: precioGrupo(cat) != null ? `pedido como menú del día: ${fmtPlata(precioGrupo(cat))}` : '',
    filas: state.menus.filter(m => catDe(m) === cat && !esMenuDelDia(m))
    .sort((a, b) => (b.activo - a.activo) || ordenMenus(a, b)).map(m => ({ m, p: productoPropio(m) })) }));
  const resto = state.productos.filter(p => !deActivos.has(p.id) && (p.activo || !deTodos.has(p.id))).sort(porNombre);
  grupos.push({ titulo: 'Guarniciones', nota: 'se eligen en cada pedido', filas: resto.filter(p => p.esGuarnicion).map(p => ({ p })) });
  grupos.push({ titulo: 'Otros productos', nota: 'no se venden solos: envases, insumos…', filas: resto.filter(p => !p.esGuarnicion).map(p => ({ p })) });
  return grupos.filter(g => g.filas.length);
}

function renderStock(bar, main){
  const edita = esDueno();
  bar.innerHTML = `<h1>Stock</h1><div class="sp"></div>
    ${edita ? `<button class="btn" id="pegar-carta">${icon('copiar', 14)} Pegar carta</button>
      <button class="btn" id="nuevo-item">${icon('plus', 14)} Nuevo</button>
      <button class="btn primary" id="cargar-stock">${icon('caja', 14)} Cargar stock</button>` : '<span class="muted">Solo lectura</span>'}`;
  const on = (sel, fn) => { const b = bar.querySelector(sel); if(b) b.addEventListener('click', fn); };
  on('#pegar-carta', () => abrirPegarCarta());
  on('#nuevo-item', () => elegirNuevo());
  on('#cargar-stock', () => abrirCargaStock());
  alinearCartaConCategorias();   // una carta armada antes de las categorías (ver carta.js)

  const hoy = todayStr();
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(hoy, i));
  const demanda7 = dias.reduce((s, f) => s + demandaDia(f), 0);
  const hoyNecesita = necesidadProductos(hoy, { soloPendiente: true });
  const grupos = gruposStock();
  const activos = grupos.reduce((s, g) => s + g.filas.filter(f => (f.m || f.p).activo).length, 0);
  const inactivos = grupos.reduce((s, g) => s + g.filas.filter(f => !(f.m || f.p).activo).length, 0);
  const stockCelda = (p) => { const bajo = p.minimo > 0 && p.stock <= p.minimo;
    return `<span class="saldo ${p.stock < 0 || bajo ? 'bad' : ''}" ${bajo ? `title="Avisa cuando quedan ${fmtNum(p.minimo)}"` : ''}>${fmtNum(p.stock)}</span>`; };
  const faltaCelda = (p) => p && hoyNecesita[p.id] ? `<span class="saldo ${hoyNecesita[p.id] > p.stock ? 'bad' : ''}">${fmtNum(hoyNecesita[p.id])}</span>` : '<span class="muted">—</span>';
  const cobCelda = (p) => { if(!p) return ''; const c = coberturaTxt(p); return `<span class="${c.cls === 'muted' ? 'muted' : 'saldo ' + c.cls}" style="font-weight:500">${esc(c.txt)}</span>`; };
  const cargar = (v, t) => edita ? `<td class="r">${v ? `<button class="btn" data-cargar="${v}" title="${t || 'Cargar stock'}" aria-label="Cargar stock">${icon('plus', 12)}<span class="cargar-lbl"> Cargar</span></button>` : ''}</td>` : '';
  const fila = (f, g) => {
    const x = f.m || f.p, p = f.p;
    const attrs = `class="click ${x.activo ? '' : 'off'} ${p && p.stock < 0 ? 'neg' : ''}" tabindex="0" data-busca="${esc(normalizarNombre(x.nombre + ' ' + g.titulo))}" ${x.activo ? '' : 'data-inactivo'}`;
    const tags = `${x.activo ? '' : ' <span class="tag plain">Inactivo</span>'}${p && p.stock < 0 ? ' <span class="tag bad">en negativo</span>' : ''}`;
    if(f.m){
      const m = f.m, modo = stockDePlato(m), disp = modo === 'otros' ? porcionesDisponibles(m) : null;
      return `<tr ${attrs} data-plato="${m.id}">
        <td><div class="pwho">${icon('menu', 15)}<div><div class="n">${esc(m.nombre)}${m.llevaGuarnicion ? ' <span class="tag plain">+ guarnición</span>' : ''}${tags}</div>
          <div class="s">${modo === 'propio' ? esc(p.unidad) : modo === 'otros' ? `usa ${esc(componentesTxt(m))}` : 'no se cuenta'}</div></div></div></td>
        <td class="r">${m.precio != null ? fmtPlata(m.precio) : '<span class="muted">sin precio</span>'}</td>
        <td class="r">${p ? stockCelda(p) : disp != null ? `<span class="muted" title="Los que alcanzan con el stock de ${esc(componentesTxt(m))}">alcanza ${fmtNum(disp)}</span>` : '<span class="muted">—</span>'}</td>
        <td class="r">${faltaCelda(p)}</td><td>${cobCelda(p)}</td>
        ${cargar(p ? p.id : modo === 'no' && m.activo ? 'm:' + m.id : '', modo === 'no' ? 'Cargale stock: desde ahí se empieza a contar' : '')}</tr>`;
    }
    return `<tr ${attrs} data-prod="${p.id}">
      <td><div class="pwho">${icon('caja', 15)}<div><div class="n">${esc(p.nombre)}${tags}</div>
        <div class="s">${esc(p.unidad)}${p.porVianda > 0 ? ` · ${fmtNum(p.porVianda)} en cada vianda` : ''}</div></div></div></td>
      <td class="r"></td><td class="r">${stockCelda(p)}</td><td class="r">${faltaCelda(p)}</td><td>${cobCelda(p)}</td>
      ${cargar(p.activo ? p.id : '')}</tr>`;
  };
  main.innerHTML = `<div class="page">
    <section class="tsec" style="margin-top:0">
      <h2>Demanda de los próximos 7 días <span class="n">${demanda7} viandas</span><span class="sp"></span><span class="hint2">según las comandas y los días fijos de los clientes</span></h2>
      <div class="forecast">${dias.map((f, i) => `<div class="fday ${i === 0 ? 'today' : ''}"><div class="d">${esc(nombreDia(f))}</div><b>${demandaDia(f)}</b>
        <div class="x">${i === 0 ? `${resumenDia(f).entregadas} entregadas` : plural(clientesActivos().filter(c => programadoEn(c, f)).length, 'cliente')}</div></div>`).join('')}</div>
    </section>
    <section class="tsec">
      <h2>Platos y productos <span class="n">${activos}</span><span class="sp"></span>
        ${edita ? `<button class="btn quiet" type="button" id="ver-categorias">${icon('menu', 13)} Categorías</button>` : ''}
        ${inactivos ? `<button class="btn quiet" type="button" id="ver-inactivos">${stockInactivos ? 'Ocultar' : 'Ver'} ${plural(inactivos, 'desactivado', 'desactivados')}</button>` : ''}</h2>
      ${grupos.length ? `<div class="pn-buscar stock-buscar">${icon('buscar', 15)}<input class="inp" id="stock-busca" placeholder="Buscar un plato o producto…" value="${esc(stockBusca)}" autocomplete="off" aria-label="Buscar un plato o producto"></div>
        <div class="clist"><div class="tablewrap"><table class="ptable stock-t" id="stock-tabla">
          <thead><tr><th>Nombre</th><th class="r">Precio</th><th class="r">Stock</th><th class="r" title="Viandas de packs que faltan entregar hoy. Los pedidos ya se descontaron al cargarlos.">Falta hoy</th><th>Cobertura</th>${edita ? '<th class="r"></th>' : ''}</tr></thead>
          <tbody>${grupos.map(g => `<tr class="grp" data-grp><td colspan="${edita ? 6 : 5}">${esc(g.titulo)}${g.nota ? `<span class="grp-nota"> · ${esc(g.nota)}</span>` : ''}</td></tr>
            ${g.filas.map(f => fila(f, g)).join('')}`).join('')}</tbody>
        </table></div><div class="calm hidden" id="stock-nada">${icon('buscar')} <span></span></div></div>`
      : `<div class="clist"><div class="stub" style="margin:28px auto"><div class="ico">${icon('caja', 20)}</div><h2>Todavía no hay nada cargado</h2>
          <p>Acá va todo lo que vendés y contás: cada plato con su precio y cuántos hay, las guarniciones y lo que se usa en cada vianda (envases).
            Pegá la carta que mandás por WhatsApp y se cargan todos los platos de una vez.</p>
          ${edita ? `<button class="btn lg primary" id="primera-carta">${icon('copiar', 14)} Pegar carta</button> <button class="btn lg" id="primer-item">${icon('plus', 14)} Nuevo</button>` : ''}</div></div>`}
    </section></div>`;
  // buscar: filtra las filas; los desactivados se ven al buscar o con "Ver desactivados"
  const filtrar = () => {
    const q = normalizarNombre(stockBusca);
    let grp = null, enGrp = 0, total = 0;
    const cerrar = () => { if(grp) grp.hidden = !enGrp; };
    for(const r of main.querySelectorAll('#stock-tabla tbody tr')){
      if(r.hasAttribute('data-grp')){ cerrar(); grp = r; enGrp = 0; continue; }
      const ver = (!r.hasAttribute('data-inactivo') || stockInactivos || !!q) && (!q || r.dataset.busca.includes(q));
      r.hidden = !ver; if(ver){ enGrp++; total++; }
    }
    cerrar();
    const nada = main.querySelector('#stock-nada');
    if(nada){ nada.classList.toggle('hidden', total > 0); nada.querySelector('span').textContent = q ? `No hay nada con «${stockBusca.trim()}».` : 'No hay nada activo para mostrar.'; }
  };
  filtrar();
  const bq = main.querySelector('#stock-busca'); if(bq) bq.addEventListener('input', () => { stockBusca = bq.value; filtrar(); });
  const vi = main.querySelector('#ver-inactivos'); if(vi) vi.addEventListener('click', () => { stockInactivos = !stockInactivos; render(); });
  const vc = main.querySelector('#ver-categorias'); if(vc) vc.addEventListener('click', () => abrirCategorias());
  const abrirFila = (r) => r.dataset.plato ? abrirPlato(r.dataset.plato) : abrirProducto(r.dataset.prod);
  main.querySelectorAll('[data-plato], [data-prod]').forEach(r => {
    r.addEventListener('click', () => abrirFila(r));
    r.addEventListener('keydown', e => { if(e.key === 'Enter') abrirFila(r); });
  });
  main.querySelectorAll('[data-cargar]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); abrirCargaStock(b.dataset.cargar); }));
  const pc = main.querySelector('#primera-carta'); if(pc) pc.addEventListener('click', () => abrirPegarCarta());
  const pi = main.querySelector('#primer-item'); if(pi) pi.addEventListener('click', () => elegirNuevo());
}

/* Nuevo: un plato (se vende, con su precio) o algo que no se vende solo (una guarnición, un envase, un insumo). */
async function elegirNuevo(){
  const r = await dialogo({
    titulo: '¿Qué querés agregar?',
    html: `<div class="nuevo-ops">
      <button type="button" class="nuevo-op" data-b="plato">${icon('menu', 18)}<b>Un plato</b><span>Lo que se vende, con su precio: milanesa, tarta, una promo…</span></button>
      <button type="button" class="nuevo-op" data-b="guarnicion">${icon('caja', 18)}<b>Una guarnición</b><span>Se elige en cada pedido: puré, ensalada, arroz…</span></button>
      <button type="button" class="nuevo-op" data-b="producto">${icon('caja', 18)}<b>Otro producto</b><span>Lo que no se vende solo: envases, verduras, insumos…</span></button></div>`,
    botones: [{ id: 'cancelar', label: 'Cancelar' }]
  });
  if(!r) return;
  if(r.boton === 'plato') abrirPlato(null);
  else abrirProducto(null, null, { guarnicion: r.boton === 'guarnicion' });
}

function dialogoMovimiento(p, tipo, alTerminar){
  if(!p) return;
  const titulos = { entrada: 'Registrar entrada', salida: 'Registrar salida', ajuste: 'Ajustar al stock contado' };
  dialogo({
    titulo: `${titulos[tipo]} · ${p.nombre}`,
    texto: `Stock actual: <b>${fmtNum(p.stock)} ${esc(p.unidad)}</b>.`,
    html: `<div class="frow">
        <div class="field"><label for="f-mov-cant">${tipo === 'ajuste' ? 'Stock contado' : 'Cantidad'} (${esc(p.unidad)})${REQ}</label>
          <input type="number" id="f-mov-cant" step="any" ${tipo === 'ajuste' ? `value="${p.stock}"` : 'min="0"'} autofocus></div>
        <div class="field"><label for="f-mov-fecha">Fecha</label><input type="date" id="f-mov-fecha" value="${todayStr()}"></div></div>
      <div class="field"><label for="f-mov-nota">Nota (opcional)</label><input type="text" id="f-mov-nota" placeholder="${tipo === 'entrada' ? 'Compra, proveedor…' : tipo === 'salida' ? 'Uso en cocina, merma…' : 'Recuento'}"></div>`,
    botones: [{ id: 'cancelar', label: 'Cancelar' }, { id: 'ok', label: 'Guardar', clase: 'primary', domId: 'confirmar-mov' }],
    onMount: (el) => {
      el._validar = () => {
        const v = Number(el.querySelector('#f-mov-cant').value);
        if(el.querySelector('#f-mov-cant').value === '' || isNaN(v) || (tipo !== 'ajuste' && v <= 0)) return marcarFalta(el.querySelector('#f-mov-cant'), 'Poné una cantidad válida.');
        return true;
      };
    }
  }).then(async (r) => {
    if(!r) return;
    const v = Number(r.el.querySelector('#f-mov-cant').value);
    const cantidad = tipo === 'ajuste' ? v - p.stock : v;
    if(tipo === 'ajuste' && cantidad === 0){ toast('El stock contado coincide: no hay nada que ajustar.', 'info'); return; }
    try{
      await registrarMovimiento(p, { tipo, cantidad, nota: r.el.querySelector('#f-mov-nota').value.trim(), fecha: r.el.querySelector('#f-mov-fecha').value });
      const act = state.productos.find(x => x.id === p.id);
      toast(`<b>${esc(p.nombre)}</b>: ahora hay ${fmtNum(act ? act.stock : 0)} ${esc(p.unidad)}.`);
      renderMenu();
      if(alTerminar) alTerminar(); else refrescar();
    }catch(e){ toastError('No se pudo registrar el movimiento', e); }
  });
}

/* Los últimos movimientos de un producto, en la caja #p-movs de la ventana. */
async function pintarMovimientos(el, p){
  const box = el.querySelector('#p-movs');
  if(!box || !p) return;
  try{
    const movs = await listarMovimientos(p.id);
    const TIPO = { entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste', entrega: 'Entrega' };
    box.innerHTML = movs.length ? movs.map(m => `<div class="hist">
        <span class="w">${formatFechaCorta(m.fecha)}</span>
        <span class="t">${TIPO[m.tipo] || m.tipo}${m.nota ? ' · ' + esc(m.nota) : ''}</span>
        <span class="v ${Number(m.cantidad) < 0 ? 'bad' : 'ok'}">${Number(m.cantidad) > 0 ? '+' : ''}${fmtNum(m.cantidad)}</span></div>`).join('')
      : '<div class="muted" style="font-size:13px">Sin movimientos todavía.</div>';
  }catch(e){ box.innerHTML = '<div class="muted">No se pudieron cargar los movimientos.</div>'; }
}
const unidadesHtml = (sel) => `${UNIDADES.map(u => `<option value="${u}" ${u === sel ? 'selected' : ''}>${u}</option>`).join('')}
  ${!UNIDADES.includes(sel) ? `<option value="${esc(sel)}" selected>${esc(sel)}</option>` : ''}<option value="__otra">Otra…</option>`;

/* Lo que no se vende solo: una guarnición, un envase, un insumo (el stock de un plato se ve en el plato).
   seguido = al cargar varios uno atrás de otro: los que ya se crearon, la unidad del último y si son guarniciones */
function abrirProducto(id, seguido = null, { guarnicion = false } = {}){
  const p = id ? productoDe(id) : null;
  if(id && !p) return;
  const suPlato = p && state.menus.find(m => m.activo && productoPropio(m) === p);   // el stock de un plato se ve en el plato
  if(suPlato) return abrirPlato(suPlato.id);
  const esG = p ? p.esGuarnicion : guarnicion || !!(seguido && seguido.guarnicion);
  const d = p || { nombre: '', unidad: (seguido && seguido.unidad) || (esG ? 'porciones' : 'unidades'), minimo: 0, porVianda: 0, activo: true, stock: 0, esGuarnicion: esG };
  const lectura = !esDueno();
  const cob = p ? coberturaProducto(p) : null;
  const usanlo = p ? state.menus.filter(m => m.activo && m.items.some(i => i.productoId === p.id)) : [];
  // la ficha: arriba lo principal; abajo, en columnas, el producto, lo que se descuenta solo y los movimientos
  const cabeza = `${p ? `<h2 class="ptitle">${esc(p.nombre)}</h2>
        <div class="stats" style="margin-top:8px">
          <div class="stat2"><b class="${p.stock < 0 || (p.minimo && p.stock <= p.minimo) ? 'bad' : ''}">${fmtNum(p.stock)}</b><span>${esc(p.unidad)} en stock</span></div>
          ${cob ? `<div class="stat2"><b>${fmtNum(cob.necesario7)}</b><span>se usan en 7 días</span></div>
                   <div class="stat2"><b class="${cob.faltaEl ? 'warn' : 'ok'}">${cob.faltaEl ? esc(nombreDia(cob.faltaEl)) : '30+ días'}</b><span>${cob.faltaEl ? 'falta desde' : 'alcanza'}</span></div>` : ''}
        </div>
        ${usanlo.length ? `<p class="help" style="margin:8px 0 0">Lo usan: ${usanlo.map(m => `<b>${esc(m.nombre)}</b> (${fmtNum(m.items.find(i => i.productoId === p.id).cantidad)} por plato)`).join(', ')}.</p>` : ''}
        ${!lectura ? `<div class="pacts" style="border:0;padding:0;margin:10px 0 0">
          <button class="btn lg" data-m="entrada">${icon('plus', 14)} Entrada</button>
          <button class="btn lg" data-m="salida">− Salida</button>
          <button class="btn lg" data-m="ajuste">${icon('editar', 14)} Ajustar al contado</button></div>` : ''}` : ''}`;
  const secProd = `${seguido && seguido.creados.length ? `<div class="banner" style="border-radius:9px;border:1px solid var(--ok-line);background:var(--ok-wash);color:var(--ok-ink);margin-bottom:14px">
          ${icon('check', 14)} Ya agregaste: <b>${seguido.creados.map(esc).join(' · ')}</b></div>` : ''}
      <div class="psec" style="margin-top:0"><h3>${esG ? 'Guarnición' : 'Producto'}</h3>
        <div class="field"><label for="f-prod-nombre">Nombre${REQ}</label><input type="text" id="f-prod-nombre" value="${esc(d.nombre)}" placeholder="${esG ? 'Ej: Puré de papa, Ensalada' : 'Ej: Envases, Bolsas, Cajones de tomate'}" autocomplete="off" ${p ? '' : 'autofocus'}>
          <div id="prod-existe"></div></div>
        <div class="field"><label for="f-prod-unidad">Se cuenta en</label>
          <select id="f-prod-unidad">${unidadesHtml(d.unidad)}</select>
          <input type="text" id="f-prod-unidad-otra" class="hidden" placeholder="Escribí la unidad" style="margin-top:6px"></div>
      </div>
      <div class="psec"><h3>Stock</h3>
        ${!p ? `<div class="field"><label for="f-prod-inicial">¿Cuánto tenés ahora?</label><input type="number" id="f-prod-inicial" min="0" step="any" value="0">
          <div class="help">Después, para sumar o restar, usá <b>Cargar stock</b>.</div></div>` : ''}
        <div class="field"><label for="f-prod-minimo">Avisarme cuando queden menos de</label><input type="number" id="f-prod-minimo" min="0" step="any" value="${d.minimo}">
          <div class="help">Aparece en rojo en Stock. Con 0 no avisa.</div></div>
      </div>`;
  const secAuto = `<div class="psec"><h3>¿Se descuenta solo?</h3>
        <p class="help" style="margin:0 0 10px">${esG ? 'Se descuenta 1 cada vez que la eligen en un pedido.' : 'Lo que se vende (los platos y las promos) va como plato, con su precio. Acá, lo que no se vende solo.'}</p>
        <label class="check"><input type="checkbox" id="f-prod-envase" ${d.porVianda > 0 ? 'checked' : ''}> Se usa en cada vianda que se entrega</label>
        <div class="help" style="margin:4px 0 10px 24px">Para envases, cubiertos, servilletas o bolsas. Ej: si hoy se entregan 12 viandas, se descuentan 12.</div>
        <div class="field ${d.porVianda > 0 ? '' : 'hidden'}" id="grupo-porvianda" style="margin-left:24px"><label for="f-prod-porvianda">¿Cuántos por vianda?</label>
          <input type="number" id="f-prod-porvianda" min="0" step="any" value="${d.porVianda > 0 ? d.porVianda : 1}" style="max-width:120px"></div>
        <label class="check" style="margin-top:6px"><input type="checkbox" id="f-prod-guarnicion" ${d.esGuarnicion ? 'checked' : ''}> Es una guarnición (arroz, puré, ensalada…: se elige en cada pedido)</label>
        <label class="check" style="margin-top:6px"><input type="checkbox" id="f-prod-activo" ${d.activo ? 'checked' : ''}> Activo (aparece para cargar y en los pedidos)</label>
      </div>
      ${p && !esG ? `<div class="psec"><h3>¿Se vende solo?</h3>
        <p class="help" style="margin:0 0 10px">Pasalo a plato: le ponés precio y aparece en los pedidos y en la carta, con este mismo stock.</p>
        <button class="btn" type="button" id="prod-a-plato">${icon('menu', 13)} Pasarlo a plato</button></div>` : ''}`;
  const secMovs = p ? `<div class="psec"><h3>Movimientos</h3><div id="p-movs"><div class="skel" style="width:50%"></div></div></div>` : '';
  const secBorrar = p && !lectura ? `<div class="psec"><button class="btn lg danger" id="borrar-producto">${icon('borrar', 14)} Eliminar ${esG ? 'guarnición' : 'producto'}</button></div>` : '';
  const cuerpo = lectura ? `<dl class="props" style="margin-top:16px"><dt>Unidad</dt><dd>${esc(d.unidad)}</dd><dt>Avisar con</dt><dd>${fmtNum(d.minimo)}</dd><dt>En cada vianda</dt><dd>${d.porVianda ? fmtNum(d.porVianda) : 'No'}</dd></dl>` + secMovs
    : p ? `<div class="pcols" style="margin-top:22px"><div class="pcol">${secProd}</div><div class="pcol">${secAuto}${secBorrar}</div><div class="pcol">${secMovs}</div></div>`
    : secProd + secAuto;
  abrirPanel({
    ancho: p ? 'grande' : 'medio',
    titulo: `${icon('caja', 14)} ${p ? (esG ? 'Guarnición' : 'Producto') : esG ? 'Nueva guarnición' : 'Nuevo producto'}`,
    html: cabeza + cuerpo,
    pie: lectura ? '' : `<button class="btn lg" id="cancelar-prod">${seguido ? 'Listo' : 'Cancelar'}</button>
      ${p ? '' : `<button class="btn lg" id="guardar-otro" title="Lo crea y deja la ventana abierta para cargar el siguiente">${icon('plus', 14)} Crear y agregar otro</button>`}
      <button class="btn lg primary" id="guardar-producto">${p ? 'Guardar cambios' : esG ? 'Crear guarnición' : 'Crear producto'}</button>`,
    onMount: async (el) => {
      el.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => dialogoMovimiento(p, b.dataset.m, () => { refrescar(); abrirProducto(p.id); })));
      const cancelar = el.querySelector('#cancelar-prod'); if(cancelar) cancelar.addEventListener('click', () => cerrarPanel());
      const unidadSel = el.querySelector('#f-prod-unidad'), otra = el.querySelector('#f-prod-unidad-otra');
      if(unidadSel) unidadSel.addEventListener('change', () => { otra.classList.toggle('hidden', unidadSel.value !== '__otra'); if(unidadSel.value === '__otra') otra.focus(); });
      const envase = el.querySelector('#f-prod-envase');
      if(envase) envase.addEventListener('change', () => el.querySelector('#grupo-porvianda').classList.toggle('hidden', !envase.checked));
      // si el nombre ya existe, se ofrece cargarle stock en lugar de duplicarlo
      const nombreInp = el.querySelector('#f-prod-nombre');
      const existente = () => { const n = normalizarNombre(nombreInp.value); return n ? state.productos.find(x => x.id !== (p && p.id) && normalizarNombre(x.nombre) === n) : null; };
      const avisarExiste = () => {
        const x = existente(), box = el.querySelector('#prod-existe');
        if(!box) return;
        box.innerHTML = x ? `<div class="help" style="color:var(--warn-ink)">Ya existe <b>${esc(x.nombre)}</b>. <button class="btn quiet" type="button" id="ir-cargar-existente">Cargarle stock</button></div>` : '';
        const b = box.querySelector('#ir-cargar-existente'); if(b) b.addEventListener('click', () => abrirCargaStock(x.id));
      };
      if(nombreInp) nombreInp.addEventListener('input', avisarExiste);
      const guardar = el.querySelector('#guardar-producto'), guardarOtro = el.querySelector('#guardar-otro');
      if(guardar) formulario(el, { botones: [guardar, guardarOtro], cambios: !!p,
        completo: () => existente() ? marcarFalta(nombreInp, `Ya existe ${existente().nombre}: para sumarle stock usá Cargar stock.`) : true });
      // otro = después de crearlo, la ventana queda abierta y vacía para cargar el siguiente
      const crear = async (otro) => {
        const nombre = el.querySelector('#f-prod-nombre').value.trim();
        if(!nombre){ marcarFalta(el.querySelector('#f-prod-nombre'), 'Poné un nombre.'); return; }
        if(existente()){ toast(`Ya existe <b>${esc(existente().nombre)}</b>: para sumarle stock usá Cargar stock.`, 'err'); return; }
        const unidad = unidadSel.value === '__otra' ? (otra.value.trim() || 'unidades') : unidadSel.value;
        const datos = { nombre, unidad,
          minimo: Number(el.querySelector('#f-prod-minimo').value) || 0,
          porVianda: envase.checked ? (Number(el.querySelector('#f-prod-porvianda').value) || 1) : 0,
          esGuarnicion: el.querySelector('#f-prod-guarnicion').checked,
          activo: el.querySelector('#f-prod-activo').checked };
        guardar.disabled = true; if(guardarOtro) guardarOtro.disabled = true;
        try{
          const guardado = await guardarProducto(p ? p.id : null, datos);
          const ini = p ? 0 : Number(el.querySelector('#f-prod-inicial').value) || 0;
          if(ini) await registrarMovimiento(guardado, { tipo: 'entrada', cantidad: ini, nota: 'Stock inicial' });
          refrescar();
          if(otro){
            toast(`<b>${esc(nombre)}</b> creado. Cargá el siguiente.`);
            abrirProducto(null, { creados: [...(seguido ? seguido.creados : []), nombre], unidad, guarnicion: datos.esGuarnicion });
            return;
          }
          toast(p ? 'Guardado.' : `<b>${esc(nombre)}</b> creado.`);
          cerrarPanel();
        }catch(e){ toastError('No se pudo guardar', e); guardar.disabled = false; if(guardarOtro) guardarOtro.disabled = false; }
      };
      if(guardar) guardar.addEventListener('click', () => crear(false));
      if(guardarOtro) guardarOtro.addEventListener('click', () => crear(true));
      if(guardarOtro){
        // Enter en un campo = crear y seguir con el próximo
        el.querySelectorAll('.pbody input:not([type="checkbox"])').forEach(x => x.addEventListener('keydown', (e) => {
          if(e.key === 'Enter' && !guardarOtro.disabled){ e.preventDefault(); crear(true); }
        }));
        // la ventana se reusa: arriba de todo y el cursor en el nombre
        if(seguido) setTimeout(() => { el.querySelector('.pbody').scrollTop = 0; nombreInp.focus(); }, 30);
      }
      // se vende solo: queda como plato con este mismo stock (si ya hay un plato con su nombre, se le enlaza)
      const aPlato = el.querySelector('#prod-a-plato');
      if(aPlato) aPlato.addEventListener('click', async () => {
        aPlato.disabled = true;
        try{
          const ya = state.menus.find(m => normalizarNombre(m.nombre) === normalizarNombre(p.nombre));
          const m = await guardarMenu(ya ? ya.id : null, ya ? { ...ya, items: [{ productoId: p.id, cantidad: 1 }] }
            : { nombre: p.nombre, precio: null, categoria: '', llevaGuarnicion: false, descripcion: '', activo: p.activo, items: [{ productoId: p.id, cantidad: 1 }] });
          if(ya) await recalcularPedidosPendientes([m.id]).catch(() => {});
          refrescar();
          toast(`<b>${esc(p.nombre)}</b> ahora es un plato: ponele el precio.`);
          abrirPlato(m.id);
        }catch(e){ toastError('No se pudo pasar a plato', e); aPlato.disabled = false; }
      });
      const borrar = el.querySelector('#borrar-producto');
      if(borrar) borrar.addEventListener('click', async () => {
        if(!(await confirmar(`Eliminar ${esG ? 'guarnición' : 'producto'}`, `¿Eliminar <b>${esc(p.nombre)}</b> y todos sus movimientos?${usanlo.length ? ` Lo usan ${usanlo.map(m => esc(m.nombre)).join(', ')}: dejan de descontarlo.` : ''}`, { ok: 'Eliminar', peligro: true }))) return;
        try{ await eliminarProducto(p); toast('Eliminado.'); cerrarPanel(); refrescar(); }
        catch(e){ toastError('No se pudo eliminar', e); }
      });
      if(p) pintarMovimientos(el, p);
    }
  });
}

/* ---------- un plato: lo que se vende y su stock, en una sola ventana ----------
   El stock de un plato es el suyo propio (un producto con su mismo nombre: cada pedido descuenta 1),
   el de otros productos (promos y combos: "2 Pizzas comunes" descuenta 2 de Pizza común) o ninguno
   (no se cuenta: siempre aparece para pedir).
   seguido = al cargar varios uno atrás de otro: los que ya se crearon, la categoría y la unidad del último. */
function componentesTxt(m){
  return m.items.map(i => { const p = productoDe(i.productoId); return p ? `${fmtNum(i.cantidad)} ${p.nombre}` : null; }).filter(Boolean).join(' + ') || 'Sin productos';
}
function filaComponenteHtml(it, i){
  const prods = state.productos.filter(p => p.activo || p.id === it.productoId);
  return `<div class="cline" data-i="${i}" style="grid-template-columns:minmax(0,1fr) 90px 34px">
    <select class="inp" data-campo="producto" aria-label="Producto"><option value="">Elegí un producto</option>
      ${prods.map(p => `<option value="${p.id}" ${p.id === it.productoId ? 'selected' : ''}>${esc(p.nombre)} (${esc(p.unidad)})</option>`).join('')}</select>
    <input type="number" class="inp" data-campo="cantidad" min="0" step="any" value="${it.cantidad}" aria-label="Cantidad">
    <button class="iconbtn" type="button" data-quitar-comp aria-label="Quitar" title="Quitar">${icon('x', 14)}</button></div>`;
}
function abrirPlato(id, { categoria = '', alGuardar = null, seguido = null } = {}){
  const m = id ? menuPorId(id) : null;
  if(id && !m) return;
  const propio = m ? productoPropio(m) : null;
  const modo0 = m ? stockDePlato(m) : 'propio';
  const d = m || { nombre: '', descripcion: '', activo: true, precio: null, llevaGuarnicion: false, items: [],
                   categoria: categoria || (seguido && seguido.categoria) || '' };
  const lectura = !esDueno();
  const cob = propio ? coberturaProducto(propio) : null;
  const disp = modo0 === 'otros' ? porcionesDisponibles(m) : null;
  const libre = m && !propio ? productoLibre(m.nombre) : null;   // un producto con su nombre: se usa ese
  const unidad = propio ? propio.unidad : libre ? libre.unidad : (seguido && seguido.unidad) || 'porciones';
  const comps = modo0 === 'otros' ? m.items : [{ productoId: '', cantidad: 1 }];
  // las categorías de la lista (y la que ya tenía, si no está), o una nueva
  const catsHtml = (sel) => { const xs = categorias(); if(sel && !xs.some(c => mismaCategoria(c, sel))) xs.push(sel);
    return `<option value="">Elegí una categoría</option>${xs.map(c => `<option value="${esc(c)}" ${sel && mismaCategoria(c, sel) ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      <option value="__nueva">+ Nueva categoría…</option>`; };
  // la ficha: arriba lo principal; abajo, en columnas, el plato, su stock y los movimientos
  const cabeza = `${m ? `<h2 class="ptitle">${esc(m.nombre)}</h2>
        <div class="stats" style="margin-top:8px">
          <div class="stat2"><b>${m.precio != null ? fmtPlata(m.precio) : '—'}</b><span>${m.precio != null ? 'precio' : 'sin precio'}</span></div>
          ${propio ? `<div class="stat2"><b class="${propio.stock < 0 || (propio.minimo && propio.stock <= propio.minimo) ? 'bad' : ''}">${fmtNum(propio.stock)}</b><span>${esc(propio.unidad)} en stock</span></div>
            ${cob ? `<div class="stat2"><b>${fmtNum(cob.necesario7)}</b><span>se usan en 7 días</span></div>
              <div class="stat2"><b class="${cob.faltaEl ? 'warn' : 'ok'}">${cob.faltaEl ? esc(nombreDia(cob.faltaEl)) : '30+ días'}</b><span>${cob.faltaEl ? 'falta desde' : 'alcanza'}</span></div>` : ''}`
          : modo0 === 'otros' ? `<div class="stat2"><b>${disp ?? '—'}</b><span>alcanzan · usa ${esc(componentesTxt(m))}</span></div>`
          : '<div class="stat2"><b class="muted">—</b><span>no se cuenta el stock</span></div>'}
        </div>
        ${propio && !lectura ? `<div class="pacts" style="border:0;padding:0;margin:10px 0 0">
          <button class="btn lg" type="button" data-m="entrada">${icon('plus', 14)} Entrada</button>
          <button class="btn lg" type="button" data-m="salida">− Salida</button>
          <button class="btn lg" type="button" data-m="ajuste">${icon('editar', 14)} Ajustar al contado</button></div>` : ''}` : ''}`;
  const secPlato = `${seguido && seguido.creados.length ? `<div class="banner" style="border-radius:9px;border:1px solid var(--ok-line);background:var(--ok-wash);color:var(--ok-ink);margin-bottom:14px">
          ${icon('check', 14)} Ya agregaste: <b>${seguido.creados.map(esc).join(' · ')}</b></div>` : ''}
      <div class="psec" style="margin-top:0"><h3>Plato</h3>
        <div class="field"><label for="f-pl-nombre">Nombre${REQ}</label><input type="text" id="f-pl-nombre" value="${esc(d.nombre)}" placeholder="Ej: Milanesa al horno" autocomplete="off" ${m ? '' : 'autofocus'}>
          <div id="pl-existe"></div></div>
        <div class="frow">
          <div class="field"><label for="f-pl-precio">Precio</label><input type="number" id="f-pl-precio" min="0" step="1" value="${d.precio ?? ''}" placeholder="$"></div>
          <div class="field"><label for="f-pl-cat">Categoría${REQ}</label><select id="f-pl-cat">${catsHtml(d.categoria)}</select></div>
        </div>
        <label class="check"><input type="checkbox" id="f-pl-guarnicion" ${d.llevaGuarnicion ? 'checked' : ''}> Lleva guarnición (se elige en cada pedido)</label>
        <div class="field" style="margin-top:12px"><label for="f-pl-desc">Descripción (opcional)</label><input type="text" id="f-pl-desc" value="${esc(d.descripcion)}" placeholder="Ej: con salsa de tomate, sin sal"></div>
        <label class="check"><input type="checkbox" id="f-pl-activo" ${d.activo ? 'checked' : ''}> Activo (aparece en los pedidos y para la carta)</label>
      </div>`;
  const secStock = `<div class="psec"><h3>Stock</h3>
        <div class="seg pl-modo" role="group" aria-label="Cómo se cuenta el stock">
          <button type="button" data-modo="propio" aria-pressed="${modo0 === 'propio'}">Su propio stock</button>
          <button type="button" data-modo="otros" aria-pressed="${modo0 === 'otros'}">De otros productos</button>
          <button type="button" data-modo="no" aria-pressed="${modo0 === 'no'}">No se cuenta</button></div>
        <input type="hidden" id="f-pl-modo" value="${modo0}">
        <div class="pl-panel ${modo0 === 'propio' ? '' : 'hidden'}" data-panel="propio">
          ${libre ? `<p class="help">Usa <b>${esc(libre.nombre)}</b>, que ya está en el stock (hay ${fmtNum(libre.stock)} ${esc(libre.unidad)}). Cada pedido descuenta 1.</p>` : ''}
          <div class="frow">
            <div class="field"><label for="f-pl-unidad">Se cuenta en</label><select id="f-pl-unidad">${unidadesHtml(unidad)}</select>
              <input type="text" id="f-pl-unidad-otra" class="hidden" placeholder="Escribí la unidad" style="margin-top:6px"></div>
            <div class="field"><label for="f-pl-minimo">Avisarme cuando queden menos de</label><input type="number" id="f-pl-minimo" min="0" step="any" value="${propio ? propio.minimo : libre ? libre.minimo : 0}"></div>
          </div>
          ${propio ? '<p class="help">Cada pedido descuenta 1. Si se termina, se sigue pudiendo pedir: aparece «sin stock» y queda en negativo, en rojo. Para sumar, usá <b>Entrada</b> o <b>Cargar stock</b>.</p>'
            : !libre ? `<div class="field"><label for="f-pl-inicial">¿Cuántos hay ahora?</label><input type="number" id="f-pl-inicial" min="0" step="any" value="" placeholder="0" style="max-width:140px">
              <div class="help">Cada pedido descuenta 1. Si se termina, se sigue pudiendo pedir: aparece «sin stock» y queda en negativo, en rojo.</div></div>` : ''}
        </div>
        <div class="pl-panel ${modo0 === 'otros' ? '' : 'hidden'}" data-panel="otros">
          <p class="help">Para promos y combos: lo que descuenta cada plato. Ej: <i>2 Pizzas comunes</i> → 2 de Pizza común.</p>
          <div id="pl-comps">${comps.map(filaComponenteHtml).join('')}</div>
          <button class="btn" type="button" id="pl-agregar" style="margin-top:4px">${icon('plus', 13)} Otro producto</button></div>
        <div class="pl-panel ${modo0 === 'no' ? '' : 'hidden'}" data-panel="no">
          <p class="help">No se lleva la cuenta: siempre aparece para pedir. Para empezar a contarlo, elegí <b>Su propio stock</b> o cargale stock desde la lista.</p></div>
      </div>`;
  const secMovs = propio ? `<div class="psec"><h3>Movimientos</h3><div id="p-movs"><div class="skel" style="width:50%"></div></div></div>` : '';
  const secBorrar = m && !lectura ? `<div class="psec"><button class="btn lg danger" type="button" id="borrar-plato">${icon('borrar', 14)} Eliminar plato</button></div>` : '';
  const cuerpo = lectura ? `<dl class="props" style="margin-top:16px"><dt>Categoría</dt><dd>${esc(d.categoria || '—')}</dd>
          <dt>Guarnición</dt><dd>${d.llevaGuarnicion ? 'Se elige en cada pedido' : 'No lleva'}</dd>
          ${d.descripcion ? `<dt>Descripción</dt><dd>${esc(d.descripcion)}</dd>` : ''}
          <dt>Stock</dt><dd>${propio ? `Propio, en ${esc(propio.unidad)}` : modo0 === 'otros' ? `Usa ${esc(componentesTxt(d))}` : 'No se cuenta'}</dd></dl>` + secMovs
    : m ? `<div class="pcols ${propio ? '' : 'dos'}" style="margin-top:22px"><div class="pcol">${secPlato}</div><div class="pcol">${secStock}${secBorrar}</div>${propio ? `<div class="pcol">${secMovs}</div>` : ''}</div>`
    : secPlato + secStock;
  abrirPanel({
    ancho: m ? 'grande' : 'medio',
    titulo: `${icon('menu', 14)} ${m ? 'Plato' : 'Nuevo plato'}`,
    html: cabeza + cuerpo,
    pie: lectura ? '' : `<button class="btn lg" id="cancelar-plato">${seguido ? 'Listo' : 'Cancelar'}</button>
      ${m ? '' : `<button class="btn lg" id="guardar-plato-otro" title="Lo crea y deja la ventana abierta para cargar el siguiente">${icon('plus', 14)} Crear y agregar otro</button>`}
      <button class="btn lg primary" id="guardar-plato">${m ? 'Guardar cambios' : 'Crear plato'}</button>`,
    onMount: (el) => {
      if(propio) pintarMovimientos(el, propio);
      if(lectura) return;
      el.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => dialogoMovimiento(propio, b.dataset.m, () => { refrescar(); abrirPlato(m.id); })));
      el.querySelector('#cancelar-plato').addEventListener('click', () => cerrarPanel());
      const val = (s) => el.querySelector(s).value;
      const nombreInp = el.querySelector('#f-pl-nombre'), modoInp = el.querySelector('#f-pl-modo');
      // cómo se cuenta el stock
      el.querySelectorAll('[data-modo]').forEach(b => b.addEventListener('click', () => {
        modoInp.value = b.dataset.modo;
        el.querySelectorAll('[data-modo]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        el.querySelectorAll('[data-panel]').forEach(x => x.classList.toggle('hidden', x.dataset.panel !== b.dataset.modo));
      }));
      const unidadSel = el.querySelector('#f-pl-unidad'), otra = el.querySelector('#f-pl-unidad-otra');
      unidadSel.addEventListener('change', () => { otra.classList.toggle('hidden', unidadSel.value !== '__otra'); if(unidadSel.value === '__otra') otra.focus(); });
      // categoría nueva: se crea y queda elegida
      const catSel = el.querySelector('#f-pl-cat');
      let catAnt = catSel.value;
      catSel.addEventListener('change', async () => {
        if(catSel.value !== '__nueva'){ catAnt = catSel.value; return; }
        const n = await pedirNombreCategoria();
        try{ if(n) catSel.innerHTML = catsHtml(await agregarCategoria(n) || n); else catSel.value = catAnt; }
        catch(e){ toastError('No se pudo crear la categoría', e); catSel.value = catAnt; }
        catAnt = catSel.value;
        catSel.dispatchEvent(new Event('input', { bubbles: true }));   // para que el formulario lo vea
      });
      // los productos de una promo o un combo
      const cont = el.querySelector('#pl-comps');
      const bindComps = () => cont.querySelectorAll('[data-quitar-comp]').forEach(b => { b.onclick = () => {
        b.closest('.cline').remove();
        if(!cont.children.length){ cont.insertAdjacentHTML('beforeend', filaComponenteHtml({ productoId: '', cantidad: 1 }, 0)); bindComps(); }
      }; });
      bindComps();
      el.querySelector('#pl-agregar').addEventListener('click', () => { cont.insertAdjacentHTML('beforeend', filaComponenteHtml({ productoId: '', cantidad: 1 }, cont.children.length)); bindComps(); });
      const leerComps = () => [...cont.querySelectorAll('.cline')].map(r => ({ productoId: r.querySelector('[data-campo="producto"]').value, cantidad: Number(r.querySelector('[data-campo="cantidad"]').value) || 0 }))
        .filter(i => i.productoId && i.cantidad > 0);
      // si ya hay un plato con ese nombre, se ofrece abrirlo en lugar de duplicarlo
      const existente = () => { const n = normalizarNombre(nombreInp.value); return n ? state.menus.find(x => x.id !== (m && m.id) && normalizarNombre(x.nombre) === n) : null; };
      const avisarExiste = () => {
        const x = existente(), box = el.querySelector('#pl-existe');
        box.innerHTML = x ? `<div class="help" style="color:var(--warn-ink)">Ya hay un plato <b>${esc(x.nombre)}</b>${x.activo ? '' : ' (desactivado)'}. <button class="btn quiet" type="button" id="ir-plato-existente">Abrirlo</button></div>` : '';
        const b = box.querySelector('#ir-plato-existente'); if(b) b.addEventListener('click', () => abrirPlato(x.id, { alGuardar }));
      };
      nombreInp.addEventListener('input', avisarExiste);
      const guardar = el.querySelector('#guardar-plato'), guardarOtro = el.querySelector('#guardar-plato-otro');
      formulario(el, { botones: [guardar, guardarOtro], cambios: !!m, completo: () => {
        if(esMenuDelDia({ nombre: nombreInp.value })) return marcarFalta(nombreInp, 'El menú del día no es un plato: es una categoría. Cada día se le asignan platos con el botón «Menú del día».');
        if(existente()) return marcarFalta(nombreInp, `Ya hay un plato ${esc(existente().nombre)}: abrilo para cambiarlo.`);
        if(modoInp.value === 'otros'){
          const its = leerComps(), primero = cont.querySelector('select');
          if(!its.length) return marcarFalta(primero, 'Elegí de qué producto descuenta, o cambiá a "No se cuenta".');
          if(its.some((x, i) => its.findIndex(y => y.productoId === x.productoId) !== i)) return marcarFalta(primero, 'Hay un producto repetido: juntá las cantidades en una sola fila.');
        }
        return true;
      } });
      // otro = después de crearlo, la ventana queda abierta y vacía para cargar el siguiente
      const crear = async (otro) => {
        const nombre = nombreInp.value.trim();
        if(!nombre){ marcarFalta(nombreInp, 'Poné el nombre del plato.'); return; }
        const modo = modoInp.value, activo = el.querySelector('#f-pl-activo').checked;
        const datos = { nombre, precio: val('#f-pl-precio'), categoria: catSel.value === '__nueva' ? '' : catSel.value, llevaGuarnicion: el.querySelector('#f-pl-guarnicion').checked,
                        descripcion: val('#f-pl-desc').trim(), activo };
        const unidadP = unidadSel.value === '__otra' ? (otra.value.trim() || 'porciones') : unidadSel.value;
        const bs = [guardar, guardarOtro].filter(Boolean); bs.forEach(b => { b.disabled = true; });
        try{
          let items = modo === 'otros' ? leerComps() : [], prod = null, ini = 0;
          if(modo === 'propio'){
            // su stock: el que ya tenía, o un producto con su nombre, o uno nuevo (con el nombre del plato)
            const minimo = Number(val('#f-pl-minimo')) || 0;
            const base = propio || productoLibre(nombre);
            const ini0 = el.querySelector('#f-pl-inicial');
            ini = !base && ini0 ? Number(ini0.value) || 0 : 0;
            prod = base ? await guardarProducto(base.id, { ...base, nombre, unidad: unidadP, minimo, activo: activo || productoUsadoPorOtros(base.id, m && m.id), esGuarnicion: false })
                        : await guardarProducto(null, { nombre, unidad: unidadP, minimo, porVianda: 0, activo, esGuarnicion: false });
            items = [{ productoId: prod.id, cantidad: 1 }];
          }
          const antes = m ? JSON.stringify(m.items) : null;
          const g = await guardarMenu(m ? m.id : null, { ...datos, items });
          if(ini > 0) await registrarMovimiento(prod, { tipo: 'entrada', cantidad: ini, nota: 'Stock inicial' });
          // el stock que era suyo queda guardado (con su historial), desactivado si ya nadie lo usa
          if(propio && modo !== 'propio' && propio.activo && !productoUsadoPorOtros(propio.id, g.id)) await guardarProducto(propio.id, { ...propio, activo: false });
          if(antes != null && antes !== JSON.stringify(g.items)) await recalcularPedidosPendientes([g.id]).catch(() => {});
          refrescar();
          if(alGuardar) alGuardar(g);
          if(otro){
            toast(`<b>${esc(nombre)}</b> creado. Cargá el siguiente.`);
            abrirPlato(null, { alGuardar, seguido: { creados: [...(seguido ? seguido.creados : []), nombre], categoria: datos.categoria, unidad: unidadP } });
            return;
          }
          toast(m ? 'Plato actualizado.' : `Plato <b>${esc(nombre)}</b> creado.`);
          cerrarPanel();
        }catch(e){ toastError('No se pudo guardar el plato', e); bs.forEach(b => { b.disabled = false; }); }
      };
      guardar.addEventListener('click', () => crear(false));
      if(guardarOtro){
        guardarOtro.addEventListener('click', () => crear(true));
        // la ventana se reusa: arriba de todo y el cursor en el nombre
        if(seguido) setTimeout(() => { el.querySelector('.pbody').scrollTop = 0; nombreInp.focus(); }, 30);
      }
      const borrar = el.querySelector('#borrar-plato');
      if(borrar) borrar.addEventListener('click', async () => {
        const conStock = propio && !productoUsadoPorOtros(propio.id, m.id);
        if(!(await confirmar('Eliminar plato', `¿Eliminar <b>${esc(m.nombre)}</b>?${conStock ? ' También se borra su stock y sus movimientos.' : ''}`, { ok: 'Eliminar', peligro: true }))) return;
        try{
          await eliminarMenu(m);
          if(conStock) await eliminarProducto(propio).catch(() => {});
          toast('Plato eliminado.'); cerrarPanel(); refrescar();
        }catch(e){ toastError('No se pudo eliminar', e); }
      });
    }
  });
}

/* ---------- carga rápida de stock: elegir de la lista y poner la cantidad ---------- */
let cargaTipo = 'entrada';
/* Lo que se puede cargar: el stock de cada plato (los que todavía no se cuentan empiezan a contarse
   con esta carga: "m:" + el id del plato) y los demás productos. */
function opcionesCargaHtml(sel){
  const platos = [], vistos = new Set();
  const op = (v, t) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${t}</option>`;
  for(const m of state.menus.filter(x => x.activo).sort(ordenMenus)){
    const p = productoPropio(m);
    if(p && p.activo){ if(!vistos.has(p.id)){ vistos.add(p.id); platos.push(op(p.id, `${esc(m.nombre)} · hay ${fmtNum(p.stock)} ${esc(p.unidad)}`)); } }
    else if(!m.items.length) platos.push(op('m:' + m.id, `${esc(m.nombre)} · empieza a contarse`));
  }
  const resto = state.productos.filter(p => !vistos.has(p.id) && (p.activo || p.id === sel));
  const prod = (p) => op(p.id, `${esc(p.nombre)} · hay ${fmtNum(p.stock)} ${esc(p.unidad)}`);
  const grupo = (t, xs) => xs.length ? `<optgroup label="${t}">${xs.join('')}</optgroup>` : '';
  return grupo('Platos', platos) + grupo('Guarniciones', resto.filter(p => p.esGuarnicion).map(prod)) + grupo('Otros productos', resto.filter(p => !p.esGuarnicion).map(prod));
}
function lineaCargaHtml(sel){
  return `<div class="cline" style="grid-template-columns:minmax(0,1fr) 100px 34px">
    <select class="inp" data-campo="producto" aria-label="Plato o producto"><option value="">Elegí un plato o producto</option>
      ${opcionesCargaHtml(sel)}
      <option value="__nuevo">+ Otro producto nuevo…</option></select>
    <input type="number" class="inp" data-campo="cantidad" min="0" step="any" placeholder="Cantidad" aria-label="Cantidad">
    <button class="iconbtn" type="button" data-quitar-carga aria-label="Quitar" title="Quitar">${icon('x', 14)}</button></div>`;
}
/* seguido = al cargar varias veces seguidas: lo que ya se cargó y la fecha elegida */
function abrirCargaStock(pid, seguido = null){
  abrirPanel({
    ancho: 'medio',
    titulo: `${icon('caja', 14)} Cargar stock`,
    html: `<div class="seg" role="group" aria-label="Qué pasó" style="margin-bottom:14px">
        <button type="button" data-ct="entrada" aria-pressed="${cargaTipo === 'entrada'}">Entró (compra o producción)</button>
        <button type="button" data-ct="salida" aria-pressed="${cargaTipo === 'salida'}">Salió (uso, merma, vencido)</button></div>
      <div class="psec" style="margin-top:0"><h3>Platos y productos <span class="sp"></span><span class="n">elegí de la lista y poné la cantidad</span></h3>
        <div id="cs-lineas">${lineaCargaHtml(pid || '')}</div>
        <button class="btn" type="button" id="cs-agregar" style="margin-top:4px">${icon('plus', 13)} Otro más</button></div>
      <div class="frow" style="margin-top:14px">
        <div class="field"><label for="cs-fecha">Fecha</label><input type="date" id="cs-fecha" value="${(seguido && seguido.fecha) || todayStr()}"></div>
        <div class="field"><label for="cs-nota">Nota (opcional)</label><input type="text" id="cs-nota" placeholder="Proveedor, compra, merma…"></div></div>
      ${seguido && seguido.cargados.length ? `<div class="banner" style="border-radius:9px;border:1px solid var(--ok-line);background:var(--ok-wash);color:var(--ok-ink)">${icon('check', 14)} Ya cargaste: ${seguido.cargados.join(' · ')}</div>` : ''}`,
    pie: `<button class="btn lg" id="cs-cerrar">Listo</button>
      <button class="btn lg" id="guardar-stock-otro" title="Lo guarda y deja la ventana abierta para cargar otro">${icon('plus', 14)} Guardar y cargar otro</button>
      <button class="btn lg primary" id="guardar-stock">Guardar</button>`,
    onMount: (el) => {
      const cont = el.querySelector('#cs-lineas');
      el.querySelectorAll('[data-ct]').forEach(b => b.addEventListener('click', () => {
        cargaTipo = b.dataset.ct;
        el.querySelectorAll('[data-ct]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      }));
      const bind = () => {
        cont.querySelectorAll('[data-quitar-carga]').forEach(b => { b.onclick = () => { if(cont.children.length > 1) b.closest('.cline').remove(); }; });
        cont.querySelectorAll('[data-campo="producto"]').forEach(sel => { sel.onchange = async () => {
          if(sel.value === '__nuevo'){ sel.value = ''; const nuevo = await dialogoProductoRapido(); if(nuevo){ sel.outerHTML = lineaCargaHtml(nuevo.id).match(/<select[\s\S]*?<\/select>/)[0]; bind(); } }
          const fila = sel.closest('.cline'); const q = fila && fila.querySelector('[data-campo="cantidad"]'); if(q && sel.value) q.focus();
        }; });
      };
      bind();
      el.querySelector('#cs-agregar').addEventListener('click', () => { cont.insertAdjacentHTML('beforeend', lineaCargaHtml('')); bind(); cont.lastElementChild.querySelector('select').focus(); });
      el.querySelector('#cs-cerrar').addEventListener('click', () => cerrarPanel());
      // cada línea: un producto (p) o un plato que todavía no se cuenta (m), y la cantidad
      const leerCarga = () => [...cont.querySelectorAll('.cline')].map(r => {
        const v = r.querySelector('[data-campo="producto"]').value, q = Number(r.querySelector('[data-campo="cantidad"]').value) || 0;
        return v.startsWith('m:') ? { m: menuPorId(v.slice(2)), q } : { p: v ? productoDe(v) : null, q };
      });
      // cada producto elegido necesita su cantidad (y cada cantidad, su producto)
      const validarCarga = () => {
        const lineas = leerCarga(), filas = [...cont.querySelectorAll('.cline')];
        const elegido = (l) => !!(l.p || l.m);
        const mala = filas.find((r, i) => (elegido(lineas[i]) && !(lineas[i].q > 0)) || (!elegido(lineas[i]) && lineas[i].q > 0));
        if(lineas.some(l => elegido(l) && l.q > 0) && !mala) return true;
        const r = mala || filas[0], i = filas.indexOf(r);
        const falta = lineas[i] && elegido(lineas[i]) ? r.querySelector('[data-campo="cantidad"]') : r.querySelector('[data-campo="producto"]');
        return marcarFalta(falta, falta && falta.dataset.campo === 'cantidad' ? 'Poné la cantidad.' : 'Elegí qué y poné la cantidad.');
      };
      const bGuardar = el.querySelector('#guardar-stock'), bOtro = el.querySelector('#guardar-stock-otro');
      formulario(el, { botones: [bGuardar, bOtro], completo: validarCarga });
      // otro = después de guardar, la ventana queda abierta y vacía para cargar lo siguiente
      const guardarCarga = async (otro) => {
        if(!validarCarga()) return;
        const validas = leerCarga().filter(l => (l.p || l.m) && l.q > 0);
        bGuardar.disabled = true; bOtro.disabled = true;
        const fecha = el.querySelector('#cs-fecha').value || todayStr(), nota = el.querySelector('#cs-nota').value.trim();
        try{
          for(const l of validas){
            // un plato que no se contaba empieza a contarse: se le crea su stock
            if(!l.p){ const m = menuPorId(l.m.id); l.p = productoPropio(m) || await crearStockPropio(m); }
            await registrarMovimiento(l.p, { tipo: cargaTipo, cantidad: l.q, nota, fecha });
          }
          const signo = cargaTipo === 'salida' ? '−' : '+';
          const partes = validas.map(l => { const act = productoDe(l.p.id), pl = act && platoDeProducto(act);
            return `${signo}${fmtNum(l.q)} ${esc(pl ? pl.nombre : l.p.nombre)} (quedan ${fmtNum(act ? act.stock : 0)})`; });
          renderMenu(); refrescar();
          if(otro){
            toast(`Stock cargado: ${partes.join(' · ')}. Cargá lo siguiente.`);
            abrirCargaStock(null, { cargados: [...(seguido ? seguido.cargados : []), ...partes], fecha });
            return;
          }
          toast(`Stock cargado: ${partes.join(' · ')}.`);
          cerrarPanel();
        }catch(e){ toastError('No se pudo cargar el stock', e); bGuardar.disabled = false; bOtro.disabled = false; }
      };
      bGuardar.addEventListener('click', () => guardarCarga(false));
      bOtro.addEventListener('click', () => guardarCarga(true));
      // la ventana se reusa: arriba de todo para la próxima carga
      if(seguido) setTimeout(() => { el.querySelector('.pbody').scrollTop = 0; }, 30);
      const primera = cont.querySelector(pid ? '[data-campo="cantidad"]' : 'select'); if(primera) setTimeout(() => primera.focus(), 40);
    }
  });
}

/* Alta rápida de algo que no se vende solo, desde la carga de stock (sin salir de la ventana).
   Los platos ya están en la lista; uno nuevo se crea con Nuevo → Un plato. */
async function dialogoProductoRapido(){
  const r = await dialogo({
    titulo: 'Otro producto nuevo',
    texto: 'Para lo que no se vende solo: insumos, envases, verduras… Se agrega a la lista una sola vez.',
    html: `<div class="field"><label for="f-rap-nombre">Nombre${REQ}</label><input type="text" id="f-rap-nombre" placeholder="Ej: Cajón de tomates" autofocus></div>
      <div class="field"><label for="f-rap-unidad">Se cuenta en</label><select id="f-rap-unidad">${UNIDADES.map(u => `<option>${u}</option>`).join('')}</select></div>`,
    botones: [{ id: 'cancelar', label: 'Cancelar' }, { id: 'ok', label: 'Agregar a la lista', clase: 'primary', domId: 'confirmar-producto-rapido' }],
    onMount: (el) => {
      el._validar = () => {
        const n = el.querySelector('#f-rap-nombre').value.trim();
        if(!n) return marcarFalta(el.querySelector('#f-rap-nombre'), 'Poné el nombre del producto.');
        const ya = state.productos.find(x => normalizarNombre(x.nombre) === normalizarNombre(n)) || state.menus.find(x => x.activo && normalizarNombre(x.nombre) === normalizarNombre(n));
        if(ya){ toast(`Ya está <b>${esc(ya.nombre)}</b> en la lista: elegilo de ahí.`, 'err'); return false; }
        return true;
      };
    }
  });
  if(!r) return null;
  try{
    const p = await guardarProducto(null, { nombre: r.el.querySelector('#f-rap-nombre').value.trim(), unidad: r.el.querySelector('#f-rap-unidad').value, minimo: 0, porVianda: 0, activo: true });
    toast(`<b>${esc(p.nombre)}</b> agregado a la lista.`);
    return p;
  }catch(e){ toastError('No se pudo crear el producto', e); return null; }
}

/* ---------- pegar la carta de WhatsApp: sus platos quedan en el stock ---------- */
/* Lee una carta en texto (como la que se manda por WhatsApp): encabezados de categoría, ítems con
   "•" y "$ precio", "+ guarnición", "(sin stock)", variedades separadas por coma y la línea de
   GUARNICIÓN. Devuelve { items: [{ nombre, categoria, precio, llevaGuarnicion, activo, descripcion }], guarniciones }. */
function leerCarta(texto){
  // fuera: caracteres invisibles, emojis y las comillas invertidas del formato de WhatsApp ("$`7.500")
  const limpiar = t => t.replace(/[​-‍⁠﻿]/g, '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{20E3}]/gu, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
  const precioDe = t => { const m = t.match(/\$\s*([\d.,]+)/); return m ? Number(m[1].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) : null; };
  const cap = t => t ? t.replace(/^([^a-záéíóúñ]*)([a-záéíóúñ])/i, (_, a, b) => a + b.toUpperCase()) : t;   // la primera letra, aunque empiece con un número
  const prolijo = t => {
    let x = t.trim();
    if(x.length > 3 && x === x.toUpperCase()) x = x.toLowerCase();
    x = cap(x).replace(/\bmenu\b/gi, 'Menú').replace(/\btacc\b/gi, 'TACC');
    return x;
  };
  const items = [], guarniciones = [];
  let categoria = '', precioCategoria = null;
  for(const linea of String(texto || '').split(/\r?\n/).map(limpiar).filter(Boolean)){
    const vineta = /^[•·▪\-*]/.test(linea);
    const t = linea.replace(/^[•·▪\-*]\s*/, '').trim();
    if(!t) continue;
    if(/^guarnici[oó]n(es)?\s*:/i.test(t)){
      t.split(':').slice(1).join(':').split(/,|\s+y\s+/).map(x => cap(x.replace(/\(.*?\)/g, '').trim().toLowerCase())).filter(Boolean)
        .forEach(g => { if(!guarniciones.includes(g)) guarniciones.push(g); });
      continue;
    }
    if(/^¡?\s*buen(os|as)?\s+(d[ií]a|tarde|noche)/i.test(t) || /^nuestros men[uú]s$/i.test(t)) continue;
    const precio = precioDe(t);
    if(/^\(.*\)$/.test(t) && items.length){ items[items.length - 1].descripcion = cap(t.slice(1, -1).trim()); continue; }
    if(/^con guarnici[oó]n/i.test(t) && precio != null && items.length){
      const prev = items[items.length - 1];
      items.push({ ...prev, nombre: prev.nombre + ' con guarnición', precio, llevaGuarnicion: true });
      continue;
    }
    // "Menú del día $ 7.500" (o "Menú sin TACC $ 8.500") es una categoría con su precio, no un plato
    const soloNombre = normalizarNombre(t.replace(/\$\s*[\d.,]+/g, '').replace(/\bvalor\b/gi, '').replace(/[\s:.]+$/, ''));
    if(precio != null && MENUS_DEL_DIA.includes(soloNombre)){ categoria = /sin tacc/.test(soloNombre) ? 'Sin TACC' : categoriaDelDia(); precioCategoria = precio; continue; }
    if(!vineta && precio == null){ categoria = prolijo(t.replace(/[:.]+$/, '')); precioCategoria = null; continue; }
    const activo = !/sin stock/i.test(t);
    let nombre = t.replace(/\(\s*sin stock\s*\)/gi, '').replace(/\bvalor\b/gi, '').replace(/\$\s*[\d.,]+/g, '').replace(/\s+/g, ' ').trim()
      .replace(/\s+por$/i, '');   // "2 menú del día por $ 10.000"
    // "+ guarnición" se saca del nombre; "con guarnición" queda en el nombre (hay otro sin guarnición): los dos piden elegirla
    const lleva = /\+\s*guarnici[oó]n/i.test(nombre) || /\bcon guarnici[oó]n$/i.test(nombre);
    nombre = nombre.replace(/\+\s*guarnici[oó]n/gi, '').replace(/[\s,:\-+]+$/, '').trim();
    const cat = vineta ? categoria : (categoria || categoriaDelDia());
    const variedad = nombre.match(/^(.*?)[,\s]*variedad(?:es)?\s*:\s*(.+)$/i);
    if(variedad){
      const base = prolijo(variedad[1].trim()).replace(/^Tartas individuales$/i, 'Tarta individual').replace(/^Tartas (mediana|grande|chica)s$/i, 'Tarta $1').replace(/^Tartas$/i, 'Tarta');
      variedad[2].split(',').map(v => v.trim()).filter(Boolean).forEach(v =>
        items.push({ nombre: `${base} de ${v.toLowerCase()}`, categoria: cat, precio: precio ?? precioCategoria, llevaGuarnicion: lleva, activo, descripcion: '' }));
      continue;
    }
    items.push({ nombre: prolijo(nombre), categoria: cat, precio: precio ?? precioCategoria, llevaGuarnicion: lleva, activo, descripcion: '' });
  }
  return { items, guarniciones };
}

function abrirPegarCarta(texto, resultado){
  const leida = texto ? leerCarta(texto) : null;
  const prods = state.productos.filter(p => p.activo && !p.esGuarnicion);
  // su propio stock si ya hay un producto con su nombre; si no, como está (o sin contar, si es nuevo)
  const sugerido = (it) => prods.some(x => normalizarNombre(x.nombre) === normalizarNombre(it.nombre)) ? '__crear' : '';
  const existe = (it) => state.menus.find(m => normalizarNombre(m.nombre) === normalizarNombre(it.nombre));
  abrirPanel({
    ancho: leida ? 'ancho' : 'medio',
    titulo: `${icon('copiar', 14)} Pegar carta`,
    html: `${resultado ? `<div class="banner phero" style="border-radius:9px;border:1px solid var(--ok-line);background:var(--ok-wash);color:var(--ok-ink);margin-bottom:14px">${icon('check', 14)} ${resultado}</div>` : ''}
      ${!leida ? `<p class="psub" style="margin-top:0">Pegá acá el mensaje con la carta, tal como lo mandás por WhatsApp. La app arma la lista de platos con sus precios para que la revises antes de guardarla.</p>
        <div class="field"><label for="carta-texto">Texto de la carta</label><textarea id="carta-texto" rows="14" placeholder="Carnes 🥩&#10;• Milanesa al horno + guarnición $ 7.500&#10;…&#10;GUARNICIÓN: Arroz, puré de papa…"></textarea></div>`
      : `<p class="psub phero" style="margin-top:0">Encontré <b>${plural(leida.items.length, 'plato', 'platos')}</b>${leida.guarniciones.length ? ` y <b>${plural(leida.guarniciones.length, 'guarnición', 'guarniciones')}</b>` : ''}. Revisá y corregí lo que haga falta: los que ya existen se actualizan (precio y categoría), el resto se crea.</p>
        <div class="psec phero" style="margin-top:0"><div class="tablewrap"><table class="ptable compacta" id="carta-tabla">
          <thead><tr><th></th><th>Plato</th><th>Categoría</th><th class="r">Precio</th><th>Guarnición</th><th>Activo</th><th>Stock</th></tr></thead>
          <tbody>${leida.items.map((it, i) => `<tr data-i="${i}">
            <td><input type="checkbox" data-c="incluir" checked aria-label="Incluir"></td>
            <td style="min-width:240px"><input class="inp sm" data-c="nombre" value="${esc(it.nombre)}" aria-label="Nombre">${existe(it) ? '<div class="help">ya existe: se actualiza</div>' : ''}</td>
            <td><input class="inp sm" data-c="categoria" value="${esc(it.categoria)}" aria-label="Categoría" style="width:120px"></td>
            <td class="r"><input class="inp sm" type="number" data-c="precio" value="${it.precio ?? ''}" placeholder="$" aria-label="Precio" style="width:100px"></td>
            <td><input type="checkbox" data-c="guarnicion" ${it.llevaGuarnicion ? 'checked' : ''} aria-label="Lleva guarnición"></td>
            <td><input type="checkbox" data-c="activo" ${it.activo ? 'checked' : ''} aria-label="Activo"></td>
            <td><select class="inp sm" data-c="producto" aria-label="Producto del stock" style="width:200px">
              <option value="">${existe(it) ? 'Como está' : 'No se cuenta'}</option>
              <option value="__crear" ${sugerido(it) === '__crear' ? 'selected' : ''}>Su propio stock</option>
              <optgroup label="Usa otro producto">${prods.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</optgroup></select></td></tr>`).join('')}</tbody></table></div></div>
        ${leida.guarniciones.length ? `<div class="psec phero"><h3>Guarniciones <span class="n">se agregan como productos del stock</span></h3>
          <div class="days" style="gap:8px">${leida.guarniciones.map((g, i) => `<label class="check" style="border:1px solid var(--line-2);border-radius:8px;padding:6px 10px">
            <input type="checkbox" data-g="${i}" checked> ${esc(g)}</label>`).join('')}</div></div>` : ''}`}`,
    pie: leida ? `<button class="btn lg" id="carta-volver">Volver al texto</button><span class="sp"></span><button class="btn lg primary" id="carta-guardar">Guardar ${plural(leida.items.length, 'plato', 'platos')}</button>`
               : `<button class="btn lg" id="carta-cerrar">Cerrar</button><button class="btn lg primary" id="carta-leer">Leer carta</button>`,
    onMount: (el) => {
      if(!leida){
        const ta = el.querySelector('#carta-texto'); if(texto) ta.value = texto;
        el.querySelector('#carta-cerrar').addEventListener('click', () => cerrarPanel());
        el.querySelector('#carta-leer').addEventListener('click', () => {
          const v = ta.value.trim();
          if(!v){ toast('Pegá el texto de la carta.', 'err'); return; }
          const r = leerCarta(v);
          if(!r.items.length){ toast('No encontré platos con precio en ese texto. Revisá que tenga líneas como "• Milanesa $ 7.500".', 'err'); return; }
          abrirPegarCarta(v);
        });
        return;
      }
      el.querySelector('#carta-volver').addEventListener('click', () => abrirPegarCarta(null));
      el.querySelector('#carta-guardar').addEventListener('click', async (ev) => {
        const filas = [...el.querySelectorAll('#carta-tabla tbody tr')];
        const items = filas.filter(r => r.querySelector('[data-c="incluir"]').checked).map(r => {
          const g = (c) => r.querySelector(`[data-c="${c}"]`);
          const prod = g('producto').value;
          return { nombre: g('nombre').value.trim(), categoria: g('categoria').value.trim(), precio: g('precio').value === '' ? null : Number(g('precio').value),
                   llevaGuarnicion: g('guarnicion').checked, activo: g('activo').checked, descripcion: leida.items[Number(r.dataset.i)].descripcion || '',
                   productoId: prod && prod !== '__crear' ? prod : null, crearProducto: prod === '__crear' ? g('nombre').value.trim() : null };
        }).filter(x => x.nombre);
        const gs = leida.guarniciones.filter((_, i) => { const c = el.querySelector(`[data-g="${i}"]`); return c && c.checked; });
        if(!items.length && !gs.length){ toast('No hay nada seleccionado para guardar.', 'err'); return; }
        const b = ev.currentTarget; b.disabled = true; b.textContent = 'Guardando…';
        try{
          const r = await cargarCarta({ items, guarniciones: gs });
          const partes = [r.menusNuevos && plural(r.menusNuevos, 'plato nuevo', 'platos nuevos'), r.menusActualizados && plural(r.menusActualizados, 'plato actualizado', 'platos actualizados'),
                          r.guarnicionesNuevas && plural(r.guarnicionesNuevas, 'guarnición', 'guarniciones'), r.productosNuevos && plural(r.productosNuevos, 'plato con su stock', 'platos con su stock')].filter(Boolean);
          toast(`Carta guardada: ${partes.join(', ')}.`);
          cerrarPanel(); irA('stock');
        }catch(e){ toastError('No se pudo guardar la carta', e); b.disabled = false; b.textContent = 'Guardar'; }
      });
    }
  });
}
