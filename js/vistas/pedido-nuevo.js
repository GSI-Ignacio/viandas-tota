/* ============================================================
   PEDIDO NUEVO, PASO A PASO
   En vez de una planilla, la app pregunta de a una cosa: 1) para quién, 2) qué pide,
   3) cómo paga y 4) muestra el resumen para confirmar. Lo ya respondido queda arriba
   en una línea con "Cambiar"; el botón de abajo dice siempre lo que sigue.
============================================================= */
const PN_PASOS_TODOS = [['quien', 'Para quién'], ['que', 'Qué pide'], ['pago', 'Cómo paga'], ['ok', 'Confirmar']];
// sin la base en la v14 no hay formas de pago: el paso "cómo paga" no aparece
const pnPasos = () => usaFormasPago() ? PN_PASOS_TODOS : PN_PASOS_TODOS.filter(([k]) => k !== 'pago');
let pnSeq = 0;

function abrirPedidoNuevo({ cliente = null, fecha = todayStr() } = {}){
  const st = { cli: null, fecha, lineas: [], forma: null, sugerida: null, paso: 'quien', busca: '', buscaPlato: '', cat: null,
               ultimo: null, porDefecto: false, guardando: false };
  abrirPanel({
    ancho: 'ancho',
    titulo: `${icon('comanda', 14)} Nuevo pedido`,
    html: '<div class="pn" id="pn"></div>',
    pie: `<button class="btn lg" id="pn-cancelar">Cancelar</button><span class="sp"></span><span class="form-aviso" id="pn-falta"></span>
      <button class="btn lg primary" id="pn-sigue" disabled>Seguir</button>`,
    onMount: (el) => {
      const raiz = el.querySelector('#pn'), sigue = el.querySelector('#pn-sigue'), falta = el.querySelector('#pn-falta');
      el.querySelector('#pn-cancelar').addEventListener('click', () => cerrarPanel());

      /* ---------- datos ---------- */
      const linea = ({ menuId, guarnicionId = null, cantidad = 1, nota = '', precio = null }) =>
        ({ id: ++pnSeq, menuId, guarnicionId, cantidad: Math.max(1, Math.trunc(cantidad) || 1), nota: nota || '', precio });
      const precioDe = (l) => l.precio != null ? l.precio : precioPara(st.cli, l.menuId);
      const total = () => st.lineas.reduce((s, l) => s + l.cantidad * (precioDe(l) || 0), 0);
      const platos = () => st.lineas.reduce((s, l) => s + l.cantidad, 0);
      const opcionesG = () => { const d = guarnicionesDelDia(st.fecha); return d.length ? d : guarniciones(); };
      const llevaG = (l) => { const m = menuPorId(l.menuId); return !!(m && m.llevaGuarnicion && opcionesG().length); };
      const hoy = todayStr();
      const cuando = () => `${st.fecha === hoy ? 'hoy, ' : st.fecha === sumarDias(hoy, 1) ? 'mañana, ' : ''}${formatFechaLarga(st.fecha)}`;
      const textoLineas = (ls) => ls.map(l => `${l.cantidad}× ${textoLinea(l)}`).join(' · ');
      const previo = () => st.cli ? pedidoDe(st.cli.id, st.fecha) : null;
      // qué falta para pasar al paso siguiente ('' = nada)
      const faltaQue = () => {
        if(!st.lineas.length) return 'Elegí al menos un plato.';
        const sinG = st.lineas.find(l => llevaG(l) && !l.guarnicionId);
        if(sinG) return `Elegí la guarnición de ${menuPorId(sinG.menuId).nombre}.`;
        return '';
      };

      /* ---------- acciones ---------- */
      const elegirCliente = (c) => {
        const cambia = !st.cli || st.cli.id !== c.id;
        st.cli = c;
        if(cambia){
          // lo de siempre (menú habitual, cantidad y precio de la ficha), si tiene
          const d = tieneDefaults(c) ? lineaPorDefecto(c) : null;
          st.lineas = d && d.menuId && d.menuId !== ELEGIR ? [linea(d)] : [];
          st.porDefecto = st.lineas.length > 0;
          // sanatorios y empresas van a cuenta, como siempre
          st.forma = modoPago(c) === 'cuenta' ? 'cuenta' : null;
          st.sugerida = null; st.ultimo = null;
          ultimoPedido(c, st.fecha, true).then(u => {
            if(!st.cli || st.cli.id !== c.id) return;
            st.ultimo = u;
            st.sugerida = u ? ((u.lineas.find(l => l.formaPago) || {}).formaPago || null) : null;
            if(st.paso === 'que' || st.paso === 'pago') pintar();
          }).catch(() => {});
        }
        ir('que');
      };
      const agregarPlato = (id) => {
        const m = menuPorId(id); if(!m) return;
        const ya = st.lineas.find(l => l.menuId === id);
        if(ya) ya.cantidad++;
        else st.lineas.push(linea({ menuId: id, cantidad: st.lineas.length ? 1 : cantidadPorDefecto(st.cli) }));
        st.porDefecto = false;
        pintarPedido();
      };
      const ir = (paso) => { st.paso = paso; pintar(); const a = raiz.querySelector('.pn-actual'); if(a) a.scrollIntoView({ block: 'nearest' }); };
      const siguiente = () => {
        if(st.paso === 'quien' && st.cli) return ir('que');
        if(st.paso === 'que' && !faltaQue()) return ir(st.forma || !usaFormasPago() ? 'ok' : 'pago');
        if(st.paso === 'pago' && st.forma) return ir('ok');
        if(st.paso === 'ok') return guardar();
      };
      sigue.addEventListener('click', siguiente);

      const guardar = async () => {
        if(st.guardando) return;
        const cli = st.cli, fch = st.fecha;
        st.guardando = true; sigue.disabled = true; sigue.classList.add('busy');
        try{
          if(!state.fechasCargadas.has(fch)) await asegurarFecha(fch);
          const ant = pedidoDe(cli.id, fch);
          if(ant && ant.estado === 'entregada'){ toast(`${esc(cli.nombre)} ya tiene un pedido entregado ese día: abrilo desde la lista para cambiarlo.`, 'err'); throw null; }
          const ls = st.lineas.map(l => ({ menuId: l.menuId, guarnicionId: llevaG(l) ? l.guarnicionId : null, cantidad: l.cantidad, nota: l.nota.trim(), precio: precioDe(l) }));
          // si ya tenía un pedido ese día, estos platos se suman
          if(ant) ls.push(...ant.lineas.map(x => ({ menuId: x.menuId, guarnicionId: x.guarnicionId, cantidad: x.cantidad, nota: x.nota, precio: x.precio })));
          const negAntes = new Set(productosNegativos().map(p => p.id));
          await guardarComanda(cli, fch, 'almuerzo', ls, { formaPago: st.forma });
          const negNuevos = productosNegativos().filter(p => !negAntes.has(p.id));
          toast(`Pedido de <b>${esc(cli.nombre)}</b> guardado: ${esc(textoMenus(cli, fch))}${st.forma ? ` · ${esc(formaLabel(st.forma))}` : ''}.`
            + (negNuevos.length ? `<br><span style="color:var(--bad-ink)">Quedó stock en negativo: ${textoNegativos(negNuevos)}.</span>` : ''), negNuevos.length ? 'err' : 'ok', negNuevos.length ? 9000 : null);
          cerrarPanel(); refrescar();
        }catch(e){
          if(e) toastError('No se pudo guardar el pedido', e);
          st.guardando = false; sigue.classList.remove('busy'); pintar();
        }
      };

      /* ---------- pasos ---------- */
      const filaHecha = (paso, titulo, valor) => `<div class="pn-hecho"><span class="pn-ok">${icon('check', 13)}</span>
        <span class="pn-t">${titulo}</span><span class="pn-v">${valor}</span>
        <button class="btn quiet" type="button" data-ir="${paso}">Cambiar</button></div>`;

      const listaClientes = () => {
        const q = normalizarNombre(st.busca);
        const pidieron = {};   // los que piden seguido van primero
        for(const k of Object.keys(state.comandas)){ const id = k.split('|')[0]; pidieron[id] = (pidieron[id] || 0) + 1; }
        let cs = clientesActivos().filter(c => !q || normalizarNombre([c.nombre, c.empresaNombre, c.direccion].join(' ')).includes(q));
        cs.sort((a, b) => (q ? 0 : (pidieron[b.id] || 0) - (pidieron[a.id] || 0)) || a.nombre.localeCompare(b.nombre, 'es'));
        const total = cs.length; cs = cs.slice(0, q ? 30 : 12);
        if(!cs.length) return `<div class="calm">${icon('buscar')} No encontré a nadie con «${esc(st.busca)}».${esDueno() ? ' Podés crearlo con <b>Cliente nuevo</b>.' : ''}</div>`;
        return cs.map(c => {
          const ped = pedidoDe(c.id, st.fecha);
          return `<button class="pn-cli ${st.cli && st.cli.id === c.id ? 'sel' : ''}" type="button" data-cli="${c.id}">${avatarHtml(c.nombre, 34)}
            <span class="t"><b>${esc(c.nombre)}</b><small>${esc([TIPO_LABEL[c.tipo], c.empresaNombre, c.direccion].filter(Boolean).join(' · '))}</small></span>
            ${ped ? `<span class="tag plain">ya tiene pedido</span>` : ''}${icon('chevR', 14)}</button>`;
        }).join('') + (!q && total > cs.length ? `<div class="pn-mas muted">Y ${plural(total - cs.length, 'cliente más', 'clientes más')}: escribí para buscar.</div>` : '');
      };
      const pasoQuien = () => {
        const fechas = [[hoy, 'Hoy'], [sumarDias(hoy, 1), 'Mañana']];
        return `<h2 class="pn-q">¿Para quién es el pedido?</h2>
          <div class="pn-cuando">${icon('calendario', 14)}<span>Para <b>${esc(cuando())}</b></span>
            <span class="pn-fechas">${fechas.map(([f, l]) => `<button type="button" class="chip ${st.fecha === f ? 'on' : ''}" data-fecha="${f}">${l}</button>`).join('')}
            <input type="date" class="inp sm" id="pn-fecha" value="${st.fecha}" ${esDueno() ? '' : `min="${hoy}"`} aria-label="Otro día"></span></div>
          ${diaCerrado(st.fecha) ? avisoDiaCerradoHtml(st.fecha, { acciones: false }) : ''}
          <div class="pn-buscar">${icon('buscar', 15)}<input class="inp" id="pn-busca" placeholder="Escribí el nombre…" value="${esc(st.busca)}" autocomplete="off" aria-label="Buscar cliente"></div>
          <div class="pn-clientes" id="pn-clientes">${listaClientes()}</div>
          ${esDueno() ? `<button class="btn" type="button" id="pn-nuevo-cli">${icon('plus', 13)} Cliente nuevo</button>` : ''}`;
      };

      const platoHtml = (m) => {
        const n = st.lineas.filter(l => l.menuId === m.id).reduce((s, l) => s + l.cantidad, 0), p = precioPara(st.cli, m.id), disp = textoDisponible(m);
        return `<button class="pn-plato ${n ? 'en' : ''} ${esMenuDelDia(m) ? 'del-dia' : ''}" type="button" data-plato="${m.id}" title="Agregar ${esc(m.nombre)}">
          <b>${esc(m.nombre)}</b><span>${p != null ? fmtPlata(p) : 'sin precio'}${disp ? ` · ${esc(disp)}` : ''}</span>${n ? `<i class="pn-n">${n}</i>` : ''}</button>`;
      };
      // sin TACC: su categoría, o "sin TACC" en el nombre (como el "Menú sin TACC" del día)
      const sinTacc = (m) => normalizarNombre(m.categoria) === 'sin tacc' || /\bsin\s*tacc\b/i.test(m.nombre);
      const platosHtml = () => {
        const q = normalizarNombre(st.buscaPlato), delDia = menusDelDia(st.fecha).filter(menuDisponible);
        let ms = menusDisponibles();
        if(q) ms = ms.filter(m => normalizarNombre(m.nombre + ' ' + (m.categoria || '')).includes(q));
        else if(st.cat === '__dia') ms = delDia;
        else if(normalizarNombre(st.cat) === 'sin tacc') ms = ms.filter(sinTacc);
        else if(st.cat) ms = ms.filter(m => (m.categoria || 'Otros') === st.cat && !sinTacc(m));
        // siempre en orden alfabético, sin importar el precio
        ms = ms.slice().sort(ordenMenus);
        if(!ms.length) return `<div class="calm">${icon('buscar')} ${q ? `No hay platos con «${esc(st.buscaPlato)}».` : 'No hay platos disponibles en esta categoría.'}</div>`;
        // lo que tiene TACC y lo que no, separados
        const con = ms.filter(m => !sinTacc(m)), sin = ms.filter(sinTacc);
        if(!con.length || !sin.length) return ms.map(platoHtml).join('');
        return `<div class="pn-grupo">Con TACC</div>${con.map(platoHtml).join('')}
          <div class="pn-grupo sin-tacc">${icon('check', 12)} Sin TACC</div>${sin.map(platoHtml).join('')}`;
      };
      // cada plato del pedido, lo justo: nombre, cantidad y subtotal; el precio, la guarnición y la nota se abren al tocarlos
      const lineaHtml = (l) => {
        const m = menuPorId(l.menuId), p = precioDe(l), g = llevaG(l), ui = l.ui || (l.ui = {});
        const guarnicion = !g ? ''
          : l.guarnicionId && !ui.g ? `<div class="pn-g-elegida">Con <b>${esc(nombreGuarnicion(l.guarnicionId))}</b>
              <button type="button" class="pn-link" data-cambiar-g>Cambiar</button></div>`
          : `<div class="pn-guarn ${l.guarnicionId ? '' : 'falta'}"><span>${l.guarnicionId ? 'Cambiar guarnición:' : 'Elegí la guarnición:'}</span>
              ${opcionesG().map(x => `<button type="button" class="chip ${l.guarnicionId === x.id ? 'on' : ''}" data-guarn="${x.id}">${esc(x.nombre)}</button>`).join('')}
              ${l.guarnicionId ? `<button type="button" class="pn-link" data-otra-g title="El mismo plato, con otra guarnición">+ otra guarnición para algunos</button>` : ''}</div>`;
        return `<div class="pn-linea" data-l="${l.id}">
          <div class="pn-l1"><b>${esc(m ? m.nombre : 'Vianda sin menú')}</b>
            <button type="button" class="pn-sub pn-precio-txt" data-sub data-editar-precio title="Cambiar el precio de este plato">${fmtPlata(l.cantidad * (p || 0)) || '$ 0'}</button>
            <button class="btn pn-quitar" type="button" data-quitar aria-label="Quitar ${esc(m ? m.nombre : 'el plato')}" title="Quitar este plato">${icon('borrar', 13)}<span>Quitar</span></button></div>
          <div class="pn-l2">
            <span class="pn-cant"><button type="button" class="iconbtn" data-menos aria-label="Uno menos" ${l.cantidad <= 1 ? 'disabled' : ''}>${icon('menos', 14)}</button>
              <input type="number" class="inp sm" data-cant min="1" step="1" value="${l.cantidad}" aria-label="Cantidad">
              <button type="button" class="iconbtn" data-mas aria-label="Uno más">${icon('plus', 14)}</button></span>
            ${ui.precio ? `<span class="pn-precio">Precio por plato $ <input type="number" class="inp sm" data-precio min="0" step="100" value="${p ?? ''}" placeholder="precio" aria-label="Precio por plato"></span>`
              : l.cantidad > 1 ? `<span class="pn-cu" data-cu>× ${p != null ? fmtPlata(p) : 'sin precio'} c/u</span>` : ''}
          </div>
          ${guarnicion}
          ${ui.nota || l.nota ? `<input type="text" class="inp sm pn-nota-in" data-nota value="${esc(l.nota)}" placeholder="Nota para la cocina (sin sal, dieta…)" aria-label="Nota">`
            : `<button type="button" class="pn-link" data-agregar-nota>+ Nota para la cocina</button>`}
        </div>`;
      };
      const columnaPedido = () => `<div class="pn-der-h"><b>Pedido de ${esc(st.cli.nombre.split(' ')[0])}</b><span class="sp"></span>
          ${st.lineas.length ? `<span class="muted">${plural(platos(), 'plato')}</span>` : ''}</div>
        ${st.porDefecto ? '<p class="pn-nota">Lo de siempre: cambialo si hoy pide otra cosa.</p>' : ''}
        <div class="pn-der-lineas">${st.lineas.length ? st.lineas.map(lineaHtml).join('')
          : `<div class="pn-vacio">${icon('comanda', 18)}<span>Todavía no elegiste platos.<br>Tocá los de la izquierda y van apareciendo acá.</span></div>`}</div>
        <div class="pn-der-total"><span>Total</span><b id="pn-total">${fmtPlata(total()) || '$ 0'}</b></div>`;
      const pasoQue = () => {
        const nom = st.cli.nombre.split(' ')[0], ant = previo(), delDia = menusDelDia(st.fecha).filter(menuDisponible);
        const cats = [...new Set(menusDisponibles().map(m => m.categoria || 'Otros'))]
          .sort((a, b) => ((a === 'Promociones') - (b === 'Promociones')) || ((b === 'Del día') - (a === 'Del día')) || a.localeCompare(b, 'es'));
        if(st.cat === null) st.cat = delDia.length ? '__dia' : '';
        const u = st.ultimo, mismo = u && textoLineas(u.lineas) === textoLineas(st.lineas);
        return `<h2 class="pn-q">¿Qué pide ${esc(nom)}?</h2>
        <div class="pn-que">
          <div class="pn-izq">
            ${ant ? `<div class="banner pn-aviso">${icon('info', 14)}<span>Ya tiene un pedido ese día (${esc(textoLineas(ant.lineas))}): lo que elijas se suma.</span></div>` : ''}
            ${u && !mismo ? `<div class="pn-repetir"><span>${icon('deshacer', 14)} Último pedido, ${esc(u.fecha === hoy ? 'hoy' : formatFechaMedia(u.fecha))}: <b>${esc(textoLineas(u.lineas))}</b></span>
              <button class="btn" type="button" id="pn-repetir">Repetir</button></div>` : ''}
            <div class="pn-cats">
              ${delDia.length ? `<button type="button" class="chip ${st.cat === '__dia' && !st.buscaPlato ? 'on' : ''}" data-cat="__dia">${icon('menu', 12)} ${esc(etiquetaMenuDia(st.fecha))}</button>` : ''}
              <button type="button" class="chip ${st.cat === '' && !st.buscaPlato ? 'on' : ''}" data-cat="">Todos</button>
              ${cats.map(c => `<button type="button" class="chip ${st.cat === c && !st.buscaPlato ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
            </div>
            <div class="pn-buscar">${icon('buscar', 15)}<input class="inp" id="pn-busca-plato" placeholder="Buscar un plato…" value="${esc(st.buscaPlato)}" autocomplete="off" aria-label="Buscar plato"></div>
            <div class="pn-grid" id="pn-grid">${platosHtml()}</div>
          </div>
          <aside class="pn-der" id="pn-der" aria-label="Pedido">${columnaPedido()}</aside>
        </div>`;
      };
      const pasoPago = () => `<h2 class="pn-q">¿Cómo paga?</h2>
        ${formaPagoHtml('pn-forma', st.forma, { sugerida: st.sugerida })}
        <p class="pn-nota">${st.cli && modoPago(st.cli) === 'cuenta' ? 'Sanatorios y empresas suelen ir <b>a cuenta</b>: suma a lo que deben y se cobra a fin de semana.'
          : '<b>A cuenta</b> = no paga ahora: queda debiendo y se ve en su ficha y en Hoy, en "A cobrar".'}</p>`;
      const pasoOk = () => {
        const ant = previo();
        return `<h2 class="pn-q">Revisá y confirmá</h2>
          <div class="pn-resumen">
            <div class="pn-r-fila">${avatarHtml(st.cli.nombre, 36)}<div class="t"><b>${esc(st.cli.nombre)}</b><small>Para ${esc(cuando())}</small></div>
              <button class="btn quiet" type="button" data-ir="quien">Cambiar</button></div>
            <div class="pn-r-lineas">${st.lineas.map(l => `<div><span>${l.cantidad}× ${esc(textoLinea({ ...l, guarnicionId: llevaG(l) ? l.guarnicionId : null }))}${l.nota ? ` <small class="muted">· ${esc(l.nota)}</small>` : ''}</span>
                <b>${fmtPlata(l.cantidad * (precioDe(l) || 0)) || '$ 0'}</b></div>`).join('')}
              <button class="btn quiet" type="button" data-ir="que">Cambiar platos</button></div>
            <div class="pn-r-total"><span>Total · ${plural(platos(), 'plato')}</span><b>${fmtPlata(total()) || '$ 0'}</b></div>
            ${usaFormasPago() ? `<div class="pn-r-fila forma">${icon((FORMAS_PAGO.find(f => f.id === st.forma) || {}).icon || 'pago', 18)}
              <div class="t"><b>${esc(formaLabel(st.forma))}</b><small>${st.forma === 'cuenta' ? 'No paga ahora: suma a lo que debe' : 'Paga al recibir o ya pagó'}</small></div>
              <button class="btn quiet" type="button" data-ir="pago">Cambiar</button></div>` : ''}
          </div>
          ${ant ? `<div class="banner pn-aviso">${icon('info', 14)}<span>Ya tiene un pedido ese día (${esc(textoLineas(ant.lineas))}): estos platos se suman${st.forma ? ` y todo el pedido queda <b>${esc(formaLabel(st.forma).toLowerCase())}</b>` : ''}.</span></div>` : ''}
          ${diaCerrado(st.fecha) ? avisoDiaCerradoHtml(st.fecha, { acciones: false }) : ''}`;
      };

      /* ---------- pintar ---------- */
      const actualizarPie = () => {
        let txt = '', ok = false, label = 'Seguir';
        if(st.paso === 'quien'){ ok = !!st.cli; txt = ok ? '' : 'Elegí para quién es.'; }
        else if(st.paso === 'que'){ txt = faltaQue(); ok = !txt; }
        else if(st.paso === 'pago'){ ok = !!st.forma; txt = ok ? '' : 'Elegí cómo paga.'; }
        else { ok = !st.guardando; label = 'Crear pedido'; }
        sigue.textContent = label; sigue.disabled = !ok || st.guardando; falta.textContent = txt;
      };
      const pintar = ({ mantener = false } = {}) => {
        const scroll = raiz.closest('.pbody') ? raiz.closest('.pbody').scrollTop : 0;
        const idx = pnPasos().findIndex(([k]) => k === st.paso);
        raiz.classList.toggle('en-que', st.paso === 'que');
        raiz.innerHTML = `<ol class="pn-pasos">${pnPasos().map(([k, l], i) => `<li class="${i < idx ? 'hecho' : i === idx ? 'activo' : ''}">
            ${i < idx ? `<button type="button" data-ir="${k}">` : '<span>'}<i>${i < idx ? icon('check', 11) : i + 1}</i><em>${l}</em>${i < idx ? '</button>' : '</span>'}</li>`).join('')}</ol>
          ${st.paso !== 'ok' && idx > 0 ? filaHecha('quien', 'Para', `<b>${esc(st.cli.nombre)}</b> <span class="muted">· ${esc(cuando())}</span>`) : ''}
          ${st.paso !== 'ok' && idx > 1 ? filaHecha('que', 'Pide', `${esc(textoLineas(st.lineas))} <span class="muted">· ${fmtPlata(total()) || '$ 0'}</span>`) : ''}
          <section class="pn-actual">${{ quien: pasoQuien, que: pasoQue, pago: pasoPago, ok: pasoOk }[st.paso]()}</section>`;
        bindear();
        actualizarPie();
        if(mantener && raiz.closest('.pbody')) raiz.closest('.pbody').scrollTop = scroll;
      };
      // solo la columna del pedido (y el número de cada plato elegido): la lista de platos no se mueve
      const pintarPedido = () => {
        const der = raiz.querySelector('#pn-der');
        if(!der){ pintar({ mantener: true }); return; }
        const scroll = der.scrollTop;
        der.innerHTML = columnaPedido();
        der.scrollTop = scroll;
        bindPedido();
        raiz.querySelectorAll('#pn-grid [data-plato]').forEach(b => {
          const n = st.lineas.filter(l => l.menuId === b.dataset.plato).reduce((s, l) => s + l.cantidad, 0);
          b.classList.toggle('en', n > 0);
          let i = b.querySelector('.pn-n');
          if(n && !i){ i = document.createElement('i'); i.className = 'pn-n'; b.appendChild(i); }
          if(i){ if(n) i.textContent = n; else i.remove(); }
        });
        actualizarPie();
      };
      const pintarGrid = () => {
        const grid = raiz.querySelector('#pn-grid'); if(!grid) return;
        grid.innerHTML = platosHtml();
        grid.querySelectorAll('[data-plato]').forEach(b => b.addEventListener('click', () => agregarPlato(b.dataset.plato)));
        raiz.querySelectorAll('[data-cat]').forEach(c => c.classList.toggle('on', !st.buscaPlato && c.dataset.cat === st.cat));
      };
      const bindPedido = () => {
        raiz.querySelectorAll('.pn-linea').forEach(row => {
          const l = st.lineas.find(x => x.id === Number(row.dataset.l)); if(!l) return;
          const repintarFila = () => {
            row.querySelector('[data-sub]').textContent = fmtPlata(l.cantidad * (precioDe(l) || 0)) || '$ 0';
            const cu = row.querySelector('[data-cu]'); if(cu) cu.textContent = `× ${precioDe(l) != null ? fmtPlata(precioDe(l)) : 'sin precio'} c/u`;
            const t = raiz.querySelector('#pn-total'); if(t) t.textContent = fmtPlata(total()) || '$ 0';
            actualizarPie();
          };
          row.querySelector('[data-quitar]').addEventListener('click', () => { st.lineas = st.lineas.filter(x => x !== l); st.porDefecto = false; pintarPedido(); });
          row.querySelector('[data-menos]').addEventListener('click', () => { if(l.cantidad > 1){ l.cantidad--; pintarPedido(); } });
          row.querySelector('[data-mas]').addEventListener('click', () => { l.cantidad++; pintarPedido(); });
          const ci = row.querySelector('[data-cant]');
          ci.addEventListener('input', () => { const n = Math.trunc(Number(ci.value)); if(n >= 1){ l.cantidad = n; repintarFila(); } });
          ci.addEventListener('change', () => pintarPedido());
          const pi = row.querySelector('[data-precio]');
          if(pi) pi.addEventListener('input', () => { l.precio = pi.value === '' ? null : Number(pi.value); repintarFila(); });
          const ep = row.querySelector('[data-editar-precio]');
          if(ep) ep.addEventListener('click', () => { l.ui.precio = true; pintarPedido(); const x = raiz.querySelector(`.pn-linea[data-l="${l.id}"] [data-precio]`); if(x){ x.focus(); x.select(); } });
          const ni = row.querySelector('[data-nota]');
          if(ni) ni.addEventListener('input', (e) => { l.nota = e.target.value; });
          const an = row.querySelector('[data-agregar-nota]');
          if(an) an.addEventListener('click', () => { l.ui.nota = true; pintarPedido(); const x = raiz.querySelector(`.pn-linea[data-l="${l.id}"] [data-nota]`); if(x) x.focus(); });
          // al elegir la guarnición, las opciones se cierran: queda la elegida y "Cambiar"
          row.querySelectorAll('[data-guarn]').forEach(b => b.addEventListener('click', () => { l.guarnicionId = b.dataset.guarn; l.ui.g = false; pintarPedido(); }));
          const cg = row.querySelector('[data-cambiar-g]');
          if(cg) cg.addEventListener('click', () => { l.ui.g = true; pintarPedido(); });
          const og = row.querySelector('[data-otra-g]');
          if(og) og.addEventListener('click', () => { l.ui.g = false; st.lineas.splice(st.lineas.indexOf(l) + 1, 0, linea({ menuId: l.menuId, precio: l.precio })); pintarPedido(); });
        });
      };
      const bindear = () => {
        raiz.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => ir(b.dataset.ir)));
        // paso 1
        const busca = raiz.querySelector('#pn-busca');
        if(busca){
          if(!st.cli) setTimeout(() => busca.focus(), 30);
          const lista = raiz.querySelector('#pn-clientes');
          const bindLista = () => lista.querySelectorAll('[data-cli]').forEach(b => b.addEventListener('click', () => elegirCliente(clientePorId(b.dataset.cli))));
          busca.addEventListener('input', () => { st.busca = busca.value; lista.innerHTML = listaClientes(); bindLista(); });
          busca.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); const p = lista.querySelector('[data-cli]'); if(p) elegirCliente(clientePorId(p.dataset.cli)); } });
          bindLista();
        }
        raiz.querySelectorAll('[data-fecha]').forEach(b => b.addEventListener('click', () => cambiarFecha(b.dataset.fecha)));
        const fIn = raiz.querySelector('#pn-fecha'); if(fIn) fIn.addEventListener('change', () => fIn.value && cambiarFecha(fIn.value));
        const nc = raiz.querySelector('#pn-nuevo-cli');
        if(nc) nc.addEventListener('click', async () => { const c = await dialogoClienteRapido(); if(c) elegirCliente(c); });
        // paso 2
        const rep = raiz.querySelector('#pn-repetir');
        if(rep) rep.addEventListener('click', () => {
          st.lineas = st.ultimo.lineas.map(l => linea({ menuId: l.menuId, guarnicionId: l.guarnicionId, cantidad: l.cantidad, nota: l.nota, precio: l.precio }));
          st.porDefecto = false;
          if(!st.forma && st.sugerida) st.forma = st.sugerida;
          pintar({ mantener: true });
          toast(`Copiado el pedido ${st.ultimo.fecha === hoy ? 'de hoy' : `del ${esc(formatFechaMedia(st.ultimo.fecha))}`}: ajustá lo que cambie.`);
        });
        raiz.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
          st.cat = b.dataset.cat; st.buscaPlato = '';
          const bp2 = raiz.querySelector('#pn-busca-plato'); if(bp2) bp2.value = '';
          pintarGrid();
        }));
        const bp = raiz.querySelector('#pn-busca-plato');
        if(bp){
          bp.addEventListener('input', () => { st.buscaPlato = bp.value; pintarGrid(); });
          bp.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); const p = raiz.querySelector('#pn-grid [data-plato]'); if(p) agregarPlato(p.dataset.plato); } });
          pintarGrid();
        }
        bindPedido();
        // paso 3: al elegir, sigue solo
        raiz.querySelectorAll('input[name="pn-forma"]').forEach(r => r.addEventListener('change', () => { st.forma = r.value; ir('ok'); }));
      };
      const cambiarFecha = async (f) => {
        if(!f || f === st.fecha) return;
        st.fecha = f;
        try{ if(!state.fechasCargadas.has(f)) await asegurarFecha(f); }catch(e){ console.error(e); }
        pintar({ mantener: true });
      };
      // Enter en el resumen = crear
      el.addEventListener('keydown', (e) => { if(e.key === 'Enter' && st.paso === 'ok' && !e.target.matches('input, textarea, button')){ e.preventDefault(); siguiente(); } });

      if(cliente) elegirCliente(cliente); else pintar();
    }
  });
}
