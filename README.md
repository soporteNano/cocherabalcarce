# Cochera Balcarce

Primera versión de la aplicación local para controlar ingresos, salidas, tarifas, cobros y turnos de caja.

## Requisitos

- Windows 10/11 o una distribución Linux moderna de 64 bits.
- Node.js 24 o posterior.

No requiere instalar paquetes adicionales.

## Inicio

Desde PowerShell, dentro de la carpeta del proyecto:

```powershell
npm start
```

Luego abrir <http://127.0.0.1:3210> en el navegador.

En Windows también se puede iniciar con doble clic en `Iniciar Cochera.cmd`.

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

## Pruebas

```powershell
npm test
```

## Alcance actual

- Inicio de sesión y perfiles base.
- ABM de empleados y usuarios: alta, roles, activación, desactivación y restablecimiento de contraseña.
- Apertura y cierre de turnos.
- Comprobante imprimible de cierre con movimientos, arqueo y vehículos que permanecen dentro por categoría.
- Registro de ingresos por patente y categoría.
- Cálculo por fracciones iniciadas de 30 minutos, estadía diaria o 24 horas.
- Excepciones de precio con motivo obligatorio.
- Registro de pagos y medios de pago.
- Tarifas por categoría con vigencia desde el día siguiente.
- Auditoría de las operaciones principales.
- Respaldo local automático semanal, verificado y con conservación de 12 copias.

Los módulos de abonados, sincronización con n8n y facturación ARCA se incorporarán en las siguientes iteraciones.
