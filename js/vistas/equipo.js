/* ============================================================
   PESTAÑAS: EQUIPO (cadetes y usuarios) y AJUSTES (negocio, cocina, alertas)
============================================================= */
function renderEquipo(bar, main){
  bar.innerHTML = `<h1>Equipo</h1><div class="sp"></div>
    <button class="btn" id="nuevo-usuario">${icon('plus', 14)} Sumar usuario</button>
    <button class="btn primary" id="nuevo-cadete">${icon('plus', 14)} Nuevo cadete</button>`;
  bar.querySelector('#nuevo-cadete').addEventListener('click', () => abrirCadete(null));
  bar.querySelector('#nuevo-usuario').addEventListener('click', dialogoMiembro);
  const hoy = todayStr();
  main.innerHTML = `<div class="page cols2">
    <section class="tsec" style="margin-top:0">
      <h2>Cadetes <span class="n">${state.cadetes.length}</span><span class="sp"></span><span class="hint2">reparten las viandas; cada uno puede tener su usuario</span></h2>
      <div class="clist">${state.cadetes.length ? state.cadetes.map(k => {
        const asignados = state.clientes.filter(c => c.cadeteId === k.id && c.activo).length;
        const hoyN = clientesDelDia(hoy).filter(c => cadeteDelDia(c, hoy) === k.id).length;
        const usuario = state.miembros.find(m => m.cadete_id === k.id);
        return `<div class="irow click" data-cad="${k.id}"><span class="dot" style="--c:${k.color}"></span>
          <div class="t"><div class="n">${esc(k.nombre)} ${k.activo ? '' : '<span class="tag plain">Inactivo</span>'}</div>
            <div class="s">${esc(k.telefono || 'Sin teléfono')} · ${usuario ? `usuario ${esc(usuario.email)}` : 'sin usuario'}</div></div>
          <span class="why">${plural(asignados, 'cliente')} · hoy ${hoyN}</span></div>`; }).join('')
        : `<div class="calm">${icon('moto')} Todavía no cargaste cadetes. Con ellos podés repartir las rutas por zona.</div>`}</div>
    </section>
    <section class="tsec" style="margin-top:0">
      <h2>Usuarios con acceso <span class="n">${state.miembros.length}</span></h2>
      <div class="clist">${state.miembros.length ? state.miembros.map(m => {
        const k = cadetePorId(m.cadete_id);
        return `<div class="irow">${avatarHtml(m.nombre || m.email, 26)}
          <div class="t"><div class="n">${esc(m.nombre || m.email)}</div><div class="s">${esc(m.email)}</div></div>
          <span class="tag ${m.rol === 'ayudante' ? 'pine' : 'warn'}">${ROL_LABEL[m.rol]}${k ? ' · ' + esc(k.nombre) : ''}</span>
          <div class="acts"><button class="btn quiet" data-quitar="${m.auth_id}" title="Quitar acceso">${icon('borrar', 13)}</button></div></div>`; }).join('')
        : `<div class="calm">${icon('equipo')} Solo vos tenés acceso por ahora.</div>`}</div>
      <p class="muted" style="font-size:13px;line-height:1.55;margin-top:10px">
        <b>Ayudante:</b> ve todo (entregas, rutas, clientes, stock y registro), registra entregas del día y reorganiza rutas; no puede cambiar clientes, pagos, stock ni ajustes.<br>
        <b>Cadete:</b> ve solo su ruta del día (a quién y dónde entregar) y marca sus entregas.<br>
        Para sumar a alguien: primero creá su usuario en Supabase → Authentication → Users → <i>Add user</i> (email y contraseña, con "Auto confirm"), y después tocá <b>Sumar usuario</b>.</p>
    </section></div>`;
  main.querySelectorAll('[data-cad]').forEach(r => r.addEventListener('click', () => abrirCadete(r.dataset.cad)));
  main.querySelectorAll('[data-quitar]').forEach(b => b.addEventListener('click', async () => {
    const m = state.miembros.find(x => x.auth_id === b.dataset.quitar);
    if(!(await confirmar('Quitar acceso', `¿Quitarle el acceso a <b>${esc(m.email)}</b>? Su usuario sigue existiendo en Supabase pero ya no ve tu negocio.`, { ok: 'Quitar acceso', peligro: true }))) return;
    try{ await quitarMiembro(m); toast('Acceso quitado.'); refrescar(); }catch(e){ toastError('No se pudo quitar el acceso', e); }
  }));
}

function abrirCadete(id){
  const k = id ? cadetePorId(id) : null;
  const d = k || { nombre: '', telefono: '', color: COLORES_CADETE[state.cadetes.length % COLORES_CADETE.length], activo: true };
  abrirPanel({
    ancho: 'medio',
    titulo: `${icon('moto', 14)} ${k ? 'Cadete' : 'Nuevo cadete'}`,
    html: `<div class="field"><label for="f-cad-nombre">Nombre${REQ}</label><input type="text" id="f-cad-nombre" value="${esc(d.nombre)}" autofocus></div>
      <div class="field"><label for="f-cad-tel">Teléfono (para mandarle la ruta por WhatsApp)</label><input type="tel" id="f-cad-tel" value="${esc(d.telefono)}"></div>
      <div class="field"><span class="flabel" id="lbl-color">Color en el mapa</span><div class="days" role="radiogroup" aria-labelledby="lbl-color">
        ${COLORES_CADETE.map(c => `<label><input type="radio" name="f-cad-color" value="${c}" ${c === d.color ? 'checked' : ''} aria-label="Color ${c}"><span style="background:${c};border-color:${c};${c === d.color ? 'box-shadow:0 0 0 2px var(--panel),0 0 0 4px ' + c : ''}"></span></label>`).join('')}</div></div>
      <label class="check"><input type="checkbox" id="f-cad-activo" ${d.activo ? 'checked' : ''}> Activo (entra en el reparto de rutas)</label>
      ${k ? `<div class="psec"><button class="btn lg danger" id="borrar-cadete">${icon('borrar', 14)} Eliminar cadete</button>
        <p class="muted" style="font-size:13px">Sus clientes quedan sin cadete asignado.</p></div>` : ''}`,
    pie: `<button class="btn lg" id="cancelar-cad">Cancelar</button><button class="btn lg primary" id="guardar-cadete">${k ? 'Guardar' : 'Crear cadete'}</button>`,
    onMount: (el) => {
      el.querySelectorAll('[name="f-cad-color"]').forEach(r => r.addEventListener('change', () => {
        el.querySelectorAll('[name="f-cad-color"]').forEach(x => { x.nextElementSibling.style.boxShadow = x.checked ? `0 0 0 2px var(--panel),0 0 0 4px ${x.value}` : ''; });
      }));
      el.querySelector('#cancelar-cad').addEventListener('click', () => cerrarPanel());
      el.querySelector('#guardar-cadete').addEventListener('click', async () => {
        const nombre = el.querySelector('#f-cad-nombre').value.trim();
        if(!nombre){ marcarFalta(el.querySelector('#f-cad-nombre'), 'Poné el nombre del cadete.'); return; }
        try{
          const g = await guardarCadete(k ? k.id : null, { nombre, telefono: el.querySelector('#f-cad-tel').value.trim(),
            color: (el.querySelector('[name="f-cad-color"]:checked') || {}).value || COLORES_CADETE[0], activo: el.querySelector('#f-cad-activo').checked });
          toast(k ? 'Cadete actualizado.' : 'Cadete creado.'); cerrarPanel(); refrescar();
        }catch(e){ toastError('No se pudo guardar', e); }
      });
      const b = el.querySelector('#borrar-cadete');
      if(b) b.addEventListener('click', async () => {
        if(!(await confirmar('Eliminar cadete', `¿Eliminar a <b>${esc(k.nombre)}</b>?`, { ok: 'Eliminar', peligro: true }))) return;
        try{ await eliminarCadete(k); toast('Cadete eliminado.'); cerrarPanel(); refrescar(); }catch(e){ toastError('No se pudo eliminar', e); }
      });
    }
  });
}

function dialogoMiembro(){
  dialogo({
    titulo: 'Sumar usuario',
    texto: 'El usuario tiene que existir en Supabase → Authentication → Users. Acá le das acceso a tu negocio con un rol.',
    html: `<div class="field"><label for="f-m-email">Email del usuario${REQ}</label><input type="email" id="f-m-email" autofocus></div>
      <div class="field"><label for="f-m-nombre">Nombre (opcional)</label><input type="text" id="f-m-nombre"></div>
      <div class="frow"><div class="field"><label for="f-m-rol">Rol</label><select id="f-m-rol"><option value="ayudante">Ayudante</option><option value="cadete">Cadete</option></select></div>
        <div class="field hidden" id="grupo-m-cadete"><label for="f-m-cadete">¿Qué cadete es?</label><select id="f-m-cadete">
          ${state.cadetes.map(k => `<option value="${k.id}">${esc(k.nombre)}</option>`).join('') || '<option value="">Primero creá el cadete</option>'}</select></div></div>`,
    botones: [{ id: 'cancelar', label: 'Cancelar' }, { id: 'ok', label: 'Dar acceso', clase: 'primary' }],
    onMount: (el) => {
      const rol = el.querySelector('#f-m-rol');
      rol.addEventListener('change', () => el.querySelector('#grupo-m-cadete').classList.toggle('hidden', rol.value !== 'cadete'));
      el._validar = () => { if(!el.querySelector('#f-m-email').value.trim()) return marcarFalta(el.querySelector('#f-m-email'), 'Poné el email del usuario.'); return true; };
    }
  }).then(async (r) => {
    if(!r) return;
    const el = r.el, rol = el.querySelector('#f-m-rol').value;
    try{
      const m = await agregarMiembro(el.querySelector('#f-m-email').value.trim(), rol, el.querySelector('#f-m-nombre').value.trim(), rol === 'cadete' ? el.querySelector('#f-m-cadete').value : null);
      toast(`<b>${esc(m.email)}</b> ya puede entrar como ${ROL_LABEL[m.rol].toLowerCase()}.`);
      refrescar();
    }catch(e){ toastError('No se pudo dar acceso', e); }
  });
}

/* ---------- ajustes ---------- */
function renderAjustes(bar, main){
  bar.innerHTML = `<h1>Ajustes</h1><div class="sp"></div><button class="btn primary" id="guardar-ajustes">${icon('check', 14)} Guardar</button>`;
  const cfg = state.config;
  main.innerHTML = `<div class="page cols2">
    <div>
    <section class="tsec" style="margin-top:0"><h2>Negocio</h2>
      <div class="clist" style="padding:16px">
        <div class="field"><label for="negocio-nombre">Nombre del negocio</label><input type="text" id="negocio-nombre" value="${esc(cfg.nombre)}"></div>
        <div class="field" style="margin:0"><label for="f-alerta">Avisar cuando a un cliente le queden</label>
          <div style="display:flex;gap:8px;align-items:center"><input type="number" id="f-alerta" min="0" step="1" value="${cfg.alertaViandas}" style="width:90px"><span class="muted">créditos o menos</span></div></div>
      </div></section>
    <section class="tsec"><h2>Copia de seguridad</h2>
      <div class="clist" style="padding:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span class="muted" style="flex:1;min-width:200px">Bajá una copia de todos tus datos o restaurá una anterior.</span>
        <button class="btn lg" id="ajustes-backup">${icon('backup', 14)} Copia de seguridad</button></div></section>
    </div>
    <section class="tsec" style="margin-top:0"><h2>Cocina <span class="sp"></span><span class="hint2">punto de partida de los recorridos</span></h2>
      <div class="clist" style="padding:16px">${ubicacionFormHtml('k', { direccion: cfg.cocinaDireccion, lat: cfg.cocinaLat, lng: cfg.cocinaLng })}</div></section>
  </div>`;
  const ubic = bindUbicacion(main, 'k', { direccion: cfg.cocinaDireccion, lat: cfg.cocinaLat, lng: cfg.cocinaLng });
  main.querySelector('#ajustes-backup').addEventListener('click', openBackupModal);
  bar.querySelector('#guardar-ajustes').addEventListener('click', async () => {
    try{
      await guardarConfig({
        nombre: main.querySelector('#negocio-nombre').value.trim() || 'Mi Vianda',
        alertaViandas: Math.max(0, Math.trunc(Number(main.querySelector('#f-alerta').value) || 0)),
        cocinaDireccion: main.querySelector('#k-direccion').value.trim(), cocinaLat: ubic.lat ?? null, cocinaLng: ubic.lng ?? null
      });
      toast('Ajustes guardados.'); renderMenu();
    }catch(e){ toastError('No se pudieron guardar los ajustes', e); }
  });
}
