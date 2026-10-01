/* ============================================================
   GESTIÓN DE VIANDAS — estructura de la app
   Para agregar una pestaña nueva:
     1) Escribir una función renderMiPestaña(bar, main){ ... } (bar es el
        encabezado de la página, main el contenido)
     2) Agregar { id, label, icon, grupo, roles, render } al arreglo TABS.
        icon es un nombre de ICON_PATHS (util.js) y es opcional; roles dice
        quién la ve: 'dueno', 'ayudante', 'cadete'.
     3) Sumar su id a PESTANAS_VISIBLES.
   Eso es todo — aparece sola en el menú de arriba.
============================================================= */

const TABS = [
  { id: 'hoy',      label: 'Hoy',      icon: 'hoy',      grupo: 'Operación', roles: ['dueno', 'ayudante'], render: renderHoy },
  { id: 'comandas', label: 'Comandas', icon: 'comanda',  grupo: 'Operación', roles: ['dueno', 'ayudante'], render: renderComandas },
  { id: 'entregas', label: 'Entregas', icon: 'entregas', grupo: 'Operación', roles: ['dueno', 'ayudante'], render: renderEntregas,
    badge: () => { const n = clientesDelDia(todayStr()).filter(c => clientePendiente(c, todayStr())).length; return n ? { n } : null; } },
  { id: 'mi-ruta',  label: 'Mi ruta',  icon: 'moto',     grupo: 'Operación', roles: ['cadete'], render: renderMiRuta },
  { id: 'rutas',    label: 'Rutas',    icon: 'rutas',    grupo: 'Operación', roles: ['dueno', 'ayudante'], render: renderRutas },
  { id: 'clientes', label: 'Clientes', icon: 'clientes', grupo: 'Gestión',   roles: ['dueno', 'ayudante'], render: renderClientes,
    // solo los packs de dietas sin créditos o por quedarse sin
    badge: () => { const sin = clientesSinSaldo().length, n = sin + clientesPorVencer().length; return n ? { n, alert: sin > 0 } : null; } },
  { id: 'stock',    label: 'Stock',    icon: 'stock',    grupo: 'Gestión',   roles: ['dueno', 'ayudante'], render: renderStock,
    badge: () => { const n = productosBajos().length; return n ? { n, alert: true } : null; } },
  { id: 'estadisticas', label: 'Estadísticas', icon: 'grafico', grupo: 'Gestión', roles: ['dueno'], render: renderEstadisticas },
  { id: 'registro', label: 'Registro', icon: 'registro', grupo: 'Control',   roles: ['dueno', 'ayudante'], render: renderRegistro },
  { id: 'equipo',   label: 'Equipo',   icon: 'equipo',   grupo: 'Control',   roles: ['dueno'], render: renderEquipo },
  { id: 'ajustes',  label: 'Ajustes',  icon: 'ajustes',  grupo: 'Control',   roles: ['dueno'], render: renderAjustes },
];

/* Pestañas que se muestran. Las demás siguen en el código, listas para volver
   a sumarlas acá. 'mi-ruta' es la única pantalla del cadete. */
let PESTANAS_VISIBLES = ['hoy', 'comandas', 'clientes', 'stock', 'estadisticas', 'mi-ruta'];

let activeTab = null;
const tabsVisibles = () => TABS.filter(t => (!t.roles || t.roles.includes(state.perfil.rol)) && (!PESTANAS_VISIBLES || PESTANAS_VISIBLES.includes(t.id)));
const tabVisible = (id) => tabsVisibles().some(t => t.id === id);

/* ---------- menú de arriba ---------- */
// por ahora las pestañas no muestran números (los contadores siguen definidos en TABS)
const MOSTRAR_CONTADORES = false;
function renderMenu(){
  const nav = document.getElementById('topnav');
  const tabs = tabsVisibles();
  const btn = t => {
    const b = MOSTRAR_CONTADORES && t.badge ? t.badge() : null;
    return `<button class="nav ${activeTab === t.id ? 'active' : ''}" data-tab="${t.id}" ${activeTab === t.id ? 'aria-current="page"' : ''} title="${esc(t.label)}">
      ${icon(t.icon || 'lista')}<span class="lbl">${esc(t.label)}</span>${b ? `<span class="cnt ${b.alert ? 'alert' : ''}">${b.n}</span>` : ''}</button>`;
  };
  const grupos = [...new Set(tabs.map(t => t.grupo))];
  const email = state.sesion ? state.sesion.user.email : '';
  const nombre = state.perfil.nombre || email;
  const rolTxt = ROL_LABEL[state.perfil.rol] + (esCadete() && cadetePorId(state.perfil.cadeteId) ? ' · ' + cadetePorId(state.perfil.cadeteId).nombre : '');
  const abierto = !!document.querySelector('#menu-usuario:not([hidden])');
  nav.innerHTML = `
    <div class="ws" title="${esc(state.config.nombre)}"><span class="mark">${esc(iniciales(state.config.nombre)[0])}</span>
      <div class="txt"><div class="wsname">${esc(state.config.nombre)}</div><div class="wssub">Gestión de viandas</div></div>
      ${BASE_LOCAL ? '<span class="env-local" title="Estás usando la base de datos de tu compu, no la de producción">Base local</span>' : ''}</div>
    <nav class="tn-tabs" aria-label="Secciones">${grupos.map(g => tabs.filter(t => t.grupo === g).map(btn).join('')).join('<span class="tn-sep" aria-hidden="true"></span>')}</nav>
    <div class="tn-sp"></div>
    ${esCadete() ? '' : `<button class="search" id="btn-buscar" type="button" title="Buscar clientes y páginas (⌘K)">${icon('buscar', 14)}<span class="txt">Buscar…</span><span class="kbd">⌘K</span></button>`}
    <button class="iconbtn" id="btn-tema" type="button" title="${temaActual() === 'dark' ? 'Modo claro' : 'Modo oscuro'}" aria-label="Cambiar tema">${icon(temaActual() === 'dark' ? 'sun' : 'moon', 16)}</button>
    <div class="umenu">
      <button class="ubtn" id="btn-usuario" type="button" aria-haspopup="menu" aria-expanded="${abierto}" aria-controls="menu-usuario" title="${esc(email)}">
        ${avatarHtml(nombre, 26)}<span class="who"><span class="n" style="display:block">${esc(nombre)}</span><span class="r" style="display:block">${esc(rolTxt)}</span></span>${icon('chevD', 12, 'caret')}</button>
      <div class="menu" id="menu-usuario" role="menu" ${abierto ? '' : 'hidden'}>
        <div class="mwho"><div class="n" id="user-email">${esc(email)}</div><div class="r">${esc(rolTxt)}</div></div>
        ${esDueno() ? `<button class="mi" id="btn-usuarios" type="button" role="menuitem">${icon('equipo', 15)} Usuarios del negocio</button>
          <button class="mi" id="btn-backup" type="button" role="menuitem">${icon('backup', 15)} Copia de seguridad</button>` : ''}
        <button class="mi" id="btn-logout" type="button" role="menuitem">${icon('salir', 15)} Salir</button>
      </div>
    </div>`;
  nav.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => irA(b.dataset.tab)));
  const bb = nav.querySelector('#btn-buscar'); if(bb) bb.addEventListener('click', abrirBuscador);
  nav.querySelector('#btn-tema').addEventListener('click', () => { cambiarTema(); render({ mantenerScroll: true }); });
  const menu = nav.querySelector('#menu-usuario'), ubtn = nav.querySelector('#btn-usuario');
  const cerrarMenu = () => { menu.hidden = true; ubtn.setAttribute('aria-expanded', 'false'); quitarCapa(menu); document.removeEventListener('click', fuera, true); };
  const fuera = (e) => { if(!menu.contains(e.target) && !ubtn.contains(e.target)) cerrarMenu(); };
  ubtn.addEventListener('click', () => {
    if(!menu.hidden){ cerrarMenu(); return; }
    menu.hidden = false; ubtn.setAttribute('aria-expanded', 'true');
    abrirCapa(menu, () => { cerrarMenu(); ubtn.focus(); });
    document.addEventListener('click', fuera, true);
    const primero = menu.querySelector('.mi'); if(primero) primero.focus();
  });
  nav.querySelector('#btn-logout').addEventListener('click', async () => { cerrarMenu(); await sb.auth.signOut(); });
  const bk = nav.querySelector('#btn-backup'); if(bk) bk.addEventListener('click', () => { cerrarMenu(); openBackupModal(); });
  const bu = nav.querySelector('#btn-usuarios'); if(bu) bu.addEventListener('click', () => { cerrarMenu(); irA('equipo'); });
}

function irA(tab, opciones){
  activeTab = tab;
  cerrarPanel(true);
  if(location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
  render(opciones);
}

function render(opciones){
  const tabs = tabsVisibles();
  // una pestaña oculta del menú (como Equipo) igual se puede abrir si el rol la permite
  const tab = tabs.find(t => t.id === activeTab)
    || TABS.find(t => t.id === activeTab && (!t.roles || t.roles.includes(state.perfil.rol))) || tabs[0];
  activeTab = tab.id;
  renderMenu();
  const bar = document.getElementById('bar');
  const main = document.getElementById('main');
  const scroll = opciones && opciones.mantenerScroll ? main.scrollTop : 0;
  main.classList.remove('enter'); void main.offsetWidth; if(!(opciones && opciones.mantenerScroll)) main.classList.add('enter');
  bar.innerHTML = ''; main.innerHTML = '';
  tab.render(bar, main, opciones || {});
  main.scrollTop = scroll;
}
/* Vuelve a dibujar la página actual sin perder la posición. */
const refrescar = () => render({ mantenerScroll: true });

/* ---------- buscador (⌘K) ---------- */
function abrirBuscador(){
  if(document.querySelector('.pal')) return;
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const el = document.createElement('div'); el.className = 'pal'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Buscar');
  el.innerHTML = `<div class="inp-wrap">${icon('buscar', 16)}<input id="pal-q" placeholder="Buscar un cliente o una página…" autocomplete="off" aria-label="Buscar"></div><div class="palist" id="pal-list"></div>`;
  document.getElementById('overlay-root').append(scrim, el);
  const cerrar = () => { quitarCapa(el); el.remove(); scrim.remove(); };
  abrirCapa(el, cerrar);
  scrim.addEventListener('click', cerrar);
  const inp = el.querySelector('#pal-q'), lista = el.querySelector('#pal-list');
  let items = [], sel = 0;
  const pintar = () => {
    const q = inp.value.trim().toLowerCase();
    const paginas = tabsVisibles().filter(t => !q || t.label.toLowerCase().includes(q)).map(t => ({ tipo: 'pag', t }));
    const clientes = esCadete() ? [] : state.clientes.filter(c => q && (c.nombre.toLowerCase().includes(q) || c.direccion.toLowerCase().includes(q) || c.empresaNombre.toLowerCase().includes(q))).slice(0, 8).map(c => ({ tipo: 'cli', c }));
    items = [...clientes, ...paginas];
    sel = Math.min(sel, Math.max(items.length - 1, 0));
    lista.innerHTML = !items.length ? `<div class="palnone">Nada coincide con "${esc(inp.value)}"</div>` :
      (clientes.length ? `<div class="mhead">Clientes</div>` : '') +
      items.map((it, i) => (it.tipo === 'pag' && (i === 0 || items[i - 1].tipo !== 'pag') ? `<div class="mhead">Páginas</div>` : '') +
        (it.tipo === 'cli'
          ? `<button class="prow" data-i="${i}" aria-selected="${i === sel}">${icon('clientes')}<span class="x">${esc(it.c.nombre)}</span><span class="sub">${esc(it.c.direccion || textoSaldo(it.c))}</span></button>`
          : `<button class="prow" data-i="${i}" aria-selected="${i === sel}">${icon(it.t.icon || 'lista')}<span class="x">${esc(it.t.label)}</span></button>`)).join('');
    lista.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => elegir(Number(b.dataset.i))));
  };
  const elegir = (i) => {
    const it = items[i]; if(!it) return;
    cerrar();
    if(it.tipo === 'pag') irA(it.t.id);
    else { irA('clientes'); abrirCliente(it.c.id); }
  };
  inp.addEventListener('input', () => { sel = 0; pintar(); });
  inp.addEventListener('keydown', (e) => {
    if(e.key === 'ArrowDown'){ sel = Math.min(sel + 1, items.length - 1); pintar(); e.preventDefault(); }
    if(e.key === 'ArrowUp'){ sel = Math.max(sel - 1, 0); pintar(); e.preventDefault(); }
    if(e.key === 'Enter'){ elegir(sel); e.preventDefault(); }
  });
  pintar();
  setTimeout(() => inp.focus(), 20);
}
document.addEventListener('keydown', (e) => {
  if((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !document.getElementById('app-screen').classList.contains('hidden')){
    e.preventDefault(); abrirBuscador();
  }
});

/* ---------- copia de seguridad ---------- */
function openBackupModal(){
  dialogo({
    titulo: 'Copia de seguridad',
    texto: 'Los datos se guardan solos en la nube, pero conviene bajar una copia cada tanto (por ejemplo, una vez por semana) y guardarla en tu compu.',
    html: `<p class="muted" style="margin:0 0 4px">Ahora tenés ${plural(state.clientes.length, 'cliente')}, ${plural(state.productos.length, 'producto')} y ${plural(state.cadetes.length, 'cadete')}.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        <button class="btn lg primary" id="btn-exportar">${icon('backup', 14)} Descargar copia (.json)</button>
        <button class="btn lg" id="btn-importar">Restaurar desde archivo</button>
      </div>`,
    botones: [{ id: 'cancelar', label: 'Cerrar', domId: 'cancelar-modal' }],
    onMount: (el) => {
      el.querySelector('#btn-exportar').addEventListener('click', async (ev) => {
        const b = ev.currentTarget; b.classList.add('busy'); b.textContent = 'Preparando…';
        try{
          const copia = await exportarTodo();
          descargarArchivo(`backup-viandas-${todayStr()}.json`, JSON.stringify(copia, null, 2));
          toast('Copia descargada.');
        }catch(e){ toastError('No se pudo armar la copia', e); }
        b.classList.remove('busy'); b.innerHTML = `${icon('backup', 14)} Descargar copia (.json)`;
      });
      el.querySelector('#btn-importar').addEventListener('click', abrirSelectorImportar);
    }
  });
}
function abrirSelectorImportar(){
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let copia;
      try{ copia = JSON.parse(reader.result); }catch(_){ toast('Ese archivo no es una copia de esta app.', 'err'); return; }
      if(!copia || !Array.isArray(copia.clientes)){ toast('Ese archivo no tiene el formato de una copia de esta app.', 'err'); return; }
      const ok = await confirmar('Restaurar copia', `Se van a <b>agregar</b> ${plural(copia.clientes.length, 'cliente')} con sus pagos, entregas y stock. No se borra nada de lo que ya tenés cargado.`, { ok: 'Agregar datos' });
      if(!ok) return;
      toast('Importando… no cierres la página.', 'info', 4000);
      try{
        const n = await importarCopia(copia);
        await cargarDatos(); refrescar();
        toast(`Listo: se importaron ${plural(n, 'cliente')}.`);
      }catch(e){ toastError('La importación se cortó', e); }
    };
    reader.readAsText(file);
  });
  input.click();
}

/* ---------- actualización periódica (para seguir el avance de los cadetes) ---------- */
let refrescando = false;
async function actualizarHoy(){
  if(refrescando || document.hidden || !state.sesion) return;
  if(!['hoy', 'comandas', 'entregas', 'rutas', 'mi-ruta'].includes(activeTab)) return;
  const tipeando = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if(capas.length || tipeando) return;
  refrescando = true;
  try{
    const hoy = todayStr();
    const [e, r] = await Promise.all([
      traerTodo(() => sb.from('entregas').select('*').eq('fecha', hoy)),
      traerTodo(() => sb.from('rutas').select('*').eq('fecha', hoy))
    ]);
    let cambio = false;
    for(const x of e){
      const k = clave(x.cliente_id, x.fecha), antes = state.entregas[k];
      if(!antes || antes.almuerzo !== (x.almuerzo || null) || antes.cena !== (x.cena || null)){ state.entregas[k] = mapEntrega(x); cambio = true; }
    }
    for(const x of r){
      const k = clave(x.cliente_id, x.fecha), antes = state.rutas[k];
      if(!antes || antes.cadeteId !== x.cadete_id || antes.orden !== x.orden){ state.rutas[k] = { cadeteId: x.cadete_id, orden: x.orden }; cambio = true; }
    }
    // pedidos: lo que cargaron, cambiaron o borraron otros usuarios (o este mismo en otra pestaña)
    let cambioPedidos = false;
    if(!esCadete()){
      const firma = (ls) => ls.map(x => [x.id, x.estado, x.cantidad, x.menuId, x.guarnicionId, x.nota, x.precio].join('~')).sort().join('|');
      for(const f of [...new Set([hoy, activeTab === 'comandas' ? comandaFecha : hoy])]){
        const filas = await traerTodo(() => sb.from('comandas').select('*').eq('fecha', f));
        const actuales = Object.entries(state.comandas).filter(([k]) => k.split('|')[1] === f).flatMap(([, ls]) => ls);
        if(firma(filas.map(mapComanda)) !== firma(actuales)){ guardarComandasEnEstado(filas, [f]); cambioPedidos = true; }
      }
    }
    if(cambioPedidos) await recargarProductos().catch(() => {});
    if(cambio) await recargarSaldos();
    if((cambio || cambioPedidos) && !capas.length) refrescar();
  }catch(_){ /* sin conexión: se reintenta en la próxima vuelta */ }
  refrescando = false;
}
setInterval(actualizarHoy, 45000);

/* Al volver a la pestaña se trae todo de nuevo (otro usuario pudo cargar o borrar cosas mientras tanto). */
let ultimaVuelta = Date.now();
async function alVolver(){
  if(document.hidden || !state.sesion || refrescando || capas.length) return;
  if(Date.now() - ultimaVuelta < 20000) return;
  ultimaVuelta = Date.now();
  refrescando = true;
  try{ await cargarDatos(); renderMenu(); refrescar(); }catch(_){ /* se reintenta la próxima vez */ }
  refrescando = false;
}
document.addEventListener('visibilitychange', alVolver);
addEventListener('focus', alVolver);

/* ============================================================
   INICIO
============================================================= */
let arrancadoPara = null;
function mostrar(id){
  for(const x of ['boot', 'login-screen', 'app-screen']) document.getElementById(x).classList.toggle('hidden', x !== id);
}
async function bootApp(session){
  if(arrancadoPara === session.user.id) return;
  arrancadoPara = session.user.id;
  state.sesion = session;
  mostrar('boot');
  try{
    await cargarPerfil();
    await cargarDatos();
  }catch(e){
    mostrar('app-screen');
    document.getElementById('topnav').innerHTML = '';
    document.getElementById('bar').innerHTML = '<h1>Gestión de Viandas</h1>';
    const migrar = e instanceof MigracionPendiente;
    document.getElementById('main').innerHTML = `<div class="stub"><div class="ico">${icon(migrar ? 'ajustes' : 'alerta', 20)}</div>
      <h2>${migrar ? 'Falta actualizar la base de datos' : 'No se pudieron cargar los datos'}</h2>
      <p>${migrar ? `Esta versión necesita que corras ${e.message === 'v5' ? '' : `<code>migraciones/migracion-${esc(e.message)}.sql</code> (y las siguientes hasta la v4) y después `}<code>actualizar-base.sql</code> en Supabase → SQL Editor. Conserva todos tus datos.` : esc(traducirError(e.message || String(e)))}</p>
      <button class="btn lg" id="btn-reintentar">Reintentar</button> <button class="btn lg quiet" id="btn-salir2">Salir</button></div>`;
    document.getElementById('btn-reintentar').addEventListener('click', () => { arrancadoPara = null; bootApp(session); });
    document.getElementById('btn-salir2').addEventListener('click', () => sb.auth.signOut());
    return;
  }
  mostrar('app-screen');
  // la base quedó atrás de la app: algunas funciones no aparecen hasta correr actualizar-base.sql
  if(esDueno() && state.versionBase < VERSION_BASE_APP)
    toast('Falta actualizar la base de datos: corré <b>actualizar-base.sql</b> en Supabase → SQL Editor. Hasta entonces faltan algunas funciones.', 'err', 15000);
  const pedido = location.hash.slice(1);
  activeTab = tabsVisibles().some(t => t.id === pedido) ? pedido : tabsVisibles()[0].id;
  render();
}
function mostrarLogin(){
  arrancadoPara = null;
  state.sesion = null;
  cerrarPanel(true);
  mostrar('login-screen');
}

async function init(){
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-submit');
    const errBox = document.getElementById('login-error');
    errBox.classList.add('hidden');
    btn.disabled = true; btn.textContent = 'Ingresando…';
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false; btn.textContent = 'Ingresar';
    if(error){
      errBox.textContent = /Invalid login/i.test(error.message) ? 'Email o contraseña incorrectos.' : traducirError(error.message);
      errBox.classList.remove('hidden');
      return;
    }
    if(data && data.session) bootApp(data.session);
  });
  window.addEventListener('hashchange', () => {
    const t = location.hash.slice(1);
    if(state.sesion && t && t !== activeTab && tabsVisibles().some(x => x.id === t)) irA(t);
  });

  sb.auth.onAuthStateChange((evento, session) => {
    if(evento === 'SIGNED_OUT' || !session){ if(evento !== 'INITIAL_SESSION') mostrarLogin(); return; }
    if(evento === 'SIGNED_IN') bootApp(session);
    else state.sesion = session;
  });
  const { data: { session } } = await sb.auth.getSession();
  if(BASE_LOCAL){ const el = document.getElementById('env-login'); if(el) el.hidden = false; document.title = '[LOCAL] ' + document.title; }
  if(session) bootApp(session); else mostrarLogin();
}
init();
