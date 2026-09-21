# Sistema de gestión de cochera

## Alcance general

El proyecto se divide en dos etapas:

1. Gestión local de entradas, salidas, estadías, abonados, cobros, usuarios, turnos de caja y respaldos.
2. Facturación electrónica mediante ARCA e impresión de comprobantes en una impresora térmica de 80 mm.

La aplicación se utilizará desde una sola computadora. La operación principal y la base de datos deben funcionar localmente, incluso cuando no haya conexión a Internet.

## Usuarios y permisos

Cada persona accederá con un usuario y una contraseña individual.

### Empleado o cajero

- Registrar entradas, salidas y cobros.
- Abrir y cerrar turnos de caja.
- Aplicar excepciones manuales a los importes sugeridos.
- Resolver manualmente casos especiales de abonados, dejando una observación.

### Coordinador o encargado

- Contar con las funciones operativas del empleado.
- Suspender y reactivar el acceso de un abonado.
- Registrar el motivo de cada suspensión o reactivación.

### Administrador

- Administrar usuarios y permisos.
- Administrar categorías de vehículos.
- Configurar horarios de apertura.
- Modificar tarifas y sus fechas de vigencia.
- Configurar medios de pago.
- Configurar y ejecutar respaldos.

Las acciones relevantes conservarán el usuario, la fecha, la hora y, cuando corresponda, el motivo.

## Categorías de vehículos

Las categorías iniciales son:

- Auto.
- Camioneta.
- Moto.

El administrador contará con un ABM para crear, modificar y desactivar categorías. Una categoría utilizada en movimientos anteriores no se eliminará físicamente, para preservar el historial.

No se controlarán límites ni cupos por categoría. El sistema mostrará la cantidad de vehículos que se encuentran dentro, pero no bloqueará ingresos por capacidad.

## Modalidades y tarifas

Cada categoría tendrá precios independientes para:

- Fracción de 30 minutos.
- Estadía diaria.
- Estadía de 24 horas.
- Abono mensual completo.
- Abono mensual diurno.

Cada fracción iniciada se cobra completa. Por ejemplo, una permanencia de 35 minutos equivale a dos fracciones.

El sistema calculará y mostrará un importe sugerido. Cualquier empleado podrá modificar el importe final como excepción. Se guardarán el importe sugerido, el importe cobrado, el usuario y el motivo.

Solo el administrador podrá modificar tarifas. Los cambios entrarán en vigencia al día siguiente y no alterarán movimientos anteriores.

## Horarios

La configuración inicial será:

- Lunes a viernes: de 08:00 a 20:00.
- Sábados y domingos: cerrado.

El administrador podrá habilitar otros días, cambiar horarios y registrar horarios especiales o cierres por feriados. Se contempla una posible apertura futura los sábados de 08:00 a 13:00.

El abono mensual diurno será válido de lunes a viernes dentro del horario abierto, aunque posteriormente se habiliten los sábados, salvo que el administrador cambie expresamente las condiciones del plan.

Cuando un cliente con estadía diaria no retire el vehículo antes del cierre, se aplicará la tarifa de estadía de 24 horas.

## Abonados mensuales

Existirán dos planes:

- Mensual completo: permite permanencia las 24 horas, todos los días.
- Mensual diurno: permite permanencia de lunes a viernes durante el horario de apertura.

Un abonado podrá registrar varias patentes, pero cada abono dará derecho a un solo vehículo dentro al mismo tiempo. El lugar no será fijo.

El ABM de abonados conservará nombre, DNI o CUIT, teléfono, correo electrónico, tipo de plan, categoría de facturación, fecha de alta y patentes autorizadas. El administrador podrá crear y modificar estos datos. El coordinador o el administrador podrán suspender y reactivar accesos, dejando el motivo auditado. Las bajas conservarán el historial.

Si otra patente del mismo abono ya está dentro, el sistema mostrará una alerta. El empleado decidirá manualmente, según la disponibilidad, si autoriza el ingreso con el mismo abono o registra una estadía común. La decisión quedará auditada.

Si un abonado mensual diurno permanece fuera del horario permitido, el sistema mostrará una alerta. El empleado podrá resolver manualmente si no aplica recargo, cobra una estadía de 24 horas o utiliza otro importe. La decisión y el motivo quedarán registrados.

### Vigencia y pago

Los abonos cubren un mes calendario. Si el alta ocurre después del primer día del mes, se cobrará un proporcional calculado de la siguiente manera:

`precio mensual / cantidad de días del mes * días restantes, incluyendo el día de alta`

Desde el mes siguiente se cobrará el importe mensual completo.

El vencimiento será el día 10 inclusive. Desde el día 11 el abono aparecerá como vencido. El recargo por atraso será configurable y tendrá valor inicial cero.

La falta de pago no bloqueará automáticamente el ingreso. El sistema informará la deuda y permitirá operar normalmente hasta que el coordinador o encargado suspenda expresamente el acceso. La suspensión y la reactivación quedarán auditadas.

## Entradas, salidas y tickets

Cada entrada registrará como mínimo:

- Identificador único del ticket.
- Patente.
- Categoría.
- Fecha y hora de entrada.
- Modalidad o abono asociado.
- Usuario que realizó la operación.

La salida registrará la fecha y hora, el tiempo transcurrido, el cálculo sugerido, las excepciones, el importe final, los medios de pago y el turno de caja.

Los vehículos que permanezcan dentro durante un cambio de turno conservarán su entrada original. El cobro se asociará al turno en el que se registre el pago.

## Medios de pago

Se admitirán:

- Efectivo.
- Transferencia.
- Débito.
- Crédito.
- QR o billetera virtual.
- Otros medios configurables.
- Pagos combinados entre varios medios.

El administrador podrá agregar, desactivar o renombrar medios. En pagos combinados se registrará el importe correspondiente a cada uno.

## Turnos y caja

Cada turno tendrá apertura, responsable, fecha y hora, y saldo inicial cuando corresponda.

El cierre mostrará:

- Efectivo esperado.
- Efectivo contado.
- Diferencia de efectivo.
- Totales por cada medio de pago.
- Pagos combinados distribuidos por medio.
- Excepciones realizadas durante el turno.
- Cantidad de vehículos que permanecen dentro, discriminada por categoría.

Al cerrar la caja, el sistema guardará y emitirá un comprobante imprimible con el responsable y horario del turno, los movimientos, los totales por medio de pago, el efectivo esperado y contado, la diferencia y la cantidad de autos, camionetas, motos y demás categorías que permanezcan en la cochera. El comprobante conservará la información existente en el momento exacto del cierre.

Los pagos de abonos también quedarán asociados al usuario, turno y medio de pago, y formarán parte del cierre de caja.

## Base de datos y respaldos

La base de datos será local y no se expondrá a Internet. Para una única computadora se prevé utilizar SQLite.

El sistema realizará un respaldo local automático una vez por semana. Cada archivo incluirá fecha y hora en su nombre. El proceso verificará el resultado y registrará si finalizó correctamente o falló.

Solo el administrador podrá configurar la carpeta de destino, la cantidad de copias conservadas, ejecutar respaldos manuales y restaurar información. La configuración inicial conservará las últimas 12 copias semanales. La copia externa será responsabilidad de los responsables de la cochera.

## Sincronización y control externo

La base local no tendrá puertos abiertos ni acceso remoto. Cada dos horas, la aplicación enviará por HTTPS un JSON a un webhook protegido de n8n. También se enviará una actualización al cerrar un turno.

La información sincronizada incluirá:

- Tickets ingresados, retirados y actualmente abiertos.
- Patentes, categorías, modalidades y horarios.
- Importes sugeridos, excepciones e importes cobrados.
- Medios de pago.
- Turnos y cierres de caja.
- Pagos y estado de los abonos.
- Fecha, hora y estado de la sincronización.

Cada registro utilizará un identificador único para evitar duplicados. Si no hay conexión o n8n no responde, el envío quedará pendiente y se reintentará automáticamente.

n8n validará el envío, generará el panel HTML de control y lo publicará en el servidor mediante FTP, FTPS o SFTP, según la disponibilidad del servidor. El acceso web deberá estar protegido porque contendrá patentes e información de caja.

## Segunda etapa

La segunda etapa incorporará:

- Emisión de comprobantes electrónicos mediante ARCA.
- Asociación del comprobante fiscal con el ticket y el pago.
- Gestión de errores y reintentos de facturación.
- Impresión del comprobante en una impresora térmica de 80 mm.

La separación entre estadía, pago y comprobante fiscal se mantendrá desde la primera etapa para permitir esta integración sin rehacer la operación principal.

## Definiciones pendientes

- Importes iniciales por categoría y modalidad.
- Datos personales y fiscales que se solicitarán a los abonados.
- Alcance exacto de las pantallas y reportes.
- Tecnología final de la interfaz local.
- Dirección y credenciales del webhook de n8n.
- Protocolo y ubicación de publicación en el servidor web.
- Diseño de los tickets y comprobantes impresos.
