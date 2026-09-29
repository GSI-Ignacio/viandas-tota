/* ---------- Menú del día ----------
   Para cada fecha se eligen los platos que son menú del día y las guarniciones que hay.
   Al cargar un pedido esos platos aparecen primero y la guarnición se elige entre las del día.
   Se guarda solo al tildar o destildar, sin botón Guardar. */
const puedeElegirCartaDia = (fecha) => esDueno() || (esAyudante() && fecha >= todayStr());

/* Tarjeta para el costado de Hoy y Comandas. */
function seccionCartaDiaHtml(fecha){
  const ms = menusDelDia(fecha), gs = guarnicionesDelDia(fecha), edita = puedeElegirCartaDia(fecha);
  const esHoy = fecha === todayStr(), hay = ms.length || gs.length;
  return `<section class="tsec" id="sec-menudia">
    <h2>${icon('menu', 14)} Menú del día ${esHoy ? '' : `<span class="n">${esc(nombreDia(fecha))}</span>`}<span class="sp"></span>
      ${edita && hay ? `<button class="btn quiet" data-carta-dia="${fecha}">Cambiar</button>` : ''}</h2>
    <div class="clist">${hay ? `
      ${ms.length ? `<div class="flist">${ms.map(m => `<div class="fl"><span class="d" style="flex:1;min-width:0;text-transform:none">${esc(m.nombre)}</span>
          <b style="font-weight:500">${esc(fmtPlata(m.precio))}</b></div>`).join('')}</div>`
        : '<div class="calm" style="padding:10px 14px">Sin platos elegidos.</div>'}
      ${gs.length ? `<div class="md-guarn"><span class="muted">Guarniciones</span>
          <div class="md-chips">${gs.map(g => `<span class="md-chip">${esc(g.nombre)}</span>`).join('')}</div></div>` : ''}
      <div class="md-pie"><button class="btn quiet" data-copiar-carta="${fecha}">${icon('copiar', 13)} Copiar para WhatsApp</button></div>`
    : `<div class="md-vacio"><p>${esHoy ? 'Todavía no elegiste el menú de hoy.' : 'Todavía no elegiste el menú de este día.'}
        ${edita ? 'Elegí los platos y las guarniciones: van a aparecer primero al cargar un pedido.' : ''}</p>
        ${edita ? `<button class="btn primary" data-carta-dia="${fecha}">${icon('menu', 13)} Elegir menú del día</button>` : ''}</div>`}
    </div></section>`;
}
function bindCartaDia(root){
  root.querySelectorAll('[data-carta-dia]').forEach(b => b.addEventListener('click', () => abrirCartaDia(b.dataset.cartaDia)));
  root.querySelectorAll('[data-copiar-carta]').forEach(b => b.addEventListener('click', () => copiarCartaDia(b.dataset.copiarCarta)));
}

async function copiarCartaDia(fecha){
  const txt = textoCartaDia(fecha);
  let ok = false;
  try{ await navigator.clipboard.writeText(txt); ok = true; }
  catch(e){
    const ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta); ta.select();
    try{ ok = document.execCommand('copy'); }catch(e2){ ok = false; }
    ta.remove();
  }
  toast(ok ? 'Menú copiado: pegalo en WhatsApp.' : 'No se pudo copiar el menú.', ok ? 'ok' : 'error');
}

// Precio que se propone para un plato nuevo: el del "Menú del día" de la carta, si está.
function precioMenuDelDia(){
  const m = state.menus.find(x => normalizarNombre(x.nombre).startsWith('menu del dia') && x.precio != null)
    || state.menus.find(x => normalizarNombre(x.categoria) === 'del dia' && x.precio != null);
  return m ? m.precio : '';
}

/* Ventana para elegir el menú de un día. */
async function abrirCartaDia(fecha){
  if(!state.fechasCargadas.has(fecha)){
    try{ await recargarCartaDia(fecha); }catch(err){ toastError('No se pudo cargar el menú de ese día', err); return; }
  }
  const edita = puedeElegirCartaDia(fecha);
  const elegidos = new Set(state.cartaDia.filter(x => x.fecha === fecha).map(x => x.menuId ? 'm' + x.menuId : 'g' + x.guarnicionId));
  const platos = state.menus.filter(m => m.activo || elegidos.has('m' + m.id));
  const cats = [...new Set(platos.map(m => m.categoria || 'Sin categoría'))];
  const gs = state.productos.filter(p => p.esGuarnicion && (p.activo || elegidos.has('g' + p.id)));
  const anterior = [...new Set(state.cartaDia.map(x => x.fecha))].filter(f => f < fecha).sort().pop();
  const fila = (clave, nombre, extra = '') => `<label class="md-op ${elegidos.has(clave) ? 'on' : ''}">
      <input type="checkbox" data-md="${clave}" ${elegidos.has(clave) ? 'checked' : ''} ${edita ? '' : 'disabled'}>
      <span class="n">${esc(nombre)}</span>${extra ? `<span class="muted">${esc(extra)}</span>` : ''}</label>`;
  const nuevo = esDueno() && edita;

  abrirPanel({
    titulo: `${icon('menu', 14)} Menú del día`,
    ancho: 'medio',
    html: `<div class="md-nav">
        <button class="iconbtn" type="button" data-md-ir="-1" aria-label="Día anterior" title="Día anterior">${icon('chevL', 15)}</button>
        <b>${esc(nombreDia(fecha))}</b><span class="muted">${esc(formatFechaMedia(fecha))}</span>
        <button class="iconbtn" type="button" data-md-ir="1" aria-label="Día siguiente" title="Día siguiente">${icon('chevR', 15)}</button>
        <span class="sp"></span><span class="muted" id="md-estado" aria-live="polite"></span>
        ${edita && anterior ? `<button class="btn quiet" type="button" id="md-repetir">${icon('copiar', 13)} Repetir lo del ${esc(nombreDia(anterior).toLowerCase())}</button>` : ''}
      </div>
      ${edita ? '' : `<div class="banner" style="margin-bottom:14px">${icon('info', 14)} Este día ya pasó: solo lo podés ver.</div>`}
      <div class="md-grid">
        <div class="psec" style="margin-top:0"><h3>Platos del día <span class="sp"></span><span class="n" id="md-n-m"></span></h3>
          <p class="muted md-ayuda">Tildá los platos que salen este día. Al cargar un pedido aparecen primero.</p>
          ${platos.length > 10 ? '<input type="search" class="inp sm search-inp" id="md-buscar" placeholder="Buscar plato…" aria-label="Buscar plato" style="margin-bottom:6px">' : ''}
          <div class="md-ops" id="md-platos">${platos.length ? cats.map(cat => `<div class="md-cat">${esc(cat)}</div>`
              + platos.filter(m => (m.categoria || 'Sin categoría') === cat).map(m => fila('m' + m.id, m.nombre, fmtPlata(m.precio))).join('')).join('')
            : '<p class="muted" style="margin:6px 2px">Todavía no hay platos en la carta.</p>'}</div>
          ${nuevo ? `<div class="md-nuevo">
            <input type="text" class="inp sm" id="md-nuevo-plato" placeholder="Plato nuevo (ej: Pastel de papa)" aria-label="Nombre del plato nuevo">
            <input type="number" class="inp sm" id="md-nuevo-precio" min="0" step="100" value="${precioMenuDelDia()}" placeholder="Precio" aria-label="Precio" style="width:96px;flex:none">
            <button class="btn" type="button" id="md-agregar-plato">${icon('plus', 13)} Agregar</button></div>` : ''}
        </div>
        <div class="psec" style="margin-top:0"><h3>Guarniciones <span class="sp"></span><span class="n" id="md-n-g"></span></h3>
          <p class="muted md-ayuda">Las que hay este día para acompañar los platos que llevan guarnición.</p>
          <div class="md-ops" id="md-guarniciones">${gs.length ? gs.map(g => fila('g' + g.id, g.nombre)).join('')
            : '<p class="muted" style="margin:6px 2px">Todavía no hay guarniciones cargadas.</p>'}</div>
          ${nuevo ? `<div class="md-nuevo">
            <input type="text" class="inp sm" id="md-nueva-guarnicion" placeholder="Guarnición nueva (ej: Calabaza)" aria-label="Nombre de la guarnición nueva">
            <button class="btn" type="button" id="md-agregar-guarnicion">${icon('plus', 13)} Agregar</button></div>` : ''}
        </div>
      </div>`,
    pie: `<button class="btn lg" id="md-copiar">${icon('copiar', 14)} Copiar para WhatsApp</button><span class="sp"></span>
      <button class="btn lg primary" id="md-listo">Listo</button>`,
    onMount: (el) => {
      const estado = el.querySelector('#md-estado');
      const seleccion = () => {
        const cl = [...el.querySelectorAll('[data-md]:checked')].map(x => x.dataset.md);
        return { menus: cl.filter(x => x[0] === 'm').map(x => x.slice(1)), guarniciones: cl.filter(x => x[0] === 'g').map(x => x.slice(1)) };
      };
      const contar = () => {
        const s = seleccion();
        el.querySelector('#md-n-m').textContent = s.menus.length ? plural(s.menus.length, 'elegido') : '';
        el.querySelector('#md-n-g').textContent = s.guarniciones.length ? plural(s.guarniciones.length, 'elegida') : '';
        el.querySelectorAll('.md-op').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
        el.querySelector('#md-copiar').disabled = !s.menus.length && !s.guarniciones.length;
      };
      // un guardado por vez, siempre con lo último que quedó tildado
      let cola = Promise.resolve();
      const guardar = (extra) => {
        estado.textContent = 'Guardando…';
        cola = cola.then(async () => {
          try{
            const s = seleccion();
            if(extra){ extra(s); }
            await guardarCartaDia(fecha, s);
            if(estado.isConnected) estado.textContent = 'Guardado';
            refrescar();
            return true;
          }catch(err){ toastError('No se pudo guardar el menú del día', err); abrirCartaDia(fecha); return false; }
        });
        return cola;
      };
      contar();
      el.querySelectorAll('[data-md]').forEach(x => x.addEventListener('change', () => { contar(); guardar(); }));
      el.querySelectorAll('[data-md-ir]').forEach(b => b.addEventListener('click', async () => {
        await cola; abrirCartaDia(sumarDias(fecha, Number(b.dataset.mdIr)));
      }));
      el.querySelector('#md-listo').addEventListener('click', async () => { await cola; cerrarPanel(); });
      el.querySelector('#md-copiar').addEventListener('click', async () => { await cola; copiarCartaDia(fecha); });

      const rep = el.querySelector('#md-repetir');
      if(rep) rep.addEventListener('click', async () => {
        const antes = new Set(state.cartaDia.filter(x => x.fecha === anterior).map(x => x.menuId ? 'm' + x.menuId : 'g' + x.guarnicionId));
        el.querySelectorAll('[data-md]').forEach(x => { if(antes.has(x.dataset.md)) x.checked = true; });
        contar(); if(await guardar()) toast(`Listo: se agregó lo del ${nombreDia(anterior).toLowerCase()}.`);
      });

      const buscar = el.querySelector('#md-buscar');
      if(buscar) buscar.addEventListener('input', () => {
        const q = normalizarNombre(buscar.value), cont = el.querySelector('#md-platos');
        cont.querySelectorAll('.md-op').forEach(l => { l.hidden = !!q && !normalizarNombre(l.textContent).includes(q); });
        cont.querySelectorAll('.md-cat').forEach(c => {
          let n = c.nextElementSibling, alguno = false;
          while(n && !n.classList.contains('md-cat')){ if(!n.hidden) alguno = true; n = n.nextElementSibling; }
          c.hidden = !alguno;
        });
      });

      // agregar un plato o una guarnición que todavía no está, y dejarlo tildado
      const agregar = async (btn, crear, tipo) => {
        btn.classList.add('busy');
        try{
          const item = await crear();
          if(!item) return;
          await cola;
          const ok = await guardar(s => { const l = tipo === 'm' ? s.menus : s.guarniciones; if(!l.includes(item.id)) l.push(item.id); });
          if(!ok) return;
          toast(`${item.nombre} quedó en el menú del ${nombreDia(fecha).toLowerCase()}.`);
          abrirCartaDia(fecha);
        }catch(err){ toastError('No se pudo agregar', err); }
        finally{ btn.classList.remove('busy'); }
      };
      const ap = el.querySelector('#md-agregar-plato');
      if(ap){
        const inp = el.querySelector('#md-nuevo-plato'), precio = el.querySelector('#md-nuevo-precio');
        const ir = () => agregar(ap, async () => {
          const nombre = inp.value.trim().replace(/\s+/g, ' ');
          if(!nombre){ inp.focus(); return null; }
          const ya = state.menus.find(m => normalizarNombre(m.nombre) === normalizarNombre(nombre));
          if(ya) return ya.activo ? ya : guardarMenu(ya.id, { ...ya, activo: true });
          return guardarMenu(null, { nombre, descripcion: '', activo: true, precio: precio.value, categoria: 'Del día', llevaGuarnicion: false, items: [] });
        }, 'm');
        ap.addEventListener('click', ir);
        inp.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); ir(); } });
      }
      const ag = el.querySelector('#md-agregar-guarnicion');
      if(ag){
        const inp = el.querySelector('#md-nueva-guarnicion');
        const ir = () => agregar(ag, async () => {
          const nombre = inp.value.trim().replace(/\s+/g, ' ');
          if(!nombre){ inp.focus(); return null; }
          const ya = state.productos.find(p => normalizarNombre(p.nombre) === normalizarNombre(nombre));
          if(ya) return ya.esGuarnicion && ya.activo ? ya : guardarProducto(ya.id, { ...ya, esGuarnicion: true, activo: true });
          return guardarProducto(null, { nombre, unidad: 'porciones', minimo: 0, porVianda: 0, activo: true, esGuarnicion: true });
        }, 'g');
        ag.addEventListener('click', ir);
        inp.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); ir(); } });
      }
    }
  });
}
