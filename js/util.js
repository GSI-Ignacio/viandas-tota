/* ============================================================
   UTILIDADES: fechas, formato, íconos, avisos, diálogos, panel
   lateral, mapas y cálculo de rutas.
============================================================= */

/* ---------- fechas (siempre como texto AAAA-MM-DD, hora local) ---------- */
function isoLocal(d){
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}
function todayStr(){ return isoLocal(new Date()); }
function parseFecha(str){ const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d, 12); }
function sumarDias(str, n){ const d = parseFecha(str); d.setDate(d.getDate() + n); return isoLocal(d); }
function diaSemana(str){ const g = parseFecha(str).getDay(); return g === 0 ? 7 : g; } // 1 = lunes … 7 = domingo
function formatFechaLarga(str){ return parseFecha(str).toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' }); }
function formatFechaMedia(str){ return parseFecha(str).toLocaleDateString('es-AR', { weekday:'short', day:'numeric', month:'short' }); }
function formatFechaCorta(str){ const [y, m, d] = str.split('-'); return `${d}/${m}/${y}`; }
function formatHora(ts){ return new Date(ts).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' }); }
function formatFechaHora(ts){
  const d = new Date(ts);
  return d.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit' }) + ' ' + formatHora(ts);
}
function nombreDia(str){
  const hoy = todayStr();
  if(str === hoy) return 'Hoy';
  if(str === sumarDias(hoy, 1)) return 'Mañana';
  if(str === sumarDias(hoy, -1)) return 'Ayer';
  return parseFecha(str).toLocaleDateString('es-AR', { weekday:'short', day:'numeric' });
}
const DIAS_CORTOS = ['L','M','M','J','V','S','D'];
const DIAS_LARGOS = ['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
function saludo(){ const h = new Date().getHours(); return h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches'; }

/* ---------- formato ---------- */
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
const esc = escapeHtml;
/* Para comparar nombres sin importar mayúsculas, tildes ni espacios de más. */
const normalizarNombre = (t) => String(t || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
function plural(n, uno, varios){ return `${n} ${n === 1 ? uno : (varios || uno + 's')}`; }
function fmtNum(n){
  const v = Number(n) || 0;
  return v.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}
function fmtPlata(n){ return n == null || n === '' ? '' : '$ ' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 }); }
function iniciales(nombre){
  const p = String(nombre || '?').trim().split(/\s+/);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}
function hueDe(texto){ let h = 0; for(const ch of String(texto)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
function avatarHtml(nombre, s = 20){ return `<span class="av" style="--s:${s}px;--h:${hueDe(nombre)}">${esc(iniciales(nombre))}</span>`; }

/* ---------- íconos (trazo de 1.5 sobre 16px) ---------- */
const ICON_PATHS = {
  hoy: '<path d="M2.5 9.5h3l1 2h3l1-2h3"/><path d="M2.5 9.5 4 3.5h8l1.5 6v3h-11z"/>',
  entregas: '<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="m5.5 8 1.8 1.8L10.5 6.4"/>',
  rutas: '<circle cx="4" cy="12" r="1.6"/><circle cx="12" cy="4" r="1.6"/><path d="M5.6 12H10a2 2 0 0 0 0-4H6a2 2 0 0 1 0-4h4.4"/>',
  clientes: '<circle cx="6" cy="5.5" r="2.3"/><path d="M1.8 13c.5-2.2 2.2-3.5 4.2-3.5s3.7 1.3 4.2 3.5"/><path d="M10.5 3.4a2.2 2.2 0 0 1 0 4.2M12 9.8c1.2.5 2 1.6 2.3 3.2"/>',
  stock: '<path d="M8 1.8 13.5 4.5v7L8 14.2 2.5 11.5v-7z"/><path d="M2.5 4.5 8 7.2l5.5-2.7M8 7.2v7"/>',
  registro: '<path d="M4 2.5h6l2.5 2.5v8.5H4z"/><path d="M6 7h4.5M6 9.5h4.5M6 12h2.5"/>',
  equipo: '<circle cx="8" cy="5" r="2.5"/><path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"/>',
  ajustes: '<circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2"/>',
  backup: '<path d="M8 2.5v7.5M5 7l3 3 3-3"/><path d="M2.5 11v2.5h11V11"/>',
  buscar: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  x: '<path d="m4 4 8 8M12 4l-8 8"/>',
  check: '<path d="m3.5 8.5 3 3 6-7"/>',
  chevL: '<path d="m10 3.5-4.5 4.5 4.5 4.5"/>',
  chevR: '<path d="m6 3.5 4.5 4.5L6 12.5"/>',
  chevD: '<path d="m4 6 4 4 4-4"/>',
  up: '<path d="m4 10 4-4 4 4"/>',
  down: '<path d="m4 6 4 4 4-4"/>',
  moon: '<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/>',
  sun: '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>',
  salir: '<path d="M6 2.5H3.5v11H6"/><path d="M10 5l3 3-3 3M13 8H6.5"/>',
  editar: '<path d="M10.5 2.8 13.2 5.5 5.5 13.2H2.8v-2.7z"/>',
  borrar: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9"/>',
  pausa: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
  play: '<path d="M5 3.2v9.6L12.5 8z"/>',
  alerta: '<path d="M8 2 14.5 13.5h-13z"/><path d="M8 6.5v3M8 11.6v.1"/>',
  pin: '<path d="M8 14.5s4.5-4.2 4.5-8a4.5 4.5 0 0 0-9 0c0 3.8 4.5 8 4.5 8z"/><circle cx="8" cy="6.5" r="1.6"/>',
  nav: '<path d="M13.5 2.5 2.5 7l4.6 1.9L9 13.5z"/>',
  tel: '<path d="M4 2.5h2l1 3-1.5 1a7 7 0 0 0 3.9 3.9l1-1.5 3 1v2a1.5 1.5 0 0 1-1.6 1.5A11 11 0 0 1 2.5 4.1 1.5 1.5 0 0 1 4 2.5z"/>',
  wa: '<path d="M3 13l.8-2.6A5.5 5.5 0 1 1 5.9 12.3z"/><path d="M6.2 5.8c.2 1.9 1.9 3.6 3.8 3.9l.7-.9-1.1-.6-.5.4c-.6-.3-1.1-.8-1.4-1.4l.4-.5-.6-1.1z"/>',
  sol: '<circle cx="8" cy="8" r="2.6"/><path d="M8 2v1.3M8 12.7V14M2 8h1.3M12.7 8H14M3.8 3.8l.9.9M11.3 11.3l.9.9M3.8 12.2l.9-.9M11.3 4.7l.9-.9"/>',
  luna: '<path d="M12.5 9.8A5 5 0 0 1 6.2 3.5a5 5 0 1 0 6.3 6.3z"/>',
  caja: '<path d="M2.5 5.5h11v8h-11z"/><path d="M1.8 3h12.4v2.5H1.8zM6.5 8h3"/>',
  mapa: '<path d="M1.8 3.8 6 2.3l4 1.5 4.2-1.5v9.9L10 13.7l-4-1.5-4.2 1.5z"/><path d="M6 2.3v9.9M10 3.8v9.9"/>',
  moto: '<circle cx="4" cy="11.5" r="2"/><circle cx="12" cy="11.5" r="2"/><path d="M4 11.5 7 6h3l2 5.5M9 3.5h2L10 6"/>',
  pago: '<rect x="1.8" y="4" width="12.4" height="8.5" rx="1.5"/><path d="M1.8 7h12.4M4.5 10h2.5"/>',
  reloj: '<circle cx="8" cy="8" r="5.8"/><path d="M8 4.8V8l2.2 1.5"/>',
  info: '<circle cx="8" cy="8" r="5.8"/><path d="M8 7.2v3.6M8 5.2v.1"/>',
  optimizar: '<path d="M2.5 13.5c3-1 4-3.5 5.5-5.5S11.5 3.5 13.5 2.5"/><path d="M10.5 2.5h3v3"/>',
  lista: '<path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><path d="M2.5 4h.1M2.5 8h.1M2.5 12h.1"/>',
  copiar: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 11V3.5A1 1 0 0 1 4 2.5h7"/>',
  comanda: '<path d="M4 1.8h8v12.4l-1.6-1-1.2 1-1.2-1-1.2 1-1.2-1-1.6 1z"/><path d="M6 5h4M6 7.5h4M6 10h2.5"/>',
  menu: '<path d="M3 9.5a5 5 0 0 1 10 0z"/><path d="M1.8 11.5h12.4M8 3v1.5"/>',
  deshacer: '<path d="M5.5 3.5 2.8 6.2l2.7 2.7"/><path d="M3 6.2h6.3a3.7 3.7 0 0 1 0 7.4H7"/>',
  grafico: '<path d="M2 13.5h12"/><path d="M4 11V8M7 11V4.5M10 11V6.5M13 11V9"/>'
};
function icon(name, size = 16, cls = ''){
  return `<svg class="${cls}" viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}

/* ---------- avisos (toasts) ---------- */
/* accion: { label, fn } agrega un botón (por ejemplo "Deshacer"). */
function toast(msg, tipo = 'ok', ms, accion){
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + tipo;
  el.setAttribute('role', tipo === 'err' ? 'alert' : 'status');
  el.innerHTML = icon(tipo === 'err' ? 'alerta' : tipo === 'info' ? 'info' : 'check', 15) + `<div>${msg}</div>`
    + (accion ? `<button class="tact" type="button">${esc(accion.label)}</button>` : '');
  root.appendChild(el);
  let listo = false;
  const quitar = () => { if(listo) return; listo = true; el.classList.add('out'); setTimeout(() => el.remove(), 180); };
  setTimeout(quitar, ms || (accion ? 6000 : tipo === 'err' ? 6500 : 3200));
  el.addEventListener('click', quitar);
  if(accion) el.querySelector('.tact').addEventListener('click', (e) => { e.stopPropagation(); quitar(); accion.fn(); });
}
function toastError(prefijo, error){
  const m = error && (error.message || error.error_description) || String(error || '');
  toast(`<b>${esc(prefijo)}</b><br>${esc(traducirError(m))}`, 'err');
}
function traducirError(m){
  if(/row-level security|permission denied/i.test(m)) return 'Tu usuario no tiene permiso para hacer esto.';
  if(/Failed to fetch|NetworkError|network/i.test(m)) return 'No hay conexión. Revisá internet y probá de nuevo.';
  if(/duplicate key/i.test(m)) return 'Ya existe un registro igual.';
  return m;
}

/* animación de carga (la misma del arranque) */
const LOADER_HTML = '<div class="ld-orbit" role="img" aria-label="Cargando">' + ['o1', 'o2', 'o3'].map(o => `<i class="${o}">${'<b></b>'.repeat(5)}</i>`).join('') + '<s></s></div>';

/* ---------- campos obligatorios ---------- */
// Asterisco rojo para la etiqueta de un campo obligatorio.
const REQ = '<span class="req" title="Obligatorio" aria-hidden="true">*</span>';
/* Marca en rojo un campo obligatorio sin completar, con el mensaje debajo; se limpia al corregirlo. Devuelve false. */
function marcarFalta(campo, mensaje){
  if(!campo){ toast(mensaje, 'err'); return false; }
  const cont = campo.closest('.field') || campo.closest('.cline') || campo.parentElement;
  let msg = [...cont.children].find(x => x.classList.contains('falta'));
  if(!msg){ msg = document.createElement('div'); msg.className = 'falta'; msg.setAttribute('role', 'alert'); cont.append(msg); }
  msg.innerHTML = `${icon('alerta', 13)}<span>${mensaje}</span>`;
  campo.classList.add('invalido');
  campo.setAttribute('aria-invalid', 'true');
  const limpiar = () => {
    campo.classList.remove('invalido'); campo.removeAttribute('aria-invalid'); msg.remove();
    campo.removeEventListener('input', limpiar); campo.removeEventListener('change', limpiar);
  };
  campo.addEventListener('input', limpiar); campo.addEventListener('change', limpiar);
  const foco = campo._selBtn || campo;
  foco.scrollIntoView({ block: 'nearest' });
  if(foco.focus) foco.focus({ preventScroll: true });
  return false;
}

/* ---------- capas: panel lateral, diálogos, paleta ---------- */
const capas = [];   // pila de capas abiertas; Escape cierra la última
function abrirCapa(el, cerrar){ capas.push({ el, cerrar }); }
function cerrarCapaSuperior(){ const c = capas[capas.length - 1]; if(c){ c.cerrar(); return true; } return false; }
function quitarCapa(el){ const i = capas.findIndex(c => c.el === el); if(i >= 0) capas.splice(i, 1); }
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && cerrarCapaSuperior()){ e.preventDefault(); }
});

/* Ventana de detalle. html: contenido; onMount(el) para enganchar eventos.
   ancho: 'grande' (horizontal, las secciones .psec se reparten en columnas) o 'medio'.
   En el celular siempre se abre vertical, a pantalla completa. */
let peekActual = null;
function abrirPanel({ titulo = '', html, pie = '', onMount, onClose, ancho = 'grande' }){
  // Si ya hay una ventana abierta se actualiza en el lugar: no se cierra ni se vuelve a abrir
  // (por ejemplo después de guardar), y se conserva hasta dónde estaba scrolleada.
  if(peekActual && peekActual.el.isConnected && !peekActual.el.classList.contains('out')){
    const el = peekActual.el, body = el.querySelector('.pbody'), scroll = body.scrollTop;
    el.className = 'peek ' + ancho;
    el.setAttribute('aria-label', String(titulo || 'Detalle').replace(/<[^>]+>/g, '').trim() || 'Detalle');
    el.querySelector('.phead .id').innerHTML = titulo;
    body.innerHTML = html;
    let foot = el.querySelector('.pfoot');
    if(pie){ if(!foot){ foot = document.createElement('div'); foot.className = 'pfoot'; el.appendChild(foot); } foot.innerHTML = pie; }
    else if(foot) foot.remove();
    peekActual.onClose = onClose;
    if(onMount) onMount(el);
    body.scrollTop = scroll;
    return el;
  }
  cerrarPanel(true);
  const scrim = document.createElement('div');
  scrim.className = 'scrim peekscrim';
  const el = document.createElement('section');
  el.className = 'peek ' + ancho;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', String(titulo || 'Detalle').replace(/<[^>]+>/g, '').trim() || 'Detalle');
  el.innerHTML = `
    <div class="phead"><div class="id">${titulo}</div><div class="sp"></div>
      <button class="iconbtn" data-cerrar aria-label="Cerrar" title="Cerrar (Esc)">${icon('x')}</button></div>
    <div class="pbody">${html}</div>
    ${pie ? `<div class="pfoot">${pie}</div>` : ''}`;
  document.getElementById('overlay-root').append(scrim, el);
  const cerrar = () => cerrarPanel();
  el.querySelector('[data-cerrar]').addEventListener('click', cerrar);
  scrim.addEventListener('click', cerrar);
  peekActual = { el, scrim, onClose, prevFocus: document.activeElement };
  abrirCapa(el, cerrar);
  if(onMount) onMount(el);
  const f = el.querySelector('[autofocus]') || el.querySelector('.pbody input, .pbody select, .pbody textarea, .pbody button') || el.querySelector('[data-cerrar]');
  if(f) setTimeout(() => f.focus({ preventScroll: true }), 30);
  return el;
}
function cerrarPanel(inmediato){
  if(!peekActual) return;
  const { el, scrim, onClose, prevFocus } = peekActual;
  peekActual = null;
  quitarCapa(el);
  if(onClose) onClose();
  if(inmediato){ el.remove(); scrim.remove(); }
  else { el.classList.add('out'); scrim.remove(); setTimeout(() => el.remove(), 170); }
  if(prevFocus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
}

/* Diálogo centrado. Devuelve una promesa con el botón elegido (o null). */
function dialogo({ titulo, texto = '', html = '', botones = [{ id:'ok', label:'Aceptar', clase:'primary' }], onMount }){
  return new Promise(resolve => {
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const el = document.createElement('div');
    el.className = 'sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'dlg-t');
    el.innerHTML = `<h2 id="dlg-t">${esc(titulo)}</h2>${texto ? `<p>${texto}</p>` : ''}${html}
      <div class="foot">${botones.map(b => `<button class="btn lg ${b.clase || ''}" data-b="${b.id}" id="${b.domId || ''}">${esc(b.label)}</button>`).join('')}</div>`;
    document.getElementById('overlay-root').append(scrim, el);
    const prev = document.activeElement;
    const fin = (v) => { quitarCapa(el); el.remove(); scrim.remove(); if(prev && prev.isConnected) prev.focus({ preventScroll: true }); resolve(v); };
    el.querySelectorAll('[data-b]').forEach(b => b.addEventListener('click', () => {
      if(b.dataset.b !== 'cancelar' && el._validar && !el._validar()) return;
      fin(b.dataset.b === 'cancelar' ? null : { boton: b.dataset.b, el });
    }));
    scrim.addEventListener('click', () => fin(null));
    abrirCapa(el, () => fin(null));
    if(onMount) onMount(el);
    const f = el.querySelector('[autofocus]') || el.querySelector('input,select,textarea') || el.querySelector('.foot .btn:last-child');
    if(f) setTimeout(() => f.focus(), 30);
  });
}
async function confirmar(titulo, texto, { ok = 'Confirmar', peligro = false } = {}){
  const r = await dialogo({ titulo, texto, botones: [
    { id:'cancelar', label:'Cancelar', domId:'confirm-cancel' },
    { id:'ok', label: ok, clase: peligro ? 'danger' : 'primary', domId:'confirm-ok' }
  ]});
  return !!r;
}

/* ---------- tema ---------- */
function temaActual(){ return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; }
function cambiarTema(){
  const t = temaActual() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try{ localStorage.setItem('viandas.tema', t); }catch(_){}
}

/* ---------- enlaces a WhatsApp, teléfono y mapas ---------- */
function telDigitos(tel){ return String(tel || '').replace(/\D/g, ''); }
function waNumero(tel){
  let d = telDigitos(tel);
  if(!d) return '';
  if(d.startsWith('54')) return d.startsWith('549') ? d : '549' + d.slice(2);
  if(d.startsWith('0')) d = d.slice(1);
  if(d.startsWith('15')) d = '11' + d.slice(2);        // celular de AMBA sin característica
  d = d.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2');      // característica + 15 + número
  return '549' + d;
}
function waLink(tel, texto){ const n = waNumero(tel); return n ? `https://wa.me/${n}?text=${encodeURIComponent(texto)}` : ''; }
function telLink(tel){ const d = telDigitos(tel); return d ? `tel:${d}` : ''; }
function tieneUbicacion(o){ return o && o.lat != null && o.lng != null && !isNaN(o.lat) && !isNaN(o.lng); }
function coordTxt(o){ return `${Number(o.lat).toFixed(6)},${Number(o.lng).toFixed(6)}`; }
function mapsPunto(o){
  return tieneUbicacion(o) ? `https://www.google.com/maps/search/?api=1&query=${coordTxt(o)}`
                           : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.direccion || '')}`;
}
function mapsNavegar(o){
  return tieneUbicacion(o) ? `https://www.google.com/maps/dir/?api=1&destination=${coordTxt(o)}&travelmode=driving`
                           : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(o.direccion || '')}&travelmode=driving`;
}
/* Recorrido en Google Maps: hasta 9 paradas intermedias por enlace, así que se parte en tramos. */
function mapsRecorrido(origen, paradas){
  const pts = paradas.filter(tieneUbicacion);
  const tramos = [];
  let desde = tieneUbicacion(origen) ? origen : null;
  for(let i = 0; i < pts.length; i += 10){
    const grupo = pts.slice(i, i + 10);
    const destino = grupo[grupo.length - 1];
    const medio = grupo.slice(0, -1);
    let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${coordTxt(destino)}`;
    if(desde) url += `&origin=${coordTxt(desde)}`;
    if(medio.length) url += `&waypoints=${medio.map(coordTxt).join('%7C')}`;
    tramos.push({ url, desde: i + 1, hasta: i + grupo.length });
    desde = destino;
  }
  return tramos;
}

/* ---------- geocodificación (OpenStreetMap / Nominatim) ---------- */
async function buscarDireccion(q, cerca){
  let url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=ar&accept-language=es&q=${encodeURIComponent(q)}`;
  if(tieneUbicacion(cerca)){
    const d = 0.6;
    url += `&viewbox=${cerca.lng - d},${cerca.lat + d},${cerca.lng + d},${cerca.lat - d}`;
  }
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if(!r.ok) throw new Error('El buscador de direcciones no respondió (' + r.status + ')');
  const data = await r.json();
  return data.map(x => ({ lat: Number(x.lat), lng: Number(x.lon), nombre: x.display_name }));
}

/* ---------- mapas (Leaflet, se carga solo cuando hace falta) ---------- */
let leafletPromesa = null;
function cargarLeaflet(){
  if(window.L) return Promise.resolve(window.L);
  if(leafletPromesa) return leafletPromesa;
  leafletPromesa = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = () => resolve(window.L);
    s.onerror = () => { leafletPromesa = null; reject(new Error('No se pudo cargar el mapa')); };
    document.head.appendChild(s);
  });
  return leafletPromesa;
}
function crearMapa(el, centro){
  const L = window.L;
  const map = L.map(el, { zoomControl: true, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  map.setView(centro && tieneUbicacion(centro) ? [centro.lat, centro.lng] : [-34.6037, -58.3816], 12);
  return map;
}
function pinIcono(texto, color, extra = ''){
  return window.L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 24],
    html: `<div class="pin ${extra}" style="--c:${color}"><b>${esc(texto)}</b></div>` });
}

/* ---------- rutas: distancia, orden óptimo y reparto por zonas ---------- */
function distanciaKm(a, b){
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function largoRecorrido(origen, pts){
  let km = 0, prev = tieneUbicacion(origen) ? origen : null;
  for(const p of pts){ if(prev) km += distanciaKm(prev, p); prev = p; }
  return km;
}
/* Vecino más cercano desde la cocina y después mejora 2-opt (recorrido abierto). */
function ordenarRecorrido(origen, pts){
  if(pts.length < 2) return pts.slice();
  const resto = pts.slice(), orden = [];
  let actual = tieneUbicacion(origen) ? origen : resto.shift();
  if(!tieneUbicacion(origen)) orden.push(actual);
  while(resto.length){
    let mejor = 0, mejorD = Infinity;
    resto.forEach((p, i) => { const d = distanciaKm(actual, p); if(d < mejorD){ mejorD = d; mejor = i; } });
    actual = resto.splice(mejor, 1)[0];
    orden.push(actual);
  }
  const conOrigen = tieneUbicacion(origen);
  const nodo = i => (conOrigen ? (i === 0 ? origen : orden[i - 1]) : orden[i]);
  const n = orden.length + (conOrigen ? 1 : 0);
  let mejoro = true, vueltas = 0;
  while(mejoro && vueltas++ < 60){
    mejoro = false;
    for(let i = 0; i < n - 2; i++){
      for(let k = i + 1; k < n - 1; k++){
        const a = nodo(i), b = nodo(i + 1), c = nodo(k), d = nodo(k + 1);
        const delta = distanciaKm(a, c) + distanciaKm(b, d) - distanciaKm(a, b) - distanciaKm(c, d);
        if(delta < -1e-9){
          const off = conOrigen ? 1 : 0;
          const seg = orden.slice(i + 1 - off, k + 1 - off).reverse();
          orden.splice(i + 1 - off, seg.length, ...seg);
          mejoro = true;
        }
      }
      // recorrido abierto: también se puede dar vuelta el tramo final entero
      const a = nodo(i), b = nodo(i + 1), fin = nodo(n - 1);
      if(distanciaKm(a, fin) - distanciaKm(a, b) < -1e-9){
        const off = conOrigen ? 1 : 0;
        const seg = orden.slice(i + 1 - off).reverse();
        orden.splice(i + 1 - off, seg.length, ...seg);
        mejoro = true;
      }
    }
  }
  return orden;
}
/* Reparte paradas entre cadetes por sectores alrededor de la cocina, parejo por viandas. */
function repartirPorZonas(origen, pts, cantidadCadetes, peso = p => 1){
  const k = Math.max(1, cantidadCadetes);
  if(!pts.length) return [];
  const centro = tieneUbicacion(origen) ? origen : {
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length };
  const conAng = pts.map(p => ({ p, a: Math.atan2(p.lat - centro.lat, (p.lng - centro.lng) * Math.cos(centro.lat * Math.PI / 180)) }))
                    .sort((x, y) => x.a - y.a);
  // arrancar después del hueco angular más grande, así los sectores no se cortan en el medio de una zona
  let hueco = 0, desde = 0;
  conAng.forEach((x, i) => {
    const sig = conAng[(i + 1) % conAng.length];
    const g = ((sig.a - x.a) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
    if(g > hueco){ hueco = g; desde = (i + 1) % conAng.length; }
  });
  const ordenados = conAng.slice(desde).concat(conAng.slice(0, desde)).map(x => x.p);
  const total = ordenados.reduce((s, p) => s + peso(p), 0);
  const grupos = Array.from({ length: k }, () => []);
  let g = 0, acumulado = 0;
  for(const p of ordenados){
    const objetivo = total * (g + 1) / k;
    if(g < k - 1 && acumulado >= objetivo - peso(p) / 2 && grupos[g].length) g++;
    grupos[g].push(p);
    acumulado += peso(p);
  }
  return grupos;
}

/* ---------- varios ---------- */
function debounce(fn, ms){ let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function descargarArchivo(nombre, contenido, tipo = 'application/json'){
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const COLORES_CADETE = ['#E2792B', '#2F4B3C', '#5C7A32', '#B23A2E', '#3E6E8E', '#8A5A9E', '#B8912A', '#6B6255'];

/* ---------- desplegables con el estilo de la app ----------
   El <select> nativo queda en la página (valor, change, labels) pero oculto; al lado va un botón
   que abre una lista propia. En pantallas táctiles se deja el selector del teléfono. */
const SELECT_NATIVO = matchMedia('(pointer: coarse)').matches;
let selectAbierto = null;

function mejorarSelect(sel){
  if(SELECT_NATIVO || sel._selBtn || sel.multiple) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  sel._selBtn = btn;
  sel.tabIndex = -1;
  sel.classList.add('sel-nat');
  sel.after(btn);
  sincronizarSelect(sel);
  sel.addEventListener('focus', () => btn.focus());
  btn.addEventListener('click', () => selectAbierto && selectAbierto.sel === sel ? cerrarListaSelect() : abrirListaSelect(sel));
  btn.addEventListener('keydown', (e) => {
    if(['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)){ e.preventDefault(); abrirListaSelect(sel); }
  });
}

function sincronizarSelect(sel){
  const btn = sel && sel._selBtn; if(!btn) return;
  btn.className = 'sel-btn ' + [...sel.classList].filter(c => c !== 'sel-nat').join(' ');
  btn.style.cssText = sel.style.cssText;
  btn.disabled = sel.disabled;
  const lab = sel.id && document.querySelector(`label[for="${CSS.escape(sel.id)}"]`);
  btn.setAttribute('aria-label', sel.getAttribute('aria-label') || (lab ? lab.textContent.trim() : ''));
  const o = sel.options[sel.selectedIndex];
  btn.innerHTML = `<span class="sel-txt">${esc(o ? o.textContent.trim() : '')}</span>${icon('chevD', 14)}`;
}

function abrirListaSelect(sel){
  cerrarListaSelect();
  const btn = sel._selBtn;
  const pop = document.createElement('div');
  pop.className = 'sel-pop'; pop.tabIndex = -1;
  const conBuscar = sel.options.length > 8;
  pop.innerHTML = (conBuscar ? '<div class="sel-buscar"><input class="inp sm" type="search" placeholder="Buscar…" aria-label="Buscar opción"></div>' : '')
    + '<div class="sel-lista" role="listbox"></div><div class="sel-vacio hidden">Sin resultados</div>';
  const lista = pop.querySelector('.sel-lista'), items = [];
  const agregar = (opt, grupo) => {
    if(opt.hidden) return;
    const d = document.createElement('div');
    d.className = 'sel-opt'; d.setAttribute('role', 'option'); d._opt = opt; d._grupo = grupo;
    if(opt.disabled) d.setAttribute('aria-disabled', 'true');
    if(opt.selected) d.setAttribute('aria-selected', 'true');
    d.innerHTML = `<span>${esc(opt.textContent.trim())}</span>${opt.selected ? icon('check', 14) : ''}`;
    lista.append(d); items.push(d);
  };
  for(const ch of sel.children){
    if(ch.tagName === 'OPTGROUP'){
      const g = document.createElement('div'); g.className = 'sel-grp'; g.textContent = ch.label; lista.append(g);
      for(const o of ch.children) agregar(o, g);
    } else if(ch.tagName === 'OPTION') agregar(ch, null);
  }
  document.body.append(pop);

  // debajo del botón, o arriba si no entra
  const r = btn.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
  pop.style.minWidth = Math.max(r.width, 160) + 'px';
  const abajo = vh - r.bottom - 12, arriba = r.top - 12;
  if(abajo >= Math.min(pop.offsetHeight, 240) || abajo >= arriba){ pop.style.top = (r.bottom + 4) + 'px'; pop.style.maxHeight = Math.min(360, abajo) + 'px'; }
  else { pop.style.bottom = (vh - r.top + 4) + 'px'; pop.style.maxHeight = Math.min(360, arriba) + 'px'; }
  pop.style.left = Math.max(8, Math.min(r.left, vw - pop.offsetWidth - 8)) + 'px';

  let activo = null;
  const elegibles = () => items.filter(d => !d.hidden && !d._opt.disabled);
  const marcar = (d, mover = true) => { items.forEach(x => x.classList.toggle('on', x === d)); activo = d || null; if(d && mover) d.scrollIntoView({ block: 'nearest' }); };
  const elegir = (d) => {
    if(!d || d._opt.disabled) return;
    const cambio = sel.selectedIndex !== d._opt.index;
    sel.selectedIndex = d._opt.index;
    cerrarListaSelect(); btn.focus();
    if(cambio){ sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
  };
  marcar(items.find(d => d._opt.selected && !d._opt.disabled) || elegibles()[0]);

  lista.addEventListener('mousedown', (e) => e.preventDefault());
  lista.addEventListener('click', (e) => elegir(e.target.closest('.sel-opt')));
  lista.addEventListener('mousemove', (e) => { const d = e.target.closest('.sel-opt'); if(d && d !== activo && !d._opt.disabled) marcar(d, false); });
  pop.addEventListener('keydown', (e) => {
    const vis = elegibles(), i = vis.indexOf(activo);
    if(e.key === 'ArrowDown'){ e.preventDefault(); marcar(vis[Math.min(vis.length - 1, i + 1)] || vis[0]); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); marcar(vis[Math.max(0, i - 1)] || vis[0]); }
    else if(e.key === 'Home' && !conBuscar){ e.preventDefault(); marcar(vis[0]); }
    else if(e.key === 'End' && !conBuscar){ e.preventDefault(); marcar(vis[vis.length - 1]); }
    else if(e.key === 'Enter'){ e.preventDefault(); elegir(activo); }
    else if(e.key === 'Tab'){ cerrarListaSelect(); }
    else if(!conBuscar && e.key.length === 1){   // saltar a la opción que empieza con esa letra
      const k = normalizarNombre(e.key), desde = vis.slice(i + 1).concat(vis.slice(0, i + 1));
      const d = desde.find(x => normalizarNombre(x.textContent).startsWith(k)); if(d) marcar(d);
    }
  });
  const buscar = pop.querySelector('.sel-buscar input');
  if(buscar){
    buscar.addEventListener('input', () => {
      const q = normalizarNombre(buscar.value);
      items.forEach(d => { d.hidden = !!q && !normalizarNombre(d.textContent).includes(q); });
      lista.querySelectorAll('.sel-grp').forEach(g => { g.hidden = !items.some(d => d._grupo === g && !d.hidden); });
      pop.querySelector('.sel-vacio').classList.toggle('hidden', items.some(d => !d.hidden));
      marcar(elegibles()[0]);
    });
    buscar.focus();
  } else pop.focus();

  abrirCapa(pop, cerrarListaSelect);
  selectAbierto = { sel, pop };
  btn.setAttribute('aria-expanded', 'true');
}

function cerrarListaSelect(){
  if(!selectAbierto) return;
  const { sel, pop } = selectAbierto;
  selectAbierto = null;
  const teniaFoco = pop.contains(document.activeElement);
  quitarCapa(pop); pop.remove();
  if(sel._selBtn){ sel._selBtn.setAttribute('aria-expanded', 'false'); if(teniaFoco && sel._selBtn.isConnected) sel._selBtn.focus(); }
}

document.addEventListener('mousedown', (e) => {
  if(selectAbierto && !selectAbierto.pop.contains(e.target) && !selectAbierto.sel._selBtn.contains(e.target)) cerrarListaSelect();
}, true);
document.addEventListener('scroll', (e) => { if(selectAbierto && !selectAbierto.pop.contains(e.target)) cerrarListaSelect(); }, true);
addEventListener('resize', () => cerrarListaSelect());

// que el botón siga al select cuando el código cambia su valor
for(const prop of ['value', 'selectedIndex']){
  const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
  Object.defineProperty(HTMLSelectElement.prototype, prop, { ...d, set(v){ d.set.call(this, v); if(this._selBtn) sincronizarSelect(this); } });
}

// cada select que aparece en la página se mejora solo; si se va, se lleva su botón
new MutationObserver((muts) => {
  for(const m of muts){
    if(m.type === 'attributes'){ if(m.target.tagName === 'SELECT') sincronizarSelect(m.target); continue; }
    if(m.target.tagName === 'SELECT' || m.target.tagName === 'OPTGROUP') sincronizarSelect(m.target.closest('select'));
    m.removedNodes.forEach(n => {
      if(n.nodeType !== 1) return;
      (n.tagName === 'SELECT' ? [n] : n.querySelectorAll('select')).forEach(s => {
        if(!s.isConnected && s._selBtn){ if(selectAbierto && selectAbierto.sel === s) cerrarListaSelect(); s._selBtn.remove(); }
      });
    });
    m.addedNodes.forEach(n => {
      if(n.nodeType !== 1) return;
      if(n.tagName === 'SELECT') mejorarSelect(n); else n.querySelectorAll('select').forEach(mejorarSelect);
    });
  }
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled', 'style'] });
document.querySelectorAll('select').forEach(mejorarSelect);
