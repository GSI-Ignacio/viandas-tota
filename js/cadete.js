/* ============================================================
   PÁGINA DEL CADETE (cadete.html?t=…) — sin usuario: con el link que le
   mandan por WhatsApp. Ve sus entregas de hoy de a una, en el orden del
   recorrido: a quién, dónde y qué lleva. Desde ahí abre Google Maps para
   llegar, le avisa al cliente que va en camino y marca la entrega; después
   aparece la siguiente. Mientras la página está abierta manda su ubicación,
   para que en Recorridos se vea dónde está y por dónde fue.
   Usa las mismas reglas que la app (data.js) con lo que manda la base para
   ese link (ruta_link): sus clientes, sus entregas y pedidos de hoy y el orden.
============================================================= */
const cadToken = new URLSearchParams(location.search).get('t') || '';
const cadRaiz = document.getElementById('cad');
let cad = null;              // lo último que mandó la base
let cadPos = null;           // dónde está: { lat, lng, precision, at }
let cadEnviada = null;       // la última ubicación que se mandó
let cadMarcando = false;
let cadMapa = null, cadCapa = null;
let cadWake = null;          // la pantalla encendida mientras reparte
// "Volver más tarde" y "No lo recibe hoy": quedan en el celular, solo para este link
const cadClave = (k) => `cad.${k}.${cadToken.slice(0, 12)}`;
const cadLeer = (k) => { try{ return new Set(JSON.parse(sessionStorage.getItem(cadClave(k)) || '[]')); }catch(_){ return new Set(); } };
const cadGuardar = (k, set) => { try{ sessionStorage.setItem(cadClave(k), JSON.stringify([...set])); }catch(_){} };
let cadDespues = cadLeer('despues'), cadSinEntregar = cadLeer('sin');

/* Lo que mandó la base, en el mismo formato que usa la app. */
function cadCargar(d){
  cad = d;
  const neg = d.negocio || {};
  state.versionBase = VERSION_BASE_APP;
  state.perfil = { rol: 'cadete', negocioId: null, cadeteId: d.cadete ? d.cadete.id : null, nombre: d.cadete ? d.cadete.nombre : '' };
  state.config = { ...state.config, nombre: neg.nombre || 'Viandas', cocinaDireccion: neg.cocina_direccion || '',
    cocinaLat: neg.cocina_lat == null ? null : Number(neg.cocina_lat), cocinaLng: neg.cocina_lng == null ? null : Number(neg.cocina_lng) };
  state.cadetes = d.cadete ? [mapCadete({ ...d.cadete, activo: true })] : [];
  state.clientes = (d.clientes || []).map(mapCliente);
  state.entregas = {};
  for(const r of d.entregas || []){ const e = mapEntrega(r); state.entregas[clave(e.clienteId, e.fecha)] = e; }
  state.comandas = {};
  guardarComandasEnEstado(d.comandas || [], [d.fecha]);
  state.rutas = {};
  for(const r of d.rutas || []) state.rutas[clave(r.cliente_id, r.fecha)] = { cadeteId: r.cadete_id, orden: r.orden };
  state.menus = armarMenus(d.menus || [], []);
  state.productos = (d.guarniciones || []).map(g => mapProducto({ ...g, es_guarnicion: true, activo: true }));
  state.diasCerrados = d.cerrado ? { [d.fecha]: { motivo: '' } } : {};
  state.fechasCargadas = new Set([d.fecha]);
}

async function cadTraer(){
  const { data, error } = await sb.rpc('ruta_link', { p_token: cadToken });
  if(error) throw error;
  cadCargar(data);
}

/* ---------- lo que se ve ---------- */
const cadK = () => state.cadetes[0];
function cadParadas(){
  const f = cad.fecha, todas = paradasDe(cadK().id, f);
  const pend = todas.filter(c => paradaPendiente(c, f) && !cadSinEntregar.has(c.id));
  return { todas, cola: [...pend.filter(c => !cadDespues.has(c.id)), ...pend.filter(c => cadDespues.has(c.id))] };
}
const cadDist = (c) => cadPos && tieneUbicacion(c) ? distanciaKm(cadPos, c) : null;
const cadDistTxt = (km) => km < 0.15 ? 'muy cerca' : km < 1 ? `${Math.max(1, Math.round(km * 10))} cuadras` : `${km.toFixed(1).replace('.', ',')} km`;
// lo que hay que cobrar (o no) en un pedido
function cadCobro(c){
  const p = pedidoDelDia(c, cad.fecha);
  if(!p || !p.total) return null;
  const t = fmtPlata(p.total);
  if(p.formaPago === 'efectivo') return { cls: 'cobrar', txt: `Cobrar ${t} en efectivo` };
  if(p.formaPago === 'transferencia') return { cls: '', txt: `${t} · paga por transferencia` };
  if(p.formaPago === 'mercadopago') return { cls: '', txt: `${t} · paga con Mercado Pago` };
  if(p.formaPago === 'cuenta') return { cls: '', txt: 'Va a cuenta: no se cobra' };
  return { cls: '', txt: `Total ${t}` };
}
// el mensaje para avisarle al cliente que va en camino
function cadMensaje(c){
  const km = cadDist(c), cuadras = km == null ? null : Math.max(1, Math.round(km * 10));
  const donde = cuadras == null ? '' : cuadras <= 2 ? ': ya estoy llegando' : `: estoy a unas ${cuadras} cuadras`;
  return `¡Hola ${c.nombre.split(' ')[0]}! Soy ${cadK().nombre.split(' ')[0]}, de ${state.config.nombre}. Voy en camino con tu pedido${donde}. ¡Gracias!`;
}

function cadPintar(){
  const k = cadK();
  const { todas, cola } = cadParadas(), c = cola[0];
  const hechas = todas.filter(x => !paradaPendiente(x, cad.fecha)).length;
  const pct = todas.length ? Math.round(hechas * 100 / todas.length) : 0;
  // el mapa de la tarjeta anterior se saca antes de borrarla (si no, el mapa falla al moverse)
  if(cadMapa){ try{ cadMapa.remove(); }catch(_){} cadMapa = null; cadCapa = null; }
  cadRaiz.innerHTML = `
    <header class="cad-top">
      <div class="cad-hola"><b>${esc(state.config.nombre)}</b><span>Hola, ${esc(k.nombre.split(' ')[0])} · ${esc(nombreDia(cad.fecha))}</span></div>
      <button type="button" class="cad-gps ${cadPos ? 'on' : cadBloqueada ? 'bloq' : ''}" id="cad-gps" title="${cadPos ? 'Tu ubicación se está compartiendo' : 'Tocá para compartir tu ubicación'}">
        <i></i>${cadPos ? 'Ubicación activa' : cadBloqueada ? 'Ubicación bloqueada' : cadMirando != null ? 'Buscando ubicación…' : 'Activar ubicación'}</button>
    </header>
    ${cadBloqueada && !cadPos ? `<div class="cad-aviso-gps">${icon('alerta', 16)}<div><b>La ubicación está bloqueada para esta página.</b>
        Así la cocina no ve por dónde vas ni le puede avisar al cliente cuántas cuadras faltan. Para activarla:
        <ul><li><b>Android (Chrome):</b> tocá el candado o los tres puntos al lado de la dirección → Permisos → Ubicación → Permitir.</li>
          <li><b>iPhone:</b> Ajustes → Safari (o Chrome) → Ubicación → Permitir o Preguntar.</li>
          <li>Si se abrió dentro de WhatsApp, abrila en el navegador (⋮ → Abrir en Chrome / Safari).</li></ul>
        <button type="button" class="btn" id="cad-gps-otra">${icon('deshacer', 13)} Ya la activé</button></div></div>` : ''}
    ${todas.length ? `<div class="cad-prog"><div class="cad-barra"><i style="width:${pct}%"></i></div><span>${hechas} de ${plural(todas.length, 'entrega')}</span></div>` : ''}
    ${c ? cadTarjeta(c, cola.length) : cadFin(todas)}`;
  cadBind(c);
  if(c) cadDibujarMapa(c);
}

function cadTarjeta(c, quedan){
  const f = cad.fecha, km = cadDist(c), cobro = cadCobro(c);
  const wa = waLink(c.telefono, cadMensaje(c)), tel = telLink(c.telefono);
  return `<article class="cad-card" data-c="${c.id}">
    <div class="cad-k">${cadDespues.has(c.id) ? 'Volvés a pasar' : 'Próxima entrega'}<span>${quedan > 1 ? `después quedan ${quedan - 1}` : 'es la última'}</span></div>
    <h1>${esc(c.nombre)}</h1>
    <p class="cad-dir">${icon('pin', 16)}<span>${esc(c.direccion || 'Sin dirección cargada')}${c.referencia ? `<small>${esc(c.referencia)}</small>` : ''}</span></p>
    ${km != null ? `<p class="cad-lejos" id="cad-lejos">A ${esc(cadDistTxt(km))} de vos</p>` : '<p class="cad-lejos" id="cad-lejos"></p>'}
    <div class="cad-lleva"><span>Lleva</span><b>${esc(queLleva(c, f))}</b></div>
    ${cobro ? `<div class="cad-cobro ${cobro.cls}">${icon('billete', 16)} ${esc(cobro.txt)}</div>` : ''}
    ${c.notas ? `<p class="cad-nota">${icon('info', 14)} ${esc(c.notas)}</p>` : ''}
    ${tieneUbicacion(c) ? '<div class="cad-mapa" id="cad-mapa"></div>' : ''}
    <div class="cad-acc">
      <a class="btn lg" href="${mapsNavegar(c, cadK().medio)}" target="_blank" rel="noopener">${icon(cadK().medio === 'pie' ? 'pie' : 'nav', 16)} Cómo llegar</a>
      ${wa ? `<a class="btn lg" href="${wa}" target="_blank" rel="noopener" id="cad-avisar">${icon('wa', 16)} Avisar que voy</a>` : ''}
      ${tel ? `<a class="btn lg" href="${tel}">${icon('tel', 16)} Llamar</a>` : ''}
    </div>
    <button type="button" class="btn primary cad-ok" id="cad-entregado">${icon('check', 20)} Entregado</button>
    <button type="button" class="btn lg quiet cad-no" id="cad-noestaba">No estaba</button>
  </article>`;
}

function cadFin(todas){
  const sin = todas.filter(c => cadSinEntregar.has(c.id) && paradaPendiente(c, cad.fecha));
  const co = cocina();
  return `<article class="cad-card cad-fin">
    <div class="cad-fin-ico">${icon(todas.length ? 'check' : 'moto', 26)}</div>
    <h1>${todas.length ? '¡Terminaste las entregas!' : 'Hoy no tenés entregas'}</h1>
    <p>${todas.length ? `Entregaste ${plural(todas.length - sin.length, 'parada')} de ${todas.length}.` : 'Si te asignan alguna, aparece acá: dejá esta página abierta o volvé a abrir el link.'}</p>
    ${sin.length ? `<div class="cad-sin"><b>No se entregaron:</b> ${sin.map(c => esc(c.nombre)).join(', ')}. Avisale a la cocina.
      <button type="button" class="btn" id="cad-reintentar">${icon('deshacer', 14)} Volver a intentar</button></div>` : ''}
    ${todas.length && tieneUbicacion(co) ? `<a class="btn lg" href="${mapsNavegar(co, cadK().medio)}" target="_blank" rel="noopener">${icon('nav', 16)} Volver a la cocina</a>` : ''}
  </article>`;
}

function cadDibujarMapa(c){
  const el = document.getElementById('cad-mapa');
  if(!el) return;
  cargarLeaflet().then(() => {
    if(!el.isConnected) return;
    if(!cadMapa || cadMapa.getContainer() !== el){ if(cadMapa) cadMapa.remove(); cadMapa = crearMapa(el, c); cadCapa = null; }
    if(cadCapa) cadCapa.remove();
    cadCapa = window.L.layerGroup().addTo(cadMapa);
    window.L.marker([c.lat, c.lng], { icon: pinIcono('', cadK().color) }).addTo(cadCapa);
    const pts = [[c.lat, c.lng]], capa = cadCapa, co = cocina();
    // sin su ubicación todavía, y antes de la primera entrega: el camino sale de la cocina
    const desdeCocina = !cadPos && tieneUbicacion(co) && !paradasDe(cadK().id, cad.fecha).some(x => !paradaPendiente(x, cad.fecha));
    if(desdeCocina){
      window.L.marker([co.lat, co.lng], { icon: pinIcono('C', '#241F17', 'home') }).addTo(capa);
      pts.push([co.lat, co.lng]);
      rutaPorCalles([co, c], cadK().medio).then(r => { if(r && cadMapa && cadMapa.hasLayer(capa)) window.L.polyline(r.linea, { color: cadK().color, weight: 4, opacity: .8 }).addTo(capa); }, () => {});
    }
    if(cadPos){
      window.L.circleMarker([cadPos.lat, cadPos.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2F80ED', fillOpacity: 1 }).addTo(capa);
      pts.push([cadPos.lat, cadPos.lng]);
      // el camino por las calles hasta ahí (se vuelve a pedir recién cuando se movió unos 200 metros)
      const paso = 0.002, desde = { lat: Math.round(cadPos.lat / paso) * paso, lng: Math.round(cadPos.lng / paso) * paso };
      rutaPorCalles([desde, c], cadK().medio).then(r => { if(r && cadMapa && cadMapa.hasLayer(capa)) window.L.polyline(r.linea, { color: cadK().color, weight: 4, opacity: .8 }).addTo(capa); }, () => {});
    }
    const m = cadMapa;
    const encuadrar = () => { if(pts.length > 1) m.fitBounds(pts, { padding: [26, 26], maxZoom: 16, animate: false }); else m.setView(pts[0], 15, { animate: false }); };
    encuadrar();
    // la tarjeta entra con una animación: al terminar, el mapa se acomoda a su tamaño final
    setTimeout(() => { if(el.isConnected && cadMapa === m){ m.invalidateSize(false); encuadrar(); } }, 450);
  }).catch(() => { el.remove(); });
}

/* ---------- acciones ---------- */
async function cadMarcar(c, estado){
  if(cadMarcando) return;
  cadMarcando = true;
  const f = cad.fecha, turnos = turnosDe(c, f).filter(t => turnoPendiente(c, f, t)), conPedido = (pedidoDelDia(c, f) || {}).estado === 'pendiente';
  try{
    const { data, error } = await sb.rpc('marcar_link', { p_token: cadToken, p_cliente: c.id, p_turnos: turnos, p_estado: estado, p_pedido: conPedido });
    if(error) throw error;
    cadDespues.delete(c.id); cadGuardar('despues', cadDespues);
    cadCargar(data);
    cadPintar();
    toast(estado === 'entregado' ? `Listo: entregado a <b>${esc(c.nombre)}</b>.` : `<b>${esc(c.nombre)}</b>: no lo recibió.`, 'ok', 7000, {
      label: 'Deshacer', fn: async () => {
        try{ const r = await sb.rpc('marcar_link', { p_token: cadToken, p_cliente: c.id, p_turnos: turnos, p_estado: 'pendiente', p_pedido: conPedido });
          if(r.error) throw r.error; cadSinEntregar.delete(c.id); cadGuardar('sin', cadSinEntregar); cadCargar(r.data); cadPintar(); }
        catch(e){ cadError(e, 'No se pudo deshacer'); }
      }
    });
  }catch(e){ cadError(e, 'No se pudo marcar'); }
  finally{ cadMarcando = false; }
}

async function cadNoEstaba(c){
  const f = cad.fecha, tieneViandas = turnosDe(c, f).some(t => turnoPendiente(c, f, t));
  const r = await dialogo({
    titulo: `${c.nombre.split(' ')[0]} no estaba`,
    texto: 'Podés seguir con la próxima y volver a pasar al final, o dejarlo sin entregar por hoy.',
    botones: [{ id: 'cancelar', label: 'Cancelar' }, { id: 'sin', label: 'No lo recibe hoy' }, { id: 'despues', label: 'Volver más tarde', clase: 'primary' }]
  });
  if(!r) return;
  if(r.boton === 'despues'){
    cadDespues.add(c.id); cadGuardar('despues', cadDespues);
    toast(`<b>${esc(c.nombre)}</b> pasa al final.`, 'info');
    cadPintar();
    return;
  }
  cadSinEntregar.add(c.id); cadGuardar('sin', cadSinEntregar);
  // las viandas de un pack cuentan igual (como hasta ahora: "no lo recibió"); el pedido queda para la cocina
  if(tieneViandas) await cadMarcar(c, 'no_recibido'); else cadPintar();
}

function cadBind(c){
  const gps = document.getElementById('cad-gps');
  if(gps) gps.addEventListener('click', () => cadUbicacion(true));
  const otra = document.getElementById('cad-gps-otra');
  if(otra) otra.addEventListener('click', () => { cadBloqueada = false; cadUbicacion(true); cadPintar(); });
  const re = document.getElementById('cad-reintentar');
  if(re) re.addEventListener('click', () => { cadSinEntregar = new Set(); cadGuardar('sin', cadSinEntregar); cadPintar(); });
  if(!c) return;
  // si la ubicación no está prendida, cada toque la vuelve a pedir (el celular pregunta, si hace falta)
  const pedir = () => { if(!cadPos && cadMirando == null && !cadBloqueada) cadUbicacion(true); };
  document.getElementById('cad-entregado').addEventListener('click', () => { pedir(); cadMarcar(c, 'entregado'); });
  document.getElementById('cad-noestaba').addEventListener('click', () => cadNoEstaba(c));
  // el aviso lleva la distancia de ese momento
  const av = document.getElementById('cad-avisar');
  if(av) av.addEventListener('click', () => { pedir(); av.href = waLink(c.telefono, cadMensaje(c)); });
}

/* ---------- la ubicación ----------
   Arranca sola al abrir el link: la primera vez el celular pregunta si la deja usar y después se acuerda.
   Si la bloqueó, se explica cómo activarla. */
let cadMirando = null, cadBloqueada = false;
function cadUbicacion(pedida){
  if(!navigator.geolocation){ if(pedida) toast('Este celular no comparte la ubicación desde el navegador.', 'err'); return; }
  if(cadMirando != null) return;
  cadMirando = navigator.geolocation.watchPosition((p) => {
    const primera = !cadPos;
    cadBloqueada = false;
    cadPos = { lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy, at: Date.now() };
    cadEnviar();
    if(primera) cadPintar(); else cadActualizarDistancia();
  }, (err) => {
    // bloqueada: se deja de pedir y se explica cómo activarla; si solo tardó, se sigue intentando
    if(err.code === 1){ navigator.geolocation.clearWatch(cadMirando); cadMirando = null; cadBloqueada = true; cadPintar(); }
    else if(pedida) toast('Todavía no se encuentra la ubicación: revisá que el GPS del celular esté prendido.', 'info', 7000);
  }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  cadPantalla();
}
// manda la ubicación cada 20 segundos, o antes si se movió 30 metros
function cadEnviar(){
  const ahora = Date.now();
  if(cadEnviada && ahora - cadEnviada.at < 20000 && distanciaKm(cadEnviada, cadPos) < 0.03) return;
  cadEnviada = { ...cadPos, at: ahora };
  sb.rpc('posicion_link', { p_token: cadToken, p_lat: cadPos.lat, p_lng: cadPos.lng, p_precision: cadPos.precision }).then(() => {}, () => {});
}
function cadActualizarDistancia(){
  const card = document.querySelector('.cad-card[data-c]');
  if(!card) return;
  const c = clientePorId(card.dataset.c), km = c && cadDist(c), el = document.getElementById('cad-lejos');
  if(el && km != null) el.textContent = `A ${cadDistTxt(km)} de vos`;
  if(c && cadMapa && cadCapa) cadDibujarMapa(c);
}
// con la pantalla prendida la ubicación se sigue mandando (con el celular bloqueado, el navegador la corta)
async function cadPantalla(){
  try{ if('wakeLock' in navigator && !cadWake && document.visibilityState === 'visible') cadWake = await navigator.wakeLock.request('screen');
    if(cadWake) cadWake.addEventListener('release', () => { cadWake = null; }); }catch(_){}
}

function cadError(e, titulo){
  const msg = String((e && e.message) || e || '');
  if(/link_vencido/.test(msg)) return cadVencido();
  toast(`${titulo}: ${esc(traducirError(msg))}`, 'err', 9000);
}
function cadVencido(){
  cadRaiz.innerHTML = `<article class="cad-card cad-fin">
    <div class="cad-fin-ico">${icon('alerta', 26)}</div>
    <h1>Este link ya no sirve</h1>
    <p>Venció o lo cambiaron. Pedile el link nuevo a la cocina.</p></article>`;
}

/* ---------- arranque ---------- */
(async function(){
  if(!cadToken) return cadVencido();
  try{ await cadTraer(); }
  catch(e){ const msg = String((e && e.message) || e); if(/link_vencido/.test(msg)) return cadVencido();
    cadRaiz.innerHTML = `<article class="cad-card cad-fin"><div class="cad-fin-ico">${icon('alerta', 26)}</div><h1>No se pudo cargar</h1>
      <p>Revisá la conexión y volvé a abrir el link.</p><button class="btn lg" onclick="location.reload()">Reintentar</button></article>`; return; }
  document.title = `Entregas · ${cadK() ? cadK().nombre : ''}`;
  cadPintar();
  // la ubicación arranca sola (la primera vez el celular pregunta; después se acuerda)
  cadUbicacion(false);
  // cada minuto (y al volver a la página) trae lo último: si la cocina cambia el orden o suma una entrega
  setInterval(() => { if(document.visibilityState === 'visible' && !cadMarcando) cadTraer().then(cadPintar, (e) => { if(/link_vencido/.test(String(e && e.message))) cadVencido(); }); }, 60000);
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState !== 'visible') return;
    cadPantalla();
    if(cadMirando == null && !cadBloqueada) cadUbicacion(false);
    if(!cadMarcando) cadTraer().then(cadPintar, () => {});
  });
})();
