/* ---------- Categorías de los platos ----------
   La lista que ordena los platos en Stock y en los pedidos; cada sección de la carta es una
   categoría y muestra solo sus platos. Se agregan, se les cambia el nombre, se ordenan y se borran
   (si una tiene platos, esos platos pasan a otra). Cada cambio se guarda en el momento. */

/* Pide el nombre de una categoría nueva. */
async function pedirNombreCategoria(){
  const r = await dialogo({
    titulo: 'Categoría nueva',
    html: `<div class="field"><label for="f-cat-nombre">Nombre${REQ}</label><input type="text" id="f-cat-nombre" placeholder="Ej: Bebidas, Postres, Ensaladas" autocomplete="off" autofocus></div>`,
    botones: [{ id: 'cancelar', label: 'Cancelar' }, { id: 'ok', label: 'Crear categoría', clase: 'primary', domId: 'confirmar-categoria' }],
    onMount: (el) => { el._validar = () => el.querySelector('#f-cat-nombre').value.trim() ? true : marcarFalta(el.querySelector('#f-cat-nombre'), 'Poné el nombre.'); }
  });
  return r ? r.el.querySelector('#f-cat-nombre').value.trim() : null;
}

function abrirCategorias(){
  if(!usaCategorias()){ toast('Para editar las categorías hay que actualizar la base de datos (actualizar-base.sql).', 'info', 7000); return; }
  const cats = categorias();
  const cuenta = (c) => { const ms = platosDeCategoria(c), act = ms.filter(m => m.activo).length; return { act, inact: ms.length - act }; };
  abrirPanel({
    titulo: `${icon('menu', 14)} Categorías`,
    ancho: 'medio',
    html: `<p class="psub" style="margin-top:0">Ordenan los platos en Stock y en los pedidos. En la carta, cada sección es una categoría y muestra solo sus platos.</p>
      <div class="cat-lista">${cats.length ? cats.map((c, i) => { const n = cuenta(c);
        return `<div class="cat-fila">
          <span class="cat-orden"><button type="button" class="iconbtn" data-subir="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Subir ${esc(c)}" title="Subir">${icon('up', 13)}</button>
            <button type="button" class="iconbtn" data-bajar="${i}" ${i === cats.length - 1 ? 'disabled' : ''} aria-label="Bajar ${esc(c)}" title="Bajar">${icon('down', 13)}</button></span>
          <input class="inp" data-nombre="${i}" value="${esc(c)}" aria-label="Nombre de la categoría ${esc(c)}" autocomplete="off">
          <span class="cat-n">${n.act ? plural(n.act, 'plato') : 'sin platos'}${n.inact ? ` · ${plural(n.inact, 'desactivado', 'desactivados')}` : ''}</span>
          <button type="button" class="iconbtn rojo" data-borrar="${i}" aria-label="Borrar ${esc(c)}" title="Borrar">${icon('borrar', 14)}</button></div>`; }).join('')
        : `<div class="calm">${icon('info')} Todavía no hay categorías: agregá la primera.</div>`}</div>
      <div class="cat-nueva"><input class="inp" id="cat-nueva" placeholder="Nueva categoría: Bebidas, Postres…" autocomplete="off" aria-label="Nueva categoría">
        <button class="btn" type="button" id="cat-agregar" disabled>${icon('plus', 13)} Agregar</button></div>
      <p class="help" id="cat-existe"></p>`,
    pie: '<span class="sp"></span><button class="btn lg" id="cat-listo">Listo</button>',
    onMount: (el) => {
      const otraVez = () => { refrescar(); abrirCategorias(); };
      el.querySelector('#cat-listo').addEventListener('click', () => cerrarPanel());
      // ordenar
      const mover = async (i, paso) => {
        const lista = [...cats], j = i + paso;
        [lista[i], lista[j]] = [lista[j], lista[i]];
        try{ await guardarCategorias(lista); otraVez(); }catch(e){ toastError('No se pudo ordenar', e); }
      };
      el.querySelectorAll('[data-subir]').forEach(b => b.addEventListener('click', () => mover(Number(b.dataset.subir), -1)));
      el.querySelectorAll('[data-bajar]').forEach(b => b.addEventListener('click', () => mover(Number(b.dataset.bajar), 1)));
      // cambiar el nombre: al salir del campo (o con Enter); si ya hay otra con ese nombre, se juntan
      el.querySelectorAll('[data-nombre]').forEach(inp => {
        inp.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); inp.blur(); } if(e.key === 'Escape'){ inp.value = cats[Number(inp.dataset.nombre)]; inp.blur(); } });
        inp.addEventListener('change', async () => {
          const vieja = cats[Number(inp.dataset.nombre)], nueva = inp.value.trim();
          if(!nueva || nueva === vieja){ inp.value = vieja; return; }
          const otra = cats.find(c => c !== vieja && mismaCategoria(c, nueva));
          if(otra && !(await confirmar('Juntar categorías', `Ya existe <b>${esc(otra)}</b>. ¿Juntar <b>${esc(vieja)}</b> con <b>${esc(otra)}</b>? Sus platos pasan a ${esc(otra)}.`, { ok: 'Juntar' }))){ inp.value = vieja; return; }
          try{
            await renombrarCategoria(vieja, otra || nueva);
            toast(otra ? `<b>${esc(vieja)}</b> quedó junto con <b>${esc(otra)}</b>.` : `<b>${esc(vieja)}</b> ahora se llama <b>${esc(nueva)}</b>.`);
            otraVez();
          }catch(e){ toastError('No se pudo cambiar el nombre', e); inp.value = vieja; }
        });
      });
      // borrar: si tiene platos, se elige a qué categoría pasan
      el.querySelectorAll('[data-borrar]').forEach(b => b.addEventListener('click', async () => {
        const c = cats[Number(b.dataset.borrar)], n = cuenta(c), total = n.act + n.inact, otras = cats.filter(x => x !== c);
        let pasarA = null;
        if(total){
          if(!otras.length){ toast('Es la única categoría y tiene platos: primero agregá otra para pasarlos ahí.', 'err'); return; }
          const r = await dialogo({
            titulo: `Borrar ${c}`,
            texto: `<b>${esc(c)}</b> tiene ${plural(total, 'plato', 'platos')}. ¿A qué categoría ${total === 1 ? 'lo' : 'los'} pasás?${
              (cartaActual().secciones.some(s => s.categoria && mismaCategoria(s.categoria, c))) ? ' En la carta, su sección pasa a esa categoría.' : ''}`,
            html: `<div class="field"><label for="f-cat-pasar">Pasarlos a${REQ}</label><select id="f-cat-pasar"><option value="">Elegí una categoría</option>
              ${otras.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></div>`,
            botones: [{ id: 'cancelar', label: 'Cancelar' }, { id: 'ok', label: 'Pasar y borrar', clase: 'primary', domId: 'confirmar-borrar-categoria' }]
          });
          if(!r) return;
          pasarA = r.el.querySelector('#f-cat-pasar').value;
          if(!pasarA) return;
        }
        try{
          await borrarCategoria(c, pasarA);
          toast(pasarA ? `<b>${esc(c)}</b> borrada: sus platos pasaron a <b>${esc(pasarA)}</b>.` : `<b>${esc(c)}</b> borrada.`, 'ok', null, pasarA ? null : {
            label: 'Deshacer', fn: async () => { try{ const l = categorias(); l.splice(Number(b.dataset.borrar), 0, c); await guardarCategorias(l); otraVez(); }catch(e){ toastError('No se pudo deshacer', e); } }
          });
          otraVez();
        }catch(e){ toastError('No se pudo borrar', e); }
      }));
      // agregar
      const nueva = el.querySelector('#cat-nueva'), agregar = el.querySelector('#cat-agregar'), aviso = el.querySelector('#cat-existe');
      const existe = () => cats.find(c => mismaCategoria(c, nueva.value));
      const revisar = () => { const x = existe(); agregar.disabled = !nueva.value.trim() || !!x; aviso.textContent = x ? `Ya existe ${x}.` : ''; };
      nueva.addEventListener('input', revisar);
      const sumar = async () => {
        if(agregar.disabled) return;
        agregar.disabled = true;
        try{ const n = await agregarCategoria(nueva.value); toast(`<b>${esc(n)}</b> agregada.`); otraVez(); setTimeout(() => { const x = document.getElementById('cat-nueva'); if(x) x.focus(); }, 40); }
        catch(e){ toastError('No se pudo agregar', e); revisar(); }
      };
      agregar.addEventListener('click', sumar);
      nueva.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); sumar(); } });
    }
  });
}
