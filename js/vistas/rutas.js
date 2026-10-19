/* ============================================================
   PESTAÑA: RECORRIDOS — reparto del día entre cadetes y orden de recorrido
   Las paradas son las viandas de packs y fijos y los pedidos del día (lo de
   un mismo cliente va junto). Se trabaja sobre un borrador (cadete y orden
   de cada parada, que se cambia arrastrando) que se guarda en la tabla rutas.
   Sin borrador guardado, cada cliente va con su cadete habitual y en orden
   por cercanía desde la cocina.
   Cada cadete recibe un link (para hoy o la semana) y ve sus entregas de a
   una en cadete.html; mientras lo tiene abierto, en el mapa se ve dónde está
   y por dónde fue, al lado del recorrido planeado.
============================================================= */
let rutaFecha = todayStr();
let rutaBorrador = null;   // { fecha, asig: { clienteId: { cadeteId, orden } }, sucio }
let rutaPosiciones = {};   // cadeteId → [{ lat, lng, at }] del día elegido
let rutaTimer = null;
const rutaCallesDe = {};   // cadeteId → { km, min } del recorrido por las calles que se dibujó

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
  return paradasDelDia(b.fecha).filter(c => b.asig[c.id] && (b.asig[c.id].cadeteId || null) === (kid || null))
    .sort((x, y) => b.asig[x.id].orden - b.asig[y.id].orden);
}
function renumerar(kid){ paradasBorrador(kid).forEach((c, i) => { rutaBorrador.asig[c.id].orden = i + 1; }); }
function optimizarGrupo(kid){
  const ps = paradasBorrador(kid);
  const orden = ordenarRecorrido(cocina(), ps.filter(tieneUbicacion)).concat(ps.filter(c => !tieneUbicacion(c)));
  orden.forEach((c, i) => { rutaBorrador.asig[c.id].orden = i + 1; });
}
/* Optimizar de verdad: el orden más corto por las calles desde la cocina (si no se puede, por cercanía). */
async function optimizarPorCalles(kid){
  const ps = paradasBorrador(kid), ubicados = ps.filter(tieneUbicacion);
  const orden = await ordenPorCalles(cocina(), ubicados, medioDe(kid)) || ordenarRecorrido(cocina(), ubicados);
  orden.concat(ps.filter(c => !tieneUbicacion(c))).forEach((c, i) => { rutaBorrador.asig[c.id].orden = i + 1; });
}
function textoRutaWhatsApp(k, paradas){
  const f = rutaBorrador.fecha;
  const lineas = paradas.map((c, i) => `${i + 1}. ${c.nombre} — ${c.direccion || 'sin dirección'}${c.referencia ? ' (' + c.referencia + ')' : ''} — ${queLleva(c, f)}\n   ${mapsNavegar(c, k.medio)}`);
  const tramos = mapsRecorrido(cocina(), paradas, k.medio);
  return `Ruta de ${k.nombre} · ${formatFechaLarga(f)}\n\n${lineas.join('\n')}` + (tramos.length ? `\n\nRecorrido completo:\n${tramos.map(t => t.url).join('\n')}` : '');
}

function renderRutas(bar, main){
  if(!rutaBorrador || rutaBorrador.fecha !== rutaFecha || !rutaBorrador.sucio) rutaBorrador = borradorDesdeEstado(rutaFecha);
  const editable = puedeArmarRutas();
  const activos = state.cadetes.filter(k => k.activo);
  bar.innerHTML = `<h1>Recorridos</h1>
    <div class="dayctl">
      <button class="iconbtn" id="r-ant" aria-label="Día anterior">${icon('chevL')}</button>
      <input type="date" class="inp" id="r-fecha" value="${rutaFecha}" aria-label="Fecha">
      <button class="iconbtn" id="r-sig" aria-label="Día siguiente">${icon('chevR')}</button>
    </div>
    <span class="muted">${esc(formatFechaLarga(rutaFecha))}</span><div class="sp"></div>
    ${editable ? `<button class="btn quiet" id="r-cadete">${icon('plus', 14)} Cadete</button>
      <button class="btn" id="r-repartir" title="Divide los clientes entre los cadetes activos por zona">${icon('rutas', 14)} Repartir por zonas</button>
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

  const nc = bar.querySelector('#r-cadete'); if(nc) nc.addEventListener('click', () => abrirCadete(null));
  clearInterval(rutaTimer);
  const delDia = paradasDelDia(rutaFecha);
  if(!delDia.length){
    main.innerHTML = `<div class="stub"><div class="ico">${icon('rutas', 20)}</div><h2>No hay entregas ese día</h2>
      <p>Ningún cliente recibe viandas ni tiene pedidos el ${DIAS_LARGOS[diaSemana(rutaFecha) - 1]}.</p></div>`;
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

  let mapa = null, capa = null, encuadrado = false;
  function dibujarMapa(){
    const el = document.getElementById('r-mapa');
    if(!el || !window.L) return;
    if(!mapa){
      mapa = crearMapa(el, cocina());
      // desde el globito de una parada se cambia su dirección
      mapa.on('popupopen', (e) => {
        const b = e.popup.getElement() && e.popup.getElement().querySelector('[data-dir-mapa]');
        if(b) b.addEventListener('click', () => { mapa.closePopup(); const c = state.clientes.find(x => x.id === b.dataset.dirMapa); if(c) abrirDireccionCliente(c, () => render()); });
      });
    }
    if(capa) capa.remove();
    const miCapa = capa = window.L.layerGroup().addTo(mapa);
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
        window.L.marker([c.lat, c.lng], { icon: pinIcono(String(i + 1), color, paradaPendiente(c, rutaFecha) ? '' : 'done') }).addTo(capa)
          .bindPopup(`<b>${esc(c.nombre)}</b><br>${esc(c.direccion)}<br>${k ? esc(k.nombre) : 'Sin cadete'} · parada ${i + 1}
            ${puedeArmarRutas() ? `<br><button type="button" class="btn quiet mapa-dir" data-dir-mapa="${c.id}">${icon('pin', 12)} Cambiar dirección</button>` : ''}`);
      });
      if(kid && linea.length > 1){
        // mientras llega el camino por las calles va en línea recta, tenue
        const recto = window.L.polyline(linea, { color, weight: 3, opacity: .35, dashArray: '3 8' }).addTo(miCapa);
        const pts = linea.map(([lat, lng]) => ({ lat, lng }));
        rutaPorCalles(pts, medioDe(kid)).then((r) => {
          if(!r || !mapa.hasLayer(miCapa)) return;
          recto.remove();
          window.L.polyline(r.linea, { color, weight: 4, opacity: .85, dashArray: rutaBorrador && rutaBorrador.sucio ? '8 6' : null }).addTo(miCapa);
          const antes = rutaCallesDe[kid];
          rutaCallesDe[kid] = { km: r.km, min: r.min, clave: medioDe(kid) + puntosRuteo(pts) };
          const g = document.getElementById(`gkm-${kid}`);
          if(g && (!antes || antes.clave !== rutaCallesDe[kid].clave)) g.textContent = textoKmCalles(rutaCallesDe[kid]);
        }).catch(() => { if(mapa.hasLayer(miCapa)) recto.setStyle({ opacity: .8, dashArray: rutaBorrador && rutaBorrador.sucio ? '6 6' : null }); });
      }
      // por dónde fue (lo que mandó su celular) y dónde está ahora
      const hecho = kid ? (rutaPosiciones[kid] || []) : [];
      if(hecho.length > 1) window.L.polyline(hecho.map(p => [p.lat, p.lng]), { color, weight: 4, opacity: .45, dashArray: '2 7', lineCap: 'round' }).addTo(capa);
      if(hecho.length){
        const u = hecho[hecho.length - 1], k = cadetePorId(kid);
        const min = Math.round((Date.now() - new Date(u.at).getTime()) / 60000);
        window.L.marker([u.lat, u.lng], { icon: window.L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
          html: `<span class="cad-vivo ${min > 5 ? 'viejo' : ''}" style="--c:${color}">${esc((k ? k.nombre : '?').slice(0, 1).toUpperCase())}</span>` }), zIndexOffset: 2000 })
          .addTo(capa).bindPopup(`<b>${esc(k ? k.nombre : 'Cadete')}</b><br>${min < 1 ? 'Ahora' : `Hace ${plural(min, 'minuto')}`}`);
        todos.push([u.lat, u.lng]);
      }
    }
    // se encuadra la primera vez; después, el mapa queda donde lo dejaste (se actualiza cada 20 segundos)
    if(todos.length && !encuadrado){ mapa.fitBounds(todos, { padding: [30, 30], maxZoom: 15 }); encuadrado = true; }
  }

  function pintarLista(){
    const cont = document.getElementById('r-lista');
    const grupos = [...state.cadetes.filter(k => k.activo || paradasBorrador(k.id).length).map(k => ({ k, kid: k.id })), { k: null, kid: null }];
    cont.innerHTML = grupos.map(({ k, kid }) => {
      const ps = paradasBorrador(kid);
      if(!k && !ps.length) return '';
      const km = largoRecorrido(cocina(), ps.filter(tieneUbicacion));
      const viandas = ps.reduce((s, c) => s + platosParada(c, rutaFecha), 0);
      const hecho = kid ? rutaPosiciones[kid] || [] : [], ult = hecho[hecho.length - 1];
      const vivo = ult ? Math.round((Date.now() - new Date(ult.at).getTime()) / 60000) : null;
      const tramos = mapsRecorrido(cocina(), ps, k ? k.medio : 'vehiculo');
      const wa = k && k.telefono && ps.length ? waLink(k.telefono, textoRutaWhatsApp(k, ps)) : '';
      return `<div class="ghead" data-kid="${kid || ''}">${k ? `<span class="dot" style="--c:${k.color}"></span>` : ''}
          <span class="gname" ${k && editable ? `data-editar-cadete="${k.id}" role="button" tabindex="0" title="Editar el cadete"` : ''}>${k ? esc(k.nombre) : 'Sin cadete'}</span>
          <span class="gcount">${plural(ps.length, 'parada')} · ${plural(viandas, 'plato')}<span id="gkm-${kid || 'sin'}">${kid && rutaCallesDe[kid] ? textoKmCalles(rutaCallesDe[kid]) : km ? ` · ≈${km.toFixed(1)} km` : ''}</span></span>
          ${k && state.versionBase >= 21 ? `<span class="gmedio" role="group" aria-label="Cómo reparte ${esc(k.nombre)}">
              ${['vehiculo', 'pie'].map(m => `<button type="button" data-medio="${m}" data-k="${k.id}" aria-pressed="${k.medio === m}" ${editable ? '' : 'disabled'}
                title="${MEDIOS[m]}: ${m === 'pie' ? 'el recorrido va por donde se camina, sin calles de una mano' : 'el recorrido respeta las manos de las calles'}">${icon(m === 'pie' ? 'pie' : 'moto', 13)}<span>${m === 'pie' ? 'A pie' : 'Vehículo'}</span></button>`).join('')}</span>` : ''}
          ${vivo != null && rutaFecha === todayStr() ? `<span class="gvivo ${vivo > 5 ? 'viejo' : ''}" title="Última ubicación que mandó su celular">${vivo < 1 ? 'en vivo' : `hace ${vivo} min`}</span>` : ''}</div>
        ${k && ps.length ? `<div class="gacts">
          ${tramos.map((t, i) => `<a class="btn" href="${t.url}" target="_blank" rel="noopener">${icon('nav', 13)} ${tramos.length > 1 ? `Tramo ${i + 1}` : 'Google Maps'}</a>`).join('')}
          ${editable && usaLinksCadete() ? `<button class="btn primary" type="button" data-link="${k.id}" title="El link con el que ve sus entregas de a una">${icon('moto', 13)} Link de ${esc(k.nombre.split(' ')[0])}</button>` : ''}
          ${wa ? `<a class="btn" href="${wa}" target="_blank" rel="noopener" title="La lista completa, como texto">${icon('wa', 13)} Lista por WhatsApp</a>` : ''}
          ${editable ? `<button class="btn quiet" data-opt="${k.id}">${icon('optimizar', 13)} Optimizar</button>` : ''}</div>` : ''}
        ${ps.length ? ps.map((c, i) => `<div class="stop" data-c="${c.id}" ${editable ? 'draggable="true" title="Arrastralo para cambiar el orden o pasarlo a otro cadete"' : ''}>
            <span class="ord" style="--c:${k ? k.color : 'var(--text-3)'}">${i + 1}</span>
            <div class="t" ${editable ? `data-dir="${c.id}" role="button" tabindex="0" title="Cambiar la dirección"` : ''}><div class="n">${esc(c.nombre)}${paradaPendiente(c, rutaFecha) ? '' : ` <span class="tag ok">Listo</span>`}</div>
              <div class="s">${tieneUbicacion(c) ? '' : `<span style="color:var(--bad-ink)">Sin ubicación · </span>`}${esc(c.direccion || 'Sin dirección')}</div>
              <div class="s lleva">${esc(queLleva(c, rutaFecha))}</div></div>
            ${editable ? `<select aria-label="Cadete de ${esc(c.nombre)}" data-asignar="${c.id}"><option value="">Sin cadete</option>
                ${state.cadetes.filter(x => x.activo || x.id === kid).map(x => `<option value="${x.id}" ${x.id === kid ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select>
              <button class="iconbtn sm" data-sube="${c.id}" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>${icon('up', 13)}</button>
              <button class="iconbtn sm" data-baja="${c.id}" aria-label="Bajar" ${i === ps.length - 1 ? 'disabled' : ''}>${icon('down', 13)}</button>` : ''}
          </div>`).join('') : `<div class="empty">Sin paradas asignadas.</div>`}`;
    }).join('') + (sinUbic.length && esDueno() ? `<div class="empty">${plural(sinUbic.length, 'cliente')} sin ubicación en el mapa: tocalo para buscar su dirección. ${sinUbic.slice(0, 6).map(c => `<button class="btn quiet" data-ubicar="${c.id}">${icon('pin', 12)} ${esc(c.nombre)}</button>`).join('')}</div>` : '');

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
    cont.querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', async () => { b.classList.add('busy'); await optimizarPorCalles(b.dataset.opt); tocar(); }));
    cont.querySelectorAll('[data-ubicar]').forEach(b => b.addEventListener('click', () => { const c = state.clientes.find(x => x.id === b.dataset.ubicar); if(c) abrirDireccionCliente(c, () => render()); }));
    cont.querySelectorAll('[data-link]').forEach(b => b.addEventListener('click', () => abrirLinkCadete(cadetePorId(b.dataset.link))));
    // vehículo o a pie: cambia el recorrido, el tiempo y cómo lo guía Google Maps
    cont.querySelectorAll('[data-medio]').forEach(b => b.addEventListener('click', async () => {
      const k = cadetePorId(b.dataset.k);
      if(!k || k.medio === b.dataset.medio) return;
      b.classList.add('busy');
      try{ await guardarCadete(k.id, { ...k, medio: b.dataset.medio }); toast(`${esc(k.nombre)} reparte ${b.dataset.medio === 'pie' ? 'caminando' : 'en vehículo'}.`); render(); }
      catch(e){ toastError('No se pudo cambiar', e); b.classList.remove('busy'); }
    }));
    cont.querySelectorAll('[data-dir]').forEach(t => {
      const abrir = () => { const c = state.clientes.find(x => x.id === t.dataset.dir); if(c) abrirDireccionCliente(c, () => render()); };
      t.addEventListener('click', abrir);
      t.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); abrir(); } });
    });
    cont.querySelectorAll('[data-editar-cadete]').forEach(n => n.addEventListener('click', () => abrirCadete(n.dataset.editarCadete)));
    if(editable) arrastrarParadas(cont, tocar);
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
      toast(`Repartido entre ${plural(activos.length, 'cadete')} por zona. Revisá y guardá (con "Optimizar orden" se ordena por las calles).`, 'info');
      render();
    });
    bar.querySelector('#r-optimizar').addEventListener('click', async (ev) => {
      const b = ev.currentTarget; b.classList.add('busy');
      for(const k of state.cadetes) if(paradasBorrador(k.id).length) await optimizarPorCalles(k.id);   // de a uno, sin apurar al servicio
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
  const traerPosiciones = async () => {
    try{ rutaPosiciones = await posicionesDelDia(rutaFecha); }catch(_){ return; }
    if(activeTab !== 'rutas' || !document.getElementById('r-lista')) return clearInterval(rutaTimer);
    pintarLista(); if(window.L) dibujarMapa();
  };
  if(usaLinksCadete()){
    rutaPosiciones = {};
    traerPosiciones();
    if(rutaFecha === todayStr()) rutaTimer = setInterval(traerPosiciones, 20000);
  }
}

// "· 4,2 km · 13 min" (por las calles, en auto o moto)
const textoKmCalles = (r) => ` · ${r.km.toFixed(1).replace('.', ',')} km · ${Math.max(1, Math.round(r.min))} min`;

/* Arrastrar una parada: entre dos paradas cambia el orden (o la pasa a ese cadete); sobre el nombre de
   un cadete, va al final de su recorrido. */
function arrastrarParadas(cont, tocar){
  let id = null;
  const limpiar = () => cont.querySelectorAll('.drop-antes, .drop-despues, .drop').forEach(x => x.classList.remove('drop-antes', 'drop-despues', 'drop'));
  const ubicar = (cid, kid, antesDe, despuesDe) => {
    const a = rutaBorrador.asig[cid]; if(!a) return;
    const kidAntes = a.cadeteId || null;
    a.cadeteId = kid || null;
    const ps = paradasBorrador(kid).filter(c => c.id !== cid), c = state.clientes.find(x => x.id === cid);
    const ref = antesDe || despuesDe, i = ref ? ps.findIndex(x => x.id === ref) : -1;
    ps.splice(i < 0 ? ps.length : antesDe ? i : i + 1, 0, c);
    ps.forEach((x, k) => { rutaBorrador.asig[x.id].orden = k + 1; });
    if(kidAntes !== (kid || null)) renumerar(kidAntes);
    tocar();
  };
  cont.querySelectorAll('.stop[draggable="true"]').forEach(row => {
    row.addEventListener('dragstart', (e) => { id = row.dataset.c; row.classList.add('arrastrando'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); });
    row.addEventListener('dragend', () => { id = null; row.classList.remove('arrastrando'); limpiar(); });
    row.addEventListener('dragover', (e) => {
      if(!id || id === row.dataset.c) return;
      e.preventDefault();
      const r = row.getBoundingClientRect(), antes = e.clientY < r.top + r.height / 2;
      limpiar(); row.classList.add(antes ? 'drop-antes' : 'drop-despues');
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      if(!id || id === row.dataset.c) return;
      const antes = row.classList.contains('drop-antes'), destino = rutaBorrador.asig[row.dataset.c];
      ubicar(id, destino ? destino.cadeteId : null, antes ? row.dataset.c : null, antes ? null : row.dataset.c);
    });
  });
  cont.querySelectorAll('.ghead[data-kid]').forEach(h => {
    h.addEventListener('dragover', (e) => { if(!id) return; e.preventDefault(); limpiar(); h.classList.add('drop'); });
    h.addEventListener('dragleave', () => h.classList.remove('drop'));
    h.addEventListener('drop', (e) => { e.preventDefault(); if(id) ubicar(id, h.dataset.kid || null, null, null); });
  });
}

/* El link de un cadete: lo ve, lo copia, se lo manda por WhatsApp, crea uno nuevo (para hoy o la semana) o lo anula. */
async function abrirLinkCadete(k){
  if(!k) return;
  if(!usaLinksCadete()){ toast('Para usar los links de los cadetes hay que actualizar la base de datos (actualizar-base.sql).', 'info', 8000); return; }
  let actual = null;
  try{ actual = (await linksVigentes()).find(l => l.cadete_id === k.id) || null; }
  catch(e){ toastError('No se pudieron traer los links', e); return; }
  const nombre = k.nombre.split(' ')[0];
  const vale = (l) => l.desde === l.hasta ? 'solo hoy' : `hasta el ${formatFechaMedia(l.hasta)}`;
  const texto = (l) => `¡Hola ${nombre}! Este es tu link para las entregas${l.desde === l.hasta ? ' de hoy' : ` (sirve ${vale(l)})`}:\n${urlLinkCadete(l.token)}\n\nAbrilo en el celular: vas a ver tus entregas de a una. Dejá la ubicación activada.`;
  abrirPanel({
    titulo: `${icon('moto', 14)} Link de ${esc(k.nombre)}`,
    ancho: 'medio',
    html: `<p class="psub" style="margin-top:0">Con este link ${esc(nombre)} ve sus entregas de a una, en el orden del recorrido, y las marca desde el celular, sin usuario ni contraseña.
        Mientras lo tiene abierto, acá ves dónde está. Al crear uno nuevo, el anterior deja de servir.</p>
      ${actual ? `<div class="psec" style="margin-top:0"><h3>Link vigente <span class="n">${esc(vale(actual))}</span></h3>
          <div class="cc-link"><input class="inp" id="lk-url" readonly value="${esc(urlLinkCadete(actual.token))}"><button class="btn" type="button" id="lk-copiar">${icon('copiar', 13)} Copiar link</button></div>
          <div class="gacts" style="margin-top:10px">
            <a class="btn primary" id="lk-wa" href="${k.telefono ? waLink(k.telefono, texto(actual)) : waTexto(texto(actual))}" target="_blank" rel="noopener">${icon('wa', 13)} Mandárselo por WhatsApp</a>
            <button class="btn" type="button" id="lk-copiar-msj" title="El mensaje entero, con el link, para pegarlo en WhatsApp">${icon('copiar', 13)} Copiar mensaje</button>
            <a class="btn" href="${urlLinkCadete(actual.token)}" target="_blank" rel="noopener">${icon('nav', 13)} Ver cómo lo ve</a>
            <button class="btn quiet" type="button" id="lk-anular">Anular</button></div>
          ${k.telefono ? '' : '<p class="help">No tiene teléfono cargado: WhatsApp te va a pedir elegir el chat.</p>'}</div>`
        : `<div class="calm" style="margin-bottom:6px">${icon('info')} ${esc(nombre)} todavía no tiene un link vigente.</div>`}
      <div class="psec"><h3>${actual ? 'Crear uno nuevo' : 'Crear el link'}</h3>
        <div class="gacts"><button class="btn lg" type="button" data-dias="1">Para hoy</button><button class="btn lg" type="button" data-dias="7">Para toda la semana</button></div>
        <p class="help">"Para toda la semana" sirve hoy y los 6 días siguientes; cada día muestra las entregas de ese día.</p></div>`,
    pie: '<span class="sp"></span><button class="btn lg" id="lk-listo">Listo</button>',
    onMount: (el) => {
      el.querySelector('#lk-listo').addEventListener('click', () => cerrarPanel());
      const cp = el.querySelector('#lk-copiar');
      if(cp) cp.addEventListener('click', async () => {
        copiarConAviso(urlLinkCadete(actual.token), 'Link copiado.', cp);
      });
      // al mandarlo por WhatsApp también queda copiado, por si WhatsApp no se abre en esta compu
      const lw = el.querySelector('#lk-wa');
      if(lw) lw.addEventListener('click', () => { copiarTexto(texto(actual)).then(ok => { if(ok) toast('También quedó copiado: si WhatsApp no se abre, pegalo en el chat del cadete.', 'info', 7000); }); });
      const cm = el.querySelector('#lk-copiar-msj');
      if(cm) cm.addEventListener('click', () => copiarConAviso(texto(actual), 'Mensaje copiado: pegalo en el chat del cadete.', cm));
      const an = el.querySelector('#lk-anular');
      if(an) an.addEventListener('click', async () => {
        if(!(await confirmar('Anular el link', `¿Anular el link de <b>${esc(k.nombre)}</b>? Deja de servir enseguida.`, { ok: 'Anular', peligro: true }))) return;
        try{ await anularLinksCadete(k); toast('Link anulado.'); abrirLinkCadete(k); }catch(e){ toastError('No se pudo anular', e); }
      });
      el.querySelectorAll('[data-dias]').forEach(b => b.addEventListener('click', async () => {
        b.classList.add('busy');
        try{ await crearLinkCadete(k, Number(b.dataset.dias)); toast(`Link nuevo para <b>${esc(k.nombre)}</b>: mandáselo por WhatsApp.`); abrirLinkCadete(k); }
        catch(e){ toastError('No se pudo crear el link', e); b.classList.remove('busy'); }
      }));
    }
  });
}
