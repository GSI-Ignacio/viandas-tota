/* ---------- Packs por renovar ----------
   Los packs de dietas sin créditos o por quedarse sin, en un solo lugar:
   avisarles por WhatsApp (queda anotado cuándo), renovarles el pack o pausarlos
   hasta que paguen. Está en Hoy (a la derecha) y en Clientes. */

function renovEstadoHtml(c){
  const s = saldoDe(c.id), hoy = todayStr();
  if(!c.activo) return `<span class="ren-est bad">Pausado · ${s < 0 ? `debe ${plural(-s, 'crédito')}` : 'sin créditos'}</span>`;
  if(s <= 0){
    const recibeHoy = turnosDe(c, hoy).length > 0;
    return `<span class="ren-est bad">${s < 0 ? `Debe ${plural(-s, 'crédito')}` : 'Sin créditos'}${recibeHoy ? ' · recibe hoy' : ''}</span>`;
  }
  const d = diasQueCubre(c);
  return `<span class="ren-est warn">Le ${s === 1 ? 'queda 1 crédito' : `quedan ${s} créditos`}${d ? ` · alcanza ${plural(d, 'día')}` : ''}</span>`;
}

function renovRowHtml(c){
  const wa = waLink(c.telefono, mensajeRecordatorio(c));
  const avisado = !!c.avisoSaldoAt;
  return `<div class="ren-row" data-cli="${c.id}">
    <div class="t" data-ren-abrir="${c.id}" role="button" tabindex="0" title="Abrir la ficha">
      <div class="n">${esc(c.nombre)}</div>
      <div class="s">${renovEstadoHtml(c)}<span class="ren-aviso ${avisado ? 'si' : ''}">${icon(avisado ? 'check' : 'wa', 12)} ${esc(textoAviso(c))}</span></div>
    </div>
    <div class="acts">
      ${wa ? `<a class="btn" href="${wa}" target="_blank" rel="noopener" data-ren-avisar="${c.id}" title="Avisarle por WhatsApp (queda anotado)">${icon('wa', 13)}<span class="lbl"> Avisar</span></a>`
        : `<button class="btn" disabled title="No tiene teléfono cargado">${icon('wa', 13)}<span class="lbl"> Avisar</span></button>`}
      ${esDueno() ? `<button class="btn primary" type="button" data-ren-renovar="${c.id}" title="Cargarle créditos">${icon('pago', 13)}<span class="lbl"> Renovar</span></button>` : ''}
      ${esDueno() ? `<button class="btn quiet" type="button" data-ren-pausar="${c.id}" title="${c.activo ? 'Pausar: deja de aparecer en Hoy hasta que pague' : 'Reactivar sus entregas'}" aria-label="${c.activo ? 'Pausar' : 'Reactivar'}">${icon(c.activo ? 'pausa' : 'play', 13)}</button>` : ''}
    </div>
  </div>`;
}

/* Sección para el costado de Hoy: los más urgentes y un acceso a la bandeja completa. */
function seccionRenovarHtml(){
  const { sin, vencen, pausados } = packsPorRenovar();
  const todos = [...sin, ...vencen];
  if(!todos.length && !pausados.length) return '';
  const muestra = todos.slice(0, 5);
  return `<section class="tsec" id="sec-renovar">
    <h2>${icon('pago', 14)} Packs por renovar <span class="sp"></span><button class="btn quiet" type="button" data-ren-bandeja>Ver todos</button></h2>
    <div class="clist ren-lista ${sin.length ? 'alert' : ''}">
      ${muestra.map(renovRowHtml).join('')}
      ${todos.length > muestra.length || pausados.length ? `<button class="more" type="button" data-ren-bandeja>${todos.length > muestra.length ? `${plural(todos.length - muestra.length, 'pack más', 'packs más')}` : ''}${todos.length > muestra.length && pausados.length ? ' · ' : ''}${pausados.length ? plural(pausados.length, 'pausado') : ''}</button>` : ''}
    </div></section>`;
}

/* Bandeja completa. */
function abrirRenovaciones(){
  const { sin, vencen, pausados } = packsPorRenovar();
  const grupo = (titulo, cls, lista, vacio) => `<div class="psec" style="margin-top:0;margin-bottom:18px">
      <h3><span class="ren-dot ${cls}"></span>${titulo} <span class="n">${lista.length || ''}</span></h3>
      <div class="clist ren-lista">${lista.length ? lista.map(renovRowHtml).join('') : `<div class="calm">${icon('check')} ${vacio}</div>`}</div></div>`;
  abrirPanel({
    titulo: `${icon('pago', 14)} Packs por renovar`,
    ancho: 'medio',
    html: `<p class="psub" style="margin-top:0">Los packs de dietas que se quedaron sin créditos o están por quedarse. Avisales por WhatsApp
        (queda anotado cuándo), renovales el pack o pausalos hasta que paguen: pausados no aparecen en Hoy.</p>
      ${grupo('Sin créditos', 'bad', sin, 'Ningún pack sin créditos.')}
      ${grupo(`Por quedarse sin (${state.config.alertaViandas} créditos o menos)`, 'warn', vencen, 'Ningún pack por quedarse sin créditos.')}
      ${pausados.length ? grupo('Pausados sin créditos', 'off', pausados, '') : ''}`,
    pie: '<span class="sp"></span><button class="btn lg" id="ren-cerrar">Cerrar</button>',
    onMount: (el) => {
      el.querySelector('#ren-cerrar').addEventListener('click', () => cerrarPanel());
      bindRenovar(el, () => { refrescar(); abrirRenovaciones(); });
    }
  });
}

function bindRenovar(root, alCambiar){
  root.querySelectorAll('[data-ren-bandeja]').forEach(b => b.addEventListener('click', () => abrirRenovaciones()));
  root.querySelectorAll('[data-ren-abrir]').forEach(el => {
    const abrir = () => { irA('clientes'); abrirCliente(el.dataset.renAbrir); };
    el.addEventListener('click', abrir);
    el.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); abrir(); } });
  });
  // el link abre WhatsApp en otra pestaña; acá solo se anota el aviso
  root.querySelectorAll('[data-ren-avisar]').forEach(a => a.addEventListener('click', async () => {
    const c = clientePorId(a.dataset.renAvisar);
    try{ await marcarAvisoSaldo(c); alCambiar(); }catch(e){ toastError('Se abrió WhatsApp pero no se pudo anotar el aviso', e); }
  }));
  root.querySelectorAll('[data-ren-renovar]').forEach(b => b.addEventListener('click', () => {
    dialogoPago(clientePorId(b.dataset.renRenovar), alCambiar, null, { renovar: true });
  }));
  root.querySelectorAll('[data-ren-pausar]').forEach(b => b.addEventListener('click', async () => {
    const c = clientePorId(b.dataset.renPausar);
    try{
      await cambiarActivo(c);
      toast(c.activo ? `<b>${esc(c.nombre)}</b> vuelve a recibir.` : `<b>${esc(c.nombre)}</b> pausado: no aparece en Hoy hasta que lo reactives.`, 'ok', null, {
        label: 'Deshacer', fn: async () => { try{ await cambiarActivo(c); alCambiar(); }catch(e){ toastError('No se pudo deshacer', e); } }
      });
      alCambiar();
    }catch(e){ toastError('No se pudo cambiar', e); }
  }));
}
