/* ============================================================
   PESTAÑA: HOY — qué hay que entregar hoy
   Dos cosas distintas: las viandas de los packs y clientes fijos (cada
   una descuenta un crédito) y los pedidos particulares de la carta.
   Lo pendiente arriba con sus botones; lo ya registrado queda plegado.
   A la derecha lo que requiere atención: créditos, stock y próximos días.
============================================================= */
function filaTurnoHtml(c, fecha, turno){
  const e = getEntrega(c.id, fecha);
  const estado = e ? e[turno] : null;
  const editable = puedeRegistrarEn(fecha);
  const bloqueado = estado !== 'entregado' && !puedeEntregar(c, fecha, turno);
  const est = estadoSaldo(c);
  const dir = [c.direccion || 'Sin dirección cargada', c.referencia].filter(Boolean).join(' · ');
  return `<div class="trow ${estado === 'entregado' ? 'done' : estado === 'saltado' ? 'skip' : ''}" data-row="${c.id}" data-turno-row="${turno}">
    <div class="t" data-abrir="${c.id}" role="button" tabindex="0" title="Ver cómo llegar y la comanda">
      <div class="n">${esc(c.nombre)}
        ${est !== 'ok' ? `<span class="tag ${est}">${esc(textoSaldo(c))}</span>` : ''}
        ${c.notas ? `<span class="tag plain" title="${esc(c.notas)}">${esc(c.notas.length > 28 ? c.notas.slice(0, 26) + '…' : c.notas)}</span>` : ''}</div>
      <div class="que"><b>${viandasTurno(c, fecha, turno)}×</b> ${esc(menuPorId(c.menuAlmuerzoId) ? menuPorId(c.menuAlmuerzoId).nombre : 'vianda')} <span class="muted">· ${esc(TIPO_LABEL[c.tipo] || '')}</span></div>
      <div class="s">${esc(dir)}</div>
      ${bloqueado ? `<div class="s warnline">Sin créditos: no entregar hasta que pague.${esDueno() ? ' Cargá el pago desde su ficha.' : ' Avisale al dueño.'}</div>` : ''}
    </div>
    <div class="meal-toggle mbtns lg ${estado || ''}" data-cliente="${c.id}" data-meal="${turno}" role="group" aria-label="${esc(TURNO_LABEL[turno])} de ${esc(c.nombre)}">
      <button class="mb si" data-v="entregado" aria-pressed="${estado === 'entregado'}" ${!editable || bloqueado ? 'disabled' : ''}
        title="${bloqueado ? 'Sin créditos: no se puede entregar' : 'Entregado'}" aria-label="Entregado">${icon('check', 16)}<span class="lbl">Entregado</span></button>
      <button class="mb no" data-v="saltado" aria-pressed="${estado === 'saltado'}" ${!editable ? 'disabled' : ''} title="No se entregó" aria-label="No se entregó">${icon('x', 15)}<span class="lbl">No</span></button>
    </div>
  </div>`;
}

const hoyAbiertas = new Set();   // "Ya registradas" que quedaron abiertas: se respetan al actualizar

function renderHoy(bar, main){
  const hoy = todayStr();
  const r = resumenDia(hoy);
  const delDia = clientesDelDia(hoy);
  const sinSaldo = clientesSinSaldo();
  const sinSaldoHoy = new Set(sinSaldo.filter(c => turnosDe(c, hoy).length).map(c => c.id));
  const porVencer = clientesPorVencer();
  const necesita = necesidadProductos(hoy, { soloPendiente: true });
  const faltanHoy = state.productos.filter(p => necesita[p.id] > p.stock);
  const bajos = productosBajos().filter(p => !faltanHoy.includes(p));
  const crudo = state.perfil.nombre || (state.sesion ? state.sesion.user.email.split('@')[0].split(/[._-]/)[0] : '');
  const nombre = crudo ? crudo.charAt(0).toUpperCase() + crudo.slice(1) : '';
  const clientesPend = delDia.filter(c => clientePendiente(c, hoy));
  const pedidos = pedidosDelDia(hoy);
  const rp = resumenPedidos(hoy);

  bar.innerHTML = `<h1>Hoy</h1><span class="muted">${esc(formatFechaLarga(hoy))}</span><div class="sp"></div>
    ${tabVisible('entregas') ? `<button class="btn" id="ir-entregas">${icon('entregas', 14)} Por cadete</button>` : ''}
    <button class="btn primary" id="nueva-comanda-hoy">${icon('plus', 14)} Nuevo pedido</button>`;
  bar.querySelector('#nueva-comanda-hoy').addEventListener('click', () => abrirComanda(null, hoy, 'almuerzo'));
  const ie = bar.querySelector('#ir-entregas'); if(ie) ie.addEventListener('click', () => { entregaFecha = hoy; irA('entregas'); });

  // en la columna de alertas el estado va debajo del nombre, así el nombre entra entero
  const irow = (c, estado, acciones = '') => `<div class="irow click" data-cli="${c.id}">
      <div class="t"><div class="n">${esc(c.nombre)}</div>${estado}</div>
      ${acciones ? `<div class="acts">${acciones}</div>` : ''}</div>`;
  const accionesSaldo = (c) => {
    const wa = waLink(c.telefono, mensajeRecordatorio(c));
    return (wa ? `<a class="btn" href="${wa}" target="_blank" rel="noopener" data-stop title="Avisarle por WhatsApp" aria-label="Avisarle por WhatsApp">${icon('wa', 13)}</a>` : '')
      + (esDueno() ? `<button class="btn" data-pago="${c.id}" data-stop>${icon('pago', 13)} Pago</button>` : '');
  };

  // bloques por turno: pendientes arriba, lo ya registrado plegado
  const bloques = ['almuerzo', 'cena'].map(t => {
    const lista = delDia.filter(c => turnosDe(c, hoy).includes(t));
    if(!lista.length) return '';
    const pend = lista.filter(c => turnoPendiente(c, hoy, t));
    const hechas = lista.filter(c => !turnoPendiente(c, hoy, t));
    const viandasPend = pend.reduce((s, c) => s + viandasTurno(c, hoy, t), 0);
    return `<section class="tsec" style="margin-top:0;margin-bottom:22px" data-turno="${t}">
      <h2>${t === 'almuerzo' ? `${icon('entregas', 15)} Viandas de packs y fijos` : `${icon('luna', 15)} Cena`}
        <span class="n">${pend.length ? `${plural(viandasPend, 'vianda')} por entregar a ${plural(pend.length, 'cliente')}` : 'todo registrado'}</span></h2>
      <div class="clist">
        ${pend.length ? pend.map(c => filaTurnoHtml(c, hoy, t)).join('') : `<div class="calm">${icon('check')} No queda nada por entregar.</div>`}
        ${hechas.length ? `<details class="hechas" data-plegado="${t}" ${!pend.length || hoyAbiertas.has(t) ? 'open' : ''}><summary>${icon('chevD', 12)} Ya registradas (${hechas.length}) · se pueden corregir</summary>
          ${hechas.map(c => filaTurnoHtml(c, hoy, t)).join('')}</details>` : ''}
      </div></section>`;
  }).join('');

  // pedidos particulares (comandas): aparte de los packs
  const pedPend = pedidos.filter(p => p.estado === 'pendiente'), pedHechos = pedidos.filter(p => p.estado !== 'pendiente');
  const bloquePedidos = pedidos.length ? `<section class="tsec" style="margin-top:0;margin-bottom:22px" id="hoy-pedidos">
      <h2>${icon('comanda', 15)} Pedidos <span class="n">${pedPend.length ? `${plural(pedPend.length, 'pedido')} por entregar · ${plural(rp.viandasPendientes, 'plato')}` : 'todo registrado'}</span></h2>
      <div class="clist">
        ${pedPend.length ? pedPend.map(p => filaPedidoHtml(p, hoy)).join('') : `<div class="calm">${icon('check')} No quedan pedidos por entregar.</div>`}
        ${pedHechos.length ? `<details class="hechas" data-plegado="pedidos" ${!pedPend.length || hoyAbiertas.has('pedidos') ? 'open' : ''}><summary>${icon('chevD', 12)} Ya registrados (${pedHechos.length}) · se pueden corregir</summary>
          ${pedHechos.map(p => filaPedidoHtml(p, hoy)).join('')}</details>` : ''}
      </div></section>` : '';

  main.innerHTML = `<div class="page">
    <h1 class="hello">${esc(saludo())}${nombre ? ', ' + esc(nombre.split(' ')[0]) : ''}</h1>
    <p class="hello-sub">${!delDia.length && !pedidos.length ? 'Hoy no hay viandas programadas ni pedidos cargados.'
      : r.pendientes || rp.pendientes ? `Faltan entregar ${[r.pendientes && `<b>${plural(r.pendientes, 'vianda')}</b> de packs`, rp.pendientes && `<b>${plural(rp.pendientes, 'pedido')}</b>`].filter(Boolean).join(' y ')}.` : 'Todo lo de hoy está registrado.'}</p>
    ${delDia.length || pedidos.length ? `<div class="kpis">
      <div class="kpi ${r.pendientes ? 'warn' : ''}"><b>${r.pendientes}</b><span>viandas de packs por entregar</span></div>
      <div class="kpi ${rp.pendientes ? 'warn' : ''}"><b>${rp.pendientes}</b><span>pedidos por entregar</span></div>
      <div class="kpi ok"><b>${r.entregadas + rp.viandasEntregadas}</b><span>entregadas hoy</span></div>
    </div>
    ${delDia.length ? `<div class="progress">${progresoHtml(r, { sinPendientes: true })}</div>` : ''}` : ''}

    <div class="hoy-grid">
      <div><div id="hoy-entregas">${bloques}</div>${bloquePedidos}
        ${!bloques && !bloquePedidos ? `<div class="clist"><div class="stub" style="margin:40px auto"><div class="ico">${icon('comanda', 20)}</div>
        <h2>Nada para entregar hoy</h2><p>Los clientes con días fijos aparecen solos. Para un pedido particular, cargalo en Comandas.</p>
        <button class="btn lg primary" id="nueva-comanda-vacio">${icon('plus', 14)} Nuevo pedido</button></div></div>` : ''}</div>

      <aside class="hoy-aside">
        ${sinSaldo.length || porVencer.length ? `<section class="tsec" id="sec-saldo">
          <h2>${icon('alerta', 14)} Créditos</h2>
          <div class="clist ${sinSaldo.length ? 'alert' : ''}">
            ${sinSaldo.map(c => irow(c, `<div class="s" style="color:var(--bad-ink);font-weight:500">${esc(textoSaldo(c))}${sinSaldoHoy.has(c.id) ? ' · recibe hoy' : ''}</div>`, accionesSaldo(c))).join('')}
            ${porVencer.map(c => { const d = diasQueCubre(c); return irow(c, `<div class="s" style="color:var(--warn-ink);font-weight:500">Quedan ${plural(saldoDe(c.id), 'crédito')}${d ? ` · alcanza ${plural(d, 'día')}` : ''}</div>`, accionesSaldo(c)); }).join('')}
          </div></section>` : ''}

        ${faltanHoy.length || bajos.length ? `<section class="tsec">
          <h2>${icon('stock', 14)} Stock para hoy <span class="sp"></span><button class="btn quiet" data-ir="stock">Ver stock</button></h2>
          <div class="clist ${faltanHoy.length ? 'alert' : ''}">
            ${faltanHoy.map(p => `<div class="irow click" data-ir="stock"><div class="t"><div class="n">${esc(p.nombre)}</div>
              <div class="s">Hacen falta ${fmtNum(necesita[p.id])} · hay ${fmtNum(p.stock)} ${esc(p.unidad)}</div></div><span class="why bad">faltan ${fmtNum(necesita[p.id] - p.stock)}</span></div>`).join('')}
            ${bajos.map(p => `<div class="irow click" data-ir="stock"><div class="t"><div class="n">${esc(p.nombre)}</div>
              <div class="s">Quedan ${fmtNum(p.stock)} ${esc(p.unidad)} · mínimo ${fmtNum(p.minimo)}</div></div><span class="why warn">bajo</span></div>`).join('')}
          </div></section>` : ''}

        <section class="tsec">
          <h2>${icon('reloj', 14)} Próximos días</h2>
          <div class="clist"><div class="flist">${Array.from({ length: 7 }, (_, i) => {
            const f = sumarDias(hoy, i), d = demandaDia(f);
            return `<div class="fl ${i === 0 ? 'today' : ''}"><span class="d">${esc(nombreDia(f))}</span><span class="muted">${plural(clientesDelDia(f).length, 'cliente')}</span><b>${d}</b></div>`;
          }).join('')}</div></div>
        </section>
      </aside>
    </div>
  </div>`;

  main.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => irA(b.dataset.ir)));
  main.querySelectorAll('[data-stop]').forEach(b => b.addEventListener('click', e => e.stopPropagation()));
  main.querySelectorAll('[data-pago]').forEach(b => b.addEventListener('click', () => dialogoPago(clientePorId(b.dataset.pago), refrescar)));
  main.querySelectorAll('.irow[data-cli]').forEach(row => row.addEventListener('click', () => { irA('clientes'); abrirCliente(row.dataset.cli); }));
  const nv = main.querySelector('#nueva-comanda-vacio'); if(nv) nv.addEventListener('click', () => abrirComanda(null, hoy, 'almuerzo'));
  main.querySelectorAll('details[data-plegado]').forEach(d => d.addEventListener('toggle', () => { if(d.open) hoyAbiertas.add(d.dataset.plegado); else hoyAbiertas.delete(d.dataset.plegado); }));
  bindEntregaRows(main.querySelector('#hoy-entregas'), hoy, refrescar, { deshacer: true });
  const hp = main.querySelector('#hoy-pedidos'); if(hp) bindPedidos(hp, hoy, refrescar);
}
