/* ============================================================
   PESTAÑA: ESTADÍSTICAS — cómo viene el negocio en un período
   Viandas entregadas (packs y pedidos), ingresos, clientes, platos más
   pedidos, días de más trabajo, créditos por entregar y stock más usado.
   Los números de arriba se comparan con el período anterior del mismo largo.
============================================================= */
let estPeriodo = '30';
const EST_PERIODOS = [['7', '7 días'], ['30', '30 días'], ['mes', 'Este mes'], ['90', '3 meses']];
const estCache = {};   // "desde|hasta" → { act, ant }: al volver a la pestaña se muestra enseguida y se actualiza atrás

const diasEntreFechas = (a, b) => Math.round((parseFecha(b) - parseFecha(a)) / 864e5);
function rangoEst(p){
  const hoy = todayStr();
  const desde = p === 'mes' ? hoy.slice(0, 8) + '01' : sumarDias(hoy, -(Number(p) - 1));
  const largo = diasEntreFechas(desde, hoy) + 1;
  return { desde, hasta: hoy, antDesde: sumarDias(desde, -largo), antHasta: sumarDias(desde, -1), largo };
}

async function traerEstadisticas(desde, hasta){
  const [entregas, comandas, pagos, movs] = await Promise.all([
    traerTodo(() => sb.from('entregas').select('*').gte('fecha', desde).lte('fecha', hasta)),
    traerTodo(() => sb.from('comandas').select('*').gte('fecha', desde).lte('fecha', hasta)),
    traerTodo(() => sb.from('pagos').select('*').gte('fecha', desde).lte('fecha', hasta)),
    traerTodo(() => sb.from('movimientos').select('*').eq('tipo', 'entrega').gte('fecha', desde).lte('fecha', hasta))
  ]);
  return { entregas, comandas, pagos, movs };
}

function calcularEst(d, desde, hasta){
  const dias = [];
  for(let f = desde; f <= hasta; f = sumarDias(f, 1)) dias.push(f);
  const porDia = Object.fromEntries(dias.map(f => [f, { packs: 0, pedidos: 0 }]));
  const porCliente = {}, porMenu = {}, porTipo = {}, porProd = {};
  const cli = (id) => porCliente[id] || (porCliente[id] = { viandas: 0, plata: 0 });
  let packs = 0, saltadas = 0, noRecibidas = 0, platos = 0, ventas = 0;
  const pedidos = new Set(), cancelados = new Set();
  for(const r of d.entregas){
    const n = consumoEntrega(mapEntrega(r));
    packs += n; cli(r.cliente_id).viandas += n;
    if(porDia[r.fecha]) porDia[r.fecha].packs += n;
    saltadas += (r.almuerzo === 'saltado' ? 1 : 0) + (r.cena === 'saltado' ? 1 : 0);
    noRecibidas += (r.almuerzo === 'no_recibido' ? (r.cant_almuerzo ?? 1) : 0) + (r.cena === 'no_recibido' ? (r.cant_cena ?? 1) : 0);
  }
  for(const r of d.comandas){
    const k = r.cliente_id + '|' + r.fecha;
    if(r.estado === 'cancelada'){ cancelados.add(k); continue; }
    if(r.estado !== 'entregada') continue;
    pedidos.add(k);
    const m = menuPorId(r.menu_id);
    const precio = r.precio != null ? Number(r.precio) : (m ? m.precio : null);
    const valor = precio != null ? precio * r.cantidad : 0;
    platos += r.cantidad; ventas += valor;
    if(porDia[r.fecha]) porDia[r.fecha].pedidos += r.cantidad;
    const c = cli(r.cliente_id); c.viandas += r.cantidad; c.plata += valor;
    const pm = porMenu[r.menu_id || '-'] || (porMenu[r.menu_id || '-'] = { cant: 0, plata: 0 });
    pm.cant += r.cantidad; pm.plata += valor;
  }
  for(const [id, v] of Object.entries(porCliente)){
    const c = clientePorId(id), t = c ? c.tipo : 'casual';
    porTipo[t] = (porTipo[t] || 0) + v.viandas;
  }
  for(const m of d.movs) porProd[m.producto_id] = (porProd[m.producto_id] || 0) - Number(m.cantidad);
  const sem = Array.from({ length: 7 }, () => ({ suma: 0, dias: 0 }));
  for(const f of dias){ const w = diaSemana(f) - 1; sem[w].suma += porDia[f].packs + porDia[f].pedidos; sem[w].dias++; }
  const creditos = d.pagos.reduce((s, p) => s + Math.max(0, Number(p.viandas) || 0), 0);
  const cobrado = d.pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const total = packs + platos;
  return { dias, porDia, porCliente, porMenu, porTipo, porProd, sem, total, packs, platos, ventas, creditos, cobrado,
    ingresos: ventas + cobrado, pedidos: pedidos.size, cancelados: cancelados.size, saltadas, noRecibidas,
    activos: Object.values(porCliente).filter(v => v.viandas > 0).length, promedio: dias.length ? total / dias.length : 0 };
}

function renderEstadisticas(bar, main){
  const periodo = estPeriodo, r = rangoEst(periodo), clave = `${r.desde}|${r.hasta}`;
  bar.innerHTML = `<h1>Estadísticas</h1>
    <div class="seg" role="group" aria-label="Período">${EST_PERIODOS.map(([k, l]) =>
      `<button data-p="${k}" aria-pressed="${periodo === k}">${l}</button>`).join('')}</div>
    <span class="muted">${esc(formatFechaMedia(r.desde))} – ${esc(formatFechaMedia(r.hasta))}</span>`;
  bar.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => { estPeriodo = b.dataset.p; render(); }));

  const pintar = () => {
    const c = estCache[clave];
    if(!c || !main.isConnected) return;
    main.innerHTML = htmlEstadisticas(c.act, c.ant, r);
    bindEstadisticas(main);
  };
  if(estCache[clave]) pintar();
  else main.innerHTML = `<div class="page"><div class="boot" style="min-height:52vh"><div>${LOADER_HTML}<span class="boot-txt">Calculando…</span></div></div></div>`;
  (async () => {
    try{
      const [a, b] = await Promise.all([traerEstadisticas(r.desde, r.hasta), traerEstadisticas(r.antDesde, r.antHasta)]);
      const nuevo = { act: calcularEst(a, r.desde, r.hasta), ant: calcularEst(b, r.antDesde, r.antHasta) };
      const cambio = !estCache[clave] || JSON.stringify(estCache[clave].act) !== JSON.stringify(nuevo.act);
      estCache[clave] = nuevo;
      if(cambio && activeTab === 'estadisticas' && estPeriodo === periodo) pintar();
    }catch(err){
      if(!estCache[clave] && activeTab === 'estadisticas') main.innerHTML = `<div class="page"><div class="stub"><div class="ico">${icon('alerta', 20)}</div>
        <h2>No se pudieron calcular</h2><p>${esc(traducirError(err.message || String(err)))}</p></div></div>`;
    }
  })();
}

/* +12% en verde, −4% en rojo; sin comparación si el período anterior está vacío */
function deltaHtml(a, b, { invertir = false } = {}){
  if(!b) return a ? '<span class="delta nuevo">nuevo</span>' : '';
  const pct = Math.round((a - b) / b * 100);
  if(!pct) return '<span class="delta">=</span>';
  const bueno = invertir ? pct < 0 : pct > 0;
  return `<span class="delta ${bueno ? 'up' : 'down'}">${pct > 0 ? '+' : '−'}${Math.abs(pct)}%</span>`;
}
const fmtUno = (n) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 });

function htmlEstadisticas(a, b, r){
  const hayDatos = a.total || a.creditos || a.cancelados || a.saltadas;
  const kpi = (l, v, delta, sub) => `<div class="est-kpi"><div class="l">${l}</div><div class="v"><b>${v}</b>${delta}</div><div class="s">${sub}</div></div>`;

  // viandas por día
  const max = Math.max(1, ...a.dias.map(f => a.porDia[f].packs + a.porDia[f].pedidos));
  const paso = Math.ceil(a.dias.length / 7);
  const barras = a.dias.map((f, i) => {
    const x = a.porDia[f], t = x.packs + x.pedidos;
    return `<div class="ec-col ${t ? '' : 'vacio'} ${f === todayStr() ? 'hoy' : ''}" data-f="${f}" data-pk="${x.packs}" data-pd="${x.pedidos}">
      <div class="ec-stack" style="height:${t ? Math.max(3, t / max * 100) : 0}%">${x.pedidos ? `<i class="pd" style="flex:${x.pedidos}"></i>` : ''}${x.packs ? `<i class="pk" style="flex:${x.packs}"></i>` : ''}</div>
      <span class="ec-lbl">${i % paso === 0 || i === a.dias.length - 1 ? esc(parseFecha(f).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })) : ''}</span></div>`;
  }).join('');

  // listas
  const lista = (filas, vacio) => filas.length ? `<div class="est-top">${filas.map(x => `<div class="et-row">
      <div class="et-n"><span>${esc(x.n)}</span><b>${x.v}</b></div>
      <div class="et-bar"><i style="width:${Math.max(3, x.p * 100)}%"></i></div>${x.s ? `<div class="et-s">${x.s}</div>` : ''}</div>`).join('')}</div>`
    : `<div class="est-vacio">${vacio}</div>`;
  const menus = Object.entries(a.porMenu).sort((x, y) => y[1].cant - x[1].cant).slice(0, 5);
  const maxM = menus.length ? menus[0][1].cant : 1;
  const topMenus = menus.map(([id, v]) => ({ n: menuPorId(id) ? menuPorId(id).nombre : 'Vianda sin menú', v: fmtNum(v.cant), p: v.cant / maxM, s: v.plata ? fmtPlata(v.plata) : '' }));
  const clis = Object.entries(a.porCliente).filter(([, v]) => v.viandas > 0).sort((x, y) => y[1].viandas - x[1].viandas).slice(0, 5);
  const maxC = clis.length ? clis[0][1].viandas : 1;
  const topClientes = clis.map(([id, v]) => { const c = clientePorId(id);
    return { n: c ? c.nombre : 'Cliente borrado', v: fmtNum(v.viandas), p: v.viandas / maxC, s: [c && TIPO_LABEL[c.tipo], v.plata ? fmtPlata(v.plata) + ' en pedidos' : ''].filter(Boolean).join(' · ') }; });
  const prods = Object.entries(a.porProd).filter(([, q]) => q > 0).sort((x, y) => y[1] - x[1]).slice(0, 5);
  const maxP = prods.length ? prods[0][1] : 1;
  const topProds = prods.map(([id, q]) => { const p = state.productos.find(x => x.id === id);
    return { n: p ? p.nombre : 'Producto borrado', v: `${fmtNum(q)} <small>${esc(p ? p.unidad : '')}</small>`, p: q / maxP }; });

  // días de la semana (promedio)
  const nombresDia = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const prom = a.sem.map(x => x.dias ? x.suma / x.dias : 0), maxS = Math.max(1, ...prom);
  const mejor = prom.indexOf(Math.max(...prom));
  const semana = `<div class="est-sem">${prom.map((v, i) => `<div class="es-col ${i === mejor && v ? 'top' : ''}" title="${nombresDia[i]}: ${fmtUno(v)} viandas por día en promedio">
      <span class="es-v">${v ? fmtUno(v) : '—'}</span><div class="es-bar"><i style="height:${v ? Math.max(4, v / maxS * 100) : 0}%"></i></div><span class="es-d">${nombresDia[i]}</span></div>`).join('')}</div>`;

  // tipos de cliente
  const TIPOS_COL = { empresa: 'var(--accent)', pack: 'var(--pack)', sanatorio: 'var(--pine)', casual: '#FFC53D' };
  const tipos = Object.entries(a.porTipo).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
  const totTipos = tipos.reduce((s, [, v]) => s + v, 0) || 1;
  const bloqueTipos = tipos.length ? `<div class="est-segbar">${tipos.map(([t, v]) => `<i style="flex:${v};background:${TIPOS_COL[t] || 'var(--text-4)'}" title="${esc(TIPO_LABEL[t] || t)}: ${v}"></i>`).join('')}</div>
      <div class="est-leyenda">${tipos.map(([t, v]) => `<div><span class="lg"><i style="background:${TIPOS_COL[t] || 'var(--text-4)'}"></i>${esc(TIPO_LABEL[t] || t)}</span>
        <b>${fmtNum(v)}</b><small>${Math.round(v / totTipos * 100)}%</small></div>`).join('')}</div>`
    : '<div class="est-vacio">Todavía no hay entregas en este período.</div>';

  // créditos: lo que ya está pago y falta entregar (hoy, no depende del período)
  const porEntregar = clientesActivos().reduce((s, c) => s + Math.max(0, saldoDe(c.id)), 0);
  const sinSaldo = clientesSinSaldo().length, porVencer = clientesPorVencer().length;

  return `<div class="page est-page">
    ${hayDatos ? '' : `<div class="banner" style="border:1px solid var(--line);border-radius:12px;margin-bottom:18px">${icon('info', 14)} Todavía no hay movimiento en este período. Los números se van a ir llenando con cada entrega, pedido y pago.</div>`}
    <div class="est-kpis">
      ${kpi('Viandas entregadas', fmtNum(a.total), deltaHtml(a.total, b.total), `${fmtNum(a.packs)} de packs · ${fmtNum(a.platos)} de pedidos`)}
      ${kpi('Ingresos', fmtPlata(a.ingresos) || '$ 0', deltaHtml(a.ingresos, b.ingresos), `${fmtPlata(a.cobrado) || '$ 0'} en créditos · ${fmtPlata(a.ventas) || '$ 0'} en pedidos`)}
      ${kpi('Promedio por día', fmtUno(a.promedio), deltaHtml(a.promedio, b.promedio), `viandas por día en ${plural(a.dias.length, 'día')}`)}
      ${kpi('Clientes atendidos', fmtNum(a.activos), deltaHtml(a.activos, b.activos), `de ${plural(clientesActivos().length, 'cliente activo', 'clientes activos')}`)}
    </div>

    <section class="est-card est-chart-card">
      <div class="ec-head"><h3>Viandas por día</h3>
        <span class="ec-leg"><span><i class="pk"></i>Packs</span><span><i class="pd"></i>Pedidos</span></span>
        <span class="sp"></span>
        <span class="muted">${a.noRecibidas ? `<span style="color:var(--bad-ink)">${a.noRecibidas} no ${a.noRecibidas === 1 ? 'la recibió' : 'las recibieron'} (cobradas)</span> · ` : ''}${a.saltadas ? `<span style="color:var(--skip-ink)">${plural(a.saltadas, 'vianda salteada', 'viandas salteadas')}</span> · ` : ''}${plural(a.pedidos, 'pedido entregado', 'pedidos entregados')}${a.cancelados ? ` · ${plural(a.cancelados, 'cancelado')}` : ''}</span></div>
      <div class="est-chart" data-chart>
        <div class="ec-grid"><span>${fmtNum(max)}</span><span>${fmtNum(Math.round(max / 2))}</span><span>0</span></div>
        <div class="ec-bars">${barras}</div>
        <div class="ec-tip" hidden></div>
      </div>
    </section>

    <div class="est-grid">
      <section class="est-card"><h3>Platos más pedidos <span class="n">pedidos entregados</span></h3>${lista(topMenus, 'Todavía no hay pedidos entregados en este período.')}</section>
      <section class="est-card"><h3>Mejores clientes <span class="n">viandas recibidas</span></h3>${lista(topClientes, 'Todavía no hay entregas en este período.')}</section>
      <section class="est-card"><h3>Días de más trabajo <span class="n">promedio por día</span></h3>${semana}
        ${prom[mejor] ? `<p class="est-nota">El día más cargado es el <b>${['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][mejor]}</b>, con ${fmtUno(prom[mejor])} viandas en promedio.</p>` : ''}</section>
      <section class="est-card"><h3>Tipos de cliente <span class="n">viandas por tipo</span></h3>${bloqueTipos}</section>
      <section class="est-card"><h3>Créditos <span class="n">al día de hoy</span></h3>
        <div class="est-big"><b>${fmtNum(porEntregar)}</b><span>viandas ya pagas por entregar</span></div>
        <div class="est-mini">
          <div><span>Vendidos en el período</span><b>${fmtNum(a.creditos)}</b>${deltaHtml(a.creditos, b.creditos)}</div>
          <div><span>Clientes sin créditos</span><b class="${sinSaldo ? 'bad' : ''}">${sinSaldo}</b></div>
          <div><span>Por quedarse sin créditos</span><b class="${porVencer ? 'warn' : ''}">${porVencer}</b></div>
        </div></section>
      <section class="est-card"><h3>Stock más usado <span class="n">en el período</span></h3>${lista(topProds, 'Todavía no salió stock en este período.')}</section>
    </div>
  </div>`;
}

function bindEstadisticas(main){
  const ch = main.querySelector('[data-chart]');
  if(!ch) return;
  const tip = ch.querySelector('.ec-tip');
  ch.querySelectorAll('.ec-col').forEach(col => {
    col.addEventListener('mouseenter', () => {
      const pk = Number(col.dataset.pk), pd = Number(col.dataset.pd);
      tip.innerHTML = `<div class="t">${esc(formatFechaMedia(col.dataset.f))}</div>
        <div><span><i class="pk"></i>Packs</span><b>${fmtNum(pk)}</b></div><div><span><i class="pd"></i>Pedidos</span><b>${fmtNum(pd)}</b></div>`;
      tip.hidden = false;
      const x = col.offsetLeft + col.offsetWidth / 2, w = tip.offsetWidth, W = ch.clientWidth;
      tip.style.left = Math.max(0, Math.min(W - w, x - w / 2)) + 'px';
    });
    col.addEventListener('mouseleave', () => { tip.hidden = true; });
  });
}
