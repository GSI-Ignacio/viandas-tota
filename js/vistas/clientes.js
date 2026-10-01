/* ============================================================
   PESTAÑA: CLIENTES — lista y ficha (datos, entrega, ubicación, saldo)
============================================================= */
let clienteBusqueda = '';
let clienteTipo = 'todos';        // todos | empresa | casual | pack
let clienteEstado = 'activos';    // activos | pausados | sin-saldo | por-vencer | todos
let clienteAbierto = null;

const TIPO_LABEL = { empresa: 'Empresa', casual: 'Casual', pack: 'Pack de dietas', sanatorio: 'Sanatorio' };
const TIPOS = ['casual', 'empresa', 'pack', 'sanatorio'];
const CREDITOS_POR_DEFECTO = 10;   // lo que se propone al cargar un pago y al dar de alta un pack de dietas
// al alta solo los packs arrancan con créditos: casuales, empresas y sanatorios pagan sus pedidos aparte
const creditosAlAlta = (tipo) => tipo === 'pack' ? CREDITOS_POR_DEFECTO : 0;
function tipoTag(c){ return `<span class="tag ${c.tipo === 'empresa' ? 'pine' : c.tipo === 'pack' ? 'warn' : c.tipo === 'sanatorio' ? 'ok' : 'plain'}">${TIPO_LABEL[c.tipo] || 'Casual'}</span>`; }
function daychipsHtml(dias){ return `<span class="daychips" aria-label="Días: ${dias.map(d => DIAS_LARGOS[d - 1]).join(', ')}">${DIAS_CORTOS.map((l, i) => `<i class="${dias.includes(i + 1) ? 'on' : ''}">${l}</i>`).join('')}</span>`; }
function llevaTxt(c){
  const n = viandasPorDia(c);
  return n ? `${plural(n, 'menú', 'menús')} por día` : '—';
}

function filtrarClientes(){
  const q = clienteBusqueda.trim().toLowerCase();
  return state.clientes.filter(c => {
    if(clienteTipo !== 'todos' && c.tipo !== clienteTipo) return false;
    if(clienteEstado === 'activos' && !c.activo) return false;
    if(clienteEstado === 'pausados' && c.activo) return false;
    if(clienteEstado === 'sin-saldo' && !(c.activo && usaCreditos(c) && saldoDe(c.id) <= 0)) return false;
    if(clienteEstado === 'deben' && !(modoPago(c) === 'cuenta' && saldoDe(c.id) < 0)) return false;
    if(clienteEstado === 'por-vencer' && !(c.activo && estadoSaldo(c) === 'warn')) return false;
    if(q && !(c.nombre + ' ' + c.empresaNombre + ' ' + c.direccion + ' ' + c.telefono).toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderClientes(bar, main){
  const activos = clientesActivos().length;
  bar.innerHTML = `<h1>Clientes</h1><span class="muted">${activos} activos · ${state.clientes.length} en total</span><div class="sp"></div>
    <input class="inp sm search-inp" id="buscador" placeholder="Buscar por nombre, empresa o dirección" aria-label="Buscar clientes" style="width:250px" value="${esc(clienteBusqueda)}">
    <div class="seg" role="group" aria-label="Tipo">${['todos', ...TIPOS].map(t =>
      `<button class="chip" data-f="${t}" aria-pressed="${clienteTipo === t}">${t === 'todos' ? 'Todos' : TIPO_LABEL[t]}</button>`).join('')}</div>
    <select class="inp sm" id="c-estado" aria-label="Estado" style="width:auto">
      ${[['activos', 'Activos'], ['sin-saldo', 'Packs sin créditos'], ['por-vencer', 'Packs por quedarse sin créditos'], ['deben', 'Sanatorio / empresa: a cobrar'], ['pausados', 'Pausados'], ['todos', 'Todos']].map(([v, l]) =>
        `<option value="${v}" ${clienteEstado === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    <button class="btn" id="ver-renovar">${icon('pago', 14)} Packs por renovar</button>
    ${esDueno() ? `<button class="btn primary" id="nuevo-cliente">${icon('plus', 14)} Nuevo cliente</button>` : ''}`;

  main.innerHTML = `<div class="tablewrap"><table class="ptable resp">
      <thead><tr><th>Cliente</th><th>Dirección</th><th>Días</th><th>Lleva</th><th>Cadete</th><th class="r">Créditos</th></tr></thead>
      <tbody id="c-tbody"></tbody></table></div>
    <div class="mcards" id="c-cards"></div>`;

  bar.querySelector('#buscador').addEventListener('input', e => { clienteBusqueda = e.target.value; pintar(); });
  bar.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => {
    clienteTipo = b.dataset.f;
    bar.querySelectorAll('[data-f]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    pintar();
  }));
  bar.querySelector('#c-estado').addEventListener('change', e => { clienteEstado = e.target.value; pintar(); });
  const nb = bar.querySelector('#nuevo-cliente'); if(nb) nb.addEventListener('click', () => abrirCliente(null));
  bar.querySelector('#ver-renovar').addEventListener('click', () => abrirRenovaciones());

  function pintar(){
    const lista = filtrarClientes();
    const tbody = document.getElementById('c-tbody'), cards = document.getElementById('c-cards');
    if(!lista.length){
      const vacio = `<div class="stub" style="margin-top:8vh"><div class="ico">${icon('clientes', 20)}</div>
        <h2>${state.clientes.length ? 'Ningún cliente coincide' : 'Todavía no hay clientes'}</h2>
        <p>${state.clientes.length ? 'Probá con otra búsqueda o cambiá los filtros.' : 'Cargá el primero con su dirección, días de entrega y créditos.'}</p>
        ${!state.clientes.length && esDueno() ? `<button class="btn lg primary" id="primer-cliente">${icon('plus', 14)} Nuevo cliente</button>` : ''}</div>`;
      tbody.innerHTML = `<tr><td colspan="6" style="height:auto;border:0">${vacio}</td></tr>`;
      cards.innerHTML = vacio;
      main.querySelectorAll('#primer-cliente').forEach(b => b.addEventListener('click', () => abrirCliente(null)));
      return;
    }
    tbody.innerHTML = lista.map(c => {
      const k = cadetePorId(c.cadeteId);
      return `<tr class="click ${c.activo ? '' : 'off'} ${clienteAbierto === c.id ? 'opened' : ''}" data-id="${c.id}" tabindex="0">
        <td><div class="pwho">${avatarHtml(c.nombre, 26)}<div style="min-width:0"><div class="n">${esc(c.nombre)} ${c.activo ? '' : '<span class="tag plain">Pausado</span>'}</div>
          <div class="s">${c.tipo === 'empresa' && c.empresaNombre ? esc(c.empresaNombre) : TIPO_LABEL[c.tipo] || ''}</div></div></div></td>
        <td class="wrap">${c.direccion ? `<span style="display:inline-flex;gap:6px;align-items:center">${tieneUbicacion(c) ? icon('pin', 13) : ''}${esc(c.direccion)}</span>` : '<span class="muted">Sin dirección</span>'}</td>
        <td>${daychipsHtml(c.dias)}</td>
        <td>${llevaTxt(c)}</td>
        <td>${k ? `<span style="display:inline-flex;gap:6px;align-items:center"><span class="dot" style="--c:${k.color}"></span>${esc(k.nombre)}</span>` : '<span class="muted">—</span>'}</td>
        <td class="r">${estadoSaldo(c) === 'na' ? '<span class="muted">—</span>' : `<span class="saldo ${c.activo ? estadoSaldo(c) : ''}">${esc(textoSaldo(c))}</span>`}</td></tr>`;
    }).join('');
    cards.innerHTML = `<div class="list" style="padding-bottom:96px">` + lista.map(c => `<div class="row click ${clienteAbierto === c.id ? 'opened' : ''}" data-id="${c.id}" tabindex="0">
        ${avatarHtml(c.nombre, 28)}
        <div class="t"><div class="n">${esc(c.nombre)}</div><div class="s">${esc(c.direccion || 'Sin dirección')} · ${llevaTxt(c)}</div></div>
        ${!c.activo ? '<span class="saldo" style="font-size:13px">Pausado</span>' : estadoSaldo(c) === 'na' ? '' : `<span class="saldo ${estadoSaldo(c)}" style="font-size:13px;white-space:nowrap">${esc(textoSaldo(c))}</span>`}</div>`).join('') + '</div>';
    main.querySelectorAll('[data-id]').forEach(el => {
      el.addEventListener('click', () => abrirCliente(el.dataset.id));
      el.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); abrirCliente(el.dataset.id); } });
    });
  }
  pintar();
}

/* ---------- ajustar créditos: se escribe cuántos tiene que tener y se carga la diferencia ---------- */
function dialogoAjusteCreditos(c, alTerminar){
  const actual = saldoDe(c.id);
  dialogo({
    titulo: `Ajustar créditos · ${c.nombre}`,
    texto: `Ahora tiene <b>${plural(actual, 'crédito')}</b>. Escribí cuántos tiene que tener: la diferencia queda anotada como un ajuste en sus pagos.`,
    html: `<div class="field"><label for="f-aj-cant">Créditos que tiene que tener${REQ}</label>
        <input type="number" id="f-aj-cant" step="1" value="${actual}" autofocus style="font-size:20px;height:48px;font-weight:600"></div>
      <div class="aj-dif" id="f-aj-dif">Sin cambios.</div>
      <div class="field" style="margin-top:12px"><label for="f-aj-nota">Motivo (opcional)</label><input type="text" id="f-aj-nota" placeholder="Me equivoqué al cargar, devolución…"></div>`,
    botones: [{ id: 'cancelar', label: 'Cancelar' }, { id: 'ok', label: 'Guardar', clase: 'primary', domId: 'confirmar-ajuste' }],
    onMount: (el) => {
      const inp = el.querySelector('#f-aj-cant'), dif = el.querySelector('#f-aj-dif');
      const pintar = () => {
        const d = Math.trunc(Number(inp.value)) - actual;
        dif.className = 'aj-dif ' + (d > 0 ? 'mas' : d < 0 ? 'menos' : '');
        dif.innerHTML = inp.value === '' ? 'Escribí un número.' : !d ? 'Sin cambios.' : `Se ${d > 0 ? 'suman' : 'restan'} <b>${plural(Math.abs(d), 'crédito')}</b>: queda con ${plural(actual + d, 'crédito')}.`;
      };
      inp.addEventListener('input', pintar); inp.select && setTimeout(() => inp.select(), 40); pintar();
      el._validar = () => inp.value === '' ? marcarFalta(inp, 'Escribí cuántos créditos tiene que tener.') : true;
    }
  }).then(async (r) => {
    if(!r) return;
    const d = Math.trunc(Number(r.el.querySelector('#f-aj-cant').value)) - actual;
    if(!d) return;
    try{
      await registrarPago(c, { viandas: d, monto: null, nota: r.el.querySelector('#f-aj-nota').value.trim() || 'Ajuste de créditos', fecha: todayStr() });
      toast(`Créditos ajustados: <b>${esc(c.nombre)}</b> tiene ${esc(textoSaldo(c))}.`);
      renderMenu();
      if(alTerminar) alTerminar();
    }catch(e){ toastError('No se pudieron ajustar los créditos', e); }
  });
}

/* ---------- diálogo para cargar un pago, o corregir uno ya cargado ---------- */
function dialogoPago(c, alTerminar, pago, { renovar = false } = {}){
  if(!c) return;
  const corregir = !!pago;
  dialogo({
    titulo: corregir ? `Corregir pago · ${c.nombre}` : renovar ? `Renovar pack · ${c.nombre}` : `Cargar pago · ${c.nombre}`,
    texto: corregir
      ? `Cambiá lo que se cargó mal, o borrá el pago. Ahora tiene <b>${esc(textoSaldo(c))}</b>; los créditos se recalculan solos.`
      : modoPago(c) === 'cuenta'
        ? `${saldoDe(c.id) < 0 ? `Debe <b>${plural(-saldoDe(c.id), 'vianda')}</b>. ` : 'Está al día. '}El pago de la semana se descuenta de lo que debe (cada vianda es un crédito).`
        : `Tiene <b>${esc(textoSaldo(c))}</b>. Cada crédito es una vianda paga: se suman a los que tiene y cada vianda entregada descuenta uno.`,
    html: `<div class="frow">
        <div class="field"><label for="f-pago-viandas">Créditos (viandas pagas)${REQ}</label><input type="number" id="f-pago-viandas" step="1" value="${corregir ? pago.viandas : modoPago(c) === 'cuenta' ? Math.max(-saldoDe(c.id), 0) || '' : CREDITOS_POR_DEFECTO}" autofocus></div>
        <div class="field"><label for="f-pago-monto">Monto (opcional)</label><input type="number" id="f-pago-monto" min="0" step="1" placeholder="$" value="${corregir && pago.monto != null ? Number(pago.monto) : ''}"></div>
      </div>
      <div class="frow">
        <div class="field"><label for="f-pago-fecha">Fecha</label><input type="date" id="f-pago-fecha" value="${corregir ? pago.fecha : todayStr()}"></div>
        <div class="field"><label for="f-pago-nota">Nota (opcional)</label><input type="text" id="f-pago-nota" placeholder="Efectivo, transferencia…" value="${corregir ? esc(pago.nota || '') : renovar ? 'Renovación' : ''}"></div>
      </div>
      ${corregir ? '' : '<p class="muted" style="font-size:13px;margin:0">¿Te equivocaste en un pago? En la ficha, en "Créditos y pagos", tocá <b>Editar</b> en ese pago, o usá <b>Ajustar créditos</b>.</p>'}`,
    botones: corregir
      ? [{ id: 'borrar', label: 'Borrar pago', clase: 'danger', domId: 'borrar-pago' }, { id: 'cancelar', label: 'Cancelar' }, { id: 'ok', label: 'Guardar cambios', clase: 'primary', domId: 'confirmar-pago' }]
      : [{ id: 'cancelar', label: 'Cancelar' }, { id: 'ok', label: 'Guardar pago', clase: 'primary', domId: 'confirmar-pago' }],
    onMount: (el) => {
      el._validar = (boton) => {
        if(boton === 'borrar') return true;
        const v = Math.trunc(Number(el.querySelector('#f-pago-viandas').value));
        if(!v) return marcarFalta(el.querySelector('#f-pago-viandas'), corregir ? 'Poné los créditos, o tocá Borrar pago.' : 'Poné cuántos créditos (viandas) pagó.');
        return true;
      };
    }
  }).then(async (r) => {
    if(!r) return;
    const el = r.el;
    const datos = {
      viandas: Math.trunc(Number(el.querySelector('#f-pago-viandas').value)),
      monto: el.querySelector('#f-pago-monto').value,
      fecha: el.querySelector('#f-pago-fecha').value || todayStr(),
      nota: el.querySelector('#f-pago-nota').value.trim()
    };
    try{
      if(r.boton === 'borrar'){
        if(!(await confirmar('Borrar pago', `¿Borrar el pago de <b>${pago.viandas > 0 ? '+' : ''}${pago.viandas} créditos</b> del ${esc(formatFechaCorta(pago.fecha))}?`, { ok: 'Borrar pago', peligro: true }))) return;
        await borrarPago(pago);
        toast(`Pago borrado. <b>${esc(c.nombre)}</b> tiene ${esc(textoSaldo(c))}.`);
      }else if(corregir){
        await editarPago(pago, datos);
        toast(`Pago corregido. <b>${esc(c.nombre)}</b> tiene ${esc(textoSaldo(c))}.`);
      }else{
        await registrarPago(c, datos);
        // si estaba pausado por falta de pago, al renovar vuelve a recibir
        const reactivar = renovar && !c.activo && saldoDe(c.id) > 0;
        if(reactivar) await cambiarActivo(c);
        toast(`${renovar ? 'Pack renovado' : 'Pago cargado'}. <b>${esc(c.nombre)}</b> tiene ${esc(textoSaldo(c))}${reactivar ? ' y vuelve a recibir' : ''}.`);
      }
      renderMenu();
      if(alTerminar) alTerminar();
    }catch(e){ toastError(corregir ? 'No se pudo corregir el pago' : 'No se pudo cargar el pago', e); }
  });
}

/* ---------- selector de ubicación (dirección + punto en el mapa) ---------- */
function ubicacionFormHtml(pre, datos, { cocinaCerca = true } = {}){
  return `<div class="field"><label for="${pre}-direccion">Dirección</label>
      <div style="display:flex;gap:6px"><input type="text" id="${pre}-direccion" value="${esc(datos.direccion || '')}" placeholder="Calle y número, localidad">
      <button class="btn lg" type="button" id="${pre}-geo">${icon('buscar', 14)} Ubicar</button></div>
      <div id="${pre}-georesultados"></div>
      <div class="help" id="${pre}-coord">${tieneUbicacion(datos) ? `Punto en el mapa: ${coordTxt(datos)}` : 'Buscá la dirección o tocá el mapa para marcar el punto de entrega.'}</div></div>
    <div class="minimap" id="${pre}-mapa"></div>`;
}
/* Engancha el buscador y el mapa; devuelve un objeto con la ubicación elegida. */
function bindUbicacion(el, pre, datos){
  const ubic = { lat: datos.lat, lng: datos.lng };
  let map = null, marker = null;
  const txt = el.querySelector(`#${pre}-coord`);
  const poner = (lat, lng, centrar) => {
    ubic.lat = lat; ubic.lng = lng;
    txt.textContent = `Punto en el mapa: ${coordTxt(ubic)} · podés arrastrarlo para ajustar`;
    if(!map) return;
    if(!marker){
      marker = window.L.marker([lat, lng], { draggable: true, icon: pinIcono('', '#E2792B') }).addTo(map);
      marker.on('dragend', () => { const p = marker.getLatLng(); poner(p.lat, p.lng, false); });
    }else marker.setLatLng([lat, lng]);
    if(centrar) map.setView([lat, lng], 16);
  };
  cargarLeaflet().then(() => {
    const cont = el.querySelector(`#${pre}-mapa`);
    if(!cont || !cont.isConnected) return;
    map = crearMapa(cont, tieneUbicacion(ubic) ? ubic : cocina());
    if(tieneUbicacion(ubic)){ poner(ubic.lat, ubic.lng, true); }
    map.on('click', (e) => poner(e.latlng.lat, e.latlng.lng, false));
    setTimeout(() => map.invalidateSize(), 200);
  }).catch(() => { const cont = el.querySelector(`#${pre}-mapa`); if(cont) cont.innerHTML = '<div class="empty">No se pudo cargar el mapa. Revisá la conexión.</div>'; });

  const btn = el.querySelector(`#${pre}-geo`), res = el.querySelector(`#${pre}-georesultados`);
  const buscar = async () => {
    const q = el.querySelector(`#${pre}-direccion`).value.trim();
    if(!q){ marcarFalta(el.querySelector(`#${pre}-direccion`), 'Escribí una dirección para buscar.'); return; }
    btn.classList.add('busy');
    try{
      const r = await buscarDireccion(q, cocina());
      if(!r.length){ res.innerHTML = '<div class="help">No encontramos esa dirección. Probá agregando la localidad, o marcá el punto en el mapa.</div>'; }
      else if(r.length === 1){ poner(r[0].lat, r[0].lng, true); res.innerHTML = ''; }
      else{
        res.innerHTML = `<div class="geores">${r.map((x, i) => `<button type="button" data-g="${i}">${esc(x.nombre)}</button>`).join('')}</div>`;
        res.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => { const x = r[Number(b.dataset.g)]; poner(x.lat, x.lng, true); res.innerHTML = ''; }));
      }
    }catch(e){ toastError('No se pudo buscar la dirección', e); }
    btn.classList.remove('busy');
  };
  btn.addEventListener('click', buscar);
  el.querySelector(`#${pre}-direccion`).addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); buscar(); } });
  return ubic;
}

/* ---------- ficha del cliente ---------- */
function abrirCliente(id){
  const c = id ? clientePorId(id) : null;
  if(id && !c) return;
  clienteAbierto = id;
  document.querySelectorAll('[data-id]').forEach(x => x.classList.toggle('opened', x.dataset.id === id));
  if(!esDueno()) return abrirClienteLectura(c);

  const d = c || { nombre: '', tipo: 'casual', empresaNombre: '', telefono: '', notas: '', direccion: '', referencia: '', lat: null, lng: null,
                   dias: [1, 2, 3, 4, 5], cantAlmuerzo: 1, cantCena: 0, cadeteId: null, activo: true };
  const sal = c ? (state.saldos[c.id] || { pagado: 0, consumido: 0, saldo: 0 }) : null;
  const modo = c ? modoPago(c) : null, sv = c ? saldoDe(c.id) : 0;
  // pack: créditos prepagos · sanatorio/empresa: cuenta que se cobra a fin de semana · casual: no usa créditos
  const grande = modo === 'cuenta'
    ? (sv < 0 ? `<b class="debe">${-sv}</b><span>viandas a cobrar · se abonan a fin de semana</span>` : `<b class="ok">${sv}</b><span>${sv ? 'créditos a favor' : 'al día: no debe nada'}</span>`)
    : `<b class="${estadoSaldo(c || {})}">${sv}</b><span>créditos disponibles</span>`;
  const saldoHtml = c && modo === 'sin' ? `<div class="cred-box modo-sin">
        <p class="cred-nota">${icon('info', 14)} Cliente casual: paga cada pedido y no usa créditos.</p>
        <div class="cred-pagos-h">Pagos cargados <span class="n" id="n-pagos"></span></div>
        <div id="c-pagos"><div class="skel" style="width:50%"></div></div>
      </div>` : c ? `<div class="cred-box modo-${modo}">
        <div class="cred-top">
          <div class="cred-big">${grande}</div>
          <div class="cred-mini">
            <div><span>Pagó</span><b>${fmtNum(sal.pagado)}</b></div>
            <div><span>${modo === 'cuenta' ? 'Recibió' : 'Usó'}</span><b>${fmtNum(sal.consumido)}</b></div>
            ${modo === 'prepago' ? `<div><span>Le alcanza</span><b>${plural(diasQueCubre(c), 'día')}</b></div>` : ''}
          </div>
        </div>
        <div class="pacts cred-acts">
          <button class="btn lg primary" type="button" id="btn-pago">${icon('plus', 14)} ${modo === 'cuenta' ? 'Registrar pago' : 'Cargar pago'}</button>
          <button class="btn lg" type="button" id="btn-ajustar">${icon('editar', 14)} ${modo === 'cuenta' ? 'Ajustar' : 'Ajustar créditos'}</button>
          ${waLink(c.telefono, '') ? `<a class="btn lg" href="${waLink(c.telefono, mensajeRecordatorio(c))}" target="_blank" rel="noopener" title="Avisar saldo por WhatsApp">${icon('wa', 14)} Avisar</a>` : ''}
          ${c.telefono ? `<a class="btn lg" href="${telLink(c.telefono)}" title="Llamar">${icon('tel', 14)}</a>` : ''}
        </div>
        <div class="cred-pagos-h">Pagos cargados <span class="n" id="n-pagos"></span></div>
        <div id="c-pagos"><div class="skel" style="width:50%"></div></div>
      </div>` : `<div class="frow">
        <div class="field"><label for="f-saldo-inicial">Créditos al alta</label><input type="number" id="f-saldo-inicial" min="0" step="1" value="${creditosAlAlta(d.tipo)}">
          <div class="help">Solo los packs de dietas arrancan con ${CREDITOS_POR_DEFECTO}. Casuales, empresas y sanatorios en 0: sus pedidos no usan créditos.</div></div>
        <div class="field"><label for="f-monto-inicial">Monto (opcional)</label><input type="number" id="f-monto-inicial" min="0" step="1" placeholder="$"></div></div>`;

  abrirPanel({
    titulo: c ? `${icon('clientes', 14)} Cliente` : `${icon('plus', 14)} Nuevo cliente`,
    html: `
      ${c ? `<h2 class="ptitle">${esc(c.nombre)}</h2><p class="psub">${tipoTag(c)} ${c.activo ? '' : '<span class="tag plain">Pausado</span>'}</p>` : ''}
      ${c ? `<div class="psec" style="margin-top:8px"><h3>${{ prepago: 'Créditos y pagos', cuenta: 'Cuenta corriente', sin: 'Pagos' }[modoPago(c)]}</h3>${saldoHtml}</div>` : ''}

      <div class="psec" style="${c ? '' : 'margin-top:0'}"><h3>Datos</h3>
        <div class="field"><label for="f-nombre">Nombre${REQ}</label><input type="text" id="f-nombre" value="${esc(d.nombre)}" placeholder="Nombre y apellido" ${c ? '' : 'autofocus'}></div>
        <div class="frow">
          <div class="field"><label for="f-tipo">Tipo de cliente</label><select id="f-tipo">
            ${TIPOS.map(t => `<option value="${t}" ${d.tipo === t ? 'selected' : ''}>${TIPO_LABEL[t]}</option>`).join('')}</select></div>
          <div class="field"><label for="f-telefono">Teléfono</label><input type="tel" id="f-telefono" value="${esc(d.telefono)}" placeholder="11 5555-5555"></div>
        </div>
        <div class="field ${d.tipo === 'empresa' ? '' : 'hidden'}" id="grupo-empresa"><label for="f-empresa">Nombre de la empresa</label>
          <input type="text" id="f-empresa" value="${esc(d.empresaNombre)}" placeholder="Ej: Estudio Contable SRL"></div>
        <div class="field"><label for="f-notas">Notas</label><textarea id="f-notas" rows="2" placeholder="Sin sal, timbre 3B, dejar en portería…">${esc(d.notas)}</textarea></div>
      </div>

      <div class="psec"><h3>Entrega</h3>
        <div class="field"><span class="flabel" id="lbl-dias">Días que recibe</span>
          <div class="days" role="group" aria-labelledby="lbl-dias">${DIAS_CORTOS.map((l, i) => `<label title="${DIAS_LARGOS[i]}"><input type="checkbox" name="f-dias" value="${i + 1}" ${d.dias.includes(i + 1) ? 'checked' : ''} aria-label="${DIAS_LARGOS[i]}"><span>${l}</span></label>`).join('')}</div>
          <div class="help">Con días marcados aparece solo en Hoy para entregarle sus viandas (cada una descuenta un crédito). A quien solo hace pedidos sueltos dejalo sin días.</div></div>
        <div class="field"><label for="f-menu-almuerzo">Tipo de vianda (para la cocina)</label><select id="f-menu-almuerzo">${opcionesMenu(d.menuAlmuerzoId || d.menuCenaId)}</select>
          <div class="help">Solo para saber qué prepararle (fit, sin TACC…). Cada vianda del pack cuenta igual: un crédito.</div></div>
        <div class="frow">
          <div class="field"><label for="f-cant-menus">Menús por día</label><input type="number" id="f-cant-menus" min="0" step="1" value="${d.cantAlmuerzo + d.cantCena}"></div>
          <div class="field"><label for="f-cadete">Cadete habitual</label><select id="f-cadete"><option value="">Sin asignar</option>
            ${state.cadetes.filter(k => k.activo || k.id === d.cadeteId).map(k => `<option value="${k.id}" ${d.cadeteId === k.id ? 'selected' : ''}>${esc(k.nombre)}</option>`).join('')}</select></div>
        </div>
        ${ubicacionFormHtml('f', d)}
        <div class="field" style="margin-top:12px"><label for="f-referencia">Referencia para el cadete</label><input type="text" id="f-referencia" value="${esc(d.referencia)}" placeholder="Piso, depto, portón verde…"></div>
      </div>

      ${c ? '' : `<div class="psec"><h3>Créditos iniciales</h3>${saldoHtml}</div>`}
      ${c ? `      <div class="psec"><h3>Últimas entregas</h3><div id="c-entregas"><div class="skel" style="width:40%"></div></div></div>
      <div class="psec"><h3>Acciones</h3><div class="pacts" style="border:0;margin:0;padding:0">
        <button class="btn lg" type="button" data-action="toggle-activo" data-id="${c.id}">${icon(c.activo ? 'pausa' : 'play', 14)} ${c.activo ? 'Pausar entregas' : 'Reactivar'}</button></div></div>` : ''}`,
    // eliminar va al pie, a la vista, como en los pedidos
    pie: `${c ? `<button class="btn lg danger" type="button" data-action="eliminar" data-id="${c.id}">${icon('borrar', 14)} Eliminar cliente</button><span class="sp"></span>` : ''}
      <button class="btn lg" id="cancelar-modal">Cancelar</button><button class="btn lg primary" id="guardar-cliente">${c ? 'Guardar cambios' : 'Crear cliente'}</button>`,
    onClose: () => { clienteAbierto = null; document.querySelectorAll('[data-id].opened').forEach(x => x.classList.remove('opened')); },
    onMount: (el) => {
      const tipoSel = el.querySelector('#f-tipo');
      tipoSel.addEventListener('change', () => el.querySelector('#grupo-empresa').classList.toggle('hidden', tipoSel.value !== 'empresa'));
      // los créditos al alta siguen al tipo, salvo que ya los hayan escrito a mano
      const ini = el.querySelector('#f-saldo-inicial');
      if(ini){
        ini.addEventListener('input', () => { ini.dataset.editado = '1'; });
        tipoSel.addEventListener('change', () => { if(!ini.dataset.editado) ini.value = creditosAlAlta(tipoSel.value); });
      }
      const ubic = bindUbicacion(el, 'f', d);
      el.querySelector('#cancelar-modal').addEventListener('click', () => cerrarPanel());
      const bp = el.querySelector('#btn-pago');
      if(bp) bp.addEventListener('click', () => dialogoPago(c, () => { refrescar(); abrirCliente(c.id); }));
      const ba = el.querySelector('#btn-ajustar');
      if(ba) ba.addEventListener('click', () => dialogoAjusteCreditos(c, () => { refrescar(); abrirCliente(c.id); }));
      el.querySelector('#guardar-cliente').addEventListener('click', async (ev) => {
        const nombre = el.querySelector('#f-nombre').value.trim();
        if(!nombre){ marcarFalta(el.querySelector('#f-nombre'), 'Poné un nombre para el cliente.'); return; }
        const dias = [...el.querySelectorAll('[name="f-dias"]:checked')].map(x => Number(x.value));
        const datos = {
          nombre, tipo: tipoSel.value, empresaNombre: el.querySelector('#f-empresa').value.trim(),
          telefono: el.querySelector('#f-telefono').value.trim(), notas: el.querySelector('#f-notas').value.trim(),
          direccion: el.querySelector('#f-direccion').value.trim(), referencia: el.querySelector('#f-referencia').value.trim(),
          lat: ubic.lat ?? null, lng: ubic.lng ?? null, dias,
          // una sola unidad: los menús del día (se guardan en el turno principal)
          cantAlmuerzo: Math.max(0, Math.trunc(Number(el.querySelector('#f-cant-menus').value) || 0)),
          cantCena: 0,
          cadeteId: el.querySelector('#f-cadete').value || null,
          menuAlmuerzoId: el.querySelector('#f-menu-almuerzo').value || null,
          menuCenaId: null
        };
        const b = ev.currentTarget; b.disabled = true;
        try{
          const guardado = await guardarCliente(c ? c.id : null, datos);
          if(!c){
            const inicial = Math.trunc(Number(el.querySelector('#f-saldo-inicial').value) || 0);
            if(inicial) await registrarPago(guardado, { viandas: inicial, monto: el.querySelector('#f-monto-inicial').value, nota: 'Alta del cliente' });
          }
          toast(c ? 'Cambios guardados.' : `<b>${esc(guardado.nombre)}</b> quedó cargado.`);
          cerrarPanel(); refrescar();
        }catch(e){ toastError('No se pudo guardar', e); b.disabled = false; }
      });
      if(!c) return;
      el.querySelector('[data-action="toggle-activo"]').addEventListener('click', async () => {
        try{ await cambiarActivo(c); toast(c.activo ? 'Entregas reactivadas.' : 'Cliente pausado: no aparece en las entregas.'); abrirCliente(c.id); refrescar(); }
        catch(e){ toastError('No se pudo cambiar el estado', e); }
      });
      el.querySelector('[data-action="eliminar"]').addEventListener('click', async () => {
        const ok = await confirmar('Eliminar cliente', `¿Eliminar a <b>${esc(c.nombre)}</b>? También se borran sus entregas, pagos y pedidos, y no se puede deshacer. El registro de entregas conserva el historial.<br><br>Si solo deja de recibir por un tiempo, mejor usá <b>Pausar entregas</b>.`, { ok: 'Eliminar', peligro: true });
        if(!ok) return;
        try{ await eliminarCliente(c); toast('Cliente eliminado.'); cerrarPanel(); refrescar(); }
        catch(e){ toastError('No se pudo eliminar', e); }
      });
      cargarHistorialCliente(el, c);
    }
  });
}

async function cargarHistorialCliente(el, c){
  try{
    const [pagos, entregas] = await Promise.all([esCadete() ? [] : listarPagos(c.id), historialEntregas(c.id)]);
    const cp = el.querySelector('#c-pagos');
    if(cp){
      el.querySelector('#n-pagos').textContent = pagos.length || '';
      const corrige = esDueno();   // el dueño corrige o borra cada pago desde acá
      const listo = () => { refrescar(); abrirCliente(c.id); };
      cp.innerHTML = pagos.length ? `<div class="pagos-lista">${pagos.map(p => `<div class="pago-row">
          <span class="v ${p.viandas < 0 ? 'bad' : 'ok'}">${p.viandas > 0 ? '+' : ''}${p.viandas}</span>
          <div class="t"><div class="n">${esc(p.nota || 'Pago')}</div><div class="s">${formatFechaCorta(p.fecha)}${p.monto != null ? ` · <b>${fmtPlata(p.monto)}</b>` : ''}</div></div>
          ${corrige ? `<div class="acts"><button class="btn" type="button" data-pago-editar="${p.id}" title="Corregir este pago">${icon('editar', 13)} Editar</button>
            <button class="btn quiet danger" type="button" data-pago-borrar="${p.id}" title="Borrar este pago" aria-label="Borrar este pago">${icon('borrar', 13)}</button></div>` : ''}</div>`).join('')}</div>`
        : '<div class="muted" style="font-size:13px">Todavía no tiene pagos cargados.</div>';
      if(corrige){
        cp.querySelectorAll('[data-pago-editar]').forEach(b => b.addEventListener('click', () => dialogoPago(c, listo, pagos.find(x => x.id === b.dataset.pagoEditar))));
        cp.querySelectorAll('[data-pago-borrar]').forEach(b => b.addEventListener('click', async () => {
          const p = pagos.find(x => x.id === b.dataset.pagoBorrar);
          if(!(await confirmar('Borrar pago', `¿Borrar el pago de <b>${p.viandas > 0 ? '+' : ''}${p.viandas} créditos</b> del ${esc(formatFechaCorta(p.fecha))}?`, { ok: 'Borrar pago', peligro: true }))) return;
          try{ await borrarPago(p); toast(`Pago borrado. <b>${esc(c.nombre)}</b> tiene ${esc(textoSaldo(c))}.`); renderMenu(); listo(); }
          catch(e){ toastError('No se pudo borrar el pago', e); }
        }));
      }
    }
    const ce = el.querySelector('#c-entregas');
    if(ce){
      const est = v => v === 'entregado' ? '<span class="tag ok">Entregado</span>' : v === 'no_recibido' ? '<span class="tag bad">No lo recibió</span>' : v === 'saltado' ? '<span class="tag skip">Salteado</span>' : '';
      ce.innerHTML = entregas.filter(e => e.almuerzo || e.cena).length ? entregas.filter(e => e.almuerzo || e.cena).map(e => `<div class="hist">
          <span class="w">${formatFechaCorta(e.fecha)}</span>
          <span class="t">${e.almuerzo ? `Almuerzo ${est(e.almuerzo)}` : ''} ${e.cena ? `Cena ${est(e.cena)}` : ''}</span>
          <span class="v">${consumoEntrega(e) ? '−' + consumoEntrega(e) : ''}</span></div>`).join('')
        : '<div class="muted" style="font-size:13px">Sin entregas registradas.</div>';
    }
  }catch(e){ const cp = el.querySelector('#c-pagos'); if(cp) cp.innerHTML = `<div class="muted">No se pudo cargar el historial.</div>`; }
}

/* Ficha de solo lectura (ayudante). */
function abrirClienteLectura(c){
  if(!c) return;
  const k = cadetePorId(c.cadeteId);
  const wa = waLink(c.telefono, mensajeRecordatorio(c));
  abrirPanel({
    titulo: `${icon('clientes', 14)} Cliente`,
    html: `<h2 class="ptitle">${esc(c.nombre)}</h2><p class="psub">${tipoTag(c)} ${c.activo ? '' : '<span class="tag plain">Pausado</span>'}</p>
      <dl class="props">
        <dt>Créditos</dt><dd><span class="saldo ${estadoSaldo(c)}">${esc(textoSaldo(c))}</span> <span class="muted">· cubre ${plural(diasQueCubre(c), 'día')}</span></dd>
        <dt>Dirección</dt><dd>${c.direccion ? esc(c.direccion) : '<span class="muted">Sin dirección</span>'}</dd>
        ${c.referencia ? `<dt>Referencia</dt><dd>${esc(c.referencia)}</dd>` : ''}
        <dt>Días</dt><dd>${daychipsHtml(c.dias)}</dd>
        <dt>Lleva</dt><dd>${llevaTxt(c)}</dd>
        <dt>Cadete</dt><dd>${k ? `<span class="dot" style="--c:${k.color}"></span>${esc(k.nombre)}` : '<span class="muted">Sin asignar</span>'}</dd>
        ${c.empresaNombre ? `<dt>Empresa</dt><dd>${esc(c.empresaNombre)}</dd>` : ''}
        ${c.telefono ? `<dt>Teléfono</dt><dd>${esc(c.telefono)}</dd>` : ''}
        ${c.notas ? `<dt>Notas</dt><dd>${esc(c.notas)}</dd>` : ''}
      </dl>
      <div class="pacts">
        ${c.direccion || tieneUbicacion(c) ? `<a class="btn lg" href="${mapsPunto(c)}" target="_blank" rel="noopener">${icon('pin', 14)} Ver en el mapa</a>` : ''}
        ${c.telefono ? `<a class="btn lg" href="${telLink(c.telefono)}">${icon('tel', 14)} Llamar</a>` : ''}
        ${wa ? `<a class="btn lg" href="${wa}" target="_blank" rel="noopener">${icon('wa', 14)} Avisar saldo</a>` : ''}
      </div>
      <p class="muted" style="font-size:13px">Solo el dueño puede modificar clientes y cargar pagos.</p>
      <div class="psec"><h3>Pagos <span class="n" id="n-pagos"></span></h3><div id="c-pagos"><div class="skel" style="width:50%"></div></div></div>
      <div class="psec"><h3>Últimas entregas</h3><div id="c-entregas"><div class="skel" style="width:40%"></div></div></div>`,
    onClose: () => { clienteAbierto = null; },
    onMount: (el) => cargarHistorialCliente(el, c)
  });
}
