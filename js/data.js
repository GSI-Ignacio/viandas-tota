/* ============================================================
   DATOS: estado en memoria, carga desde Supabase, reglas del negocio
   (créditos, programación por día, comandas y menús, rutas, demanda de
   productos) y escrituras.
   Los permisos reales los aplica la base (actualizar-base.sql); acá
   solo se esconden las acciones que el rol no puede hacer.
============================================================= */
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  sesion: null,
  perfil: { rol: 'dueno', negocioId: null, cadeteId: null, nombre: '' },
  config: { nombre: 'Mi Vianda', cocinaDireccion: '', cocinaLat: null, cocinaLng: null, alertaViandas: 3 },
  clientes: [],
  cadetes: [],
  miembros: [],
  saldos: {},          // clienteId → { pagado, consumido, saldo }
  entregas: {},        // `${clienteId}|${fecha}` → entrega
  rutas: {},           // `${clienteId}|${fecha}` → { cadeteId, orden }
  fechasCargadas: new Set(),
  produccion: [],      // viandas preparadas por día (tabla stock)
  productos: [],       // con su stock actual
  menus: [],           // { id, nombre, descripcion, activo, items: [{ productoId, cantidad }] }
  cartaDia: [],        // { id, fecha, menuId, guarnicionId }: los menús del día y las guarniciones de cada fecha
  comandas: {},        // `${clienteId}|${fecha}|${turno}` → filas de la comanda (un menú por fila)
  comandasGeneradas: new Set(), // fechas cuyas comandas ya se trajeron en esta sesión
};

class MigracionPendiente extends Error {}
/* Versión de la base que espera esta app (la última de actualizar-base.sql). */
const VERSION_BASE_APP = 12;

/* ---------- roles ---------- */
const esDueno = () => state.perfil.rol === 'dueno';
const esAyudante = () => state.perfil.rol === 'ayudante';
const esCadete = () => state.perfil.rol === 'cadete';
const puedeArmarRutas = () => esDueno() || esAyudante();
const puedeRegistrarEn = (fecha) => esDueno() || fecha === todayStr();
const ROL_LABEL = { dueno: 'Dueño', ayudante: 'Ayudante', cadete: 'Cadete' };

/* ---------- mapeo entre columnas de la base y objetos locales ---------- */
function mapCliente(r){
  return {
    id: r.id, nombre: r.nombre, tipo: r.tipo || 'casual', empresaNombre: r.empresa_nombre || '',
    telefono: r.telefono || '', notas: r.notas || '', activo: r.activo !== false,
    direccion: r.direccion || '', referencia: r.referencia || '',
    lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng),
    dias: Array.isArray(r.dias) ? r.dias.map(Number) : [1, 2, 3, 4, 5],
    cantAlmuerzo: r.cant_almuerzo ?? 1,
    cantCena: r.cant_cena ?? (r.consumo === 'almuerzo_cena' ? 1 : 0),
    cadeteId: r.cadete_id || null,
    menuAlmuerzoId: r.menu_almuerzo_id || null, menuCenaId: r.menu_cena_id || null,
    avisoSaldoAt: r.aviso_saldo_at || null,
    precioVianda: r.precio_vianda == null ? null : Number(r.precio_vianda)
  };
}
function clientePayload(c){
  return {
    nombre: c.nombre, tipo: c.tipo, empresa_nombre: c.empresaNombre, telefono: c.telefono, notas: c.notas,
    direccion: c.direccion, referencia: c.referencia, lat: c.lat, lng: c.lng, dias: c.dias,
    cant_almuerzo: c.cantAlmuerzo, cant_cena: c.cantCena, cadete_id: c.cadeteId || null,
    menu_almuerzo_id: c.menuAlmuerzoId || null, menu_cena_id: c.menuCenaId || null,
    consumo: c.cantCena > 0 ? 'almuerzo_cena' : 'almuerzo',      // compatibilidad con la versión anterior
    ...(state.versionBase >= 10 ? { precio_vianda: c.precioVianda ?? null } : {})
  };
}
function mapEntrega(r){
  return { id: r.id, clienteId: r.cliente_id, fecha: r.fecha, almuerzo: r.almuerzo || null, cena: r.cena || null,
           cantAlmuerzo: r.cant_almuerzo, cantCena: r.cant_cena, cadeteId: r.cadete_id || null, actualizada: r.updated_at };
}
function mapCadete(r){ return { id: r.id, nombre: r.nombre, telefono: r.telefono || '', color: r.color || COLORES_CADETE[0], activo: r.activo !== false }; }
function mapProducto(r){
  return { id: r.id, nombre: r.nombre, unidad: r.unidad || 'unidades', minimo: Number(r.minimo) || 0,
           porVianda: Number(r.por_vianda) || 0, activo: r.activo !== false, stock: Number(r.stock) || 0, esGuarnicion: !!r.es_guarnicion };
}
function mapComanda(r){
  return { id: r.id, clienteId: r.cliente_id, fecha: r.fecha, turno: r.turno, menuId: r.menu_id || null, guarnicionId: r.guarnicion_id || null,
           cantidad: Number(r.cantidad) || 0, nota: r.nota || '', origen: r.origen || 'manual',
           estado: r.estado || 'pendiente', precio: r.precio == null ? null : Number(r.precio) };
}
const clave = (clienteId, fecha) => clienteId + '|' + fecha;
const claveT = (clienteId, fecha, turno) => clienteId + '|' + fecha + '|' + turno;
function guardarComandasEnEstado(filas, fechas){
  // reemplaza lo cargado para esas fechas (o para los clientes/fechas de las filas)
  for(const f of fechas || []) for(const k of Object.keys(state.comandas)) if(k.split('|')[1] === f) delete state.comandas[k];
  for(const r of filas){
    const x = mapComanda(r), k = claveT(x.clienteId, x.fecha, x.turno);
    (state.comandas[k] = state.comandas[k] || []).push(x);
  }
}
function armarMenus(menus, items){
  return menus.map(m => ({ id: m.id, nombre: m.nombre, descripcion: m.descripcion || '', activo: m.activo !== false,
    precio: m.precio == null ? null : Number(m.precio), categoria: m.categoria || '', llevaGuarnicion: !!m.lleva_guarnicion,
    items: items.filter(i => i.menu_id === m.id).map(i => ({ productoId: i.producto_id, cantidad: Number(i.cantidad) || 0 })) }));
}

/* Supabase devuelve como máximo 1000 filas por consulta: esto trae todas, de a páginas. */
async function traerTodo(armarConsulta){
  const out = [];
  for(let desde = 0; ; desde += 1000){
    const { data, error } = await armarConsulta().range(desde, desde + 999);
    if(error) throw error;
    out.push(...(data || []));
    if(!data || data.length < 1000) break;
  }
  return out;
}

/* ---------- carga ---------- */
async function cargarPerfil(){
  const { data, error } = await sb.rpc('mi_perfil');
  if(error){
    if(/mi_perfil|PGRST202|function/i.test(error.message + ' ' + (error.code || ''))) throw new MigracionPendiente('v2');
    throw error;
  }
  const p = data || {};
  state.perfil = { rol: p.rol || 'dueno', negocioId: p.negocio_id, cadeteId: p.cadete_id || null, nombre: p.nombre || '' };
  // esta versión necesita la v4 (pedidos con estado propio): si falta, se avisa en vez de funcionar a medias
  const chk = await sb.from('comandas').select('estado').limit(1);
  if(chk.error){
    if(/relation|does not exist|PGRST205/i.test(chk.error.message + ' ' + (chk.error.code || '')) && !/estado/i.test(chk.error.message)) throw new MigracionPendiente('v3');
    if(/estado|column/i.test(chk.error.message)) throw new MigracionPendiente('v4');
    throw chk.error;
  }
  // qué versión tiene la base (desde la v7): lo nuevo se muestra solo si la base ya lo soporta
  const ver = await sb.rpc('version_base');
  state.versionBase = ver.error ? 0 : Number(ver.data) || 0;
  const chk5 = await sb.from('carta_dia').select('fecha').limit(1);
  if(chk5.error){
    if(/relation|does not exist|PGRST205|schema cache/i.test(chk5.error.message + ' ' + (chk5.error.code || ''))) throw new MigracionPendiente('v5');
    throw chk5.error;
  }
}

/* Las comandas son pedidos particulares: ya no se arman solas. Queda para no romper llamadas viejas. */
async function generarComandas(){ return 0; }
async function recargarComandas(fecha, clienteId){
  const filas = await traerTodo(() => { let q = sb.from('comandas').select('*').eq('fecha', fecha); if(clienteId) q = q.eq('cliente_id', clienteId); return q; });
  if(clienteId){ for(const t of ['almuerzo', 'cena']) delete state.comandas[claveT(clienteId, fecha, t)]; guardarComandasEnEstado(filas); }
  else{ guardarComandasEnEstado(filas, [fecha]); await recargarCartaDia(fecha); }
}
/* Trae las comandas de un día que todavía no estaba cargado. */
async function prepararComandas(fecha){
  if(state.comandasGeneradas.has(fecha)) return false;
  state.comandasGeneradas.add(fecha);
  if(state.fechasCargadas.has(fecha)) return false;
  await recargarComandas(fecha);
  return true;
}

async function cargarDatos(){
  const hoy = todayStr();
  const desde = sumarDias(hoy, -7), hasta = sumarDias(hoy, 7);
  const verStock = !esCadete();
  const [config, clientes, cadetes, saldos, entregas, rutas, produccion, productos, miembros, menus, menuItems, comandas, carta] = await Promise.all([
    sb.from('negocio_config').select('*').maybeSingle(),
    traerTodo(() => sb.from('clientes').select('*').order('nombre')),
    sb.from('cadetes').select('*').order('nombre'),
    sb.rpc('saldos'),
    traerTodo(() => sb.from('entregas').select('*').gte('fecha', desde).lte('fecha', hasta)),
    traerTodo(() => sb.from('rutas').select('*').gte('fecha', desde).lte('fecha', hasta)),
    verStock ? sb.from('stock').select('*').gte('fecha', sumarDias(hoy, -60)).order('fecha', { ascending: false }) : { data: [] },
    verStock ? sb.from('productos_stock').select('*').order('nombre') : { data: [] },
    esDueno() ? sb.from('miembros').select('*').order('created_at') : { data: [] },
    sb.from('menus').select('*').order('nombre'),
    sb.from('menu_productos').select('*'),
    traerTodo(() => sb.from('comandas').select('*').gte('fecha', desde).lte('fecha', hasta)),
    traerTodo(() => sb.from('carta_dia').select('*').gte('fecha', desde).lte('fecha', hasta))
  ]);
  for(const r of [config, cadetes, saldos, produccion, productos, miembros, menus, menuItems]) if(r.error) throw r.error;
  const cfg = config.data || {};
  state.config = {
    nombre: cfg.nombre || 'Mi Vianda', cocinaDireccion: cfg.cocina_direccion || '',
    cocinaLat: cfg.cocina_lat == null ? null : Number(cfg.cocina_lat), cocinaLng: cfg.cocina_lng == null ? null : Number(cfg.cocina_lng),
    alertaViandas: cfg.alerta_viandas ?? 3
  };
  state.clientes = clientes.map(mapCliente);
  state.cadetes = (cadetes.data || []).map(mapCadete);
  state.saldos = {};
  for(const s of saldos.data || []) state.saldos[s.cliente_id] = { pagado: Number(s.pagado), consumido: Number(s.consumido), saldo: Number(s.saldo) };
  state.entregas = {};
  for(const r of entregas) state.entregas[clave(r.cliente_id, r.fecha)] = mapEntrega(r);
  state.rutas = {};
  for(const r of rutas) state.rutas[clave(r.cliente_id, r.fecha)] = { cadeteId: r.cadete_id, orden: r.orden };
  state.fechasCargadas = new Set();
  for(let f = desde; f <= hasta; f = sumarDias(f, 1)) state.fechasCargadas.add(f);
  state.produccion = (produccion.data || []).map(r => ({ fecha: r.fecha, preparadas: r.preparadas }));
  state.productos = (productos.data || []).map(mapProducto);
  state.miembros = miembros.data || [];
  state.menus = armarMenus(menus.data || [], menuItems.data || []).sort(ordenMenus);
  state.comandas = {};
  guardarComandasEnEstado(comandas);
  state.cartaDia = carta.map(mapCartaDia);
  await recargarCuentasPedidos().catch(() => { state.cuentasPedidos = {}; });
}
const mapCartaDia = (r) => ({ id: r.id, fecha: r.fecha, menuId: r.menu_id || null, guarnicionId: r.guarnicion_id || null });
async function recargarCartaDia(fecha){
  const filas = await traerTodo(() => sb.from('carta_dia').select('*').eq('fecha', fecha));
  state.cartaDia = state.cartaDia.filter(x => x.fecha !== fecha).concat(filas.map(mapCartaDia));
}

/* Trae entregas y rutas de un día fuera de la ventana cargada. */
async function asegurarFecha(fecha){
  if(state.fechasCargadas.has(fecha)) return false;
  const [e, r] = await Promise.all([
    traerTodo(() => sb.from('entregas').select('*').eq('fecha', fecha)),
    traerTodo(() => sb.from('rutas').select('*').eq('fecha', fecha)),
    recargarComandas(fecha)
  ]);
  for(const x of e) state.entregas[clave(x.cliente_id, x.fecha)] = mapEntrega(x);
  for(const x of r) state.rutas[clave(x.cliente_id, x.fecha)] = { cadeteId: x.cadete_id, orden: x.orden };
  state.fechasCargadas.add(fecha);
  return true;
}
async function recargarSaldos(){
  const { data, error } = await sb.rpc('saldos');
  if(error) throw error;
  state.saldos = {};
  for(const s of data || []) state.saldos[s.cliente_id] = { pagado: Number(s.pagado), consumido: Number(s.consumido), saldo: Number(s.saldo) };
}
async function recargarProductos(){
  const { data, error } = await sb.from('productos_stock').select('*').order('nombre');
  if(error) throw error;
  state.productos = (data || []).map(mapProducto);
}

/* ---------- reglas del negocio ---------- */
const clientePorId = (id) => state.clientes.find(c => c.id === id);
const cadetePorId = (id) => state.cadetes.find(k => k.id === id);
const clientesActivos = () => state.clientes.filter(c => c.activo);
const getEntrega = (clienteId, fecha) => state.entregas[clave(clienteId, fecha)];
const cantTurno = (c, turno) => turno === 'almuerzo' ? c.cantAlmuerzo : c.cantCena;
const viandasPorDia = (c) => c.cantAlmuerzo + c.cantCena;

// "no lo recibió" cuenta como vianda (usa crédito y stock); "saltado" no
const cuentaComoVianda = (v) => v === 'entregado' || v === 'no_recibido';
function consumoEntrega(e){
  if(!e) return 0;
  return (cuentaComoVianda(e.almuerzo) ? (e.cantAlmuerzo ?? 1) : 0) + (cuentaComoVianda(e.cena) ? (e.cantCena ?? 1) : 0);
}
function programadoEn(c, fecha){ return c.activo && c.dias.includes(diaSemana(fecha)) && viandasPorDia(c) > 0; }
function tieneRegistro(c, fecha){ const e = getEntrega(c.id, fecha); return !!(e && (e.almuerzo || e.cena)); }

/* ---------- comandas ---------- */
const lineasComanda = (clienteId, fecha, turno) => state.comandas[claveT(clienteId, fecha, turno)] || [];
const menuPorId = (id) => state.menus.find(m => m.id === id);
// los menús van de menor a mayor precio (los que no tienen precio, al final) y a igual precio por nombre
const ordenMenus = (a, b) => (a.precio ?? Infinity) - (b.precio ?? Infinity) || a.nombre.localeCompare(b.nombre, 'es');
/* ENTREGAS (packs y clientes fijos): cada vianda es una unidad y descuenta un crédito.
   No dependen de las comandas, que son pedidos particulares aparte. */
function recibeTurno(c, fecha, turno){
  const e = getEntrega(c.id, fecha);
  if(e && e[turno]) return true;
  return programadoEn(c, fecha) && cantTurno(c, turno) > 0;
}
/* Viandas de una entrega: lo ya entregado, o lo de su ficha. */
function viandasTurno(c, fecha, turno){
  const e = getEntrega(c.id, fecha);
  // la cantidad anotada en la entrega de ese día (al entregarla, o si se sumaron o quitaron viandas desde Hoy)
  const snap = e && (cuentaComoVianda(e[turno]) || state.versionBase >= 12) ? (turno === 'almuerzo' ? e.cantAlmuerzo : e.cantCena) : null;
  if(snap != null) return snap;
  return Math.max(cantTurno(c, turno), 1);
}
// sumar o quitar viandas de un día: dueño o ayudante, en los días que puede registrar
const puedeCambiarViandas = (fecha) => state.versionBase >= 12 && !esCadete() && puedeRegistrarEn(fecha);
/* "2 viandas · Fit" (el tipo de vianda es informativo, para la cocina) */
function textoVianda(c, fecha, turno = 'almuerzo'){
  const n = viandasTurno(c, fecha, turno);
  const m = menuPorId(turno === 'almuerzo' ? c.menuAlmuerzoId : c.menuCenaId);
  return `${plural(n, 'vianda')}${m ? ' · ' + m.nombre : ''}`;
}

/* COMANDAS (pedidos particulares): lo que pidió un cliente un día, con estado propio. */
function pedidoDe(clienteId, fecha){
  const lineas = lineasComanda(clienteId, fecha, 'almuerzo').concat(lineasComanda(clienteId, fecha, 'cena'));
  if(!lineas.length) return null;
  const estado = lineas.every(l => l.estado === 'entregada') ? 'entregada' : lineas.every(l => l.estado === 'cancelada') ? 'cancelada' : 'pendiente';
  return { clienteId, fecha, lineas, estado, viandas: lineas.reduce((s, l) => s + l.cantidad, 0), total: valorPedido(lineas) };
}
function pedidosDelDia(fecha){ return state.clientes.map(c => pedidoDe(c.id, fecha)).filter(Boolean); }
function valorPedido(lineas){
  let total = 0;
  for(const l of lineas){ const precio = l.precio != null ? l.precio : (menuPorId(l.menuId) || {}).precio; if(precio == null) return null; total += precio * l.cantidad; }
  return total;
}
function resumenPedidos(fecha){
  const ps = pedidosDelDia(fecha);
  const cuenta = (e) => ps.filter(p => p.estado === e);
  return { pedidos: ps.length, pendientes: cuenta('pendiente').length, entregados: cuenta('entregada').length, cancelados: cuenta('cancelada').length,
           viandasPendientes: cuenta('pendiente').reduce((s, p) => s + p.viandas, 0), viandasEntregadas: cuenta('entregada').reduce((s, p) => s + p.viandas, 0) };
}
/* Líneas del pedido de un cliente un día. */
function menusTurno(c, fecha, turno = 'almuerzo'){
  return lineasComanda(c.id, fecha, turno).map(x => ({ menuId: x.menuId, guarnicionId: x.guarnicionId, cantidad: x.cantidad, nota: x.nota, origen: x.origen }));
}
const nombreGuarnicion = (id) => { const p = state.productos.find(x => x.id === id); return p ? p.nombre.toLowerCase() : ''; };
/* "Milanesa al horno con arroz (sin sal)" */
function textoLinea(x){
  const m = menuPorId(x.menuId);
  return `${m ? m.nombre : 'Vianda'}${x.guarnicionId ? ' con ' + nombreGuarnicion(x.guarnicionId) : ''}${x.nota ? ' (' + x.nota + ')' : ''}`;
}
function textoMenus(c, fecha, turno = 'almuerzo'){
  return menusTurno(c, fecha, turno).map(x => `${x.cantidad}× ${textoLinea(x)}`).join(' · ');
}
/* Valor de una comanda según los precios de la carta (null si algún menú no tiene precio). */
/* Cuántos platos de un menú se pueden armar con el stock actual (null si el menú no tiene productos enlazados).
   El stock ya tiene descontados los pedidos cargados. */
function porcionesDisponibles(m){
  if(!m || !m.items || !m.items.length) return null;
  return Math.max(0, Math.min(...m.items.map(it => {
    const p = state.productos.find(x => x.id === it.productoId);
    return p && p.activo ? Math.floor(p.stock / (it.cantidad || 1)) : 0;
  })));
}
/* Cómo se arma un menú con el stock:
   'listo'  → tiene su propio producto (el plato ya armado, con el mismo nombre);
   'piezas' → se arma con otros productos (las piezas) que hay que juntar;
   'sin'    → no tiene productos enlazados. */
function armadoMenu(m){
  if(!m || !m.items || !m.items.length) return 'sin';
  if(m.items.length === 1){ const p = state.productos.find(x => x.id === m.items[0].productoId); if(p && normalizarNombre(p.nombre) === normalizarNombre(m.nombre)) return 'listo'; }
  return 'piezas';
}
/* Para un menú sin productos: la pieza del stock que aparece en su nombre ("Kipe con guarnición" → "Kipe"). */
function piezaSugerida(m){
  if(!m || (m.items && m.items.length)) return null;
  const n = normalizarNombre(m.nombre);
  return state.productos.filter(p => p.activo && !p.esGuarnicion && normalizarNombre(p.nombre) !== n && n.includes(normalizarNombre(p.nombre)))
    .sort((a, b) => b.nombre.length - a.nombre.length)[0] || null;
}
// texto de disponibilidad para listas y desplegables
function textoDisponible(m){
  const n = porcionesDisponibles(m);
  if(n == null) return '';
  if(n === 0) return 'sin stock';
  return armadoMenu(m) === 'piezas' ? `para armar (${n})` : `quedan ${n}`;
}
// disponible: activo y con stock (los que no descuentan stock se consideran disponibles)
const menuDisponible = (m) => !!m && m.activo && (porcionesDisponibles(m) ?? 1) > 0;
const menusDisponibles = () => state.menus.filter(menuDisponible);

/* Precio de un plato para un cliente: su precio propio (sanatorio, empresas) o el de la carta. */
function precioPara(c, menuId){
  if(c && c.tipo !== 'casual' && c.precioVianda != null) return c.precioVianda;
  const m = menuPorId(menuId);
  return m && m.precio != null ? m.precio : null;
}
function valorLineas(lineas, c){
  let total = 0;
  for(const l of lineas){ const p = precioPara(c, l.menuId); if(p == null) return null; total += p * l.cantidad; }
  return total;
}

/* Turnos que se muestran para un cliente un día. */
function turnosDe(c, fecha){ return ['almuerzo', 'cena'].filter(t => recibeTurno(c, fecha, t)); }
function clientesDelDia(fecha, incluirNoProgramados = false){
  return state.clientes.filter(c => turnosDe(c, fecha).length || (incluirNoProgramados && c.activo));
}
/* Resumen de un día, en viandas. */
function resumenDia(fecha, lista){
  let esperadas = 0, entregadas = 0, noRecibidas = 0, saltadas = 0;
  for(const c of (lista || state.clientes)){
    const e = getEntrega(c.id, fecha);
    for(const t of turnosDe(c, fecha)){
      const v = viandasTurno(c, fecha, t);
      esperadas += v;
      if(e && e[t] === 'saltado') saltadas += v;
    }
    if(e) for(const t of ['almuerzo', 'cena']){
      const n = t === 'almuerzo' ? (e.cantAlmuerzo ?? 1) : (e.cantCena ?? 1);
      if(e[t] === 'entregado') entregadas += n;
      if(e[t] === 'no_recibido') noRecibidas += n;
    }
  }
  return { esperadas, entregadas, noRecibidas, saltadas, pendientes: Math.max(esperadas - entregadas - noRecibidas - saltadas, 0) };
}
function turnoPendiente(c, fecha, turno){ const e = getEntrega(c.id, fecha); return !(e && e[turno]); }
function clientePendiente(c, fecha){ return turnosDe(c, fecha).some(t => turnoPendiente(c, fecha, t)); }

/* ---------- saldo de viandas ---------- */
const saldoDe = (id) => (state.saldos[id] ? state.saldos[id].saldo : 0);
/* Cómo paga cada tipo de cliente:
   'prepago' (pack de dietas): compra créditos antes; sin créditos no se le entrega.
   'cuenta' (sanatorio, empresa): se le entrega igual y lo que debe se cobra a fin de semana.
   'sin' (casual): paga cada pedido, no usa créditos. */
function modoPago(c){ return c.tipo === 'pack' ? 'prepago' : (c.tipo === 'sanatorio' || c.tipo === 'empresa') ? 'cuenta' : 'sin'; }
const usaCreditos = (c) => modoPago(c) === 'prepago';
/* 'ok' | 'warn' | 'bad' para los prepagos; 'debe' (amarillo) para la cuenta que debe; 'na' si no usa créditos */
function estadoSaldo(c){
  const s = saldoDe(c.id), modo = modoPago(c);
  if(modo === 'sin') return 'na';
  if(modo === 'cuenta') return s < 0 || deudaPedidos(c) > 0 ? 'debe' : 'ok';
  if(s <= 0) return 'bad';
  if(s <= state.config.alertaViandas) return 'warn';
  return 'ok';
}
/* ¿Se le puede entregar este turno? Con la base en la v11 siempre: un pack sin créditos
   recibe igual y queda debiendo. Antes, solo los prepagos necesitaban créditos (v8). */
function puedeEntregar(c, fecha, turno){
  if(state.versionBase >= 11) return true;
  const e = getEntrega(c.id, fecha);
  if(e && cuentaComoVianda(e[turno])) return true;
  if(!usaCreditos(c) && state.versionBase >= 8) return true;
  return saldoDe(c.id) >= viandasTurno(c, fecha, turno);
}
/* Cuántos días de entrega programados cubre el saldo actual (desde hoy, sin contar lo ya entregado hoy). */
function diasQueCubre(c){
  let saldo = saldoDe(c.id);
  if(saldo <= 0 || !c.activo || viandasPorDia(c) === 0 || !c.dias.length) return 0;
  const hoy = todayStr();
  let dias = 0;
  for(let i = 0; i < 120 && saldo > 0; i++){
    const f = sumarDias(hoy, i);
    if(!programadoEn(c, f)) continue;
    const ya = i === 0 ? consumoEntrega(getEntrega(c.id, f)) : 0;
    const necesita = viandasPorDia(c) - ya;
    if(necesita <= 0) continue;
    if(saldo >= necesita){ dias++; saldo -= necesita; } else break;
  }
  return dias;
}
function textoSaldo(c){
  const s = saldoDe(c.id), modo = modoPago(c);
  if(modo === 'sin') return 'no usa créditos';
  if(modo === 'cuenta'){
    // lo que debe de pedidos (en plata) y de viandas fijas, todo junto
    const plata = deudaPedidos(c), partes = [];
    if(plata > 0) partes.push(fmtPlata(plata));
    if(s < 0) partes.push(plural(-s, 'vianda'));
    if(partes.length) return 'debe ' + partes.join(' + ');
    return s > 0 ? `${plural(s, 'crédito')} a favor` : 'al día';
  }
  if(s <= 0) return s < 0 ? `debe ${plural(-s, 'crédito')}` : 'sin créditos';
  return plural(s, 'crédito');
}
// solo los packs (prepagos) cuentan para los avisos de créditos
function clientesPorVencer(){
  return clientesActivos().filter(c => estadoSaldo(c) === 'warn').sort((a, b) => saldoDe(a.id) - saldoDe(b.id));
}
function clientesSinSaldo(){
  return clientesActivos().filter(c => usaCreditos(c) && viandasPorDia(c) > 0 && saldoDe(c.id) <= 0).sort((a, b) => saldoDe(a.id) - saldoDe(b.id));
}
/* Packs para renovar: sin créditos, por quedarse sin, y los pausados que quedaron sin créditos. */
function packsPorRenovar(){
  return {
    sin: clientesSinSaldo(),
    vencen: clientesPorVencer(),
    pausados: state.clientes.filter(c => !c.activo && usaCreditos(c) && saldoDe(c.id) <= 0).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  };
}
// "Avisado hoy", "Avisado ayer", "Avisado el lun 29" o "Sin avisar"
function textoAviso(c){
  if(!c.avisoSaldoAt) return 'Sin avisar';
  const f = isoLocal(new Date(c.avisoSaldoAt)), n = nombreDia(f);
  return n === 'Hoy' ? 'Avisado hoy' : n === 'Ayer' ? 'Avisado ayer' : `Avisado el ${n.toLowerCase()}`;
}
/* Anota que se le avisó por WhatsApp (desde la v9 de la base). */
async function marcarAvisoSaldo(c){
  if(state.versionBase < 9) return;
  const { data, error } = await sb.rpc('marcar_aviso_saldo', { cid: c.id });
  if(error) throw error;
  c.avisoSaldoAt = data;
}

/* ---------- cuenta en plata de los pedidos (sanatorio, empresas) — desde la v10 ---------- */
async function recargarCuentasPedidos(){
  state.cuentasPedidos = {};
  if(state.versionBase < 10 || esCadete()) return;
  const { data, error } = await sb.rpc('cuentas_pedidos');
  if(error) throw error;
  for(const r of data || []) state.cuentasPedidos[r.cliente_id] = {
    platos: Number(r.platos), entregado: Number(r.entregado), pagado: Number(r.pagado), saldo: Number(r.saldo),
    ultimoPago: r.ultimo_pago, platosSinPagar: Number(r.platos_sin_pagar) };
}
const cuentaPedidosDe = (c) => (state.cuentasPedidos || {})[c.id] || null;
const deudaPedidos = (c) => Math.max((cuentaPedidosDe(c) || {}).saldo || 0, 0);
// clientes a cuenta que deben plata de pedidos entregados
const clientesDebenPedidos = () => state.clientes.filter(c => modoPago(c) === 'cuenta' && (cuentaPedidosDe(c) || {}).saldo > 0)
  .sort((a, b) => cuentaPedidosDe(b).saldo - cuentaPedidosDe(a).saldo);
/* Pago en plata de los pedidos (no toca los créditos). */
async function registrarPagoPedidos(c, { monto, fecha, nota }){
  const { error } = await sb.from('pagos').insert({ cliente_id: c.id, viandas: 0, monto: Number(monto), nota: nota || 'Pago de pedidos', fecha: fecha || todayStr(), concepto: 'pedidos' });
  if(error) throw error;
  await recargarCuentasPedidos();
}
/* El último pedido del cliente antes de una fecha (para repetirlo). */
/* El pedido más reciente del cliente antes de esa fecha. Con mismoDia (pedido nuevo) también cuenta
   lo que ya se le entregó ese mismo día; un pedido pendiente de ese día no, para no duplicarlo. */
async function ultimoPedido(c, fecha, mismoDia = false){
  const { data, error } = await sb.from('comandas').select('*').eq('cliente_id', c.id)[mismoDia ? 'lte' : 'lt']('fecha', fecha).neq('estado', 'cancelada')
    .order('fecha', { ascending: false }).limit(80);
  if(error) throw error;
  const filas = (data || []).filter(x => x.fecha < fecha || x.estado === 'entregada');
  if(!filas.length) return null;
  const f = filas[0].fecha;
  return { fecha: f, lineas: filas.filter(x => x.fecha === f).map(mapComanda) };
}
/* Los pedidos del cliente entre dos fechas, por día (para el resumen de la semana). */
async function pedidosEntre(c, desde, hasta){
  const filas = await traerTodo(() => sb.from('comandas').select('*').eq('cliente_id', c.id).gte('fecha', desde).lte('fecha', hasta).neq('estado', 'cancelada'));
  const porDia = {};
  for(const x of filas.map(mapComanda)) (porDia[x.fecha] = porDia[x.fecha] || []).push(x);
  return porDia;
}

// sanatorios y empresas que deben viandas (se cobran a fin de semana)
function clientesQueDeben(){
  return state.clientes.filter(c => modoPago(c) === 'cuenta' && saldoDe(c.id) < 0).sort((a, b) => saldoDe(a.id) - saldoDe(b.id));
}
function mensajeRecordatorio(c){
  const s = saldoDe(c.id);
  const neg = state.config.nombre;
  if(modoPago(c) === 'cuenta') return `Hola! Te escribimos de ${neg}: ${s < 0 ? `esta semana van ${plural(-s, 'vianda')} a cuenta` : 'tu cuenta está al día'}. ¡Gracias!`;
  if(s <= 0) return `Hola ${c.nombre.split(' ')[0]}! Te escribimos de ${neg}: ya no te quedan créditos (viandas pagas). Cuando quieras renovamos así seguís recibiendo. ¡Gracias!`;
  return `Hola ${c.nombre.split(' ')[0]}! Te escribimos de ${neg}: te ${s === 1 ? 'queda 1 crédito' : `quedan ${s} créditos`} (viandas pagas). ¿Querés que renovemos? ¡Gracias!`;
}

/* ---------- rutas del día ---------- */
const rutaDe = (clienteId, fecha) => state.rutas[clave(clienteId, fecha)];
function cadeteDelDia(c, fecha){ const r = rutaDe(c.id, fecha); return r ? r.cadeteId : c.cadeteId; }
function ordenDelDia(c, fecha){ const r = rutaDe(c.id, fecha); return r ? r.orden : null; }
const cocina = () => ({ lat: state.config.cocinaLat, lng: state.config.cocinaLng, direccion: state.config.cocinaDireccion });
function colorCadete(id){ const k = cadetePorId(id); return k ? k.color : '#8C8378'; }
/* Paradas de un cadete un día, en el orden guardado (o por cercanía si no hay orden). */
function paradasDe(cadeteId, fecha){
  const lista = clientesDelDia(fecha).filter(c => (cadeteDelDia(c, fecha) || null) === (cadeteId || null));
  const conOrden = lista.filter(c => ordenDelDia(c, fecha) != null).sort((a, b) => ordenDelDia(a, fecha) - ordenDelDia(b, fecha));
  const sinOrden = lista.filter(c => ordenDelDia(c, fecha) == null);
  const ubicados = sinOrden.filter(tieneUbicacion), sinUbic = sinOrden.filter(c => !tieneUbicacion(c));
  return conOrden.concat(ordenarRecorrido(cocina(), ubicados), sinUbic);
}

/* ---------- demanda y stock ---------- */
/* Viandas que salen un día: las de los packs más las de los pedidos (sin los cancelados). */
/* Créditos que le van a quedar al empezar ese día, si recibe todo lo programado hasta entonces. */
function saldoProyectado(c, fecha){
  let s = saldoDe(c.id);
  const hoy = todayStr();
  for(let f = hoy; f < fecha; f = sumarDias(f, 1))
    for(const t of turnosDe(c, f)){ if(f === hoy && !turnoPendiente(c, f, t)) continue; s -= viandasTurno(c, f, t); }
  return s;
}
function demandaDia(fecha){
  const packs = clientesActivos().reduce((s, c) => s + turnosDe(c, fecha).reduce((a, t) => a + viandasTurno(c, fecha, t), 0), 0);
  return packs + pedidosDelDia(fecha).filter(p => p.estado !== 'cancelada').reduce((s, p) => s + p.viandas, 0);
}
/* Productos que hacen falta un día según las comandas (o el menú habitual). soloPendiente deja
   afuera los turnos ya registrados, que ya se descontaron del stock. Devuelve { productoId: cantidad }. */
/* Lo que todavía no salió del stock ese día: las viandas de los packs que faltan entregar
   (envases y los productos de su tipo de vianda). Los pedidos ya se descontaron al cargarlos. */
function necesidadProductos(fecha, { soloPendiente = false } = {}){
  const out = {};
  const sumar = (pid, q) => { out[pid] = (out[pid] || 0) + q; };
  for(const c of clientesActivos()){
    const e = getEntrega(c.id, fecha);
    const m = menuPorId(c.menuAlmuerzoId);
    for(const t of turnosDe(c, fecha)){
      if(soloPendiente && e && e[t]) continue;
      const v = viandasTurno(c, fecha, t);
      for(const p of state.productos) if(p.activo && p.porVianda > 0) sumar(p.id, p.porVianda * v);
      if(m) for(const it of m.items) sumar(it.productoId, it.cantidad * v);
    }
  }
  return out;
}
/* Lo que usan los pedidos de un día (ya descontado del stock al cargarlos). */
function usoPedidos(fecha){
  const out = {};
  const sumar = (pid, q) => { out[pid] = (out[pid] || 0) + q; };
  for(const ped of pedidosDelDia(fecha)){
    if(ped.estado === 'cancelada') continue;
    for(const l of ped.lineas){
      const m = menuPorId(l.menuId);
      if(m) for(const it of m.items) sumar(it.productoId, it.cantidad * l.cantidad);
      if(l.guarnicionId) sumar(l.guarnicionId, l.cantidad);
    }
    for(const p of state.productos) if(p.activo && p.porVianda > 0) sumar(p.id, p.porVianda * ped.viandas);
  }
  return out;
}
// productos activos con stock en negativo
const productosNegativos = () => state.productos.filter(p => p.activo && p.stock < 0);
const textoNegativos = (ps) => ps.map(p => `<b>${esc(p.nombre)}</b> (${fmtNum(p.stock)})`).join(', ');
const productoEnUso = (p) => p.porVianda > 0 || p.esGuarnicion || state.menus.some(m => m.activo && m.items.some(i => i.productoId === p.id));
const guarniciones = () => state.productos.filter(p => p.esGuarnicion && p.activo);

/* ---------- menú del día ---------- */
// Los platos elegidos como menú del día y las guarniciones que hay esa fecha (vacío si no se eligió nada).
const menusDelDia = (fecha) => state.cartaDia.filter(x => x.fecha === fecha && x.menuId).map(x => menuPorId(x.menuId)).filter(Boolean)
  .sort(ordenMenus);
const guarnicionesDelDia = (fecha) => state.cartaDia.filter(x => x.fecha === fecha && x.guarnicionId).map(x => state.productos.find(p => p.id === x.guarnicionId)).filter(Boolean)
  .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
const hayCartaDia = (fecha) => state.cartaDia.some(x => x.fecha === fecha);
// "Menú de hoy", "Menú de mañana", "Menú del jueves 2"
function etiquetaMenuDia(fecha){
  if(fecha === todayStr()) return 'Menú de hoy';
  if(fecha === sumarDias(todayStr(), 1)) return 'Menú de mañana';
  return 'Menú del ' + parseFecha(fecha).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric' }).replace(',', '');
}
/* Guarda qué menús y guarniciones hay en una fecha: agrega lo nuevo y quita lo que se destildó. */
async function guardarCartaDia(fecha, { menus, guarniciones: gs }){
  const actuales = state.cartaDia.filter(x => x.fecha === fecha);
  const quiere = new Set([...menus.map(id => 'm' + id), ...gs.map(id => 'g' + id)]);
  const claveFila = (x) => x.menuId ? 'm' + x.menuId : 'g' + x.guarnicionId;
  const tiene = new Set(actuales.map(claveFila));
  const borrar = actuales.filter(x => !quiere.has(claveFila(x))).map(x => x.id);
  const nuevas = [...menus.filter(id => !tiene.has('m' + id)).map(id => ({ fecha, menu_id: id })),
                  ...gs.filter(id => !tiene.has('g' + id)).map(id => ({ fecha, guarnicion_id: id }))];
  if(borrar.length){ const { error } = await sb.from('carta_dia').delete().in('id', borrar); if(error) throw error; }
  if(nuevas.length){ const { error } = await sb.from('carta_dia').insert(nuevas); if(error) throw error; }
  await recargarCartaDia(fecha);
}
/* Texto para mandar por WhatsApp con el menú de un día. */
function textoCartaDia(fecha){
  const ms = menusDelDia(fecha), gs = guarnicionesDelDia(fecha);
  const lista = (xs) => xs.length > 1 ? xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1] : xs.join('');
  const esHoy = fecha === todayStr();
  const dia = parseFecha(fecha).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric' }).replace(',', '');
  return [...(esHoy ? ['¡Buen día! 🤗'] : []), esHoy ? 'Menú del día 🥘' : `Menú del ${dia} 🥘`, '',
    ...ms.map(m => `• ${m.nombre}${m.precio != null ? ' ' + fmtPlata(m.precio) : ''}`),
    ...(gs.length ? ['', `Guarniciones: ${lista(gs.map(g => g.nombre.toLowerCase()))}`] : [])].join('\n');
}
function produccionDe(fecha){ const p = state.produccion.find(x => x.fecha === fecha); return p ? p.preparadas : null; }
/* Para productos que se usan en menús (o en toda vianda): hasta qué día alcanza el stock según las comandas. */
function coberturaProducto(p){
  if(!productoEnUso(p)) return null;
  const hoy = todayStr();
  let stock = p.stock, dias = 0, faltaEl = null, necesario7 = 0;
  for(let i = 0; i < 30; i++){
    const f = sumarDias(hoy, i);
    const uso = necesidadProductos(f, { soloPendiente: i === 0 })[p.id] || 0;   // lo de hoy ya entregado ya se descontó
    if(i < 7) necesario7 += uso;
    if(uso === 0){ if(faltaEl == null) dias++; continue; }
    if(faltaEl == null){ if(stock >= uso){ stock -= uso; dias++; } else faltaEl = f; }
  }
  return { dias, faltaEl, necesario7 };
}
const productosBajos = () => state.productos.filter(p => p.activo && (p.stock < 0 || (p.minimo > 0 && p.stock <= p.minimo)));

/* ---------- escrituras ---------- */
async function marcarEntrega(c, fecha, turno, valor){
  if(!puedeRegistrarEn(fecha)) throw new Error('Solo se pueden registrar entregas del día de hoy.');
  const e = getEntrega(c.id, fecha);
  if(cuentaComoVianda(valor) && !puedeEntregar(c, fecha, turno)){
    throw new Error(`Sin créditos: a ${c.nombre} le ${saldoDe(c.id) === 1 ? 'queda 1 crédito' : `quedan ${plural(Math.max(saldoDe(c.id), 0), 'crédito')}`} y la comanda es de ${plural(viandasTurno(c, fecha, turno), 'vianda')}. Hay que cargar un pago antes de entregar.`);
  }
  const payload = {
    cliente_id: c.id, fecha,
    almuerzo: turno === 'almuerzo' ? valor : (e ? e.almuerzo : null),
    cena: turno === 'cena' ? valor : (e ? e.cena : null)
  };
  return guardarEntrega(c, fecha, e, payload);
}
/* Cuántas viandas lleva ese día en un turno, solo para ese día (la ficha no cambia).
   Si ya se entregó, los créditos y el stock se ajustan enseguida; si no, al entregarla. */
async function cambiarViandasDia(c, fecha, turno, n){
  if(!puedeCambiarViandas(fecha)) throw new Error('No podés cambiar las viandas de ese día.');
  const e = getEntrega(c.id, fecha);
  const payload = { cliente_id: c.id, fecha, almuerzo: e ? e.almuerzo : null, cena: e ? e.cena : null };
  payload[turno === 'almuerzo' ? 'cant_almuerzo' : 'cant_cena'] = Math.max(1, Math.trunc(n) || 1);
  return guardarEntrega(c, fecha, e, payload);
}
async function guardarEntrega(c, fecha, e, payload){
  const { data, error } = await sb.from('entregas').upsert(payload, { onConflict: 'cliente_id,fecha' }).select().single();
  if(error) throw error;
  const nueva = mapEntrega(data);
  const delta = consumoEntrega(nueva) - consumoEntrega(e);
  state.entregas[clave(c.id, fecha)] = nueva;
  const s = state.saldos[c.id] || (state.saldos[c.id] = { pagado: 0, consumido: 0, saldo: 0 });
  s.consumido += delta; s.saldo -= delta;
  if(delta !== 0 && !esCadete()) await recargarProductos().catch(() => {});
  return nueva;
}

/* Guarda la comanda de un cliente para un día y turno: lineas = [{ menuId, guarnicionId, cantidad, nota }].
   Sin líneas = ese día no recibe ese turno. */
async function guardarComanda(c, fecha, turno, lineas){
  const actuales = lineasComanda(c.id, fecha, turno);
  const clv = (l) => (l.menuId || '') + '|' + (l.guarnicionId || '');
  const nuevas = new Map();
  for(const l of lineas){
    if(!(l.cantidad > 0)) continue;
    const g = l.menuId && menuPorId(l.menuId) && menuPorId(l.menuId).llevaGuarnicion ? (l.guarnicionId || null) : null;
    const k = clv({ menuId: l.menuId, guarnicionId: g });
    if(nuevas.has(k)){ nuevas.get(k).cantidad += l.cantidad; if(l.nota) nuevas.get(k).nota = [nuevas.get(k).nota, l.nota].filter(Boolean).join(' · '); }
    else nuevas.set(k, { menuId: l.menuId || null, guarnicionId: g, cantidad: Math.trunc(l.cantidad), nota: (l.nota || '').trim(),
                         precio: l.precio != null && l.precio !== '' && !isNaN(Number(l.precio)) ? Number(l.precio) : precioPara(c, l.menuId) });
  }
  for(const a of actuales){
    const n = nuevas.get(clv(a));
    if(!n){ const { error } = await sb.from('comandas').delete().eq('id', a.id); if(error) throw error; }
    else if(n.cantidad !== a.cantidad || n.nota !== a.nota || (n.precio != null && n.precio !== a.precio)){
      const cambio = { cantidad: n.cantidad, nota: n.nota };
      if(n.precio != null) cambio.precio = n.precio;
      const { error } = await sb.from('comandas').update(cambio).eq('id', a.id); if(error) throw error;
    }
  }
  const aInsertar = [...nuevas.values()].filter(n => !actuales.some(a => clv(a) === clv(n)))
    .map(n => ({ cliente_id: c.id, fecha, turno, menu_id: n.menuId, guarnicion_id: n.guarnicionId, cantidad: n.cantidad, nota: n.nota, origen: 'manual',
                 ...(n.precio != null ? { precio: n.precio } : {}) }));
  if(aInsertar.length){ const { error } = await sb.from('comandas').insert(aInsertar); if(error) throw error; }
  await recargarComandas(fecha, c.id);
  if(!esCadete()) await recargarProductos().catch(() => {});   // el pedido ya descontó su stock
  await recargarCuentasPedidos().catch(() => {});              // y ya suma a la cuenta (sanatorio, empresas)
}

/* Vuelve a calcular lo que descuentan los pedidos pendientes de hoy en adelante
   (por ejemplo, después de cambiar los productos de un menú). */
async function recalcularPedidosPendientes(){
  const { error } = await sb.from('comandas').update({ estado: 'pendiente' }).eq('estado', 'pendiente').gte('fecha', todayStr());
  if(error) throw error;
  await recargarProductos();
}

/* Cambia el estado del pedido de un cliente un día: pendiente | entregada | cancelada.
   El stock ya se descontó al cargarlo; al cancelarlo vuelve. */
async function marcarPedido(c, fecha, estado){
  const { error } = await sb.from('comandas').update({ estado }).eq('cliente_id', c.id).eq('fecha', fecha);
  if(error) throw error;
  await recargarComandas(fecha, c.id);
  if(!esCadete()) await recargarProductos().catch(() => {});
  await recargarCuentasPedidos().catch(() => {});
}

async function guardarMenu(id, datos){
  const fila = { nombre: datos.nombre, descripcion: datos.descripcion || '', activo: datos.activo,
                 precio: datos.precio === '' || datos.precio == null ? null : Number(datos.precio), categoria: (datos.categoria || '').trim(),
                 lleva_guarnicion: !!datos.llevaGuarnicion };
  const { data, error } = id ? await sb.from('menus').update(fila).eq('id', id).select().single()
                             : await sb.from('menus').insert(fila).select().single();
  if(error) throw error;
  const del = await sb.from('menu_productos').delete().eq('menu_id', data.id);
  if(del.error) throw del.error;
  const items = datos.items.filter(i => i.productoId && i.cantidad > 0);
  if(items.length){
    const { error: e2 } = await sb.from('menu_productos').insert(items.map(i => ({ menu_id: data.id, producto_id: i.productoId, cantidad: i.cantidad })));
    if(e2) throw e2;
  }
  const m = { id: data.id, nombre: data.nombre, descripcion: data.descripcion || '', activo: data.activo !== false, items: items.map(i => ({ ...i })),
              precio: data.precio == null ? null : Number(data.precio), categoria: data.categoria || '', llevaGuarnicion: !!data.lleva_guarnicion };
  const i = state.menus.findIndex(x => x.id === m.id);
  if(i >= 0) state.menus[i] = m; else state.menus.push(m);
  state.menus.sort(ordenMenus);
  return m;
}
/* Carga una carta leída de un texto (ver leerCarta en stock.js). Crea las guarniciones que falten
   como productos, y crea los menús o les actualiza precio y categoría si ya existían. */
async function cargarCarta({ items, guarniciones: nombresG }){
  const res = { menusNuevos: 0, menusActualizados: 0, guarnicionesNuevas: 0, productosNuevos: 0 };
  for(const g of nombresG){
    const ya = state.productos.find(p => normalizarNombre(p.nombre) === normalizarNombre(g));
    if(!ya){ await guardarProducto(null, { nombre: g, unidad: 'porciones', minimo: 0, porVianda: 0, activo: true, esGuarnicion: true }); res.guarnicionesNuevas++; }
    else if(!ya.esGuarnicion) await guardarProducto(ya.id, { ...ya, esGuarnicion: true });
  }
  for(const it of items){
    const ya = state.menus.find(m => normalizarNombre(m.nombre) === normalizarNombre(it.nombre));
    let productoId = it.productoId || null;
    if(it.crearProducto){
      const existe = state.productos.find(p => normalizarNombre(p.nombre) === normalizarNombre(it.crearProducto));
      productoId = existe ? existe.id : (await guardarProducto(null, { nombre: it.crearProducto, unidad: 'unidades', minimo: 0, porVianda: 0, activo: true })).id;
      if(!existe) res.productosNuevos++;
    }
    const componentes = productoId ? [{ productoId, cantidad: 1 }] : (ya ? ya.items : []);
    await guardarMenu(ya ? ya.id : null, { nombre: it.nombre, descripcion: it.descripcion || (ya ? ya.descripcion : ''), activo: it.activo,
      precio: it.precio, categoria: it.categoria, llevaGuarnicion: it.llevaGuarnicion, items: componentes });
    if(ya) res.menusActualizados++; else res.menusNuevos++;
  }
  return res;
}

async function eliminarMenu(m){
  const { error } = await sb.from('menus').delete().eq('id', m.id);
  if(error){
    if(/foreign key|violates/i.test(error.message)) throw new Error('Ese menú ya se usó en comandas: desactivalo en lugar de eliminarlo, así se conserva el historial.');
    throw error;
  }
  state.menus = state.menus.filter(x => x.id !== m.id);
  state.clientes.forEach(c => { if(c.menuAlmuerzoId === m.id) c.menuAlmuerzoId = null; if(c.menuCenaId === m.id) c.menuCenaId = null; });
}

async function guardarCliente(id, datos){
  const payload = clientePayload(datos);
  if(id){
    const { data, error } = await sb.from('clientes').update(payload).eq('id', id).select().single();
    if(error) throw error;
    const i = state.clientes.findIndex(x => x.id === id);
    state.clientes[i] = mapCliente(data);
    return state.clientes[i];
  }
  const { data, error } = await sb.from('clientes').insert(Object.assign({ activo: true }, payload)).select().single();
  if(error) throw error;
  const c = mapCliente(data);
  state.clientes.push(c);
  state.clientes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  state.saldos[c.id] = { pagado: 0, consumido: 0, saldo: 0 };
  return c;
}
async function cambiarActivo(c){
  const { error } = await sb.from('clientes').update({ activo: !c.activo }).eq('id', c.id);
  if(error) throw error;
  c.activo = !c.activo;
}
async function eliminarCliente(c){
  const { error } = await sb.from('clientes').delete().eq('id', c.id);
  if(error) throw error;
  state.clientes = state.clientes.filter(x => x.id !== c.id);
  for(const k of Object.keys(state.entregas)) if(k.startsWith(c.id + '|')) delete state.entregas[k];
  delete state.saldos[c.id];
}
async function registrarPago(c, { viandas, monto, nota, fecha }){
  const { data, error } = await sb.from('pagos').insert({
    cliente_id: c.id, viandas, monto: monto === '' || monto == null ? null : Number(monto), nota: nota || '', fecha: fecha || todayStr()
  }).select().single();
  if(error) throw error;
  const s = state.saldos[c.id] || (state.saldos[c.id] = { pagado: 0, consumido: 0, saldo: 0 });
  s.pagado += viandas; s.saldo += viandas;
  if(viandas > 0) c.avisoSaldoAt = null;   // la base también lo borra (v9)
  return data;
}
/* Corrige un pago ya cargado (créditos, monto, fecha o nota) o lo borra; los créditos del cliente se recalculan. */
async function editarPago(p, { viandas, monto, nota, fecha }){
  const { data, error } = await sb.from('pagos').update({
    viandas, monto: monto === '' || monto == null ? null : Number(monto), nota: nota || '', fecha: fecha || p.fecha
  }).eq('id', p.id).select();
  if(error) throw error;
  if(!data || !data.length) throw new Error('Solo el dueño puede corregir pagos');
  await recargarSaldos();
  await recargarCuentasPedidos().catch(() => {});
}
async function borrarPago(p){
  const { data, error } = await sb.from('pagos').delete().eq('id', p.id).select();
  if(error) throw error;
  if(!data || !data.length) throw new Error('Solo el dueño puede borrar pagos');
  await recargarSaldos();
  await recargarCuentasPedidos().catch(() => {});
}
async function listarPagos(clienteId){
  const { data, error } = await sb.from('pagos').select('*').eq('cliente_id', clienteId).order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(40);
  if(error) throw error;
  return data || [];
}
async function historialEntregas(clienteId, limite = 30){
  const { data, error } = await sb.from('entregas').select('*').eq('cliente_id', clienteId).order('fecha', { ascending: false }).limit(limite);
  if(error) throw error;
  return (data || []).map(mapEntrega);
}
/* Historial de un cliente, día por día (del más nuevo al más viejo): las viandas de packs y fijos
   con su estado y cantidad, y sus pedidos (sin los cancelados). */
async function historialCliente(c){
  const [ents, coms] = await Promise.all([
    historialEntregas(c.id, 60),
    sb.from('comandas').select('*').eq('cliente_id', c.id).neq('estado', 'cancelada').order('fecha', { ascending: false }).limit(150)
      .then(({ data, error }) => { if(error) throw error; return (data || []).map(mapComanda); })
  ]);
  const dias = new Map();
  const dia = (f) => { if(!dias.has(f)) dias.set(f, { fecha: f, viandas: [], pedido: [] }); return dias.get(f); };
  for(const e of ents) for(const t of ['almuerzo', 'cena'])
    if(e[t]) dia(e.fecha).viandas.push({ turno: t, estado: e[t], cantidad: (t === 'almuerzo' ? e.cantAlmuerzo : e.cantCena) ?? 1 });
  for(const k of coms) dia(k.fecha).pedido.push(k);
  return [...dias.values()].sort((a, b) => b.fecha.localeCompare(a.fecha));
}

async function guardarConfig(patch){
  const fila = {};
  if('nombre' in patch) fila.nombre = patch.nombre;
  if('cocinaDireccion' in patch) fila.cocina_direccion = patch.cocinaDireccion;
  if('cocinaLat' in patch) fila.cocina_lat = patch.cocinaLat;
  if('cocinaLng' in patch) fila.cocina_lng = patch.cocinaLng;
  if('alertaViandas' in patch) fila.alerta_viandas = patch.alertaViandas;
  const { error } = await sb.from('negocio_config').upsert(fila, { onConflict: 'user_id' });
  if(error) throw error;
  Object.assign(state.config, patch);
}

async function guardarProduccion(fecha, preparadas){
  const { data, error } = await sb.from('stock').upsert({ fecha, preparadas }, { onConflict: 'user_id,fecha' }).select().single();
  if(error) throw error;
  const p = state.produccion.find(x => x.fecha === fecha);
  if(p) p.preparadas = data.preparadas; else state.produccion.push({ fecha: data.fecha, preparadas: data.preparadas });
  state.produccion.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

async function guardarProducto(id, datos){
  const fila = { nombre: datos.nombre, unidad: datos.unidad, minimo: datos.minimo, por_vianda: datos.porVianda, activo: datos.activo, es_guarnicion: !!datos.esGuarnicion };
  const q = id ? sb.from('productos').update(fila).eq('id', id).select().single() : sb.from('productos').insert(fila).select().single();
  const { data, error } = await q;
  if(error) throw error;
  await recargarProductos();
  return state.productos.find(p => p.id === data.id) || mapProducto(data);
}
async function eliminarProducto(p){
  const { error } = await sb.from('productos').delete().eq('id', p.id);
  if(error) throw error;
  state.productos = state.productos.filter(x => x.id !== p.id);
}
/* entrada suma, salida resta; un ajuste lleva la diferencia con signo (stock contado − stock actual). */
async function registrarMovimiento(p, { tipo, cantidad, nota, fecha }){
  const valor = tipo === 'entrada' ? Math.abs(cantidad) : tipo === 'salida' ? -Math.abs(cantidad) : Number(cantidad);
  const { error } = await sb.from('movimientos').insert({ producto_id: p.id, tipo, cantidad: valor, nota: nota || '', fecha: fecha || todayStr() });
  if(error) throw error;
  await recargarProductos();
}
async function listarMovimientos(productoId){
  const { data, error } = await sb.from('movimientos').select('*').eq('producto_id', productoId).order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(60);
  if(error) throw error;
  return data || [];
}

async function guardarCadete(id, datos){
  const fila = { nombre: datos.nombre, telefono: datos.telefono, color: datos.color, activo: datos.activo };
  const q = id ? sb.from('cadetes').update(fila).eq('id', id).select().single() : sb.from('cadetes').insert(fila).select().single();
  const { data, error } = await q;
  if(error) throw error;
  const k = mapCadete(data);
  const i = state.cadetes.findIndex(x => x.id === k.id);
  if(i >= 0) state.cadetes[i] = k; else state.cadetes.push(k);
  state.cadetes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return k;
}
async function eliminarCadete(k){
  const { error } = await sb.from('cadetes').delete().eq('id', k.id);
  if(error) throw error;
  state.cadetes = state.cadetes.filter(x => x.id !== k.id);
  state.clientes.forEach(c => { if(c.cadeteId === k.id) c.cadeteId = null; });
}
async function agregarMiembro(email, rol, nombre, cadeteId){
  const { data, error } = await sb.rpc('agregar_miembro', { p_email: email, p_rol: rol, p_nombre: nombre || '', p_cadete_id: cadeteId || null });
  if(error) throw error;
  const i = state.miembros.findIndex(m => m.auth_id === data.auth_id);
  if(i >= 0) state.miembros[i] = data; else state.miembros.push(data);
  return data;
}
async function quitarMiembro(m){
  const { error } = await sb.from('miembros').delete().eq('auth_id', m.auth_id);
  if(error) throw error;
  state.miembros = state.miembros.filter(x => x.auth_id !== m.auth_id);
}

/* Guarda el cadete y el orden de cada cliente para un día. */
async function guardarRutas(fecha, asignaciones){
  if(!asignaciones.length) return;
  const filas = asignaciones.map(a => ({ fecha, cliente_id: a.clienteId, cadete_id: a.cadeteId || null, orden: a.orden }));
  const { error } = await sb.from('rutas').upsert(filas, { onConflict: 'cliente_id,fecha' });
  if(error) throw error;
  for(const a of asignaciones) state.rutas[clave(a.clienteId, fecha)] = { cadeteId: a.cadeteId || null, orden: a.orden };
}
async function borrarRutas(fecha){
  const { error } = await sb.from('rutas').delete().eq('fecha', fecha);
  if(error) throw error;
  for(const k of Object.keys(state.rutas)) if(k.endsWith('|' + fecha)) delete state.rutas[k];
}

async function buscarRegistro({ desde, hasta, texto, actor, turno, pagina = 0 }){
  let q = sb.from('entregas_log').select('*').order('created_at', { ascending: false }).range(pagina * 100, pagina * 100 + 99);
  if(desde) q = q.gte('fecha', desde);
  if(hasta) q = q.lte('fecha', hasta);
  if(texto) q = q.ilike('cliente_nombre', `%${texto}%`);
  if(actor) q = q.eq('actor_email', actor);
  if(turno) q = q.eq('turno', turno);
  const { data, error } = await q;
  if(error) throw error;
  return data || [];
}

/* ---------- copia de seguridad ---------- */
async function exportarTodo(){
  const tablas = ['clientes', 'pagos', 'entregas', 'stock', 'productos', 'movimientos', 'cadetes', 'rutas', 'menus', 'menu_productos', 'comandas', 'carta_dia'];
  const datos = {};
  for(const t of tablas) datos[t] = await traerTodo(() => sb.from(t).select('*'));
  return { version: 2, app: 'viandas', exportado: new Date().toISOString(), negocio: state.config, ...datos };
}
/* Importa una copia (de esta versión o de la anterior). Agrega, no borra lo existente. */
async function importarCopia(copia, avance){
  const v2 = copia.version === 2;
  const idCliente = {}, idCadete = {}, idProducto = {};
  let n = 0;
  if(v2){
    for(const k of copia.cadetes || []){
      const { data, error } = await sb.from('cadetes').insert({ nombre: k.nombre, telefono: k.telefono || '', color: k.color || COLORES_CADETE[0], activo: k.activo !== false }).select().single();
      if(!error) idCadete[k.id] = data.id;
    }
  }
  for(const c of copia.clientes || []){
    const fila = v2
      ? { nombre: c.nombre, tipo: c.tipo, empresa_nombre: c.empresa_nombre || '', telefono: c.telefono || '', notas: c.notas || '', activo: c.activo !== false,
          direccion: c.direccion || '', referencia: c.referencia || '', lat: c.lat, lng: c.lng, dias: c.dias || [1,2,3,4,5],
          cant_almuerzo: c.cant_almuerzo ?? 1, cant_cena: c.cant_cena ?? 0, consumo: c.consumo || 'almuerzo', cadete_id: idCadete[c.cadete_id] || null }
      : { nombre: c.nombre, tipo: c.tipo, empresa_nombre: c.empresaNombre || '', telefono: c.telefono || '', notas: c.notas || '', activo: c.activo !== false,
          consumo: c.consumo, cant_almuerzo: 1, cant_cena: c.consumo === 'almuerzo_cena' ? 1 : 0 };
    const { data, error } = await sb.from('clientes').insert(fila).select().single();
    if(error){ console.error(error); continue; }
    idCliente[c.id] = data.id;
    if(avance) avance(++n);
  }
  // pagos antes que entregas: sin saldo la base no deja registrar lo entregado
  const pagos = v2 ? (copia.pagos || []) : (copia.clientes || []).filter(c => c.packComprado > 0).map(c => ({ cliente_id: c.id, viandas: c.packComprado, nota: 'Pack (copia anterior)' }));
  for(const p of pagos){
    if(!idCliente[p.cliente_id]) continue;
    await sb.from('pagos').insert({ cliente_id: idCliente[p.cliente_id], viandas: p.viandas, monto: p.monto ?? null, nota: p.nota || '', fecha: p.fecha || todayStr() });
  }
  for(const e of copia.entregas || []){
    const cid = idCliente[v2 ? e.cliente_id : e.clienteId];
    if(!cid) continue;
    const { error } = await sb.from('entregas').upsert({ cliente_id: cid, fecha: e.fecha, almuerzo: e.almuerzo ?? null, cena: e.cena ?? null }, { onConflict: 'cliente_id,fecha' });
    if(error) console.error(error);
  }
  for(const s of copia.stock || []){
    await sb.from('stock').upsert({ fecha: s.fecha, preparadas: s.preparadas }, { onConflict: 'user_id,fecha' });
  }
  if(v2){
    for(const p of copia.productos || []){
      const { data, error } = await sb.from('productos').insert({ nombre: p.nombre, unidad: p.unidad, minimo: p.minimo, por_vianda: p.por_vianda, activo: p.activo }).select().single();
      if(!error) idProducto[p.id] = data.id;
    }
    for(const m of copia.movimientos || []){
      if(m.tipo === 'entrega' || !idProducto[m.producto_id]) continue;
      await sb.from('movimientos').insert({ producto_id: idProducto[m.producto_id], tipo: m.tipo, cantidad: m.cantidad, nota: m.nota || '', fecha: m.fecha });
    }
  }
  return Object.keys(idCliente).length;
}
