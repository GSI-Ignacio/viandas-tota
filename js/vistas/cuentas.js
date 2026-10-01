/* ---------- Cuenta de pedidos (sanatorio, empresas) ----------
   Los pedidos entregados se van sumando en plata y se cobran a fin de semana:
   resumen día por día para mandar, y el pago en plata que deja la cuenta al día. */

const lunesDe = (f) => sumarDias(f, -(diaSemana(f) - 1));

function textoCuentaPedidos(c){
  const k = cuentaPedidosDe(c);
  if(!k || k.saldo <= 0) return '';
  return `Debe ${fmtPlata(k.saldo)}${k.platosSinPagar ? ` · ${plural(k.platosSinPagar, 'plato')}` : ''}`;
}

/* Pago en plata de los pedidos: propone lo que debe (o el total de la semana). */
function dialogoPagoPedidos(c, alTerminar, montoSugerido){
  const k = cuentaPedidosDe(c), deuda = k ? Math.max(k.saldo, 0) : 0;
  const sugerido = montoSugerido != null ? montoSugerido : deuda;
  dialogo({
    titulo: `Registrar pago · ${c.nombre}`,
    texto: deuda ? `Debe <b>${fmtPlata(deuda)}</b> de pedidos${k.platosSinPagar ? ` (${plural(k.platosSinPagar, 'plato')} desde el último pago)` : ''}.` : 'Está al día con los pedidos.',
    html: `<div class="frow">
        <div class="field"><label for="f-pp-monto">Monto${REQ}</label><input type="number" id="f-pp-monto" min="1" step="1" value="${sugerido || ''}" placeholder="$" autofocus></div>
        <div class="field"><label for="f-pp-fecha">Fecha</label><input type="date" id="f-pp-fecha" value="${todayStr()}"></div>
      </div>
      <div class="field"><label for="f-pp-nota">Nota (opcional)</label><input type="text" id="f-pp-nota" value="Pago de la semana" placeholder="Transferencia, efectivo…"></div>`,
    botones: [{ id: 'cancelar', label: 'Cancelar' }, { id: 'ok', label: 'Registrar pago', clase: 'primary', domId: 'confirmar-pago-pedidos' }],
    onMount: (el) => {
      el._validar = () => (Number(el.querySelector('#f-pp-monto').value) > 0) || marcarFalta(el.querySelector('#f-pp-monto'), 'Poné el monto que pagó.');
    }
  }).then(async (r) => {
    if(!r) return;
    try{
      await registrarPagoPedidos(c, { monto: r.el.querySelector('#f-pp-monto').value, fecha: r.el.querySelector('#f-pp-fecha').value || todayStr(), nota: r.el.querySelector('#f-pp-nota').value.trim() });
      const k2 = cuentaPedidosDe(c);
      toast(`Pago registrado. <b>${esc(c.nombre)}</b> ${k2 && k2.saldo > 0 ? `todavía debe ${fmtPlata(k2.saldo)}` : 'quedó al día'}.`);
      renderMenu();
      if(alTerminar) alTerminar();
    }catch(e){ toastError('No se pudo registrar el pago', e); }
  });
}

/* Resumen de los pedidos de una semana (lunes a domingo), para cobrar. */
async function abrirResumenSemana(c, desde){
  desde = desde || lunesDe(todayStr());
  const hasta = sumarDias(desde, 6);
  let porDia;
  try{ porDia = await pedidosEntre(c, desde, hasta); }catch(e){ toastError('No se pudieron traer los pedidos', e); return; }
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(desde, i));
  const filas = dias.map(f => {
    const ls = porDia[f] || [];
    const platos = ls.reduce((s, l) => s + l.cantidad, 0);
    const plata = ls.reduce((s, l) => s + l.cantidad * (l.precio != null ? l.precio : (precioPara(c, l.menuId) || 0)), 0);
    const pend = ls.some(l => l.estado !== 'entregada');
    return { f, ls, platos, plata, pend };
  });
  const conPedido = filas.filter(x => x.platos);
  const tot = conPedido.reduce((s, x) => ({ platos: s.platos + x.platos, plata: s.plata + x.plata }), { platos: 0, plata: 0 });
  const entregado = tot.plata;
  const k = cuentaPedidosDe(c);
  const fmtF = (f) => parseFecha(f).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' });
  const textoWA = [`Resumen de pedidos · ${c.nombre}`, `Semana del ${fmtF(desde)} al ${fmtF(hasta)}`, '',
    ...conPedido.map(x => `${nombreDia(x.f).replace(/^./, m => m.toUpperCase())} ${fmtF(x.f)}: ${plural(x.platos, 'plato')} — ${fmtPlata(x.plata)}`),
    '', `Total: ${plural(tot.platos, 'plato')} — ${fmtPlata(tot.plata)}`, '', `¡Gracias! ${state.config.nombre}`].join('\n');

  abrirPanel({
    titulo: `${icon('pago', 14)} Resumen de la semana`,
    ancho: 'medio',
    html: `<h2 class="ptitle">${esc(c.nombre)}</h2>
      <div class="md-nav">
        <button class="iconbtn" type="button" data-sem="-7" aria-label="Semana anterior" title="Semana anterior">${icon('chevL', 15)}</button>
        <b>Semana del ${esc(fmtF(desde))} al ${esc(fmtF(hasta))}</b>
        <button class="iconbtn" type="button" data-sem="7" aria-label="Semana siguiente" title="Semana siguiente">${icon('chevR', 15)}</button>
      </div>
      <div class="clist"><div class="tablewrap"><table class="ptable compacta">
        <thead><tr><th>Día</th><th>Qué se entregó</th><th class="r">Platos</th><th class="r">$</th></tr></thead>
        <tbody>${filas.map(x => `<tr class="${x.platos ? '' : 'off'}"><td style="white-space:nowrap">${esc(nombreDia(x.f))} <span class="muted">${esc(fmtF(x.f))}</span></td>
          <td class="wrap">${x.ls.length ? x.ls.map(l => `${l.cantidad}× ${esc(textoLinea(l))}`).join(' · ') + (x.pend ? ' <span class="tag warn">pendiente</span>' : '') : '<span class="muted">—</span>'}</td>
          <td class="r">${x.platos || ''}</td><td class="r">${x.platos ? fmtPlata(x.plata) : ''}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2"><b>Total de la semana</b></td><td class="r"><b>${tot.platos}</b></td><td class="r"><b>${fmtPlata(tot.plata) || '$ 0'}</b></td></tr></tfoot>
      </table></div></div>
      ${conPedido.some(x => x.pend) ? `<p class="muted" style="font-size:13px;margin:8px 2px 0">Incluye pedidos que todavía no se marcaron entregados: suman a la cuenta desde que se cargan.</p>` : ''}
      ${k ? `<div class="cred-ped" style="margin-top:14px"><div class="cp-top"><span>Debe en total (todas las semanas)</span><b class="${k.saldo > 0 ? 'debe' : 'ok'}">${fmtPlata(Math.max(k.saldo, 0)) || '$ 0'}</b></div>
        <div class="s">${k.ultimoPago ? `Último pago el ${esc(formatFechaCorta(k.ultimoPago))}` : 'Todavía no registró pagos de pedidos.'}</div></div>` : ''}`,
    pie: `<button class="btn lg" id="sem-copiar">${icon('copiar', 14)} Copiar para WhatsApp</button><span class="sp"></span>
      ${esDueno() ? `<button class="btn lg primary" id="sem-pago">${icon('pago', 14)} Registrar pago</button>` : ''}
      <button class="btn lg" id="sem-cerrar">Listo</button>`,
    onMount: (el) => {
      el.querySelectorAll('[data-sem]').forEach(b => b.addEventListener('click', () => abrirResumenSemana(c, sumarDias(desde, Number(b.dataset.sem)))));
      el.querySelector('#sem-cerrar').addEventListener('click', () => cerrarPanel());
      el.querySelector('#sem-copiar').addEventListener('click', async () => {
        try{ await navigator.clipboard.writeText(textoWA); toast('Resumen copiado: pegalo en WhatsApp.'); }
        catch(e){ toast('No se pudo copiar el resumen.', 'err'); }
      });
      const bp = el.querySelector('#sem-pago');
      if(bp) bp.addEventListener('click', () => dialogoPagoPedidos(c, () => { refrescar(); abrirResumenSemana(c, desde); }, k && k.saldo > 0 ? k.saldo : entregado));
    }
  });
}
