/* ============================================================
   PESTAÑA: RUTAS — reparto del día entre cadetes y orden de recorrido
   Se trabaja sobre un borrador (cadete y orden de cada cliente) que se
   guarda en la tabla rutas. Sin borrador guardado, cada cliente va con
   su cadete habitual y en orden por cercanía desde la cocina.
============================================================= */
let rutaFecha = todayStr();
let rutaBorrador = null;   // { fecha, asig: { clienteId: { cadeteId, orden } }, sucio }

function borradorDesdeEstado(fecha){
  const asig = {};
  const grupos = [...state.cadetes.map(k => k.id), null];
  for(const kid of grupos){
    paradasDe(kid, fecha).forEach((c, i) => { asig[c.id] = { cadeteId: kid, orden: i + 1 }; });
  }
  return { fecha, asig, sucio: false };
}
function paradasBorrador(kid){
  const b = rutaBorrador;
  return clientesDelDia(b.fecha).filter(c => b.asig[c.id] && (b.asig[c.id].cadeteId || null) === (kid || null))
    .sort((x, y) => b.asig[x.id].orden - b.asig[y.id].orden);
}
function renumerar(kid){ paradasBorrador(kid).forEach((c, i) => { rutaBorrador.asig[c.id].orden = i + 1; }); }
function optimizarGrupo(kid){
  const ps = paradasBorrador(kid);
  const orden = ordenarRecorrido(cocina(), ps.filter(tieneUbicacion)).concat(ps.filter(c => !tieneUbicacion(c)));
  orden.forEach((c, i) => { rutaBorrador.asig[c.id].orden = i + 1; });
}
function textoRutaWhatsApp(k, paradas){
  const f = rutaBorrador.fecha;
  const lineas = paradas.map((c, i) => `${i + 1}. ${c.nombre} — ${c.direccion || 'sin dirección'}${c.referencia ? ' (' + c.referencia + ')' : ''} — ${turnosDe(c, f).map(t => `${TURNO_LABEL[t].toLowerCase()} ×${cantTurno(c, t) || 1}`).join(', ')}\n   ${mapsNavegar(c)}`);
  const tramos = mapsRecorrido(cocina(), paradas);
  return `Ruta de ${k.nombre} · ${formatFechaLarga(f)}\n\n${lineas.join('\n')}` + (tramos.length ? `\n\nRecorrido completo:\n${tramos.map(t => t.url).join('\n')}` : '');
}

function renderRutas(bar, main){
  if(!rutaBorrador || rutaBorrador.fecha !== rutaFecha || !rutaBorrador.sucio) rutaBorrador = borradorDesdeEstado(rutaFecha);
  const editable = puedeArmarRutas();
  const activos = state.cadetes.filter(k => k.activo);
  bar.innerHTML = `<h1>Rutas</h1>
    <div class="dayctl">
      <button class="iconbtn" id="r-ant" aria-label="Día anterior">${icon('chevL')}</button>
      <input type="date" class="inp" id="r-fecha" value="${rutaFecha}" aria-label="Fecha">
      <button class="iconbtn" id="r-sig" aria-label="Día siguiente">${icon('chevR')}</button>
    </div>
    <span class="muted">${esc(formatFechaLarga(rutaFecha))}</span><div class="sp"></div>
    ${editable ? `<button class="btn" id="r-repartir" title="Divide los clientes entre los cadetes activos por zona">${icon('rutas', 14)} Repartir por zonas</button>
      <button class="btn" id="r-optimizar" title="Ordena cada recorrido por cercanía">${icon('optimizar', 14)} Optimizar orden</button>
      ${rutaBorrador.sucio ? `<button class="btn quiet" id="r-descartar">Descartar</button><button class="btn primary" id="r-guardar">${icon('check', 14)} Guardar rutas</button>` : ''}` : ''}`;

  const cambiarFecha = async (f) => {
    if(rutaBorrador.sucio && !(await confirmar('Cambios sin guardar', 'Hay cambios en las rutas que no guardaste. ¿Descartarlos?', { ok: 'Descartar', peligro: true }))){ render(); return; }
    rutaFecha = f || todayStr(); rutaBorrador = null;
    try{ await asegurarFecha(rutaFecha); }catch(e){ toastError('No se pudieron traer las rutas de ese día', e); }
    render();
  };
  bar.querySelector('#r-fecha').addEventListener('change', e => cambiarFecha(e.target.value));
  bar.querySelector('#r-ant').addEventListener('click', () => cambiarFecha(sumarDias(rutaFecha, -1)));
  bar.querySelector('#r-sig').addEventListener('click', () => cambiarFecha(sumarDias(rutaFecha, 1)));

  const delDia = clientesDelDia(rutaFecha);
  if(!delDia.length){
    main.innerHTML = `<div class="stub"><div class="ico">${icon('rutas', 20)}</div><h2>No hay entregas ese día</h2>
      <p>Ningún cliente activo recibe viandas el ${DIAS_LARGOS[diaSemana(rutaFecha) - 1]}.</p></div>`;
    return;
  }
  const sinCocina = !tieneUbicacion(cocina());
  const sinUbic = delDia.filter(c => !tieneUbicacion(c));
  main.innerHTML = `
    ${sinCocina ? `<div class="banner warn">${icon('alerta', 14)} Falta la dirección de la cocina: los recorridos se calculan sin punto de partida.${esDueno() ? ' <button class="btn quiet" id="r-ir-ajustes">Configurarla</button>' : ''}</div>` : ''}
    ${!state.cadetes.length ? `<div class="banner">${icon('info', 14)} Todavía no hay cadetes cargados. ${esDueno() ? '<button class="btn quiet" id="r-ir-equipo">Sumar cadetes</button>' : ''}</div>` : ''}
    <div class="routes"><div class="rlist" id="r-lista"></div><div class="rmap"><div class="map" id="r-mapa"></div></div></div>`;
  const ia = main.querySelector('#r-ir-ajustes'); if(ia) ia.addEventListener('click', () => irA('ajustes'));
  const ie = main.querySelector('#r-ir-equipo'); if(ie) ie.addEventListener('click', () => irA('equipo'));

  let mapa = null, capa = null;
  function dibujarMapa(){
    const el = document.getElementById('r-mapa');
    if(!el || !window.L) return;
    if(!mapa){ mapa = crearMapa(el, cocina()); }
    if(capa) capa.remove();
    capa = window.L.layerGroup().addTo(mapa);
    const todos = [];
    const co = cocina();
    if(tieneUbicacion(co)){ window.L.marker([co.lat, co.lng], { icon: pinIcono('C', '#241F17', 'home'), zIndexOffset: 1000 }).addTo(capa).bindPopup('<b>Cocina</b>'); todos.push([co.lat, co.lng]); }
    for(const kid of [...state.cadetes.map(k => k.id), null]){
      const ps = paradasBorrador(kid);
      const color = kid ? colorCadete(kid) : '#8C8378';
      const linea = tieneUbicacion(co) ? [[co.lat, co.lng]] : [];
      ps.forEach((c, i) => {
        if(!tieneUbicacion(c)) return;
        linea.push([c.lat, c.lng]); todos.push([c.lat, c.lng]);
        const k = cadetePorId(kid);
        window.L.marker([c.lat, c.lng], { icon: pinIcono(String(i + 1), color, clientePendiente(c, rutaFecha) ? '' : 'done') }).addTo(capa)
          .bindPopup(`<b>${esc(c.nombre)}</b><br>${esc(c.direccion)}<br>${k ? esc(k.nombre) : 'Sin cadete'} · parada ${i + 1}`);
      });
      if(kid && linea.length > 1) window.L.polyline(linea, { color, weight: 3, opacity: .8, dashArray: rutaBorrador.sucio ? '6 6' : null }).addTo(capa);
    }
    if(todos.length) mapa.fitBounds(todos, { padding: [30, 30], maxZoom: 15 });
  }

  function pintarLista(){
    const cont = document.getElementById('r-lista');
    const grupos = [...state.cadetes.filter(k => k.activo || paradasBorrador(k.id).length).map(k => ({ k, kid: k.id })), { k: null, kid: null }];
    cont.innerHTML = grupos.map(({ k, kid }) => {
      const ps = paradasBorrador(kid);
      if(!k && !ps.length) return '';
      const km = largoRecorrido(cocina(), ps.filter(tieneUbicacion));
      const viandas = ps.reduce((s, c) => s + viandasPorDia(c), 0);
      const tramos = mapsRecorrido(cocina(), ps);
      const wa = k && k.telefono && ps.length ? waLink(k.telefono, textoRutaWhatsApp(k, ps)) : '';
      return `<div class="ghead">${k ? `<span class="dot" style="--c:${k.color}"></span>` : ''}
          <span class="gname">${k ? esc(k.nombre) : 'Sin cadete'}</span>
          <span class="gcount">${plural(ps.length, 'parada')} · ${plural(viandas, 'vianda')}${km ? ` · ≈${km.toFixed(1)} km` : ''}</span></div>
        ${k && ps.length ? `<div class="gacts">
          ${tramos.map((t, i) => `<a class="btn" href="${t.url}" target="_blank" rel="noopener">${icon('nav', 13)} ${tramos.length > 1 ? `Tramo ${i + 1}` : 'Google Maps'}</a>`).join('')}
          ${wa ? `<a class="btn" href="${wa}" target="_blank" rel="noopener">${icon('wa', 13)} Enviar a ${esc(k.nombre.split(' ')[0])}</a>` : ''}
          ${editable ? `<button class="btn quiet" data-opt="${k.id}">${icon('optimizar', 13)} Optimizar</button>` : ''}</div>` : ''}
        ${ps.length ? ps.map((c, i) => `<div class="stop" data-c="${c.id}">
            <span class="ord" style="--c:${k ? k.color : 'var(--text-3)'}">${i + 1}</span>
            <div class="t"><div class="n">${esc(c.nombre)}${clientePendiente(c, rutaFecha) ? '' : ` <span class="tag ok">Listo</span>`}</div>
              <div class="s">${tieneUbicacion(c) ? '' : `<span style="color:var(--bad-ink)">Sin ubicación · </span>`}${esc(c.direccion || 'Sin dirección')} · ${viandasPorDia(c)} v.</div></div>
            ${editable ? `<select aria-label="Cadete de ${esc(c.nombre)}" data-asignar="${c.id}"><option value="">Sin cadete</option>
                ${state.cadetes.filter(x => x.activo || x.id === kid).map(x => `<option value="${x.id}" ${x.id === kid ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select>
              <button class="iconbtn sm" data-sube="${c.id}" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>${icon('up', 13)}</button>
              <button class="iconbtn sm" data-baja="${c.id}" aria-label="Bajar" ${i === ps.length - 1 ? 'disabled' : ''}>${icon('down', 13)}</button>` : ''}
          </div>`).join('') : `<div class="empty">Sin paradas asignadas.</div>`}`;
    }).join('') + (sinUbic.length && esDueno() ? `<div class="empty">${plural(sinUbic.length, 'cliente')} sin ubicación en el mapa: abrí su ficha y usá "Ubicar". ${sinUbic.slice(0, 6).map(c => `<button class="btn quiet" data-ubicar="${c.id}">${esc(c.nombre)}</button>`).join('')}</div>` : '');

    const tocar = () => { rutaBorrador.sucio = true; render(); };
    cont.querySelectorAll('[data-asignar]').forEach(s => s.addEventListener('change', () => {
      const a = rutaBorrador.asig[s.dataset.asignar], antes = a.cadeteId;
      a.cadeteId = s.value || null; a.orden = 9999;
      renumerar(antes); optimizarGrupo(a.cadeteId); tocar();
    }));
    const mover = (id, d) => {
      const a = rutaBorrador.asig[id], ps = paradasBorrador(a.cadeteId);
      const i = ps.findIndex(c => c.id === id), j = i + d;
      if(j < 0 || j >= ps.length) return;
      const otro = rutaBorrador.asig[ps[j].id];
      [a.orden, otro.orden] = [otro.orden, a.orden];
      tocar();
    };
    cont.querySelectorAll('[data-sube]').forEach(b => b.addEventListener('click', () => mover(b.dataset.sube, -1)));
    cont.querySelectorAll('[data-baja]').forEach(b => b.addEventListener('click', () => mover(b.dataset.baja, 1)));
    cont.querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', () => { optimizarGrupo(b.dataset.opt); tocar(); }));
    cont.querySelectorAll('[data-ubicar]').forEach(b => b.addEventListener('click', () => { irA('clientes'); abrirCliente(b.dataset.ubicar); }));
  }

  if(editable){
    bar.querySelector('#r-repartir').addEventListener('click', () => {
      if(!activos.length){ toast('Primero sumá cadetes activos en Equipo.', 'err'); return; }
      const ubicados = delDia.filter(tieneUbicacion);
      if(!ubicados.length){ toast('Ningún cliente de ese día tiene ubicación en el mapa.', 'err'); return; }
      const grupos = repartirPorZonas(cocina(), ubicados, activos.length, c => viandasPorDia(c));
      grupos.forEach((g, i) => g.forEach(c => { rutaBorrador.asig[c.id] = { cadeteId: activos[i].id, orden: 9999 }; }));
      for(const k of activos) optimizarGrupo(k.id);
      renumerar(null);
      rutaBorrador.sucio = true;
      toast(`Repartido entre ${plural(activos.length, 'cadete')} por zona. Revisá y guardá.`, 'info');
      render();
    });
    bar.querySelector('#r-optimizar').addEventListener('click', () => {
      for(const k of state.cadetes) optimizarGrupo(k.id);
      rutaBorrador.sucio = true; render();
    });
    const bd = bar.querySelector('#r-descartar');
    if(bd) bd.addEventListener('click', () => { rutaBorrador = null; render(); });
    const bg = bar.querySelector('#r-guardar');
    if(bg) bg.addEventListener('click', async () => {
      bg.classList.add('busy');
      try{
        const asig = Object.entries(rutaBorrador.asig).map(([clienteId, a]) => ({ clienteId, cadeteId: a.cadeteId, orden: a.orden }));
        await guardarRutas(rutaFecha, asig);
        rutaBorrador = null;
        toast('Rutas guardadas. Cada cadete ya ve su recorrido.');
        render();
      }catch(e){ toastError('No se pudieron guardar las rutas', e); bg.classList.remove('busy'); }
    });
  }

  pintarLista();
  cargarLeaflet().then(dibujarMapa).catch(() => { const el = document.getElementById('r-mapa'); if(el) el.innerHTML = '<div class="stub"><p>No se pudo cargar el mapa. Revisá la conexión.</p></div>'; });
}
