/* ---------- Días sin entregas (feriados, vacaciones, cierres) ----------
   Un día cerrado no tiene entregas de packs ni fijos: nadie usa créditos y "le alcanza hasta"
   lo saltea. Los pedidos se pueden cargar igual (con un aviso). Se marcan acá, desde el día en
   "Próximos días", o trayendo los feriados nacionales y eligiendo cuáles se cierran. */

const feriadosCache = {};   // año → [{ fecha, nombre, tipo }]

function avisoDiaCerradoHtml(fecha, { acciones = true } = {}){
  const d = diaCerrado(fecha);
  if(!d) return '';
  const cuando = fecha === todayStr() ? 'Hoy no se trabaja' : 'Ese día no se trabaja';
  return `<div class="banner dia-cerrado">${icon('calendario', 15)}
    <span><b>${cuando}${d.motivo ? ` · ${esc(d.motivo)}` : ''}.</b> Los packs y fijos no reciben ni usan créditos.</span>
    ${acciones && puedeCerrarDias(fecha) ? `<button class="btn quiet" type="button" data-abrir-dia="${fecha}">Abrir el día</button>` : ''}</div>`;
}
function bindAvisoDiaCerrado(root, alCambiar){
  root.querySelectorAll('[data-abrir-dia]').forEach(b => b.addEventListener('click', async () => {
    const f = b.dataset.abrirDia, antes = diaCerrado(f);
    try{
      await abrirDiaCerrado(f);
      toast(`${esc(formatFechaMedia(f))} vuelve a ser un día con entregas.`, 'ok', null, {
        label: 'Deshacer', fn: async () => { try{ await cerrarDias([{ fecha: f, motivo: antes && antes.motivo }]); alCambiar(); }catch(e){ toastError('No se pudo deshacer', e); } }
      });
      alCambiar();
    }catch(e){ toastError('No se pudo abrir el día', e); }
  }));
}

/* Marcar un día puntual como cerrado (pide el motivo). */
function dialogoCerrarDia(fecha, alTerminar){
  dialogo({
    titulo: `Día sin entregas · ${formatFechaMedia(fecha)}`,
    texto: 'Ese día los packs y fijos no reciben ni usan créditos. Los pedidos se pueden cargar igual.',
    html: `<div class="field"><label for="f-dc-motivo">Motivo (opcional)</label><input type="text" id="f-dc-motivo" value="Feriado" placeholder="Feriado, vacaciones…" autofocus></div>`,
    botones: [{ id: 'cancelar', label: 'Cancelar' }, { id: 'ok', label: 'Marcar sin entregas', clase: 'primary', domId: 'confirmar-cerrar-dia' }]
  }).then(async (r) => {
    if(!r) return;
    try{
      await cerrarDias([{ fecha, motivo: r.el.querySelector('#f-dc-motivo').value }]);
      toast(`${esc(formatFechaMedia(fecha))}: día sin entregas.`);
      if(alTerminar) alTerminar();
    }catch(e){ toastError('No se pudo marcar el día', e); }
  });
}

/* Ventana con todos los días sin entregas, para marcar uno o traer los feriados nacionales. */
function abrirDiasCerrados(anioFeriados){
  const hoy = todayStr(), anio = Number(hoy.slice(0, 4));
  const proximos = Object.entries(state.diasCerrados || {}).filter(([f]) => f >= hoy).sort(([a], [b]) => a.localeCompare(b));
  const anioF = anioFeriados || anio;
  // los que ya pasaron no sirven: solo se cuentan
  const fer = feriadosCache[anioF] && feriadosCache[anioF].filter(x => x.fecha >= hoy);
  const pasados = feriadosCache[anioF] ? feriadosCache[anioF].length - fer.length : 0;
  const edita = puedeCerrarDias(hoy);
  const filaFeriado = (x) => {
    const ya = !!diaCerrado(x.fecha);
    return `<label class="check fer-row ${ya ? 'off' : ''}">
      <input type="checkbox" data-fer="${x.fecha}" data-nombre="${esc(x.nombre)}" ${ya ? 'checked disabled' : !edita ? 'disabled' : ''}>
      <span class="w">${esc(formatFechaMedia(x.fecha))}</span><span class="t">${esc(x.nombre)}</span>
      <span class="muted">${ya ? 'ya marcado' : x.tipo === 'trasladable' ? 'trasladable' : x.tipo === 'puente' ? 'puente' : ''}</span></label>`;
  };
  abrirPanel({
    titulo: `${icon('calendario', 14)} Días sin entregas`,
    ancho: 'medio',
    html: `<p class="psub" style="margin-top:0">Feriados, vacaciones o cualquier día que no se trabaja. Ese día los packs y fijos no reciben ni usan
        créditos, y "le alcanza hasta" lo saltea. Los pedidos se pueden cargar igual.</p>
      ${edita ? `<div class="psec" style="margin-top:6px"><h3>Marcar un día</h3>
        <div class="dc-form">
          <div class="field"><label for="f-dc-fecha">Fecha${REQ}</label><input type="date" id="f-dc-fecha" min="${esDueno() ? '' : hoy}"></div>
          <div class="field"><label for="f-dc-mot">Motivo (opcional)</label><input type="text" id="f-dc-mot" placeholder="Feriado, vacaciones…"></div>
          <button class="btn lg primary" type="button" id="dc-marcar">Marcar sin entregas</button>
        </div></div>` : ''}
      <div class="psec"><h3>Próximos días sin entregas <span class="n">${proximos.length || ''}</span></h3>
        <div class="clist">${proximos.length ? proximos.map(([f, d]) => `<div class="irow">
            <div class="t"><div class="n">${esc(formatFechaLarga(f).replace(/^./, x => x.toUpperCase()))}${f === hoy ? ' · hoy' : ''}</div>
              <div class="s">${esc(d.motivo || 'Sin entregas')}</div></div>
            ${edita ? `<button class="btn quiet" type="button" data-abrir-dia="${f}">Quitar</button>` : ''}</div>`).join('')
          : `<div class="calm">${icon('check')} No hay días marcados. Todos los días con clientes programados tienen entregas.</div>`}</div></div>
      <div class="psec"><h3>Feriados nacionales <span class="sp"></span>
          <select class="inp sm" id="dc-anio" aria-label="Año" style="width:auto">${[anio, anio + 1].map(a => `<option value="${a}" ${a === anioF ? 'selected' : ''}>${a}</option>`).join('')}</select></h3>
        ${fer ? `<p class="help" style="margin:0 0 8px">Tildá los que no trabajás y tocá <b>Marcar los elegidos</b>. Ninguno se marca solo.${pasados ? ` (${plural(pasados, 'feriado de este año ya pasó', 'feriados de este año ya pasaron')}.)` : ''}</p>
            <div class="clist fer-lista">${fer.length ? fer.map(filaFeriado).join('') : `<div class="calm">${icon('check')} No quedan feriados en ${anioF}.</div>`}</div>
            ${edita ? `<button class="btn lg primary" type="button" id="dc-elegidos" style="margin-top:10px" disabled>Marcar los elegidos</button>` : ''}`
          : `<button class="btn lg" type="button" id="dc-traer">${icon('calendario', 14)} Traer los feriados de ${anioF}</button>`}
      </div>`,
    pie: '<span class="sp"></span><button class="btn lg" id="dc-cerrar">Listo</button>',
    onMount: (el) => {
      const otraVez = () => { refrescar(); abrirDiasCerrados(anioF); };
      el.querySelector('#dc-cerrar').addEventListener('click', () => cerrarPanel());
      bindAvisoDiaCerrado(el, otraVez);
      const marcar = el.querySelector('#dc-marcar');
      if(marcar){
        const fInp = el.querySelector('#f-dc-fecha');
        const apagar = () => { marcar.disabled = !fInp.value || !!diaCerrado(fInp.value); marcar.title = fInp.value && diaCerrado(fInp.value) ? 'Ese día ya está marcado' : ''; };
        fInp.addEventListener('input', apagar); fInp.addEventListener('change', apagar); apagar();
        marcar.addEventListener('click', async () => {
          marcar.disabled = true;
          try{ await cerrarDias([{ fecha: fInp.value, motivo: el.querySelector('#f-dc-mot').value }]); toast(`${esc(formatFechaMedia(fInp.value))}: día sin entregas.`); otraVez(); }
          catch(e){ toastError('No se pudo marcar el día', e); apagar(); }
        });
      }
      el.querySelector('#dc-anio').addEventListener('change', (e) => abrirDiasCerrados(Number(e.target.value)));
      const traer = el.querySelector('#dc-traer');
      if(traer) traer.addEventListener('click', async () => {
        traer.classList.add('busy');
        try{ feriadosCache[anioF] = await feriadosNacionales(anioF); abrirDiasCerrados(anioF); }
        catch(e){ toastError('No se pudieron traer los feriados (revisá la conexión)', e); traer.classList.remove('busy'); }
      });
      const elegidos = el.querySelector('#dc-elegidos');
      if(elegidos){
        const tildados = () => [...el.querySelectorAll('[data-fer]:checked:not(:disabled)')];
        el.querySelectorAll('[data-fer]').forEach(x => x.addEventListener('change', () => {
          const n = tildados().length;
          elegidos.disabled = !n;
          elegidos.textContent = n ? `Marcar ${plural(n, 'día elegido', 'días elegidos')}` : 'Marcar los elegidos';
        }));
        elegidos.addEventListener('click', async () => {
          const dias = tildados().map(x => ({ fecha: x.dataset.fer, motivo: x.dataset.nombre }));
          elegidos.disabled = true;
          try{ const n = await cerrarDias(dias); toast(`Listo: ${plural(n, 'día quedó', 'días quedaron')} sin entregas.`); otraVez(); }
          catch(e){ toastError('No se pudieron marcar los días', e); elegidos.disabled = false; }
        });
      }
    }
  });
}
