/* ============================================================
   PESTAÑA: REGISTRO — cada cambio en una entrega: quién, cuándo, qué
   Lo escribe la base con un trigger; nadie lo puede editar ni borrar.
============================================================= */
let registroFiltro = { desde: sumarDias(todayStr(), -7), hasta: todayStr(), texto: '', actor: '', turno: '' };

function estadoChip(v){
  if(v === 'entregado') return '<span class="tag ok">Entregado</span>';
  if(v === 'no_recibido') return '<span class="tag warn">No lo recibió</span>';
  if(v === 'saltado') return '<span class="tag plain">Salteado</span>';
  return '<span class="tag plain">Sin marcar</span>';
}

function renderRegistro(bar, main){
  const f = registroFiltro;
  bar.innerHTML = `<h1>Registro de entregas</h1><div class="sp"></div>
    <input type="date" class="inp sm" id="g-desde" value="${f.desde}" aria-label="Desde" style="width:auto">
    <span class="muted">a</span>
    <input type="date" class="inp sm" id="g-hasta" value="${f.hasta}" aria-label="Hasta" style="width:auto">
    <input class="inp sm search-inp" id="g-texto" placeholder="Cliente" aria-label="Cliente" style="width:150px" value="${esc(f.texto)}">
    <select class="inp sm" id="g-turno" aria-label="Turno" style="width:auto"><option value="">Almuerzo y cena</option>
      <option value="almuerzo" ${f.turno === 'almuerzo' ? 'selected' : ''}>Almuerzo</option><option value="cena" ${f.turno === 'cena' ? 'selected' : ''}>Cena</option></select>
    <select class="inp sm" id="g-actor" aria-label="Usuario" style="width:auto"><option value="">Todos los usuarios</option></select>`;
  main.innerHTML = `<div class="banner">${icon('info', 14)} Cada vez que alguien marca o desmarca una entrega queda anotado acá, con su usuario. No se puede modificar.</div>
    <div class="tablewrap"><table class="ptable">
      <thead><tr><th>Cuándo</th><th>Entrega del</th><th>Cliente</th><th>Turno</th><th>Cambio</th><th class="r">Viandas</th><th>Quién</th></tr></thead>
      <tbody id="g-tbody"><tr><td colspan="7"><div class="skel" style="width:40%"></div></td></tr></tbody></table></div>
    <div id="g-mas"></div>`;

  const actores = new Set();
  let pagina = 0, filas = [];
  const cargar = async (reset) => {
    if(reset){ pagina = 0; filas = []; }
    try{
      const nuevas = await buscarRegistro({ ...registroFiltro, pagina });
      filas = filas.concat(nuevas);
      nuevas.forEach(r => r.actor_email && actores.add(r.actor_email));
      pintar(nuevas.length === 100);
    }catch(e){
      document.getElementById('g-tbody').innerHTML = `<tr><td colspan="7" class="z">No se pudo leer el registro: ${esc(traducirError(e.message))}</td></tr>`;
    }
  };
  const pintar = (hayMas) => {
    const sel = document.getElementById('g-actor');
    if(sel){
      const v = registroFiltro.actor;
      sel.innerHTML = `<option value="">Todos los usuarios</option>` + [...actores].sort().map(a => `<option ${a === v ? 'selected' : ''}>${esc(a)}</option>`).join('');
    }
    const tb = document.getElementById('g-tbody');
    tb.innerHTML = filas.length ? filas.map(r => `<tr>
        <td>${esc(formatFechaHora(r.created_at))}</td>
        <td>${esc(formatFechaMedia(r.fecha))}</td>
        <td>${esc(r.cliente_nombre || '(cliente borrado)')}</td>
        <td>${esc(TURNO_LABEL[r.turno] || r.turno)}</td>
        <td><span style="display:inline-flex;gap:6px;align-items:center">${estadoChip(r.antes)}<span class="muted">→</span>${estadoChip(r.despues)}</span></td>
        <td class="r">${r.cantidad ?? '—'}</td>
        <td><span style="display:inline-flex;gap:8px;align-items:center">${avatarHtml(r.actor_email || '?', 20)}${esc(r.actor_email || '—')} <span class="muted">${esc(ROL_LABEL[r.actor_rol] || '')}</span></span></td>
      </tr>`).join('')
      : `<tr><td colspan="7" style="height:auto;border:0"><div class="stub" style="margin:8vh auto"><div class="ico">${icon('registro', 20)}</div><h2>Sin movimientos</h2><p>No hay cambios de entregas con estos filtros.</p></div></td></tr>`;
    document.getElementById('g-mas').innerHTML = hayMas ? `<button class="more" id="g-cargar-mas">Cargar más</button>` : '';
    const m = document.getElementById('g-cargar-mas'); if(m) m.addEventListener('click', () => { pagina++; cargar(false); });
  };
  const aplicar = () => {
    registroFiltro = { desde: bar.querySelector('#g-desde').value, hasta: bar.querySelector('#g-hasta').value,
      texto: bar.querySelector('#g-texto').value.trim(), actor: bar.querySelector('#g-actor').value, turno: bar.querySelector('#g-turno').value };
    cargar(true);
  };
  ['#g-desde', '#g-hasta', '#g-turno', '#g-actor'].forEach(s => bar.querySelector(s).addEventListener('change', aplicar));
  bar.querySelector('#g-texto').addEventListener('input', debounce(aplicar, 350));
  cargar(true);
}
