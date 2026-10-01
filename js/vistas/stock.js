/* ============================================================
   PESTAÑA: STOCK — productos terminados, menús armados con esos
   productos, y producción diaria. Un pedido descuenta los productos de
   sus menús al cargarse, y una vianda de pack los de su tipo de vianda al
   entregarse (más lo que se usa en toda vianda, como envases). Con las
   viandas de los próximos días se calcula qué falta y hasta cuándo alcanza.
============================================================= */
let stockVista = 'productos';     // productos | menus | produccion
const UNIDADES = ['unidades', 'porciones', 'kg', 'cajones', 'bandejas', 'paquetes', 'docenas', 'litros'];

let stockFecha = todayStr();

function coberturaTxt(p){
  const cob = coberturaProducto(p);
  if(!cob) return { txt: 'No está en ningún menú', cls: 'muted' };
  if(cob.faltaEl) return { txt: cob.faltaEl === todayStr() ? 'no alcanza para hoy' : `falta desde ${nombreDia(cob.faltaEl).toLowerCase() === 'mañana' ? 'mañana' : 'el ' + nombreDia(cob.faltaEl).toLowerCase()}`, cls: cob.faltaEl <= sumarDias(todayStr(), 2) ? 'bad' : 'warn' };
  return { txt: 'alcanza para más de 30 días', cls: 'ok' };
}

function renderStock(bar, main){
  bar.innerHTML = `<h1>Stock</h1>
    <div class="seg" role="group" aria-label="Vista">
      <button data-v="productos" aria-pressed="${stockVista === 'productos'}">Productos</button>
      <button data-v="menus" aria-pressed="${stockVista === 'menus'}">Menús</button>
      <button data-v="produccion" aria-pressed="${stockVista === 'produccion'}">Producción diaria</button>
    </div><div class="sp"></div>
    ${esDueno() && stockVista !== 'produccion' && menusSinProductos().length ? `<button class="btn" id="menus-a-stock">${icon('caja', 14)} Pasar menús al stock</button>` : ''}
    ${esDueno() && stockVista === 'productos' ? `<button class="btn" id="nuevo-producto">${icon('plus', 14)} Nuevo producto</button>
      <button class="btn primary" id="cargar-stock">${icon('caja', 14)} Cargar stock</button>` : ''}
    ${stockVista === 'menus' && puedeElegirCartaDia(todayStr()) ? `<button class="btn" id="elegir-menu-dia">${icon('menu', 14)} Menú del día</button>` : ''}
    ${esDueno() && stockVista === 'menus' ? `<button class="btn" id="pegar-carta">${icon('copiar', 14)} Pegar carta</button>
      <button class="btn primary" id="nuevo-menu">${icon('plus', 14)} Nuevo menú</button>` : ''}
    ${!esDueno() ? '<span class="muted">Solo lectura</span>' : ''}`;
  bar.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => { stockVista = b.dataset.v; render(); }));
  const np = bar.querySelector('#nuevo-producto'); if(np) np.addEventListener('click', () => abrirProducto(null));
  const mas = bar.querySelector('#menus-a-stock'); if(mas) mas.addEventListener('click', () => abrirMenusAStock());
  const cs = bar.querySelector('#cargar-stock'); if(cs) cs.addEventListener('click', () => abrirCargaStock());
  const nm = bar.querySelector('#nuevo-menu'); if(nm) nm.addEventListener('click', () => abrirMenu(null));
  const md = bar.querySelector('#elegir-menu-dia'); if(md) md.addEventListener('click', () => abrirCartaDia(todayStr()));
  const pc = bar.querySelector('#pegar-carta'); if(pc) pc.addEventListener('click', () => abrirPegarCarta());
  if(stockVista === 'produccion') return renderProduccion(main);
  if(stockVista === 'menus') return renderMenus(main);

  const hoy = todayStr();
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(hoy, i));
  const demanda7 = dias.reduce((s, f) => s + demandaDia(f), 0);
  const prods = state.productos;
  const hoyNecesita = necesidadProductos(hoy, { soloPendiente: true });
  main.innerHTML = `<div class="page">
    <section class="tsec" style="margin-top:0">
      <h2>Demanda de los próximos 7 días <span class="n">${demanda7} viandas</span><span class="sp"></span><span class="hint2">según las comandas y los días fijos de los clientes</span></h2>
      <div class="forecast">${dias.map((f, i) => `<div class="fday ${i === 0 ? 'today' : ''}"><div class="d">${esc(nombreDia(f))}</div><b>${demandaDia(f)}</b>
        <div class="x">${i === 0 ? `${resumenDia(f).entregadas} entregadas` : plural(clientesActivos().filter(c => programadoEn(c, f)).length, 'cliente')}</div></div>`).join('')}</div>
    </section>
    <section class="tsec">
      <h2>Productos <span class="n">${prods.length}</span></h2>
      ${prods.length ? `<div class="clist"><div class="tablewrap"><table class="ptable">
        <thead><tr><th>Producto</th><th class="r">Stock</th><th class="r" title="Viandas de packs que faltan entregar hoy. Los pedidos ya se descontaron al cargarlos.">Falta hoy</th><th class="r">Mínimo</th><th>Cobertura</th>${esDueno() ? '<th class="r">Movimiento</th>' : ''}</tr></thead>
        <tbody>${prods.map(p => { const cob = coberturaTxt(p); const bajo = p.minimo > 0 && p.stock <= p.minimo;
          return `<tr class="click ${p.activo ? '' : 'off'} ${p.stock < 0 ? 'neg' : ''}" data-prod="${p.id}" tabindex="0">
            <td><div class="pwho">${icon('caja', 15)}<div><div class="n">${esc(p.nombre)} ${p.activo ? '' : '<span class="tag plain">Inactivo</span>'}${p.stock < 0 ? ' <span class="tag bad">en negativo</span>' : ''}</div><div class="s">${esc(p.unidad)}</div></div></div></td>
            <td class="r"><span class="saldo ${p.stock < 0 || bajo ? 'bad' : ''}">${fmtNum(p.stock)}</span></td>
            <td class="r">${hoyNecesita[p.id] ? `<span class="saldo ${hoyNecesita[p.id] > p.stock ? 'bad' : ''}">${fmtNum(hoyNecesita[p.id])}</span>` : '<span class="muted">—</span>'}</td>
            <td class="r z">${p.minimo ? fmtNum(p.minimo) : '—'}</td>
            <td><span class="${cob.cls === 'muted' ? 'muted' : 'saldo ' + cob.cls}" style="font-weight:500">${esc(cob.txt)}</span></td>
            ${esDueno() ? `<td class="r"><button class="btn" data-mov="cargar" data-p="${p.id}">${icon('plus', 12)} Cargar</button></td>` : ''}
          </tr>`; }).join('')}</tbody></table></div></div>`
      : `<div class="clist"><div class="stub" style="margin:28px auto"><div class="ico">${icon('caja', 20)}</div><h2>Sin productos</h2>
          <p>Cargá los productos terminados que preparás: milanesas, filet de pollo, porciones de puré, tartas… Después armá los menús con esos productos y se descuentan solos con cada pedido y cada vianda entregada.</p>
          ${esDueno() ? `<button class="btn lg primary" id="primer-producto">${icon('plus', 14)} Nuevo producto</button>` : ''}</div></div>`}
    </section></div>`;
  main.querySelectorAll('[data-prod]').forEach(r => {
    r.addEventListener('click', () => abrirProducto(r.dataset.prod));
    r.addEventListener('keydown', e => { if(e.key === 'Enter') abrirProducto(r.dataset.prod); });
  });
  main.querySelectorAll('[data-mov]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); abrirCargaStock(b.dataset.p); }));
  const pp = main.querySelector('#primer-producto'); if(pp) pp.addEventListener('click', () => abrirProducto(null));
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

function abrirProducto(id){
  const p = id ? state.productos.find(x => x.id === id) : null;
  const d = p || { nombre: '', unidad: 'unidades', minimo: 0, porVianda: 0, activo: true, stock: 0 };
  const lectura = !esDueno();
  const cob = p ? coberturaProducto(p) : null;
  abrirPanel({
    ancho: p ? 'grande' : 'medio',
    titulo: `${icon('caja', 14)} ${p ? 'Producto' : 'Nuevo producto'}`,
    html: `${p ? `<h2 class="ptitle">${esc(p.nombre)}</h2>
        <div class="stats" style="margin-top:8px">
          <div class="stat2"><b class="${p.stock < 0 || (p.minimo && p.stock <= p.minimo) ? 'bad' : ''}">${fmtNum(p.stock)}</b><span>${esc(p.unidad)} en stock</span></div>
          ${cob ? `<div class="stat2"><b>${fmtNum(cob.necesario7)}</b><span>se usan en 7 días</span></div>
                   <div class="stat2"><b class="${cob.faltaEl ? 'warn' : 'ok'}">${cob.faltaEl ? esc(nombreDia(cob.faltaEl)) : '30+ días'}</b><span>${cob.faltaEl ? 'falta desde' : 'alcanza'}</span></div>` : ''}
        </div>
        ${!lectura ? `<div class="pacts" style="border:0;padding:0;margin:10px 0 0">
          <button class="btn lg" data-m="entrada">${icon('plus', 14)} Entrada</button>
          <button class="btn lg" data-m="salida">− Salida</button>
          <button class="btn lg" data-m="ajuste">${icon('editar', 14)} Ajustar al contado</button></div>` : ''}` : ''}
      ${lectura ? `<dl class="props" style="margin-top:16px"><dt>Unidad</dt><dd>${esc(d.unidad)}</dd><dt>Avisar con</dt><dd>${fmtNum(d.minimo)}</dd><dt>En cada vianda</dt><dd>${d.porVianda ? fmtNum(d.porVianda) : 'No'}</dd></dl>` : `
      <div class="psec" style="margin-top:${p ? 22 : 0}px"><h3>Producto</h3>
        <div class="field"><label for="f-prod-nombre">Nombre${REQ}</label><input type="text" id="f-prod-nombre" value="${esc(d.nombre)}" placeholder="Ej: Milanesas, Puré, Envases" autocomplete="off" ${p ? '' : 'autofocus'}>
          <div id="prod-existe"></div></div>
        <div class="field"><label for="f-prod-unidad">Se cuenta en</label>
          <select id="f-prod-unidad">${UNIDADES.map(u => `<option value="${u}" ${u === d.unidad ? 'selected' : ''}>${u}</option>`).join('')}
            ${!UNIDADES.includes(d.unidad) ? `<option value="${esc(d.unidad)}" selected>${esc(d.unidad)}</option>` : ''}<option value="__otra">Otra…</option></select>
          <input type="text" id="f-prod-unidad-otra" class="hidden" placeholder="Escribí la unidad" style="margin-top:6px"></div>
      </div>
      <div class="psec"><h3>Stock</h3>
        ${!p ? `<div class="field"><label for="f-prod-inicial">¿Cuánto tenés ahora?</label><input type="number" id="f-prod-inicial" min="0" step="any" value="0">
          <div class="help">Después, para sumar o restar, usá <b>Cargar stock</b>.</div></div>` : ''}
        <div class="field"><label for="f-prod-minimo">Avisarme cuando queden menos de</label><input type="number" id="f-prod-minimo" min="0" step="any" value="${d.minimo}">
          <div class="help">Aparece en rojo en Stock y en Hoy. Con 0 no avisa.</div></div>
      </div>
      <div class="psec"><h3>¿Se descuenta solo?</h3>
        <p class="help" style="margin:0 0 10px">Lo que lleva cada comida (milanesas, puré…) se descuenta por los menús: armalos en <b>Stock → Menús</b>.</p>
        <label class="check"><input type="checkbox" id="f-prod-envase" ${d.porVianda > 0 ? 'checked' : ''}> Se usa en cada vianda que se entrega</label>
        <div class="help" style="margin:4px 0 10px 24px">Para envases, cubiertos, servilletas o bolsas. Ej: si hoy se entregan 12 viandas, se descuentan 12.</div>
        <div class="field ${d.porVianda > 0 ? '' : 'hidden'}" id="grupo-porvianda" style="margin-left:24px"><label for="f-prod-porvianda">¿Cuántos por vianda?</label>
          <input type="number" id="f-prod-porvianda" min="0" step="any" value="${d.porVianda > 0 ? d.porVianda : 1}" style="max-width:120px"></div>
        <label class="check" style="margin-top:6px"><input type="checkbox" id="f-prod-guarnicion" ${d.esGuarnicion ? 'checked' : ''}> Es una guarnición (arroz, puré, ensalada…: se elige en cada comanda)</label>
        <label class="check" style="margin-top:6px"><input type="checkbox" id="f-prod-activo" ${d.activo ? 'checked' : ''}> Activo (aparece para cargar y en los menús)</label>
      </div>`}
      ${p ? `<div class="psec"><h3>Movimientos</h3><div id="p-movs"><div class="skel" style="width:50%"></div></div></div>` : ''}
      ${p && !lectura ? `<div class="psec"><button class="btn lg danger" id="borrar-producto">${icon('borrar', 14)} Eliminar producto</button></div>` : ''}`,
    pie: lectura ? '' : `<button class="btn lg" id="cancelar-prod">Cancelar</button><button class="btn lg primary" id="guardar-producto">${p ? 'Guardar cambios' : 'Crear producto'}</button>`,
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
      const guardar = el.querySelector('#guardar-producto');
      if(guardar) formulario(el, { botones: guardar, cambios: !!p,
        completo: () => existente() ? marcarFalta(nombreInp, `Ya existe ${existente().nombre}: para sumarle stock usá Cargar stock.`) : true });
      if(guardar) guardar.addEventListener('click', async () => {
        const nombre = el.querySelector('#f-prod-nombre').value.trim();
        if(!nombre){ marcarFalta(el.querySelector('#f-prod-nombre'), 'Poné un nombre para el producto.'); return; }
        if(existente()){ toast(`Ya existe <b>${esc(existente().nombre)}</b>: para sumarle stock usá Cargar stock.`, 'err'); return; }
        const unidad = unidadSel.value === '__otra' ? (otra.value.trim() || 'unidades') : unidadSel.value;
        const datos = { nombre, unidad,
          minimo: Number(el.querySelector('#f-prod-minimo').value) || 0,
          porVianda: envase.checked ? (Number(el.querySelector('#f-prod-porvianda').value) || 1) : 0,
          esGuarnicion: el.querySelector('#f-prod-guarnicion').checked,
          activo: el.querySelector('#f-prod-activo').checked };
        guardar.disabled = true;
        try{
          const guardado = await guardarProducto(p ? p.id : null, datos);
          const ini = p ? 0 : Number(el.querySelector('#f-prod-inicial').value) || 0;
          if(ini) await registrarMovimiento(guardado, { tipo: 'entrada', cantidad: ini, nota: 'Stock inicial' });
          toast(p ? 'Producto actualizado.' : 'Producto creado.');
          cerrarPanel(); refrescar();
        }catch(e){ toastError('No se pudo guardar el producto', e); guardar.disabled = false; }
      });
      const borrar = el.querySelector('#borrar-producto');
      if(borrar) borrar.addEventListener('click', async () => {
        if(!(await confirmar('Eliminar producto', `¿Eliminar <b>${esc(p.nombre)}</b> y todos sus movimientos?`, { ok: 'Eliminar', peligro: true }))) return;
        try{ await eliminarProducto(p); toast('Producto eliminado.'); cerrarPanel(); refrescar(); }
        catch(e){ toastError('No se pudo eliminar', e); }
      });
      if(!p) return;
      try{
        const movs = await listarMovimientos(p.id);
        const TIPO = { entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste', entrega: 'Entrega' };
        el.querySelector('#p-movs').innerHTML = movs.length ? movs.map(m => `<div class="hist">
            <span class="w">${formatFechaCorta(m.fecha)}</span>
            <span class="t">${TIPO[m.tipo] || m.tipo}${m.nota ? ' · ' + esc(m.nota) : ''}</span>
            <span class="v ${Number(m.cantidad) < 0 ? 'bad' : 'ok'}">${Number(m.cantidad) > 0 ? '+' : ''}${fmtNum(m.cantidad)}</span></div>`).join('')
          : '<div class="muted" style="font-size:13px">Sin movimientos todavía.</div>';
      }catch(e){ el.querySelector('#p-movs').innerHTML = '<div class="muted">No se pudieron cargar los movimientos.</div>'; }
    }
  });
}

/* ---------- producción diaria de viandas ---------- */
function renderProduccion(main){
  const preparadas = produccionDe(stockFecha);
  const r = resumenDia(stockFecha);
  const balance = (preparadas || 0) - r.entregadas;
  const historial = Array.from({ length: 14 }, (_, i) => sumarDias(todayStr(), -i));
  main.innerHTML = `<div class="page">
    <p class="hello-sub" style="margin-top:0">Cuántas viandas preparaste cada día, contra lo programado por los clientes y lo que se entregó.</p>
    <div class="clist" style="padding:14px 16px;display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-top:14px">
      <div class="field" style="margin:0;min-width:150px"><label for="s-fecha">Fecha</label><input type="date" id="s-fecha" value="${stockFecha}"></div>
      <div class="field" style="margin:0;min-width:150px"><label for="s-preparadas">Viandas preparadas</label><input type="number" id="s-preparadas" min="0" step="1" value="${preparadas ?? ''}" placeholder="${demandaDia(stockFecha)}" ${esDueno() ? '' : 'disabled'}></div>
      ${esDueno() ? `<button class="btn lg primary" id="s-guardar">Guardar</button>` : ''}
    </div>
    <div class="stats">
      <div class="stat2"><b>${demandaDia(stockFecha)}</b><span>programadas</span></div>
      <div class="stat2"><b>${preparadas ?? '—'}</b><span>preparadas</span></div>
      <div class="stat2"><b class="ok">${r.entregadas}</b><span>entregadas</span></div>
      <div class="stat2"><b class="${balance < 0 ? 'bad' : ''}">${preparadas == null ? '—' : Math.abs(balance)}</b><span>${balance < 0 ? 'faltaron' : 'sobraron'}</span></div>
    </div>
    <section class="tsec"><h2>Últimos 14 días</h2>
      <div class="clist"><div class="tablewrap"><table class="ptable">
        <thead><tr><th>Día</th><th class="r">Programadas</th><th class="r">Preparadas</th><th class="r">Entregadas</th><th class="r">Balance</th></tr></thead>
        <tbody>${historial.map(f => { const p = produccionDe(f); const cargada = state.fechasCargadas.has(f); const ent = cargada ? resumenDia(f).entregadas : null; const bal = p != null && ent != null ? p - ent : null;
          return `<tr class="click" data-dia="${f}"><td>${esc(formatFechaMedia(f))}</td><td class="r z">${demandaDia(f)}</td><td class="r">${p ?? '—'}</td>
            <td class="r">${ent ?? '…'}</td><td class="r"><span class="saldo ${bal == null ? '' : bal < 0 ? 'bad' : 'ok'}">${bal == null ? '—' : (bal > 0 ? '+' : '') + bal}</span></td></tr>`; }).join('')}</tbody>
      </table></div></div></section></div>`;
  main.querySelector('#s-fecha').addEventListener('change', async (e) => {
    stockFecha = e.target.value || todayStr();
    try{ await asegurarFecha(stockFecha); }catch(_){}
    refrescar();
  });
  main.querySelectorAll('[data-dia]').forEach(r => r.addEventListener('click', async () => { stockFecha = r.dataset.dia; try{ await asegurarFecha(stockFecha); }catch(_){} refrescar(); }));
  const g = main.querySelector('#s-guardar');
  if(g) g.addEventListener('click', async () => {
    const v = Math.max(0, Math.trunc(Number(main.querySelector('#s-preparadas').value) || 0));
    try{ await guardarProduccion(stockFecha, v); toast(`Guardado: ${plural(v, 'vianda preparada', 'viandas preparadas')} el ${formatFechaMedia(stockFecha)}.`); refrescar(); }
    catch(e){ toastError('No se pudo guardar', e); }
  });
}

/* ---------- menús armados ---------- */
function componentesTxt(m){
  return m.items.map(i => { const p = state.productos.find(x => x.id === i.productoId); return p ? `${fmtNum(i.cantidad)} ${p.nombre}` : null; }).filter(Boolean).join(' + ') || 'Sin productos';
}
function renderMenus(main){
  const hoy = todayStr();
  const usoHoy = new Map(resumenCocina(hoy).map(x => [x.menuId || '', x.pendiente + x.entregado]));
  const cats = [...new Set(state.menus.map(m => m.categoria || 'Sin categoría'))];
  const fila = m => `<div class="irow click ${m.activo ? '' : 'off'}" data-menu="${m.id}" tabindex="0">
      ${icon('menu', 16)}
      <div class="t"><div class="n">${esc(m.nombre)} ${m.llevaGuarnicion ? '<span class="tag plain">+ guarnición</span>' : ''} ${!m.activo ? '<span class="tag plain">Inactivo</span>'
          : porcionesDisponibles(m) === 0 ? '<span class="tag bad">Sin stock: no aparece en los pedidos</span>'
          : armadoMenu(m) === 'piezas' ? `<span class="tag warn" title="Tenés las piezas en stock pero el plato todavía hay que armarlo">Para armar · alcanza para ${porcionesDisponibles(m)}</span>`
          : porcionesDisponibles(m) != null ? `<span class="tag ok">Listo · quedan ${porcionesDisponibles(m)}</span>`
          : piezaSugerida(m) ? `<span class="tag plain">Se puede armar con ${esc(piezaSugerida(m).nombre)}</span>${esDueno() ? ` <button class="btn quiet" type="button" data-enlazar="${m.id}" title="Enlazar ${esc(piezaSugerida(m).nombre)} como pieza de este menú">${icon('plus', 12)} Enlazar</button>` : ''}` : ''}</div>
        <div class="s">${esc(componentesTxt(m))}${m.descripcion ? ' · ' + esc(m.descripcion) : ''}</div></div>
      <span class="why">${usoHoy.get(m.id) ? `${plural(usoHoy.get(m.id), 'vianda')} hoy` : ''}</span>
      <b class="num" style="min-width:84px;text-align:right">${m.precio != null ? fmtPlata(m.precio) : '<span class="muted" style="font-weight:400">sin precio</span>'}</b></div>`;
  const paraArmar = state.menus.filter(m => m.activo && armadoMenu(m) === 'piezas' && porcionesDisponibles(m) > 0);
  main.innerHTML = `<div class="page">
    ${paraArmar.length ? `<div class="banner warn" style="border-radius:12px;border:1px solid var(--warn-line);margin-bottom:14px">${icon('alerta', 14)}
      <span><b>Para armar:</b> tenés las piezas de ${paraArmar.map(m => `<b>${esc(m.nombre)}</b> (${porcionesDisponibles(m)})`).join(', ')}, pero todavía hay que armarlos.</span></div>` : ''}
    <p class="hello-sub" style="margin-top:0">La carta: cada menú con su precio y los productos del stock que lleva. Al cargar un pedido se descuentan solos, y la guarnición que se elija también.
      ${esDueno() ? ' Para cargar la carta de WhatsApp de una vez, usá <b>Pegar carta</b>.' : ''}</p>
    ${state.menus.length ? cats.map(cat => { const ms = state.menus.filter(m => (m.categoria || 'Sin categoría') === cat);
      return `<section class="tsec" style="margin-top:18px"><h2>${esc(cat)} <span class="n">${ms.length}</span></h2><div class="clist">${ms.map(fila).join('')}</div></section>`; }).join('')
      : `<div class="clist" style="margin-top:18px"><div class="stub" style="margin:28px auto"><div class="ico">${icon('menu', 20)}</div><h2>Sin menús</h2>
          <p>Pegá la carta que mandás por WhatsApp y se cargan todos los menús con sus precios, o armalos de a uno.</p>
          ${esDueno() ? `<button class="btn lg primary" id="primera-carta">${icon('copiar', 14)} Pegar carta</button> <button class="btn lg" id="primer-menu">${icon('plus', 14)} Nuevo menú</button>` : ''}</div></div>`}
    ${guarniciones().length ? `<section class="tsec"><h2>Guarniciones <span class="n">${guarniciones().length}</span><span class="sp"></span><span class="hint2">se eligen en cada comanda de un menú "+ guarnición"</span></h2>
      <div class="clist"><div class="irow">${icon('caja', 15)}<div class="t"><div class="n">${guarniciones().map(g => esc(g.nombre)).join(' · ')}</div></div></div></div></section>` : ''}
  </div>`;
  main.querySelectorAll('[data-enlazar]').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const m = menuPorId(b.dataset.enlazar), p = piezaSugerida(m);
    if(!m || !p) return;
    try{
      await guardarMenu(m.id, { ...m, items: [{ productoId: p.id, cantidad: 1 }] });
      await recalcularPedidosPendientes().catch(() => {});
      toast(`<b>${esc(m.nombre)}</b> ahora se arma con ${esc(p.nombre)}${m.llevaGuarnicion ? ' y la guarnición que elijan' : ''}.`);
      refrescar();
    }catch(err){ toastError('No se pudo enlazar', err); }
  }));
  main.querySelectorAll('[data-menu]').forEach(r => {
    r.addEventListener('click', () => abrirMenu(r.dataset.menu));
    r.addEventListener('keydown', e => { if(e.key === 'Enter') abrirMenu(r.dataset.menu); });
  });
  const pm = main.querySelector('#primer-menu'); if(pm) pm.addEventListener('click', () => abrirMenu(null));
  const pc = main.querySelector('#primera-carta'); if(pc) pc.addEventListener('click', () => abrirPegarCarta());
}

function filaComponenteHtml(it, i){
  const prods = state.productos.filter(p => p.activo || p.id === it.productoId);
  return `<div class="cline" data-i="${i}" style="grid-template-columns:minmax(0,1fr) 90px 34px">
    <select class="inp" data-campo="producto" aria-label="Producto"><option value="">Elegí un producto</option>
      ${prods.map(p => `<option value="${p.id}" ${p.id === it.productoId ? 'selected' : ''}>${esc(p.nombre)} (${esc(p.unidad)})</option>`).join('')}</select>
    <input type="number" class="inp" data-campo="cantidad" min="0" step="any" value="${it.cantidad}" aria-label="Cantidad">
    <button class="iconbtn" type="button" data-quitar-comp aria-label="Quitar" title="Quitar">${icon('x', 14)}</button></div>`;
}
function abrirMenu(id){
  const m = id ? menuPorId(id) : null;
  const d = m || { nombre: '', descripcion: '', activo: true, items: [{ productoId: '', cantidad: 1 }] };
  const lectura = !esDueno();
  abrirPanel({
    ancho: 'medio',
    titulo: `${icon('menu', 14)} ${m ? 'Menú' : 'Nuevo menú'}`,
    html: lectura ? `<h2 class="ptitle">${esc(d.nombre)}</h2><p class="psub">${esc(d.descripcion)}</p>
        <dl class="props"><dt>Precio</dt><dd>${d.precio != null ? fmtPlata(d.precio) : '—'}</dd><dt>Lleva</dt><dd>${esc(componentesTxt(d))}${d.llevaGuarnicion ? ' + guarnición' : ''}</dd></dl>` : `
      <div class="field"><label for="f-menu-nombre">Nombre${REQ}</label><input type="text" id="f-menu-nombre" value="${esc(d.nombre)}" placeholder="Ej: Milanesa con puré" ${m ? '' : 'autofocus'}></div>
      <div class="frow">
        <div class="field"><label for="f-menu-precio">Precio</label><input type="number" id="f-menu-precio" min="0" step="1" value="${d.precio ?? ''}" placeholder="$"></div>
        <div class="field"><label for="f-menu-cat">Categoría</label><input type="text" id="f-menu-cat" value="${esc(d.categoria || '')}" list="menu-cats" placeholder="Carnes, Pollo, Varios…">
          <datalist id="menu-cats">${[...new Set(state.menus.map(x => x.categoria).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
      </div>
      <label class="check" style="margin-bottom:12px"><input type="checkbox" id="f-menu-guarnicion" ${d.llevaGuarnicion ? 'checked' : ''}> Lleva guarnición (se elige en cada comanda)</label>
      <div class="field"><label for="f-menu-desc">Descripción (opcional)</label><input type="text" id="f-menu-desc" value="${esc(d.descripcion)}" placeholder="Ej: con puré de calabaza, sin sal"></div>
      <div class="psec"><h3>Productos que lleva una vianda</h3>
        <div id="menu-comps">${d.items.map(filaComponenteHtml).join('')}</div>
        <button class="btn" type="button" id="menu-agregar" style="margin-top:8px">${icon('plus', 13)} Agregar producto</button>
        ${!state.productos.length ? '<p class="muted" style="font-size:13px;margin-top:10px">Primero cargá los productos en Stock → Productos.</p>' : ''}</div>
      <label class="check" style="margin-top:16px"><input type="checkbox" id="f-menu-activo" ${d.activo ? 'checked' : ''}> Activo (aparece para elegir en las comandas)</label>
      ${m ? `<div class="psec"><button class="btn lg danger" id="borrar-menu">${icon('borrar', 14)} Eliminar menú</button></div>` : ''}`,
    pie: lectura ? '' : `<button class="btn lg" id="cancelar-menu">Cancelar</button><button class="btn lg primary" id="guardar-menu">${m ? 'Guardar cambios' : 'Crear menú'}</button>`,
    onMount: (el) => {
      if(lectura) return;
      const cont = el.querySelector('#menu-comps');
      const bind = () => cont.querySelectorAll('[data-quitar-comp]').forEach(b => { b.onclick = () => b.closest('.cline').remove(); });
      bind();
      el.querySelector('#menu-agregar').addEventListener('click', () => { cont.insertAdjacentHTML('beforeend', filaComponenteHtml({ productoId: '', cantidad: 1 }, cont.children.length)); bind(); });
      el.querySelector('#cancelar-menu').addEventListener('click', () => cerrarPanel());
      formulario(el, { botones: el.querySelector('#guardar-menu'), cambios: !!m });
      el.querySelector('#guardar-menu').addEventListener('click', async (ev) => {
        const nombre = el.querySelector('#f-menu-nombre').value.trim();
        if(!nombre){ marcarFalta(el.querySelector('#f-menu-nombre'), 'Poné un nombre para el menú.'); return; }
        const items = [...cont.querySelectorAll('.cline')].map(r => ({ productoId: r.querySelector('[data-campo="producto"]').value, cantidad: Number(r.querySelector('[data-campo="cantidad"]').value) || 0 }))
          .filter(i => i.productoId && i.cantidad > 0);
        const repetido = items.find((x, i) => items.findIndex(y => y.productoId === x.productoId) !== i);
        if(repetido){ toast('Hay un producto repetido: juntá las cantidades en una sola fila.', 'err'); return; }
        const b = ev.currentTarget; b.disabled = true;
        try{
          const g = await guardarMenu(m ? m.id : null, { nombre, descripcion: el.querySelector('#f-menu-desc').value.trim(), activo: el.querySelector('#f-menu-activo').checked, items,
            precio: el.querySelector('#f-menu-precio').value, categoria: el.querySelector('#f-menu-cat').value, llevaGuarnicion: el.querySelector('#f-menu-guarnicion').checked });
          if(m) await recalcularPedidosPendientes().catch(() => {});
          toast(m ? 'Menú actualizado.' : `Menú <b>${esc(nombre)}</b> creado.`); cerrarPanel(); refrescar();
        }catch(e){ toastError('No se pudo guardar el menú', e); b.disabled = false; }
      });
      const borrar = el.querySelector('#borrar-menu');
      if(borrar) borrar.addEventListener('click', async () => {
        if(!(await confirmar('Eliminar menú', `¿Eliminar <b>${esc(m.nombre)}</b>?`, { ok: 'Eliminar', peligro: true }))) return;
        try{ await eliminarMenu(m); toast('Menú eliminado.'); cerrarPanel(); refrescar(); }
        catch(e){ toastError('No se pudo eliminar', e); }
      });
    }
  });
}

/* ---------- carga rápida de stock: elegir producto de la lista y cantidad ---------- */
let cargaTipo = 'entrada';
function lineaCargaHtml(pid){
  const prods = state.productos.filter(x => x.activo || x.id === pid);
  return `<div class="cline" style="grid-template-columns:minmax(0,1fr) 100px 34px">
    <select class="inp" data-campo="producto" aria-label="Producto"><option value="">Elegí un producto</option>
      ${prods.map(x => `<option value="${x.id}" ${x.id === pid ? 'selected' : ''}>${esc(x.nombre)} · hay ${fmtNum(x.stock)} ${esc(x.unidad)}</option>`).join('')}
      <option value="__nuevo">+ Producto nuevo…</option></select>
    <input type="number" class="inp" data-campo="cantidad" min="0" step="any" placeholder="Cantidad" aria-label="Cantidad">
    <button class="iconbtn" type="button" data-quitar-carga aria-label="Quitar" title="Quitar">${icon('x', 14)}</button></div>`;
}
function abrirCargaStock(pid, hecho){
  abrirPanel({
    ancho: 'medio',
    titulo: `${icon('caja', 14)} Cargar stock`,
    html: `<div class="seg" role="group" aria-label="Qué pasó" style="margin-bottom:14px">
        <button type="button" data-ct="entrada" aria-pressed="${cargaTipo === 'entrada'}">Entró (compra o producción)</button>
        <button type="button" data-ct="salida" aria-pressed="${cargaTipo === 'salida'}">Salió (uso, merma, vencido)</button></div>
      <div class="psec" style="margin-top:0"><h3>Productos <span class="sp"></span><span class="n">elegí de la lista y poné la cantidad</span></h3>
        <div id="cs-lineas">${lineaCargaHtml(pid || '')}</div>
        <button class="btn" type="button" id="cs-agregar" style="margin-top:4px">${icon('plus', 13)} Otro producto</button></div>
      <div class="frow" style="margin-top:14px">
        <div class="field"><label for="cs-fecha">Fecha</label><input type="date" id="cs-fecha" value="${todayStr()}"></div>
        <div class="field"><label for="cs-nota">Nota (opcional)</label><input type="text" id="cs-nota" placeholder="Proveedor, compra, merma…"></div></div>
      ${hecho ? `<div class="banner" style="border-radius:9px;border:1px solid var(--ok-line);background:var(--ok-wash);color:var(--ok-ink)">${icon('check', 14)} ${hecho}</div>` : ''}`,
    pie: `<button class="btn lg" id="cs-cerrar">Listo</button><button class="btn lg primary" id="guardar-stock">Guardar</button>`,
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
      const leerCarga = () => [...cont.querySelectorAll('.cline')].map(r => ({ p: state.productos.find(x => x.id === r.querySelector('[data-campo="producto"]').value), q: Number(r.querySelector('[data-campo="cantidad"]').value) || 0 }));
      // cada producto elegido necesita su cantidad (y cada cantidad, su producto)
      const validarCarga = () => {
        const lineas = leerCarga(), filas = [...cont.querySelectorAll('.cline')];
        const mala = filas.find((r, i) => (lineas[i].p && !(lineas[i].q > 0)) || (!lineas[i].p && lineas[i].q > 0));
        if(lineas.some(l => l.p && l.q > 0) && !mala) return true;
        const r = mala || filas[0], i = filas.indexOf(r);
        const falta = lineas[i] && lineas[i].p ? r.querySelector('[data-campo="cantidad"]') : r.querySelector('[data-campo="producto"]');
        return marcarFalta(falta, falta && falta.dataset.campo === 'cantidad' ? 'Poné la cantidad.' : 'Elegí el producto y poné la cantidad.');
      };
      formulario(el, { botones: el.querySelector('#guardar-stock'), completo: validarCarga });
      el.querySelector('#guardar-stock').addEventListener('click', async (ev) => {
        if(!validarCarga()) return;
        const validas = leerCarga().filter(l => l.p && l.q > 0);
        const b = ev.currentTarget; b.disabled = true;
        const fecha = el.querySelector('#cs-fecha').value || todayStr(), nota = el.querySelector('#cs-nota').value.trim();
        try{
          for(const l of validas) await registrarMovimiento(l.p, { tipo: cargaTipo, cantidad: l.q, nota, fecha });
          const signo = cargaTipo === 'salida' ? '−' : '+';
          const resumen = validas.map(l => { const act = state.productos.find(x => x.id === l.p.id); return `${signo}${fmtNum(l.q)} ${esc(l.p.nombre)} (quedan ${fmtNum(act ? act.stock : 0)})`; }).join(' · ');
          toast(`Stock cargado: ${resumen}.`);
          cerrarPanel(); renderMenu(); refrescar();
        }catch(e){ toastError('No se pudo cargar el stock', e); b.disabled = false; }
      });
      const primera = cont.querySelector(pid ? '[data-campo="cantidad"]' : 'select'); if(primera) setTimeout(() => primera.focus(), 40);
    }
  });
}
/* Alta rápida de un producto desde la carga de stock (sin salir de la ventana). */
async function dialogoProductoRapido(){
  const r = await dialogo({
    titulo: 'Producto nuevo',
    texto: 'Se agrega a la lista una sola vez; después lo elegís de la lista cada vez que cargues stock.',
    html: `<div class="field"><label for="f-rap-nombre">Nombre${REQ}</label><input type="text" id="f-rap-nombre" placeholder="Ej: Filet de pollo" autofocus></div>
      <div class="field"><label for="f-rap-unidad">Se cuenta en</label><select id="f-rap-unidad">${UNIDADES.map(u => `<option>${u}</option>`).join('')}</select></div>`,
    botones: [{ id: 'cancelar', label: 'Cancelar' }, { id: 'ok', label: 'Agregar a la lista', clase: 'primary', domId: 'confirmar-producto-rapido' }],
    onMount: (el) => {
      el._validar = () => {
        const n = el.querySelector('#f-rap-nombre').value.trim();
        if(!n) return marcarFalta(el.querySelector('#f-rap-nombre'), 'Poné el nombre del producto.');
        const ya = state.productos.find(x => normalizarNombre(x.nombre) === normalizarNombre(n));
        if(ya){ toast(`Ya existe <b>${esc(ya.nombre)}</b> en la lista.`, 'err'); return false; }
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

/* ---------- pegar la carta de WhatsApp ---------- */
/* Lee una carta en texto (como la que se manda por WhatsApp): encabezados de categoría, ítems con
   "•" y "$ precio", "+ guarnición", "(sin stock)", variedades separadas por coma y la línea de
   GUARNICIÓN. Devuelve { items: [{ nombre, categoria, precio, llevaGuarnicion, activo, descripcion }], guarniciones }. */
function leerCarta(texto){
  const limpiar = t => t.replace(/[​-‍⁠﻿]/g, '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{20E3}]/gu, '').replace(/\s+/g, ' ').trim();
  const precioDe = t => { const m = t.match(/\$\s*([\d.,]+)/); return m ? Number(m[1].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) : null; };
  const cap = t => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  const prolijo = t => {
    let x = t.trim();
    if(x.length > 3 && x === x.toUpperCase()) x = x.toLowerCase();
    x = cap(x).replace(/\bmenu\b/gi, 'Menú').replace(/\btacc\b/gi, 'TACC');
    return x;
  };
  const items = [], guarniciones = [];
  let categoria = '';
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
    if(!vineta && precio == null){ categoria = prolijo(t.replace(/[:.]+$/, '')); continue; }
    const activo = !/sin stock/i.test(t);
    let nombre = t.replace(/\(\s*sin stock\s*\)/gi, '').replace(/\bvalor\b/gi, '').replace(/\$\s*[\d.,]+/g, '').replace(/\s+/g, ' ').trim();
    const lleva = /\+\s*guarnici[oó]n/i.test(nombre);
    nombre = nombre.replace(/\+\s*guarnici[oó]n/gi, '').replace(/[\s,:\-+]+$/, '').trim();
    const cat = vineta ? categoria : (categoria || 'Del día');
    const variedad = nombre.match(/^(.*?)[,\s]*variedad(?:es)?\s*:\s*(.+)$/i);
    if(variedad){
      const base = prolijo(variedad[1].trim()).replace(/^Tartas individuales$/i, 'Tarta individual').replace(/^Tartas$/i, 'Tarta');
      variedad[2].split(',').map(v => v.trim()).filter(Boolean).forEach(v =>
        items.push({ nombre: `${base} de ${v.toLowerCase()}`, categoria: cat, precio, llevaGuarnicion: lleva, activo, descripcion: '' }));
      continue;
    }
    items.push({ nombre: prolijo(nombre), categoria: cat, precio, llevaGuarnicion: lleva, activo, descripcion: '' });
  }
  return { items, guarniciones };
}

function abrirPegarCarta(texto, resultado){
  const leida = texto ? leerCarta(texto) : null;
  const prods = state.productos.filter(p => p.activo && !p.esGuarnicion);
  const sugerido = (it) => {
    const primera = normalizarNombre(it.nombre).split(' ')[0].replace(/s$/, '');
    const p = prods.find(x => normalizarNombre(x.nombre).replace(/s$/, '') === primera || normalizarNombre(x.nombre).split(' ')[0].replace(/s$/, '') === primera);
    return p ? p.id : '';
  };
  const existe = (it) => state.menus.find(m => normalizarNombre(m.nombre) === normalizarNombre(it.nombre));
  abrirPanel({
    ancho: leida ? 'ancho' : 'medio',
    titulo: `${icon('copiar', 14)} Pegar carta`,
    html: `${resultado ? `<div class="banner phero" style="border-radius:9px;border:1px solid var(--ok-line);background:var(--ok-wash);color:var(--ok-ink);margin-bottom:14px">${icon('check', 14)} ${resultado}</div>` : ''}
      ${!leida ? `<p class="psub" style="margin-top:0">Pegá acá el mensaje con la carta, tal como lo mandás por WhatsApp. La app arma la lista de menús con sus precios para que la revises antes de guardarla.</p>
        <div class="field"><label for="carta-texto">Texto de la carta</label><textarea id="carta-texto" rows="14" placeholder="Carnes 🥩&#10;• Milanesa al horno + guarnición $ 7.500&#10;…&#10;GUARNICIÓN: Arroz, puré de papa…"></textarea></div>`
      : `<p class="psub phero" style="margin-top:0">Encontré <b>${plural(leida.items.length, 'menú', 'menús')}</b>${leida.guarniciones.length ? ` y <b>${plural(leida.guarniciones.length, 'guarnición', 'guarniciones')}</b>` : ''}. Revisá y corregí lo que haga falta: los que ya existen se actualizan (precio y categoría), el resto se crea.</p>
        <div class="psec phero" style="margin-top:0"><div class="tablewrap"><table class="ptable compacta" id="carta-tabla">
          <thead><tr><th></th><th>Menú</th><th>Categoría</th><th class="r">Precio</th><th>Guarnición</th><th>Activo</th><th>Descuenta del stock</th></tr></thead>
          <tbody>${leida.items.map((it, i) => `<tr data-i="${i}">
            <td><input type="checkbox" data-c="incluir" checked aria-label="Incluir"></td>
            <td style="min-width:240px"><input class="inp sm" data-c="nombre" value="${esc(it.nombre)}" aria-label="Nombre">${existe(it) ? '<div class="help">ya existe: se actualiza</div>' : ''}</td>
            <td><input class="inp sm" data-c="categoria" value="${esc(it.categoria)}" aria-label="Categoría" style="width:120px"></td>
            <td class="r"><input class="inp sm" type="number" data-c="precio" value="${it.precio ?? ''}" placeholder="$" aria-label="Precio" style="width:100px"></td>
            <td><input type="checkbox" data-c="guarnicion" ${it.llevaGuarnicion ? 'checked' : ''} aria-label="Lleva guarnición"></td>
            <td><input type="checkbox" data-c="activo" ${it.activo ? 'checked' : ''} aria-label="Activo"></td>
            <td><select class="inp sm" data-c="producto" aria-label="Producto del stock" style="width:200px">
              <option value="">— Después —</option>
              ${prods.map(p => `<option value="${p.id}" ${sugerido(it) === p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}
              <option value="__crear">+ Crear «${esc(it.nombre)}»</option></select></td></tr>`).join('')}</tbody></table></div></div>
        ${leida.guarniciones.length ? `<div class="psec phero"><h3>Guarniciones <span class="n">se agregan como productos del stock</span></h3>
          <div class="days" style="gap:8px">${leida.guarniciones.map((g, i) => `<label class="check" style="border:1px solid var(--line-2);border-radius:8px;padding:6px 10px">
            <input type="checkbox" data-g="${i}" checked> ${esc(g)}</label>`).join('')}</div></div>` : ''}`}`,
    pie: leida ? `<button class="btn lg" id="carta-volver">Volver al texto</button><span class="sp"></span><button class="btn lg primary" id="carta-guardar">Guardar ${plural(leida.items.length, 'menú', 'menús')}</button>`
               : `<button class="btn lg" id="carta-cerrar">Cerrar</button><button class="btn lg primary" id="carta-leer">Leer carta</button>`,
    onMount: (el) => {
      if(!leida){
        const ta = el.querySelector('#carta-texto'); if(texto) ta.value = texto;
        el.querySelector('#carta-cerrar').addEventListener('click', () => cerrarPanel());
        el.querySelector('#carta-leer').addEventListener('click', () => {
          const v = ta.value.trim();
          if(!v){ toast('Pegá el texto de la carta.', 'err'); return; }
          const r = leerCarta(v);
          if(!r.items.length){ toast('No encontré menús con precio en ese texto. Revisá que tenga líneas como "• Milanesa $ 7.500".', 'err'); return; }
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
          const partes = [r.menusNuevos && plural(r.menusNuevos, 'menú nuevo', 'menús nuevos'), r.menusActualizados && plural(r.menusActualizados, 'menú actualizado', 'menús actualizados'),
                          r.guarnicionesNuevas && plural(r.guarnicionesNuevas, 'guarnición', 'guarniciones'), r.productosNuevos && plural(r.productosNuevos, 'producto nuevo', 'productos nuevos')].filter(Boolean);
          toast(`Carta guardada: ${partes.join(', ')}.`);
          stockVista = 'menus'; cerrarPanel(); render();
        }catch(e){ toastError('No se pudo guardar la carta', e); b.disabled = false; b.textContent = 'Guardar'; }
      });
    }
  });
}

/* ---------- pasar los menús al stock ----------
   Crea un producto de stock por cada menú que todavía no descuenta nada y lo enlaza:
   cada plato que se pida descuenta 1 de ese producto. */
const menusSinProductos = () => state.menus.filter(m => m.activo && !m.items.length);

function abrirMenusAStock(){
  const ms = menusSinProductos();
  const conProd = state.menus.filter(m => m.activo && m.items.length).length;
  const cats = [...new Set(ms.map(m => m.categoria || 'Sin categoría'))];
  const existente = (m) => state.productos.find(p => normalizarNombre(p.nombre) === normalizarNombre(m.nombre));
  const fila = (m) => { const ya = existente(m); return `<tr data-menu="${m.id}">
      <td><label class="check"><input type="checkbox" data-c="usar" checked> ${esc(m.nombre)}</label></td>
      <td>${ya ? '<span class="muted">Usa el producto que ya existe</span>'
        : `<select class="inp sm" data-c="unidad" aria-label="Se cuenta en" style="width:130px">${UNIDADES.map(u => `<option ${u === 'porciones' ? 'selected' : ''}>${u}</option>`).join('')}</select>`}</td>
      <td class="r">${ya ? `<span class="muted">hay ${fmtNum(ya.stock)} ${esc(ya.unidad)}</span>`
        : '<input type="number" class="inp sm" data-c="inicial" min="0" step="1" placeholder="0" aria-label="Cuánto tenés ahora" style="width:96px;margin-left:auto">'}</td></tr>`; };
  abrirPanel({
    titulo: `${icon('caja', 14)} Pasar menús al stock`, ancho: 'medio',
    html: ms.length ? `<p class="psub" style="margin-top:0">Se crea un producto de stock por cada menú y quedan enlazados: cada plato que pidan descuenta 1 de ese producto.
        Destildá los que no quieras contar así.</p>
      <div class="clist"><div class="tablewrap"><table class="ptable compacta">
        <thead><tr><th><label class="check"><input type="checkbox" id="ms-todos" checked> Menú</label></th><th>Se cuenta en</th><th class="r">Cuánto tenés ahora</th></tr></thead>
        <tbody>${cats.map(cat => `<tr class="grp"><td colspan="3">${esc(cat)}</td></tr>` + ms.filter(m => (m.categoria || 'Sin categoría') === cat).map(fila).join('')).join('')}</tbody>
      </table></div></div>
      ${conProd ? `<p class="muted" style="font-size:13px;margin-top:10px">${plural(conProd, 'menú ya descuenta', 'menús ya descuentan')} productos del stock: esos no se tocan.</p>` : ''}`
      : `<div class="clist"><div class="calm">${icon('check')} Todos los menús ya descuentan productos del stock.</div></div>`,
    pie: ms.length ? '<button class="btn lg" id="ms-cancelar">Cancelar</button><button class="btn lg primary" id="ms-crear">Pasar menús</button>'
      : '<button class="btn lg" id="ms-cancelar">Cerrar</button>',
    onMount: (el) => {
      el.querySelector('#ms-cancelar').addEventListener('click', () => cerrarPanel());
      const todos = el.querySelector('#ms-todos'), checks = () => [...el.querySelectorAll('[data-c="usar"]')];
      const crear = el.querySelector('#ms-crear');
      const contar = () => {
        const n = checks().filter(x => x.checked).length;
        if(crear){ crear.disabled = !n; crear.textContent = n ? `Pasar ${plural(n, 'menú', 'menús')}` : 'Pasar menús'; }
        if(todos) todos.checked = n === checks().length;
      };
      if(todos) todos.addEventListener('change', () => { checks().forEach(x => { x.checked = todos.checked; }); contar(); });
      checks().forEach(x => x.addEventListener('change', contar));
      contar();
      if(crear) crear.addEventListener('click', async () => {
        const filas = [...el.querySelectorAll('tr[data-menu]')].filter(r => r.querySelector('[data-c="usar"]').checked);
        crear.disabled = true;
        let hechos = 0;
        try{
          for(const r of filas){
            const m = menuPorId(r.dataset.menu);
            if(!m) continue;
            crear.textContent = `Pasando ${hechos + 1} de ${filas.length}…`;
            let p = existente(m);
            if(!p){
              p = await guardarProducto(null, { nombre: m.nombre, unidad: r.querySelector('[data-c="unidad"]').value, minimo: 0, porVianda: 0, activo: true, esGuarnicion: false });
              const ini = Number(r.querySelector('[data-c="inicial"]').value) || 0;
              if(ini > 0) await registrarMovimiento(p, { tipo: 'entrada', cantidad: ini, nota: 'Stock inicial' });
            }
            await guardarMenu(m.id, { ...m, items: [{ productoId: p.id, cantidad: 1 }] });
            hechos++;
          }
          await recalcularPedidosPendientes();   // los pedidos que ya estaban pasan a descontar su producto
          toast(`Listo: ${plural(hechos, 'menú quedó', 'menús quedaron')} en el stock. Cargá cuánto tenés con <b>Cargar stock</b>.`);
          stockVista = 'productos'; cerrarPanel(); renderMenu(); render();
        }catch(e){ toastError(hechos ? `Se pasaron ${hechos} y después falló` : 'No se pudo crear', e); crear.disabled = false; contar(); refrescar(); }
      });
    }
  });
}
