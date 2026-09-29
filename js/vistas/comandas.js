/* ============================================================
   PESTAÑA: COMANDAS — pedidos particulares
   Son otra cosa que las entregas de los packs: platos de la carta, con
   guarnición y precio, y su propio estado (pendiente / entregada /
   cancelada). No usan créditos. Al marcar un pedido entregado se
   descuentan del stock los productos de cada plato y la guarnición.
============================================================= */
let comandaFecha = todayStr();
let comandaBusqueda = '';

const puedeEditarComandas = (fecha) => esDueno() || (esAyudante() && fecha >= todayStr());
const ESTADO_PEDIDO = { pendiente: 'Pendiente', entregada: 'Entregado', cancelada: 'Cancelado' };
function estadoPedidoTag(ped){
  if(!ped) return '';
  return `<span class="tag ${ped.estado === 'entregada' ? 'ok' : ped.estado === 'cancelada' ? 'bad' : 'plain'}">${ESTADO_PEDIDO[ped.estado]}</span>`;
}

/* Totales de cocina de un día: cuántos de cada plato hay en los pedidos (sin los cancelados). */
function resumenCocina(fecha){
  const porMenu = new Map();
  for(const ped of pedidosDelDia(fecha)){
    if(ped.estado === 'cancelada') continue;
    for(const l of ped.lineas){
      const k = (l.menuId || '') + '|' + (l.guarnicionId || '');
      const x = porMenu.get(k) || { menuId: l.menuId, guarnicionId: l.guarnicionId, pendiente: 0, entregado: 0 };
      if(ped.estado === 'entregada') x.entregado += l.cantidad; else x.pendiente += l.cantidad;
      porMenu.set(k, x);
    }
  }
  return [...porMenu.values()].sort((a, b) => (b.pendiente + b.entregado) - (a.pendiente + a.entregado));
}

/* Botones de estado de un pedido (entregado / cancelado); tocar el activo lo vuelve a pendiente. */
function botonesPedidoHtml(ped, fecha){
  const editable = puedeEditarComandas(fecha);
  return `<div class="ped-toggle mbtns lg ${ped.estado}" data-pedido="${ped.clienteId}" role="group" aria-label="Estado del pedido">
    <button class="mb si" data-v="entregada" aria-pressed="${ped.estado === 'entregada'}" ${editable ? '' : 'disabled'} title="Entregado" aria-label="Entregado">${icon('check', 16)}<span class="lbl">Entregado</span></button>
    <button class="mb no" data-v="cancelada" aria-pressed="${ped.estado === 'cancelada'}" ${editable ? '' : 'disabled'} title="Cancelado" aria-label="Cancelado">${icon('x', 15)}<span class="lbl">Cancelado</span></button>
  </div>`;
}
function filaPedidoHtml(ped, fecha){
  const c = clientePorId(ped.clienteId);
  const dir = [c.direccion, c.referencia].filter(Boolean).join(' · ');
  return `<div class="trow ${ped.estado === 'entregada' ? 'done' : ped.estado === 'cancelada' ? 'skip' : ''}" data-row-pedido="${c.id}">
    <div class="t" data-abrir-pedido="${c.id}" role="button" tabindex="0" title="Ver o cambiar el pedido">
      <div class="n">${esc(c.nombre)} ${ped.lineas.some(l => l.origen === 'whatsapp') ? '<span class="tag pine">WhatsApp</span>' : ''}</div>
      <div class="que">${ped.lineas.map(l => `<b>${l.cantidad}×</b> ${esc(textoLinea(l))}`).join(' · ')}</div>
      <div class="s">${esc(dir || 'Sin dirección')}${ped.total != null ? ` · <b style="color:var(--text)">${fmtPlata(ped.total)}</b>` : ''}</div>
    </div>
    ${botonesPedidoHtml(ped, fecha)}
  </div>`;
}
/* Engancha los botones y la apertura de los pedidos dentro de un contenedor. */
function bindPedidos(cont, fecha, alCambiar){
  cont.querySelectorAll('.ped-toggle .mb').forEach(b => b.addEventListener('click', async () => {
    const grupo = b.closest('.ped-toggle');
    const c = clientePorId(grupo.dataset.pedido);
    const ped = pedidoDe(c.id, fecha);
    const antes = ped.estado;
    const nuevo = antes === b.dataset.v ? 'pendiente' : b.dataset.v;
    grupo.classList.add('busy');
    try{
      await marcarPedido(c, fecha, nuevo);
      toast(`Pedido de <b>${esc(c.nombre)}</b>: ${ESTADO_PEDIDO[nuevo].toLowerCase()}.`, 'ok', null, {
        label: 'Deshacer', fn: async () => { try{ await marcarPedido(c, fecha, antes); alCambiar(); }catch(err){ toastError('No se pudo deshacer', err); } }
      });
    }catch(err){ toastError('No se pudo cambiar el pedido', err); }
    grupo.classList.remove('busy');
    alCambiar();
  }));
  cont.querySelectorAll('[data-abrir-pedido]').forEach(el => {
    const abrir = () => abrirComanda(clientePorId(el.dataset.abrirPedido), fecha, 'almuerzo');
    el.addEventListener('click', abrir);
    el.addEventListener('keydown', e => { if(e.key === 'Enter') abrir(); });
  });
}

function renderComandas(bar, main){
  const hoy = todayStr();
  bar.innerHTML = `<h1>Comandas</h1>
    <div class="dayctl">
      <button class="iconbtn" id="c-ant" aria-label="Día anterior" title="Día anterior">${icon('chevL')}</button>
      <input type="date" class="inp" id="c-fecha" value="${comandaFecha}" aria-label="Fecha">
      <button class="iconbtn" id="c-sig" aria-label="Día siguiente" title="Día siguiente">${icon('chevR')}</button>
      ${comandaFecha !== hoy ? `<button class="btn quiet" id="c-hoy">Hoy</button>` : ''}
    </div>
    <span class="muted">${esc(formatFechaLarga(comandaFecha))}</span><div class="sp"></div>
    <input class="inp sm search-inp" id="c-buscar" placeholder="Buscar cliente" aria-label="Buscar cliente" style="width:170px" value="${esc(comandaBusqueda)}">
    ${puedeEditarComandas(comandaFecha) ? `<button class="btn primary" id="nueva-comanda">${icon('plus', 14)} Nuevo pedido</button>` : ''}`;

  const cambiar = async (f) => {
    comandaFecha = f || todayStr();
    render();
    try{ if(await asegurarFecha(comandaFecha)) refrescar(); }catch(e){ toastError('No se pudieron traer los pedidos de ese día', e); }
  };
  bar.querySelector('#c-fecha').addEventListener('change', e => cambiar(e.target.value));
  bar.querySelector('#c-ant').addEventListener('click', () => cambiar(sumarDias(comandaFecha, -1)));
  bar.querySelector('#c-sig').addEventListener('click', () => cambiar(sumarDias(comandaFecha, 1)));
  const bh = bar.querySelector('#c-hoy'); if(bh) bh.addEventListener('click', () => cambiar(hoy));
  const nc = bar.querySelector('#nueva-comanda'); if(nc) nc.addEventListener('click', () => abrirComanda(null, comandaFecha, 'almuerzo'));
  bar.querySelector('#c-buscar').addEventListener('input', e => { comandaBusqueda = e.target.value; pintarLista(); });

  const f = comandaFecha;
  const rp = resumenPedidos(f);
  const cocinaRes = resumenCocina(f);
  const necesita = necesidadProductos(f, { soloPendiente: f === hoy });
  const prods = state.productos.filter(p => necesita[p.id] > 0).map(p => ({ p, n: necesita[p.id] }));
  const faltan = prods.filter(x => x.n > x.p.stock);
  const totalDia = pedidosDelDia(f).filter(p => p.estado !== 'cancelada').reduce((s, p) => s + (p.total || 0), 0);
  main.innerHTML = `<div class="page">
    <div class="kpis" style="margin-top:0">
      <div class="kpi ${rp.pendientes ? 'warn' : ''}"><b>${rp.pendientes}</b><span>pedidos por entregar · ${plural(rp.viandasPendientes, 'plato')}</span></div>
      <div class="kpi ok"><b>${rp.entregados}</b><span>entregados</span></div>
      <div class="kpi"><b>${fmtPlata(totalDia) || '$ 0'}</b><span>total del día (sin cancelados)</span></div>
    </div>
    <div class="hoy-grid">
      <section class="tsec" id="c-lista" style="margin-top:0"></section>
      <aside class="hoy-aside">
        <section class="tsec"><h2>${icon('comanda', 14)} Cocina <span class="n">${plural(cocinaRes.reduce((s, x) => s + x.pendiente + x.entregado, 0), 'plato')}</span></h2>
          ${cocinaRes.length ? `<div class="clist"><div class="flist">${cocinaRes.map(x => `<div class="fl"><span class="d" style="text-transform:none">${esc(textoLinea(x))}</span>
              <span class="muted">${x.entregado ? `${x.entregado} entregados` : ''}</span><b>${x.pendiente}</b></div>`).join('')}</div></div>`
            : `<div class="clist"><div class="calm">${icon('comanda')} No hay pedidos para este día.</div></div>`}
        </section>
        ${prods.length ? `<section class="tsec"><h2>${icon('stock', 14)} Productos que hacen falta</h2>
          <div class="clist"><div class="tablewrap"><table class="ptable compacta">
          <thead><tr><th>Producto</th><th class="r">Falta usar</th><th class="r">Hay</th></tr></thead>
          <tbody>${prods.map(({ p, n }) => `<tr><td>${esc(p.nombre)} <span class="muted">${esc(p.unidad)}</span></td>
            <td class="r">${fmtNum(n)}</td><td class="r"><span class="saldo ${n > p.stock ? 'bad' : ''}">${fmtNum(p.stock)}</span></td></tr>`).join('')}</tbody></table></div></div>
          ${faltan.length ? `<p class="muted" style="color:var(--bad-ink);margin:8px 2px 0">${icon('alerta', 13)} Faltan ${faltan.map(x => `${fmtNum(x.n - x.p.stock)} ${esc(x.p.unidad)} de ${esc(x.p.nombre)}`).join(', ')}.</p>` : ''}
        </section>` : ''}
      </aside>
    </div>
  </div>`;

  function pintarLista(){
    const q = comandaBusqueda.trim().toLowerCase();
    const cont = document.getElementById('c-lista');
    const ps = pedidosDelDia(f).filter(p => { const c = clientePorId(p.clienteId); return !q || (c.nombre + ' ' + c.empresaNombre).toLowerCase().includes(q); });
    const orden = { pendiente: 0, entregada: 1, cancelada: 2 };
    ps.sort((a, b) => orden[a.estado] - orden[b.estado] || clientePorId(a.clienteId).nombre.localeCompare(clientePorId(b.clienteId).nombre, 'es'));
    cont.innerHTML = ps.length ? `<h2>Pedidos <span class="n">${plural(ps.length, 'pedido')}</span></h2>
        <div class="clist">${ps.map(p => filaPedidoHtml(p, f)).join('')}</div>`
      : `<div class="clist"><div class="stub" style="margin:40px auto"><div class="ico">${icon('comanda', 20)}</div>
        <h2>${q ? 'Ningún pedido coincide' : 'Sin pedidos'}</h2>
        <p>${q ? 'Probá con otro nombre.' : 'Acá van los pedidos particulares de la carta. Las viandas de los packs se registran en Hoy.'}</p>
        ${!q && puedeEditarComandas(f) ? `<button class="btn lg primary" id="primera-comanda">${icon('plus', 14)} Nuevo pedido</button>` : ''}</div></div>`;
    bindPedidos(cont, f, refrescar);
    const pc = cont.querySelector('#primera-comanda'); if(pc) pc.addEventListener('click', () => abrirComanda(null, f, 'almuerzo'));
  }
  pintarLista();
}

/* Menús agrupados por categoría de la carta, con su precio. */
function opcionesMenu(sel){
  const activos = state.menus.filter(m => m.activo || m.id === sel);
  const cats = [...new Set(activos.map(m => m.categoria || ''))];
  const opc = m => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.nombre)}${m.precio != null ? ' · ' + fmtPlata(m.precio) : ''}${m.activo ? '' : ' (inactivo)'}</option>`;
  return cats.map(cat => { const ms = activos.filter(m => (m.categoria || '') === cat).map(opc).join('');
      return cat && cats.length > 1 ? `<optgroup label="${esc(cat)}">${ms}</optgroup>` : ms; }).join('')
    + `<option value="" ${!sel ? 'selected' : ''}>Vianda sin menú</option>`;
}
function opcionesGuarnicion(sel){
  return `<option value="">Guarnición…</option>` + state.productos.filter(p => p.esGuarnicion && (p.activo || p.id === sel))
    .map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('');
}
function lineaComandaHtml(l, i){
  const m = menuPorId(l.menuId);
  return `<div class="cline cline-com" data-i="${i}">
    <select class="inp" data-campo="menu" aria-label="Menú">${opcionesMenu(l.menuId)}</select>
    <select class="inp ${m && m.llevaGuarnicion ? '' : 'hidden'}" data-campo="guarnicion" aria-label="Guarnición">${opcionesGuarnicion(l.guarnicionId)}</select>
    <input type="number" class="inp" data-campo="cantidad" min="1" step="1" value="${l.cantidad}" aria-label="Cantidad">
    <input type="text" class="inp" data-campo="nota" value="${esc(l.nota || '')}" placeholder="Nota (sin sal, dieta…)" aria-label="Nota">
    <button class="iconbtn" type="button" data-quitar-linea="${i}" aria-label="Quitar" title="Quitar">${icon('x', 14)}</button></div>`;
}

/* ---------- editor de un pedido ---------- */
function abrirComanda(c, fecha, turno = 'almuerzo'){
  const nueva = !c;
  const ped = c ? pedidoDe(c.id, fecha) : null;
  const entregado = !!(ped && ped.estado === 'entregada');
  const editable = puedeEditarComandas(fecha) && !entregado;
  let lineas;
  if(ped) lineas = ped.lineas.map(x => ({ menuId: x.menuId, guarnicionId: x.guarnicionId, cantidad: x.cantidad, nota: x.nota }));
  else { const m = state.menus.find(x => x.activo); lineas = [{ menuId: m ? m.id : null, guarnicionId: null, cantidad: 1, nota: '' }]; }

  const clientesOpc = clientesActivos().map(x => `<option value="${x.id}">${esc(x.nombre)}${x.tipo === 'empresa' && x.empresaNombre ? ' · ' + esc(x.empresaNombre) : ''}</option>`).join('');
  abrirPanel({
    ancho: 'medio',
    titulo: `${icon('comanda', 14)} ${nueva || !ped ? 'Nuevo pedido' : 'Pedido'} · ${esc(nombreDia(fecha))}`,
    html: `${nueva ? `
        <div class="field"><label for="f-com-cliente">Cliente</label>
          <div style="display:flex;gap:6px"><select id="f-com-cliente" autofocus><option value="">Elegí un cliente</option>${clientesOpc}</select>
          ${esDueno() ? `<button class="btn lg" type="button" id="com-cliente-nuevo" title="Cliente nuevo">${icon('plus', 14)} Nuevo</button>` : ''}</div></div>
        <input type="hidden" id="f-com-turno" value="${turno}">
        <div class="field"><label for="f-com-fecha">Fecha</label><input type="date" id="f-com-fecha" value="${fecha}" min="${esDueno() ? '' : todayStr()}"></div>`
      : `<h2 class="ptitle">${esc(c.nombre)}</h2>
         <p class="psub">${tipoTag(c)} Pedido del ${esc(formatFechaMedia(fecha))} ${ped ? '· ' + estadoPedidoTag(ped) : ''}</p>`}
      ${entregado ? `<div class="banner" style="border-radius:9px;border:1px solid var(--line);margin-bottom:12px">${icon('info', 14)} Ya se entregó y se descontó del stock. Para cambiarlo, volvelo a pendiente.
          ${puedeEditarComandas(fecha) ? '<button class="btn quiet" id="com-reabrir">Volver a pendiente</button>' : ''}</div>` : ''}
      <div class="psec" style="margin-top:${nueva ? 6 : 12}px"><h3>Platos <span class="sp"></span><span class="n" id="com-total"></span></h3>
        <div id="com-lineas">${lineas.map(lineaComandaHtml).join('')}</div>
        ${editable ? `<button class="btn" type="button" id="com-agregar" style="margin-top:8px">${icon('plus', 13)} Agregar plato</button>` : ''}
        ${!state.menus.length ? `<p class="muted" style="font-size:13px;margin-top:10px">Todavía no hay menús en la carta. ${esDueno() ? 'Cargalos en Stock → Menús (podés pegar la carta de WhatsApp).' : ''}</p>` : ''}
      </div>
      <p class="muted" style="font-size:13px;margin-top:14px">Los pedidos no usan créditos. Al marcarlo entregado se descuentan del stock los productos de cada plato y la guarnición.</p>`,
    pie: editable ? `${ped ? `<button class="btn lg danger" id="borrar-comanda">${icon('borrar', 14)} Eliminar pedido</button><span class="sp"></span>` : ''}
      <button class="btn lg" id="cancelar-comanda">Cerrar</button><button class="btn lg primary" id="guardar-comanda">${ped ? 'Guardar pedido' : 'Crear pedido'}</button>` : '',
    onMount: (el) => {
      const cont = el.querySelector('#com-lineas');
      const leer = () => [...cont.querySelectorAll('.cline')].map(r => ({
        menuId: r.querySelector('[data-campo="menu"]').value || null,
        guarnicionId: r.querySelector('[data-campo="guarnicion"]').value || null,
        cantidad: Math.trunc(Number(r.querySelector('[data-campo="cantidad"]').value) || 0),
        nota: r.querySelector('[data-campo="nota"]').value.trim()
      }));
      const clienteActual = () => nueva ? clientePorId(el.querySelector('#f-com-cliente').value) : c;
      const actualizar = () => {
        const ls = leer();
        const tot = ls.reduce((s, l) => s + Math.max(l.cantidad, 0), 0);
        const valor = valorLineas(ls.filter(l => l.cantidad > 0));
        el.querySelector('#com-total').textContent = plural(tot, 'plato') + (valor != null && tot ? ' · ' + fmtPlata(valor) : '');
        cont.querySelectorAll('.cline').forEach(r => { const m = menuPorId(r.querySelector('[data-campo="menu"]').value); r.querySelector('[data-campo="guarnicion"]').classList.toggle('hidden', !(m && m.llevaGuarnicion)); });
      };
      const bind = () => {
        cont.querySelectorAll('input,select').forEach(x => { x.disabled = !editable; x.addEventListener('input', actualizar); x.addEventListener('change', actualizar); });
        cont.querySelectorAll('[data-quitar-linea]').forEach(b => { b.hidden = !editable; b.addEventListener('click', () => { b.closest('.cline').remove(); actualizar(); }); });
      };
      bind(); actualizar();
      const ag = el.querySelector('#com-agregar');
      if(ag) ag.addEventListener('click', () => {
        const m = state.menus.find(x => x.activo);
        cont.insertAdjacentHTML('beforeend', lineaComandaHtml({ menuId: m ? m.id : null, guarnicionId: null, cantidad: 1, nota: '' }, cont.children.length));
        bind(); actualizar();
        const ultimo = cont.lastElementChild.querySelector('select'); if(ultimo) ultimo.focus();
      });
      const cn = el.querySelector('#com-cliente-nuevo');
      if(cn) cn.addEventListener('click', async () => {
        const nuevoCli = await dialogoClienteRapido();
        if(nuevoCli){ const sel = el.querySelector('#f-com-cliente'); sel.insertAdjacentHTML('beforeend', `<option value="${nuevoCli.id}">${esc(nuevoCli.nombre)}</option>`); sel.value = nuevoCli.id; }
      });
      const cancelar = el.querySelector('#cancelar-comanda'); if(cancelar) cancelar.addEventListener('click', () => cerrarPanel());
      const reabrir = el.querySelector('#com-reabrir');
      if(reabrir) reabrir.addEventListener('click', async () => {
        try{ await marcarPedido(c, fecha, 'pendiente'); toast('Pedido de nuevo pendiente: el stock volvió.'); abrirComanda(c, fecha); refrescar(); }
        catch(err){ toastError('No se pudo cambiar el pedido', err); }
      });
      const borrar = el.querySelector('#borrar-comanda');
      if(borrar) borrar.addEventListener('click', async () => {
        if(!(await confirmar('Eliminar pedido', `¿Eliminar el pedido de <b>${esc(c.nombre)}</b> del ${esc(formatFechaMedia(fecha))}?`, { ok: 'Eliminar', peligro: true }))) return;
        try{ await guardarComanda(c, fecha, 'almuerzo', []); toast('Pedido eliminado.'); cerrarPanel(); refrescar(); }
        catch(err){ toastError('No se pudo eliminar el pedido', err); }
      });
      const guardar = el.querySelector('#guardar-comanda');
      if(guardar) guardar.addEventListener('click', async () => {
        const cli = clienteActual();
        if(!cli){ toast('Elegí el cliente del pedido.', 'err'); return; }
        const fch = nueva ? (el.querySelector('#f-com-fecha').value || fecha) : fecha;
        const ls = leer().filter(l => l.cantidad > 0);
        if(!ls.length){ toast('Agregá al menos un plato con cantidad.', 'err'); return; }
        const sinG = ls.find(l => { const m = menuPorId(l.menuId); return m && m.llevaGuarnicion && !l.guarnicionId && guarniciones().length; });
        if(sinG){ toast(`Elegí la guarnición de <b>${esc(menuPorId(sinG.menuId).nombre)}</b>.`, 'err'); return; }
        guardar.disabled = true;
        try{
          if(!state.fechasCargadas.has(fch)) await asegurarFecha(fch);
          const previo = pedidoDe(cli.id, fch);
          if(nueva && previo){
            if(previo.estado === 'entregada'){ toast(`${esc(cli.nombre)} ya tiene un pedido entregado ese día: abrilo desde la lista.`, 'err'); guardar.disabled = false; return; }
            if(!(await confirmar('Ya tiene un pedido', `${esc(cli.nombre)} ya tiene un pedido ese día. ¿Sumar estos platos al pedido?`, { ok: 'Sumar' }))){ guardar.disabled = false; return; }
            ls.push(...previo.lineas.map(x => ({ menuId: x.menuId, guarnicionId: x.guarnicionId, cantidad: x.cantidad, nota: x.nota })));
          }
          await guardarComanda(cli, fch, 'almuerzo', ls);
          toast(`Pedido de <b>${esc(cli.nombre)}</b> guardado: ${esc(textoMenus(cli, fch))}.`);
          abrirComanda(cli, fch); refrescar();
        }catch(err){ toastError('No se pudo guardar el pedido', err); guardar.disabled = false; }
      });
    }
  });
}

/* Alta rápida de un cliente desde un pedido (casual, sin días fijos). */
async function dialogoClienteRapido(){
  const r = await dialogo({
    titulo: 'Cliente nuevo',
    texto: 'Para pedidos sueltos: se crea como casual, sin días fijos. Después podés completar su ficha.',
    html: `<div class="field"><label for="f-rc-nombre">Nombre</label><input type="text" id="f-rc-nombre" autofocus></div>
      <div class="field"><label for="f-rc-tel">Teléfono</label><input type="tel" id="f-rc-tel"></div>
      <div class="field"><label for="f-rc-dir">Dirección</label><input type="text" id="f-rc-dir" placeholder="Calle y número"></div>`,
    botones: [{ id: 'cancelar', label: 'Cancelar' }, { id: 'ok', label: 'Crear cliente', clase: 'primary', domId: 'confirmar-cliente-rapido' }],
    onMount: (el) => { el._validar = () => { if(!el.querySelector('#f-rc-nombre').value.trim()){ toast('Poné el nombre.', 'err'); return false; } return true; }; }
  });
  if(!r) return null;
  try{
    const c = await guardarCliente(null, { nombre: r.el.querySelector('#f-rc-nombre').value.trim(), tipo: 'casual', empresaNombre: '', telefono: r.el.querySelector('#f-rc-tel').value.trim(),
      notas: '', direccion: r.el.querySelector('#f-rc-dir').value.trim(), referencia: '', lat: null, lng: null, dias: [], cantAlmuerzo: 1, cantCena: 0, cadeteId: null, menuAlmuerzoId: null, menuCenaId: null });
    toast(`<b>${esc(c.nombre)}</b> creado.`);
    return c;
  }catch(e){ toastError('No se pudo crear el cliente', e); return null; }
}
