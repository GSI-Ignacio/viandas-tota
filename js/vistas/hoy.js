/* ============================================================
   PESTAÑA: HOY — qué hay que entregar hoy
   Dos cosas distintas: las viandas de los packs y clientes fijos (cada
   una descuenta un crédito) y los pedidos particulares de la carta.
   Lo pendiente arriba con sus botones; lo ya registrado queda plegado.
   A la derecha lo que requiere atención: créditos, stock y próximos días.
============================================================= */
/* Lo ya registrado va en una línea: estado, qué se entregó y un botón para volverlo a pendiente.
   estado: 'ok' (entregado), 'nr' (no lo recibió: cuenta igual), 'skip' (salteado: ese día no recibe)
   o 'bad' (pedido cancelado). */
function filaHechaHtml({ estado, nombre, detalle, etiqueta, abrir, toggle }){
  const ico = { ok: 'check', nr: 'x', skip: 'saltear', bad: 'x' }[estado], fila = { ok: 'done', nr: 'done nr', skip: 'skip', bad: 'skip cancel' }[estado];
  return `<div class="trow hecha ${fila}" ${abrir.fila}>
    <span class="est ${estado}" aria-hidden="true">${icon(ico, 13)}</span>
    <div class="t" ${abrir.attr} role="button" tabindex="0" title="${abrir.title}">
      <div class="n1"><b>${esc(nombre)}</b><span> · ${detalle}</span></div></div>
    <span class="tag ${{ nr: 'bad' }[estado] || estado}">${etiqueta}</span>
    ${toggle}
  </div>`;
}
const botonDeshacer = () => `<button class="mb" data-deshacer title="Volver a pendiente" aria-label="Deshacer: volver a pendiente">${icon('deshacer', 14)}<span class="lbl">Deshacer</span></button>`;

function filaTurnoHtml(c, fecha, turno){
  const e = getEntrega(c.id, fecha);
  const estado = e ? e[turno] : null;
  const editable = puedeRegistrarEn(fecha);
  const nombreVianda = menuPorId(c.menuAlmuerzoId) ? menuPorId(c.menuAlmuerzoId).nombre : 'vianda';
  if(estado === 'entregado' || estado === 'no_recibido' || estado === 'saltado'){
    const ok = estado === 'entregado';
    return filaHechaHtml({ estado: { entregado: 'ok', no_recibido: 'nr', saltado: 'skip' }[estado], nombre: c.nombre,
      detalle: `${viandasTurno(c, fecha, turno)}× ${esc(nombreVianda)} · ${esc(TIPO_LABEL[c.tipo] || '')}`,
      etiqueta: { entregado: 'Entregado', no_recibido: 'No lo recibió · usó crédito', saltado: 'Salteado · no usó crédito' }[estado],
      abrir: { fila: `data-row="${c.id}" data-turno-row="${turno}"`, attr: `data-abrir="${c.id}"`, title: 'Ver la ficha de la entrega' },
      toggle: editable ? `<div class="meal-toggle deshacer ${estado}" data-cliente="${c.id}" data-meal="${turno}">${botonDeshacer().replace('data-deshacer', `data-v="${estado}"`)}</div>` : '' });
  }
  const bloqueado = !cuentaComoVianda(estado) && !puedeEntregar(c, fecha, turno);
  const est = estadoSaldo(c);
  const dir = [c.direccion || 'Sin dirección cargada', c.referencia].filter(Boolean).join(' · ');
  return `<div class="trow ${estado === 'entregado' ? 'done' : estado === 'saltado' ? 'skip' : ''}" data-row="${c.id}" data-turno-row="${turno}">
    <div class="t" data-abrir="${c.id}" role="button" tabindex="0" title="Ver cómo llegar y la comanda">
      <div class="n">${esc(c.nombre)}
        ${est === 'bad' || est === 'warn' || est === 'debe' ? `<span class="tag ${est}">${esc(textoSaldo(c))}</span>` : ''}
        ${c.notas ? `<span class="tag plain" title="${esc(c.notas)}">${esc(c.notas.length > 28 ? c.notas.slice(0, 26) + '…' : c.notas)}</span>` : ''}</div>
      <div class="que"><b>${viandasTurno(c, fecha, turno)}×</b> ${esc(nombreVianda)} <span class="muted">· ${esc(TIPO_LABEL[c.tipo] || '')}</span></div>
      <div class="s">${esc(dir)}</div>
      ${bloqueado ? `<div class="s warnline">Sin créditos: no entregar hasta que pague.${esDueno() ? ' Cargá el pago desde su ficha.' : ' Avisale al dueño.'}</div>` : ''}
    </div>
    <div class="meal-toggle mbtns lg ${estado || ''}" data-cliente="${c.id}" data-meal="${turno}" role="group" aria-label="${esc(TURNO_LABEL[turno])} de ${esc(c.nombre)}">
      <button class="mb si" data-v="entregado" aria-pressed="${estado === 'entregado'}" ${!editable || bloqueado ? 'disabled' : ''}
        title="${bloqueado ? 'Sin créditos: no se puede entregar' : 'Entregado'}" aria-label="Entregado">${icon('check', 16)}<span class="lbl">Entregado</span></button>
${state.versionBase >= 7 ? `      <button class="mb nr" data-v="no_recibido" aria-pressed="${estado === 'no_recibido'}" ${!editable || bloqueado ? 'disabled' : ''}
        title="${bloqueado ? 'Sin créditos' : 'No lo recibió: el cadete fue y no estaba. Cuenta como vianda (usa crédito y stock)'}" aria-label="No lo recibió">${icon('x', 15)}<span class="lbl">No recibió</span></button>` : ''}
      <button class="mb no" data-v="saltado" aria-pressed="${estado === 'saltado'}" ${!editable ? 'disabled' : ''} title="Saltear hoy: no recibe la vianda y no usa crédito" aria-label="Saltear hoy">${icon('saltear', 15)}<span class="lbl">Saltear</span></button>
    </div>
  </div>`;
}

/* Pack sin créditos en Hoy: no se entrega; se renueva, se le avisa o se saltea el día. */
function filaSinCreditoHtml(c, fecha, turno){
  const wa = waLink(c.telefono, mensajeRecordatorio(c));
  return `<div class="trow sincred" data-row="${c.id}" data-turno-row="${turno}">
    <div class="t" data-abrir="${c.id}" role="button" tabindex="0" title="Ver la ficha de la entrega">
      <div class="n">${esc(c.nombre)} <span class="tag bad">${esc(textoSaldo(c))}</span></div>
      <div class="que"><b>${viandasTurno(c, fecha, turno)}×</b> vianda <span class="muted">· ${esc(TIPO_LABEL[c.tipo] || '')}</span></div>
      <div class="s">${esc(textoAviso(c))}</div>
    </div>
    <div class="acts">
      ${esDueno() ? `<button class="btn primary" type="button" data-ren-renovar="${c.id}">${icon('pago', 13)}<span class="lbl"> Renovar</span></button>` : ''}
      ${wa ? `<a class="btn" href="${wa}" target="_blank" rel="noopener" data-ren-avisar="${c.id}" title="Avisarle por WhatsApp">${icon('wa', 13)}<span class="lbl"> Avisar</span></a>` : ''}
      <div class="meal-toggle deshacer" data-cliente="${c.id}" data-meal="${turno}"><button class="mb" data-v="saltado" title="Saltear hoy: no recibe y no usa crédito">${icon('saltear', 14)}<span class="lbl">Saltear</span></button></div>
    </div>
  </div>`;
}

const hoyPlegadas = new Set();   // "Ya registradas" que se plegaron a mano: se respetan al actualizar

function renderHoy(bar, main){
  const hoy = todayStr();
  const r = resumenDia(hoy);
  const delDia = clientesDelDia(hoy);
  // a cuenta: lo que deben en viandas fijas y en plata de pedidos (v10)
  const deben = [...new Set([...clientesQueDeben(), ...clientesDebenPedidos()])];
  const necesita = necesidadProductos(hoy, { soloPendiente: true });
  const negativos = productosNegativos();
  const faltanHoy = state.productos.filter(p => p.activo && p.stock >= 0 && necesita[p.id] > p.stock);
  const bajos = productosBajos().filter(p => p.stock >= 0 && !faltanHoy.includes(p));
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

  // cada bloque: resumen arriba, lo que falta entregar en su tarjeta y lo ya registrado en otra
  const chipsHtml = (chips) => `<div class="echips">${chips.filter(x => x.siempre || x.n).map(x =>
    `<span class="echip ${x.cls} ${x.n ? '' : 'cero'}"><i></i><b>${x.n}</b>${esc(x.label)}</span>`).join('')}</div>`;
  const bloque = ({ titulo, id, attrs = '', chips, nPend, pendHtml, vacio, extraHtml, hechasTitulo, nHechas, hechasHtml, clave }) => `
    <section class="tsec bloque-dia ${id === 'hoy-pedidos' ? 'pd' : 'pk'}" style="margin-top:0;margin-bottom:26px" ${id ? `id="${id}"` : ''} ${attrs}>
      <h2>${titulo}</h2>
      ${chipsHtml(chips)}
      <div class="clist lista-dia">
        <div class="lhead pend"><i></i>Falta entregar <span class="n">${nPend}</span></div>
        ${pendHtml || `<div class="calm">${icon('check')} ${vacio}</div>`}
      </div>
      ${extraHtml || ''}
      ${nHechas ? `<details class="clist lista-dia hechas2" data-plegado="${clave}" ${hoyPlegadas.has(clave) ? '' : 'open'}>
        <summary class="lhead">${icon('chevD', 12)} ${hechasTitulo} <span class="n">${nHechas}</span></summary>
        ${hechasHtml}</details>` : ''}
    </section>`;

  const bloques = ['almuerzo', 'cena'].map(t => {
    const lista = delDia.filter(c => turnosDe(c, hoy).includes(t));
    if(!lista.length) return '';
    const pendTodos = lista.filter(c => turnoPendiente(c, hoy, t));
    const sinCred = pendTodos.filter(c => !puedeEntregar(c, hoy, t));   // packs sin créditos: no se entregan
    const pend = pendTodos.filter(c => !sinCred.includes(c));
    const hechas = lista.filter(c => !turnoPendiente(c, hoy, t));
    const estH = (c) => (getEntrega(c.id, hoy) || {})[t];
    const v = (cs) => cs.reduce((s, c) => s + viandasTurno(c, hoy, t), 0);
    // primero lo entregado, después lo que no recibieron y al final lo salteado
    const orden = { entregado: 0, no_recibido: 1, saltado: 2 };
    hechas.sort((a, b) => orden[estH(a)] - orden[estH(b)] || a.nombre.localeCompare(b.nombre, 'es'));
    return bloque({
      titulo: t === 'almuerzo' ? `${icon('entregas', 15)} Viandas de packs y fijos` : `${icon('luna', 15)} Cena`,
      attrs: `data-turno="${t}"`,
      chips: [
        { cls: 'pend', n: v(pend), label: 'por entregar', siempre: true },
        { cls: 'bad', n: v(sinCred), label: 'sin créditos' },
        { cls: 'ok', n: v(hechas.filter(c => estH(c) === 'entregado')), label: 'entregadas', siempre: true },
        { cls: 'nr', n: v(hechas.filter(c => estH(c) === 'no_recibido')), label: 'no las recibieron', siempre: state.versionBase >= 7 },
        { cls: 'skip', n: v(hechas.filter(c => estH(c) === 'saltado')), label: 'salteadas', siempre: true }
      ],
      nPend: plural(pend.length, 'cliente'), pendHtml: pend.map(c => filaTurnoHtml(c, hoy, t)).join(''), vacio: 'No queda nada por entregar.',
      extraHtml: sinCred.length ? `<div class="clist lista-dia sin-cred">
          <div class="lhead bad"><i></i>Sin créditos · no entregar <span class="n">${plural(sinCred.length, 'cliente')}</span></div>
          ${sinCred.map(c => filaSinCreditoHtml(c, hoy, t)).join('')}</div>` : '',
      hechasTitulo: 'Ya registradas hoy', nHechas: hechas.length ? plural(hechas.length, 'cliente') : 0,
      hechasHtml: hechas.map(c => filaTurnoHtml(c, hoy, t)).join(''), clave: t
    });
  }).join('');

  // pedidos particulares (comandas): aparte de los packs
  const pedPend = pedidos.filter(p => p.estado === 'pendiente'), pedHechos = pedidos.filter(p => p.estado !== 'pendiente');
  pedHechos.sort((a, b) => (a.estado === 'entregada' ? 0 : 1) - (b.estado === 'entregada' ? 0 : 1));
  const bloquePedidos = pedidos.length ? bloque({
    titulo: `${icon('comanda', 15)} Pedidos`, id: 'hoy-pedidos',
    chips: [
      { cls: 'pend', n: pedPend.length, label: `por entregar${rp.viandasPendientes ? ` · ${plural(rp.viandasPendientes, 'plato')}` : ''}`, siempre: true },
      { cls: 'ok', n: pedHechos.filter(p => p.estado === 'entregada').length, label: 'entregados', siempre: true },
      { cls: 'bad', n: pedHechos.filter(p => p.estado === 'cancelada').length, label: 'cancelados' }
    ],
    nPend: plural(pedPend.length, 'pedido'), pendHtml: pedPend.map(p => filaPedidoHtml(p, hoy)).join(''), vacio: 'No quedan pedidos por entregar.',
    hechasTitulo: 'Ya registrados hoy', nHechas: pedHechos.length ? plural(pedHechos.length, 'pedido') : 0,
    hechasHtml: pedHechos.map(p => filaPedidoHtml(p, hoy)).join(''), clave: 'pedidos'
  }) : '';

  main.innerHTML = `<div class="page">
    ${delDia.length ? `<div class="progress" style="margin-top:0">${progresoHtml(r, { sinPendientes: true })}</div>` : ''}

    <div class="hoy-grid">
      <div><div id="hoy-entregas">${bloques}</div>${bloquePedidos}
        ${!bloques && !bloquePedidos ? `<div class="clist"><div class="stub" style="margin:40px auto"><div class="ico">${icon('comanda', 20)}</div>
        <h2>Nada para entregar hoy</h2><p>Los clientes con días fijos aparecen solos. Para un pedido particular, cargalo en Comandas.</p>
        <button class="btn lg primary" id="nueva-comanda-vacio">${icon('plus', 14)} Nuevo pedido</button></div></div>` : ''}</div>

      <aside class="hoy-aside">
        ${seccionCartaDiaHtml(hoy)}
        ${seccionRenovarHtml()}

        ${deben.length ? `<section class="tsec" id="sec-cobrar">
          <h2>${icon('pago', 14)} A cobrar a fin de semana <span class="n">sanatorios y empresas</span></h2>
          <div class="clist debe">
            ${deben.map(c => {
              const k = cuentaPedidosDe(c), debePed = k && k.saldo > 0, debeV = saldoDe(c.id) < 0;
              const txt = [debePed && textoCuentaPedidos(c), debeV && `debe ${plural(-saldoDe(c.id), 'vianda')} fijas`].filter(Boolean).join(' · ');
              return irow(c, `<div class="s" style="color:var(--skip-ink);font-weight:500">${esc(txt.replace(/^./, x => x.toUpperCase()))}</div>`,
                (debePed ? `<button class="btn" data-resumen="${c.id}" data-stop title="Resumen de la semana">${icon('lista', 13)}</button>` : '')
                + (esDueno() ? `<button class="btn" ${debePed ? `data-pago-ped="${c.id}"` : `data-pago="${c.id}"`} data-stop>${icon('pago', 13)} Pago</button>` : ''));
            }).join('')}
          </div></section>` : ''}

        ${negativos.length || faltanHoy.length || bajos.length ? `<section class="tsec">
          <h2>${icon('stock', 14)} Stock para hoy <span class="sp"></span><button class="btn quiet" data-ir="stock">Ver stock</button></h2>
          <div class="clist ${negativos.length || faltanHoy.length ? 'alert' : ''}">
            ${negativos.map(p => `<div class="irow click neg" data-ir="stock"><div class="t"><div class="n">${esc(p.nombre)}</div>
              <div class="s" style="color:var(--bad-ink)">Stock en negativo: ${fmtNum(p.stock)} ${esc(p.unidad)}</div></div><span class="why bad">${fmtNum(p.stock)}</span></div>`).join('')}
            ${faltanHoy.map(p => `<div class="irow click" data-ir="stock"><div class="t"><div class="n">${esc(p.nombre)}</div>
              <div class="s">Hacen falta ${fmtNum(necesita[p.id])} · hay ${fmtNum(p.stock)} ${esc(p.unidad)}</div></div><span class="why bad">faltan ${fmtNum(necesita[p.id] - p.stock)}</span></div>`).join('')}
            ${bajos.map(p => `<div class="irow click" data-ir="stock"><div class="t"><div class="n">${esc(p.nombre)}</div>
              <div class="s">Quedan ${fmtNum(p.stock)} ${esc(p.unidad)} · mínimo ${fmtNum(p.minimo)}</div></div><span class="why warn">bajo</span></div>`).join('')}
          </div></section>` : ''}

        <section class="tsec">
          <h2>${icon('reloj', 14)} Próximos días</h2>
          <div class="clist"><div class="flist">${Array.from({ length: 7 }, (_, i) => {
            const f = sumarDias(hoy, i), d = demandaDia(f);
            return `<div class="fl click ${i === 0 ? 'today' : ''}" data-dia="${f}" role="button" tabindex="0" title="Ver la entrega de ese día"><span class="d">${esc(nombreDia(f))}</span><span class="muted">${plural(clientesDelDia(f).length, 'cliente')}</span><b>${d}</b>${icon('chevR', 13)}</div>`;
          }).join('')}</div></div>
        </section>
      </aside>
    </div>
  </div>`;

  main.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => irA(b.dataset.ir)));
  bindCartaDia(main);
  bindRenovar(main, refrescar);
  main.querySelectorAll('[data-dia]').forEach(el => {
    el.addEventListener('click', () => abrirDiaEntrega(el.dataset.dia));
    el.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); abrirDiaEntrega(el.dataset.dia); } });
  });
  main.querySelectorAll('[data-stop]').forEach(b => b.addEventListener('click', e => e.stopPropagation()));
  main.querySelectorAll('[data-pago-ped]').forEach(b => b.addEventListener('click', () => dialogoPagoPedidos(clientePorId(b.dataset.pagoPed), refrescar)));
  main.querySelectorAll('[data-resumen]').forEach(b => b.addEventListener('click', () => abrirResumenSemana(clientePorId(b.dataset.resumen))));
  main.querySelectorAll('[data-pago]').forEach(b => b.addEventListener('click', () => dialogoPago(clientePorId(b.dataset.pago), refrescar)));
  main.querySelectorAll('.irow[data-cli]').forEach(row => row.addEventListener('click', () => { irA('clientes'); abrirCliente(row.dataset.cli); }));
  const nv = main.querySelector('#nueva-comanda-vacio'); if(nv) nv.addEventListener('click', () => abrirComanda(null, hoy, 'almuerzo'));
  main.querySelectorAll('details[data-plegado]').forEach(d => d.addEventListener('toggle', () => { if(d.open) hoyPlegadas.delete(d.dataset.plegado); else hoyPlegadas.add(d.dataset.plegado); }));
  bindEntregaRows(main.querySelector('#hoy-entregas'), hoy, refrescar, { deshacer: true });
  const hp = main.querySelector('#hoy-pedidos'); if(hp) bindPedidos(hp, hoy, refrescar);
}

/* ---------- cómo viene la entrega de un día (desde "Próximos días") ---------- */
async function abrirDiaEntrega(fecha){
  try{ if(!state.fechasCargadas.has(fecha)) await asegurarFecha(fecha); }catch(e){ toastError('No se pudo cargar ese día', e); return; }
  const hoy = todayStr();
  const ESTADO = { entregado: ['ok', 'Entregado'], no_recibido: ['bad', 'No lo recibió'], saltado: ['skip', 'Salteado'] };
  const filas = [];
  let vPacks = 0, sinCred = 0;
  for(const c of clientesDelDia(fecha)){
    for(const t of turnosDe(c, fecha)){
      const n = viandasTurno(c, fecha, t), e = getEntrega(c.id, fecha), est = e && e[t];
      const falta = usaCreditos(c) && !cuentaComoVianda(est) && est !== 'saltado' && saldoProyectado(c, fecha) < n;
      if(est !== 'saltado') vPacks += n;
      if(falta) sinCred++;
      filas.push({ c, n, est, falta });
    }
  }
  filas.sort((a, b) => (b.falta - a.falta) || a.c.nombre.localeCompare(b.c.nombre, 'es'));
  const pedidos = pedidosDelDia(fecha).filter(p => p.estado !== 'cancelada');
  const platos = pedidos.reduce((s, p) => s + p.viandas, 0);
  const menus = menusDelDia(fecha);
  const filaPack = ({ c, n, est, falta }) => {
    const m = menuPorId(c.menuAlmuerzoId);
    const etiqueta = est ? `<span class="tag ${ESTADO[est][0]}">${ESTADO[est][1]}</span>`
      : falta ? `<span class="tag bad" title="Con lo que va a recibir hasta ese día, no le alcanzan los créditos">Sin créditos ese día</span>`
      : modoPago(c) === 'cuenta' ? '<span class="tag debe">A cuenta</span>' : '';
    return `<div class="dia-row" data-dia-cli="${c.id}" role="button" tabindex="0">
      <div class="t"><div class="n">${esc(c.nombre)}</div>
        <div class="s"><b>${n}×</b> ${esc(m ? m.nombre : 'vianda')} · ${esc(TIPO_LABEL[c.tipo] || '')}${c.direccion ? ' · ' + esc(c.direccion) : ''}</div></div>
      ${etiqueta}</div>`;
  };
  const filaPedido = (p) => { const c = clientePorId(p.clienteId);
    return `<div class="dia-row" data-dia-cli="${c.id}" role="button" tabindex="0">
      <div class="t"><div class="n">${esc(c.nombre)}</div><div class="s">${p.lineas.map(l => `<b>${l.cantidad}×</b> ${esc(textoLinea(l))}`).join(' · ')}</div></div>
      ${p.total != null ? `<b class="dia-plata">${fmtPlata(p.total)}</b>` : ''}${p.estado === 'entregada' ? '<span class="tag ok">Entregado</span>' : ''}</div>`; };

  abrirPanel({
    titulo: `${icon('reloj', 14)} Entrega del día`,
    ancho: 'medio',
    html: `<div class="md-nav">
        <button class="iconbtn" type="button" data-dia-ir="-1" aria-label="Día anterior" title="Día anterior">${icon('chevL', 15)}</button>
        <b>${esc(nombreDia(fecha))}</b><span class="muted">${esc(formatFechaLarga(fecha).replace(/^./, x => x.toUpperCase()))}</span>
        <button class="iconbtn" type="button" data-dia-ir="1" aria-label="Día siguiente" title="Día siguiente">${icon('chevR', 15)}</button>
      </div>
      <div class="echips">
        <span class="echip pk ${vPacks ? '' : 'cero'}"><i></i><b>${vPacks}</b>viandas de packs</span>
        <span class="echip pd ${platos ? '' : 'cero'}"><i></i><b>${platos}</b>platos de pedidos</span>
        ${sinCred ? `<span class="echip bad"><i></i><b>${sinCred}</b>sin créditos ese día</span>` : ''}
      </div>
      <p class="dia-menu">${icon('menu', 14)} ${menus.length ? `Menú del día: <b>${menus.map(m => esc(m.nombre)).join(' · ')}</b>` : '<span class="muted">Todavía no se eligió el menú de este día.</span>'}</p>
      <div class="psec" style="margin-top:14px"><h3>Packs y fijos <span class="n">${plural(filas.length, 'entrega')}</span></h3>
        <div class="clist">${filas.length ? filas.map(filaPack).join('') : `<div class="calm">${icon('check')} No hay viandas de packs programadas.</div>`}</div>
        ${sinCred ? `<p class="muted" style="font-size:13px;margin:8px 2px 0">"Sin créditos ese día": con lo que va a recibir hasta entonces no le alcanza.${state.versionBase >= 11 ? ' Se le entrega igual y queda debiendo;' : ''} conviene renovarle el pack antes.</p>` : ''}</div>
      <div class="psec"><h3>Pedidos <span class="n">${plural(pedidos.length, 'pedido')}</span></h3>
        <div class="clist">${pedidos.length ? pedidos.map(filaPedido).join('') : `<div class="calm">${icon('comanda')} Todavía no hay pedidos cargados para este día.</div>`}</div></div>`,
    pie: `${puedeEditarComandas(fecha) ? `<button class="btn lg" id="dia-pedido">${icon('plus', 14)} Nuevo pedido para este día</button>` : ''}<span class="sp"></span>
      <button class="btn lg primary" id="dia-cerrar">Listo</button>`,
    onMount: (el) => {
      el.querySelector('#dia-cerrar').addEventListener('click', () => cerrarPanel());
      el.querySelectorAll('[data-dia-ir]').forEach(b => b.addEventListener('click', () => abrirDiaEntrega(sumarDias(fecha, Number(b.dataset.diaIr)))));
      const np = el.querySelector('#dia-pedido'); if(np) np.addEventListener('click', () => abrirComanda(null, fecha, 'almuerzo'));
      el.querySelectorAll('[data-dia-cli]').forEach(r => {
        const abrir = () => { irA('clientes'); abrirCliente(r.dataset.diaCli); };
        r.addEventListener('click', abrir);
        r.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); abrir(); } });
      });
    }
  });
}
