/* ============================================================
   PESTAÑAS: ENTREGAS (dueño y ayudante) y MI RUTA (cadete)
   Cada cliente programado para el día, agrupado por cadete y en el
   orden del recorrido. Cada turno se marca Entregado o No se entregó;
   tocar el estado activo lo vuelve a "sin marcar".
============================================================= */
let entregaFecha = todayStr();
let entregaCadete = 'todos';      // 'todos' | id de cadete | 'sin'
let entregaVer = 'todos';         // 'todos' | 'pendientes'
let entregaBusqueda = '';
let entregaExtras = false;        // mostrar también clientes activos no programados ese día

/* Se trabaja con una sola unidad por día, "menú del día" (se guarda como el turno almuerzo).
   La cena queda solo para datos anteriores que la tengan cargada. */
const TURNO_LABEL = { almuerzo: 'Menú del día', cena: 'Cena' };
const TURNO_CORTO = { almuerzo: 'Menús', cena: 'Cena' };

function mealToggleHtml(c, fecha, turno){
  const e = getEntrega(c.id, fecha);
  const estado = e ? e[turno] : null;
  const editable = puedeRegistrarEn(fecha);
  const bloqueado = !cuentaComoVianda(estado) && !puedeEntregar(c, fecha, turno);
  const cant = viandasTurno(c, fecha, turno);
  return `<div class="meal">
    <span class="ml">${esc(TURNO_CORTO[turno])}${cant > 1 ? ` <small>×${cant}</small>` : ''}</span>
    <div class="meal-toggle mbtns ${estado || ''}" data-cliente="${c.id}" data-meal="${turno}" role="group" aria-label="${esc(TURNO_LABEL[turno])} de ${esc(c.nombre)}">
      <button class="mb si" data-v="entregado" aria-pressed="${estado === 'entregado'}" ${!editable || bloqueado ? 'disabled' : ''}
        title="${bloqueado ? 'Sin créditos: no se puede entregar' : 'Entregado'}" aria-label="Entregado">${icon('check', 16)}</button>
${state.versionBase >= 7 ? `      <button class="mb nr" data-v="no_recibido" aria-pressed="${estado === 'no_recibido'}" ${!editable || bloqueado ? 'disabled' : ''} title="No lo recibió: cuenta como vianda" aria-label="No lo recibió">${icon('x', 15)}</button>` : ''}
      <button class="mb no" data-v="saltado" aria-pressed="${estado === 'saltado'}" ${!editable ? 'disabled' : ''} title="Saltear: no recibe y no usa crédito" aria-label="Saltear">${icon('saltear', 15)}</button>
    </div></div>`;
}

/* columnas: turnos que aparecen en la lista, para que Almuerzo y Cena queden alineados entre filas. */
function entregaRowHtml(c, fecha, numero, columnas){
  const turnos = turnosDe(c, fecha);
  const cols = columnas || turnos;
  const pendiente = clientePendiente(c, fecha);
  const sinSaldo = turnos.some(t => turnoPendiente(c, fecha, t) && !puedeEntregar(c, fecha, t));
  const est = estadoSaldo(c);
  const k = cadetePorId(cadeteDelDia(c, fecha));
  const sub = [c.direccion || 'Sin dirección cargada', c.referencia, c.tipo === 'empresa' && c.empresaNombre ? c.empresaNombre : ''].filter(Boolean).join(' · ');
  return `<div class="erow ${pendiente ? '' : 'done'}" data-row="${c.id}">
    ${numero != null ? `<span class="ord" style="--c:${k ? k.color : 'var(--text-3)'}">${numero}</span>` : ''}
    <div class="t" data-abrir="${c.id}" role="button" tabindex="0" title="Ver datos de entrega">
      <div class="n"><span>${esc(c.nombre)}</span>
        ${est !== 'ok' && est !== 'na' && !esCadete() ? `<span class="tag ${est}">${esc(textoSaldo(c))}</span>` : est === 'warn' ? `<span class="tag warn">${esc(textoSaldo(c))}</span>` : ''}
        ${c.notas ? `<span class="tag plain" title="${esc(c.notas)}">Nota</span>` : ''}</div>
      <div class="s">${esc(sub)}</div>
      <div class="s menus">${turnos.map(t => (turnos.length > 1 ? TURNO_LABEL[t] + ': ' : '') + esc(textoVianda(c, fecha, t))).join(' · ')}</div>
      ${sinSaldo ? `<div class="s warnline">Sin créditos: no entregar hasta que pague.${esDueno() ? ' Cargá el pago desde su ficha.' : ' Avisale al dueño.'}</div>` : ''}
    </div>
    <div class="meals">${cols.map(t => turnos.includes(t) ? mealToggleHtml(c, fecha, t) : `<div class="meal ph" aria-hidden="true"><span class="ml">${TURNO_LABEL[t]}</span><div class="mbtns"><span class="mb"></span><span class="mb"></span></div></div>`).join('')}</div>
  </div>`;
}

/* Maneja los clicks de los botones de turno y de la ficha dentro de un contenedor. */
/* opciones.deshacer: después de marcar, aviso con botón "Deshacer" (en Hoy la fila cambia de lugar). */
function bindEntregaRows(cont, fecha, alCambiar, opciones = {}){
  cont.querySelectorAll('.meal-toggle .mb').forEach(b => b.addEventListener('click', async () => {
    const grupo = b.closest('.meal-toggle');
    const c = clientePorId(grupo.dataset.cliente);
    const turno = grupo.dataset.meal;
    const e = getEntrega(c.id, fecha);
    const actual = e ? e[turno] : null;
    const nuevo = actual === b.dataset.v ? null : b.dataset.v;
    grupo.classList.add('busy');
    try{
      await marcarEntrega(c, fecha, turno, nuevo);
      const aviso = cuentaComoVianda(nuevo) && usaCreditos(c) && estadoSaldo(c) !== 'ok' && !esCadete()
        ? ` ${saldoDe(c.id) <= 0 ? 'Se quedó sin créditos.' : `Le quedan ${plural(saldoDe(c.id), 'crédito')}.`}` : '';
      if(opciones.deshacer){
        const que = { entregado: 'entregado', no_recibido: 'no lo recibió (cuenta como vianda)', saltado: 'salteada, no usa crédito' }[nuevo] || 'sin marcar';
        toast(`<b>${esc(c.nombre)}</b> · ${TURNO_LABEL[turno].toLowerCase()}: ${que}.${aviso}`, aviso ? 'info' : 'ok', null, {
          label: 'Deshacer',
          fn: async () => {
            try{ await marcarEntrega(c, fecha, turno, actual); alCambiar(); }
            catch(err){ toastError('No se pudo deshacer', err); }
          }
        });
      }else if(aviso) toast(`<b>${esc(c.nombre)}</b>:${aviso}`, 'info');
    }catch(err){ toastError('No se pudo guardar la entrega', err); }
    grupo.classList.remove('busy');
    alCambiar();
  }));
  cont.querySelectorAll('[data-abrir]').forEach(el => {
    const abrir = () => abrirFichaEntrega(clientePorId(el.dataset.abrir), fecha);
    el.addEventListener('click', abrir);
    el.addEventListener('keydown', ev => { if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); abrir(); } });
  });
}

function progresoHtml(r, { sinPendientes = false } = {}){
  const nr = r.noRecibidas || 0;
  const tot = Math.max(r.esperadas, r.entregadas + nr + r.saltadas, 1);
  return `<div class="meter" role="img" aria-label="${r.entregadas} de ${r.esperadas} viandas entregadas">
      <i class="ok" style="width:${(r.entregadas / tot * 100).toFixed(1)}%"></i><i class="nr" style="width:${(nr / tot * 100).toFixed(1)}%"></i><i class="skip" style="width:${(r.saltadas / tot * 100).toFixed(1)}%"></i></div>
    <span class="pl"><b>${r.entregadas}</b> de ${r.esperadas} viandas entregadas</span>
    ${nr ? `<span class="pl" style="color:var(--bad-ink)">${nr} no ${nr === 1 ? 'la recibió' : 'las recibieron'}</span>` : ''}
    ${r.saltadas ? `<span class="pl" style="color:var(--skip-ink)">${plural(r.saltadas, 'salteada')}</span>` : ''}
    ${sinPendientes ? '' : `<span class="pl">${r.pendientes} pendientes</span>`}`;
}

/* Ficha rápida para entregar: dirección, cómo llegar, contacto, notas. */
function abrirFichaEntrega(c, fecha){
  if(!c) return;
  const k = cadetePorId(cadeteDelDia(c, fecha));
  const wa = waLink(c.telefono, '');
  abrirPanel({
    titulo: `${icon('entregas', 14)} Entrega · ${esc(nombreDia(fecha))}`,
    html: `<h2 class="ptitle">${esc(c.nombre)}</h2>
      <p class="psub">${esc(c.tipo === 'empresa' && c.empresaNombre ? c.empresaNombre : c.tipo === 'pack' ? 'Pack de viandas' : c.tipo === 'empresa' ? 'Empresa' : 'Casual')}</p>
      <div class="psec"><h3>Entrega</h3><dl class="props">
        <dt>Dirección</dt><dd>${c.direccion ? esc(c.direccion) : '<span class="muted">Sin dirección cargada</span>'}</dd>
        ${c.referencia ? `<dt>Referencia</dt><dd>${esc(c.referencia)}</dd>` : ''}
        ${turnosDe(c, fecha).map(t => `<dt>${turnosDe(c, fecha).length > 1 ? TURNO_LABEL[t] : 'Lleva'}</dt><dd>${esc(textoVianda(c, fecha, t))}</dd>`).join('')}
        ${pedidoDe(c.id, fecha) ? `<dt>Pedido</dt><dd>${esc(textoMenus(c, fecha))} ${estadoPedidoTag(pedidoDe(c.id, fecha))}
          ${puedeEditarComandas(fecha) ? `<button class="btn quiet" data-editar-comanda="almuerzo">${icon('editar', 12)} Ver</button>` : ''}</dd>` : ''}
        <dt>Cadete</dt><dd>${k ? `<span class="dot" style="--c:${k.color}"></span>${esc(k.nombre)}` : '<span class="muted">Sin asignar</span>'}</dd>
        ${!esCadete() ? `<dt>Créditos</dt><dd><span class="saldo ${estadoSaldo(c)}">${esc(textoSaldo(c))}</span></dd>` : ''}
        ${c.telefono ? `<dt>Teléfono</dt><dd>${esc(c.telefono)}</dd>` : ''}
        ${c.notas ? `<dt>Notas</dt><dd>${esc(c.notas)}</dd>` : ''}
      </dl>
      <div class="pacts" style="border:0">
        ${c.direccion || tieneUbicacion(c) ? `<a class="btn lg primary" href="${mapsNavegar(c)}" target="_blank" rel="noopener">${icon('nav', 14)} Cómo llegar</a>` : ''}
        ${c.telefono ? `<a class="btn lg" href="${telLink(c.telefono)}">${icon('tel', 14)} Llamar</a>` : ''}
        ${wa ? `<a class="btn lg" href="${wa}" target="_blank" rel="noopener">${icon('wa', 14)} WhatsApp</a>` : ''}
        ${!esCadete() ? `<button class="btn lg" id="ficha-completa">${icon('clientes', 14)} Ficha del cliente</button>` : ''}
      </div></div>
      ${tieneUbicacion(c) ? '<div class="psec"><h3>Mapa</h3><div class="minimap" id="ficha-mapa" style="height:320px"></div></div>' : ''}`,
    onMount: async (el) => {
      const b = el.querySelector('#ficha-completa');
      if(b) b.addEventListener('click', () => { irA('clientes'); abrirCliente(c.id); });
      el.querySelectorAll('[data-editar-comanda]').forEach(x => x.addEventListener('click', () => abrirComanda(c, fecha, x.dataset.editarComanda)));
      const m = el.querySelector('#ficha-mapa');
      if(m){
        try{ await cargarLeaflet(); const map = crearMapa(m, c); map.setView([c.lat, c.lng], 16);
             window.L.marker([c.lat, c.lng], { icon: pinIcono('', k ? k.color : '#E2792B') }).addTo(map); }
        catch(_){ m.innerHTML = '<div class="empty">No se pudo cargar el mapa.</div>'; }
      }
    }
  });
}

function renderEntregas(bar, main){
  const hoy = todayStr();
  bar.innerHTML = `<h1>Entregas</h1>
    <div class="dayctl">
      <button class="iconbtn" id="dia-ant" aria-label="Día anterior" title="Día anterior">${icon('chevL')}</button>
      <input type="date" class="inp" id="f-fecha" value="${entregaFecha}" aria-label="Fecha de entrega">
      <button class="iconbtn" id="dia-sig" aria-label="Día siguiente" title="Día siguiente">${icon('chevR')}</button>
      ${entregaFecha !== hoy ? `<button class="btn quiet" id="dia-hoy">Hoy</button>` : ''}
    </div>
    <span class="muted">${esc(formatFechaLarga(entregaFecha))}</span>
    <div class="sp"></div>
    <input class="inp sm search-inp" id="e-buscar" placeholder="Buscar cliente" aria-label="Buscar cliente" style="width:170px" value="${esc(entregaBusqueda)}">
    ${state.cadetes.length ? `<select class="inp sm" id="e-cadete" aria-label="Cadete" style="width:auto">
      <option value="todos">Todos los cadetes</option>
      ${state.cadetes.map(k => `<option value="${k.id}" ${entregaCadete === k.id ? 'selected' : ''}>${esc(k.nombre)}</option>`).join('')}
      <option value="sin" ${entregaCadete === 'sin' ? 'selected' : ''}>Sin cadete</option></select>` : ''}
    <div class="seg" role="group" aria-label="Mostrar">
      <button data-ver="todos" aria-pressed="${entregaVer === 'todos'}">Todos</button>
      <button data-ver="pendientes" aria-pressed="${entregaVer === 'pendientes'}">Pendientes</button>
    </div>`;

  main.innerHTML = `
    ${!puedeRegistrarEn(entregaFecha) ? `<div class="banner">${icon('info', 14)} Solo lectura: tu usuario registra únicamente las entregas de hoy.</div>` : ''}
    <div class="sticky-prog" id="e-prog"></div>
    <div class="list" id="e-lista"><div style="padding:16px"><div class="skel" style="width:60%"></div></div></div>`;

  const cambiarFecha = async (f) => {
    entregaFecha = f || todayStr();
    render();
    try{ if(await asegurarFecha(entregaFecha)) refrescar(); }catch(e){ toastError('No se pudieron traer las entregas de ese día', e); }
  };
  bar.querySelector('#f-fecha').addEventListener('change', e => cambiarFecha(e.target.value));
  bar.querySelector('#dia-ant').addEventListener('click', () => cambiarFecha(sumarDias(entregaFecha, -1)));
  bar.querySelector('#dia-sig').addEventListener('click', () => cambiarFecha(sumarDias(entregaFecha, 1)));
  const bh = bar.querySelector('#dia-hoy'); if(bh) bh.addEventListener('click', () => cambiarFecha(todayStr()));
  bar.querySelector('#e-buscar').addEventListener('input', e => { entregaBusqueda = e.target.value; pintar(); });
  const sc = bar.querySelector('#e-cadete'); if(sc) sc.addEventListener('change', e => { entregaCadete = e.target.value; pintar(); });
  bar.querySelectorAll('[data-ver]').forEach(b => b.addEventListener('click', () => { entregaVer = b.dataset.ver; render(); }));

  function pintar(){
    const f = entregaFecha;
    const q = entregaBusqueda.trim().toLowerCase();
    let lista = clientesDelDia(f, entregaExtras);
    if(entregaCadete !== 'todos') lista = lista.filter(c => (cadeteDelDia(c, f) || 'sin') === entregaCadete);
    if(q) lista = lista.filter(c => (c.nombre + ' ' + c.direccion + ' ' + c.empresaNombre).toLowerCase().includes(q));
    const visibles = entregaVer === 'pendientes' ? lista.filter(c => clientePendiente(c, f)) : lista;
    document.getElementById('e-prog').innerHTML = progresoHtml(resumenDia(f, lista));

    const ids = new Set(visibles.map(c => c.id));
    const grupos = [];
    for(const k of state.cadetes){
      const paradas = paradasDe(k.id, f).filter(c => ids.has(c.id));
      if(paradas.length) grupos.push({ k, paradas });
    }
    const sinCadete = paradasDe(null, f).filter(c => ids.has(c.id));
    if(sinCadete.length) grupos.push({ k: null, paradas: sinCadete });
    const vistos = new Set(grupos.flatMap(g => g.paradas.map(c => c.id)));
    const resto = visibles.filter(c => !vistos.has(c.id));     // no programados (extras)
    if(resto.length) grupos.push({ k: null, paradas: resto, extras: true });

    const columnas = ['almuerzo', 'cena'].filter(t => visibles.some(c => turnosDe(c, f).includes(t)));
    const cont = document.getElementById('e-lista');
    if(!lista.length){
      cont.innerHTML = `<div class="stub"><div class="ico">${icon('entregas', 20)}</div>
        <h2>${state.clientes.length ? 'No hay entregas programadas' : 'Todavía no hay clientes'}</h2>
        <p>${state.clientes.length ? `Ningún cliente activo recibe viandas el ${DIAS_LARGOS[diaSemana(f) - 1]}${q || entregaCadete !== 'todos' ? ' con estos filtros' : ''}.` : 'Sumá clientes desde la pestaña Clientes, con sus días y cantidades.'}</p>
        ${state.clientes.length && !entregaExtras ? `<button class="btn lg" id="ver-extras">Mostrar todos los clientes activos</button>` : ''}</div>`;
    }else if(!visibles.length){
      cont.innerHTML = `<div class="calm">${icon('check')} Todo registrado para ${esc(nombreDia(f).toLowerCase())}.</div>`;
    }else{
      cont.innerHTML = grupos.map(g => {
        const r = resumenDia(f, g.paradas);
        const tramos = g.k ? mapsRecorrido(cocina(), g.paradas.filter(c => clientePendiente(c, f))) : [];
        return `<div class="ghead">
            ${g.k ? `<span class="dot" style="--c:${g.k.color}"></span>` : ''}
            <span class="gname">${g.extras ? 'No programados' : g.k ? esc(g.k.nombre) : 'Sin cadete asignado'}</span>
            <span class="gcount">${r.entregadas}/${r.esperadas || '—'} viandas</span><span class="gsp"></span>
            ${tramos.length ? `<a class="btn quiet" href="${tramos[0].url}" target="_blank" rel="noopener" title="Abrir lo pendiente en Google Maps">${icon('nav', 13)} Recorrido</a>` : ''}
          </div>` + g.paradas.map((c, i) => entregaRowHtml(c, f, g.k && !g.extras ? i + 1 : null, columnas)).join('');
      }).join('') + (!entregaExtras ? `<button class="more" id="ver-extras">Mostrar también clientes no programados</button>` :
                                      `<button class="more" id="ocultar-extras">Ocultar clientes no programados</button>`);
    }
    const ve = document.getElementById('ver-extras'); if(ve) ve.addEventListener('click', () => { entregaExtras = true; pintar(); });
    const oe = document.getElementById('ocultar-extras'); if(oe) oe.addEventListener('click', () => { entregaExtras = false; pintar(); });
    bindEntregaRows(cont, f, () => { pintar(); renderMenu(); });
  }
  pintar();
}

/* ---------- vista del cadete ---------- */
let miRutaMapa = true;
function renderMiRuta(bar, main){
  const hoy = todayStr();
  const k = cadetePorId(state.perfil.cadeteId);
  bar.innerHTML = `<h1>Mi ruta</h1><span class="muted">${esc(formatFechaLarga(hoy))}</span><div class="sp"></div>
    <button class="btn ${miRutaMapa ? 'on' : ''}" id="btn-mapa">${icon('mapa', 14)} Mapa</button>`;
  bar.querySelector('#btn-mapa').addEventListener('click', () => { miRutaMapa = !miRutaMapa; render(); });
  if(!k){
    main.innerHTML = `<div class="stub"><div class="ico">${icon('moto', 20)}</div><h2>Tu usuario no está vinculado a un cadete</h2>
      <p>Pedile al dueño que te asigne en Equipo → Usuarios.</p></div>`;
    return;
  }
  const paradas = paradasDe(k.id, hoy);
  main.innerHTML = `
    ${miRutaMapa && paradas.some(tieneUbicacion) ? '<div class="myroute-map"><div class="map" id="mr-mapa"></div></div>' : ''}
    <div class="sticky-prog" id="mr-prog"></div>
    <div class="gacts" id="mr-acts"></div>
    <div class="list" id="mr-lista"></div>`;

  let mapa = null, capa = null;
  function dibujarMapa(){
    const el = document.getElementById('mr-mapa');
    if(!el || !window.L) return;
    if(!mapa) mapa = crearMapa(el, cocina());
    if(capa) capa.remove();
    capa = window.L.layerGroup().addTo(mapa);
    const pts = [];
    if(tieneUbicacion(cocina())){ window.L.marker([cocina().lat, cocina().lng], { icon: pinIcono('C', '#241F17', 'home') }).addTo(capa); pts.push([cocina().lat, cocina().lng]); }
    paradas.forEach((c, i) => {
      if(!tieneUbicacion(c)) return;
      window.L.marker([c.lat, c.lng], { icon: pinIcono(String(i + 1), k.color, clientePendiente(c, hoy) ? '' : 'done') })
        .addTo(capa).bindPopup(`<b>${esc(c.nombre)}</b><br>${esc(c.direccion)}`);
      pts.push([c.lat, c.lng]);
    });
    if(pts.length > 1) window.L.polyline(pts, { color: k.color, weight: 3, opacity: .75 }).addTo(capa);
    if(pts.length) mapa.fitBounds(pts, { padding: [28, 28], maxZoom: 16 });
  }
  function pintar(){
    document.getElementById('mr-prog').innerHTML = progresoHtml(resumenDia(hoy, paradas));
    const pendientes = paradas.filter(c => clientePendiente(c, hoy));
    const tramos = mapsRecorrido(cocina(), pendientes);
    document.getElementById('mr-acts').innerHTML = pendientes.length
      ? tramos.map((t, i) => `<a class="btn lg primary" href="${t.url}" target="_blank" rel="noopener">${icon('nav', 14)} ${tramos.length > 1 ? `Tramo ${i + 1} (paradas ${t.desde}–${t.hasta})` : 'Abrir recorrido en Google Maps'}</a>`).join('')
        + (pendientes.some(c => !tieneUbicacion(c)) ? `<span class="muted" style="align-self:center">Algunas paradas no tienen ubicación en el mapa.</span>` : '')
      : `<span class="calm" style="padding:4px 0">${icon('check')} ${paradas.length ? 'Terminaste la ruta de hoy.' : 'Hoy no tenés entregas asignadas.'}</span>`;
    const cont = document.getElementById('mr-lista');
    const columnas = ['almuerzo', 'cena'].filter(t => paradas.some(c => turnosDe(c, hoy).includes(t)));
    cont.innerHTML = paradas.length ? paradas.map((c, i) => entregaRowHtml(c, hoy, i + 1, columnas)).join('')
      : `<div class="stub"><div class="ico">${icon('moto', 20)}</div><h2>Sin entregas para hoy</h2><p>Cuando te asignen clientes van a aparecer acá, en orden de recorrido.</p></div>`;
    bindEntregaRows(cont, hoy, () => { pintar(); dibujarMapa(); });
  }
  pintar();
  if(document.getElementById('mr-mapa')) cargarLeaflet().then(dibujarMapa).catch(() => {
    const el = document.getElementById('mr-mapa'); if(el) el.innerHTML = '<div class="empty">No se pudo cargar el mapa.</div>';
  });
}
