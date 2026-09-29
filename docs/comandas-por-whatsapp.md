# Comandas por WhatsApp — diseño

Estado: propuesta para después de la Fase 1. Hoy las comandas se cargan a mano
(Comandas → Nueva comanda). La base ya está preparada para esto: cada comanda
guarda su `origen` (`manual`, `automatica` o `whatsapp`).

## Qué queremos

Que un cliente escriba por WhatsApp, por ejemplo *"mañana 2 milanesas con puré
para el almuerzo"*, y que eso aparezca como comanda en la app, lista para
confirmar, sin que nadie la tipee. El cliente recibe una respuesta con lo que
quedó anotado.

## Cómo funcionaría

```
Cliente ──WhatsApp──▶ WhatsApp Business (API de Meta)
                          │  webhook con cada mensaje
                          ▼
                 Función de Supabase (Edge Function)
                   1. verifica que el mensaje venga de Meta
                   2. busca al cliente por su teléfono
                   3. interpreta el pedido (día, turno, menús, cantidades)
                   4. guarda la comanda con origen = whatsapp y estado "a confirmar"
                   5. le responde al cliente con el resumen
                          │
                          ▼
                 App: Comandas → "Por confirmar (WhatsApp)"
                   el dueño o el ayudante revisa y confirma, o corrige
```

1. **Número de WhatsApp Business** conectado a la API oficial de Meta
   (WhatsApp Cloud API). Se usa un número propio del negocio; puede ser uno nuevo
   o migrar el actual.
2. **Webhook** en una Edge Function de Supabase. Es la única parte que corre en un
   servidor y la que usa la clave privada de Supabase (nunca va en la página web).
3. **Identificar al cliente por su teléfono.** La app ya guarda `clientes.telefono`,
   así que hay que normalizarlo al formato internacional (549 + característica +
   número). Si el número no está cargado, el mensaje queda en una bandeja de
   "sin cliente" para asignarlo a mano.
4. **Interpretar el pedido.** Dos caminos, de más simple a más flexible:
   - **Menú numerado:** el bot responde con los menús del día numerados y el
     cliente contesta *"2 x 1, 1 x 3"*. Es fácil de entender y casi no falla.
   - **Texto libre:** un modelo de lenguaje interpreta *"mañana 2 milas con puré
     y una tarta a la noche"* contra la lista de menús activos y devuelve los
     datos estructurados. Es más cómodo para el cliente, pero siempre conviene
     que un humano confirme.
5. **Confirmación humana.** Las comandas de WhatsApp entran como *a confirmar*;
   no descuentan nada hasta que se entregan, igual que las demás. Así un error de
   interpretación no llega a la cocina.
6. **Respuesta al cliente:** *"Anotamos para mañana almuerzo: 2× Milanesa con
   puré. Te quedan 8 créditos."*, y un aviso si no le alcanzan los créditos.

## Cambios necesarios

- Base de datos: un estado `a_confirmar` / `confirmada` en `comandas` y una tabla
  `mensajes_whatsapp` con cada mensaje recibido, para revisar y auditar.
- App: una sección "Por confirmar" en Comandas, con Confirmar / Corregir / Rechazar.
- Servidor: la Edge Function (webhook de Meta + interpretación + respuesta).
- Configuración en Meta: cuenta de WhatsApp Business, número, plantilla de
  mensajes y token.

## Costos y límites a tener en cuenta

- Meta cobra según el tipo de mensaje y el país, y esas tarifas cambian: hay que
  revisar la tarifa vigente antes de decidir. Responder a un cliente que escribió
  primero suele ser lo más barato; los mensajes que inicia el negocio (por ejemplo,
  recordatorios de créditos) usan plantillas aprobadas y tienen otro costo.
- Si se usa un modelo de lenguaje para el texto libre, se suma un costo chico
  por mensaje.
- Alternativa sin API y sin costo: mandar por WhatsApp un **link a un formulario
  de pedido** de la app, donde el cliente elige menús y cantidades. Se pierde la
  conversación natural, pero no requiere cuenta de Meta.

## Orden sugerido

1. Formulario de pedido por link (rápido y sin costo) para validar que los
   clientes lo usan.
2. WhatsApp Cloud API con menú numerado y confirmación humana.
3. Texto libre con un modelo de lenguaje, cuando lo anterior funcione bien.
