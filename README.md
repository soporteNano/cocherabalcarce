# Cochera Balcarce

Primera versión de la aplicación local para controlar ingresos, salidas, tarifas, cobros y turnos de caja.

## Requisitos

- Windows 10/11 o una distribución Linux moderna de 64 bits.
- Node.js 24 o posterior.

Después de descargar o clonar el proyecto por primera vez, ejecutar `npm install` para instalar sus componentes.

## Inicio

Desde PowerShell, dentro de la carpeta del proyecto:

```powershell
npm install
npm start
```

Luego abrir <http://127.0.0.1:3210> en el navegador.

En Windows también se puede iniciar con doble clic en `Iniciar Cochera.cmd`.

### Acceso desde celulares u otras computadoras

Al iniciar, la consola muestra una dirección de red local, por ejemplo `http://192.168.1.20:3210`. Un celular o computadora conectado al mismo Wi-Fi puede abrir esa dirección en el navegador.

En Windows, la primera ejecución puede mostrar una solicitud del firewall. Se debe permitir Node.js únicamente en redes privadas. No se debe abrir el puerto en el router ni publicar esta dirección en Internet.

Para recorridas, el administrador puede crear un usuario con rol **Consulta / recorredor**. Este perfil puede buscar patentes, ver vehículos dentro, consultar abonados y disponibilidad, pero el servidor rechaza cobros, movimientos y cambios de configuración.

### Inicio en Linux

Después de descargar o clonar el proyecto:

```bash
chmod +x iniciar-cochera.sh
./iniciar-cochera.sh
```

Si el entorno gráfico no abre el navegador automáticamente, ingresar manualmente a <http://127.0.0.1:3210>.

Para instalarlo como servicio y lograr que se inicie junto con Linux, se puede crear posteriormente una unidad de `systemd`. La base de datos seguirá ubicada en `data/cochera.sqlite` y los respaldos en `backups`.

El primer acceso de desarrollo es:

- Usuario: `admin`
- Contraseña: `Cambiar123!`

Esta contraseña es temporal y deberá reemplazarse antes de usar el sistema con información real.

## Datos locales

La base se crea automáticamente en `data/cochera.sqlite`. Esta carpeta está excluida de Git. Las categorías iniciales son Auto, Camioneta y Moto, y se crean los medios de pago acordados.

Antes de cobrar un ticket, el administrador debe cargar las tarifas. Por la regla comercial definida, toda tarifa nueva comienza a regir al día siguiente.

## Configuración de ARCA

La configuración local se guarda en `.env`, archivo excluido de GitHub. `.env.example` contiene las opciones necesarias: CUIT emisor, ambiente, certificado, clave privada, punto de venta y tipo de comprobante. Los certificados nunca deben subirse al repositorio.

La emisión se realiza únicamente cuando un empleado confirma **Emitir en ARCA** desde la bandeja Facturación. El sistema conserva el CAE y muestra los rechazos o errores informados por el organismo.

## Pruebas

```powershell
npm test
```

## Alcance actual

- Inicio de sesión y perfiles base.
- ABM de empleados y usuarios: alta, roles, activación, desactivación y restablecimiento de contraseña.
- Acceso simultáneo desde navegadores de la misma red local y perfil móvil de consulta sin permisos de modificación.
- ABM de abonados mensuales con datos de contacto, plan, categoría, fecha de alta y múltiples patentes.
- ABM de categorías de vehículos, con activación y desactivación sin perder el historial.
- Capacidad configurable por piso o sector, con cupos separados para autos/camionetas y motos.
- Disponibilidad estimada durante el ingreso y autorización auditada cuando el cupo está completo.
- Condición fiscal del cliente en cada ticket, con Consumidor final como valor predeterminado.
- Registro y autorización de solicitudes de factura electrónica ante ARCA, con CAE, punto de venta y número de comprobante.
- Consulta en vivo de razón social por CUIT mediante Padrón A13 de ARCA.
- Suspensión y reactivación de abonados por administradores y coordinadores, con motivo auditado.
- Apertura y cierre de turnos.
- Comprobante imprimible de cierre con movimientos, arqueo y vehículos que permanecen dentro por categoría.
- Registro de ingresos por patente y categoría.
- Cálculo por fracciones iniciadas de 30 minutos, estadía diaria o 24 horas.
- Excepciones de precio con motivo obligatorio.
- Registro de pagos y medios de pago.
- Tarifas por categoría con vigencia desde el día siguiente.
- Auditoría de las operaciones principales.
- Respaldo local automático semanal, verificado y con conservación de 12 copias.

Los módulos de cobro mensual de abonos, sincronización con n8n y comprobante térmico de 80 mm se incorporarán en las siguientes iteraciones.
