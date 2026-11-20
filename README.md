# Plataforma de Préstamos Tecnológicos

Proyecto Integrador Ingeniería de Software - Plataforma de préstamo de recursos tecnológicos.

La plataforma permite reservar equipos del inventario, consultar los préstamos propios y revisar solicitudes como administrador. El catálogo y la capacidad salen de `productos` y `productos.stock`. Las reservas confirmadas consumen capacidad durante su franja. La interfaz usa la hora de Bogotá y limita cada préstamo a 72 horas.

## Probar la interfaz

Extrae el ZIP completo y abre `public/index.html` en un navegador moderno. Puedes registrar un estudiante con datos ficticios y entrar al panel con **Entrar como administrador de prueba**. En este modo, los datos viven en la pestaña del navegador.

## Conectar con MySQL o MariaDB

Necesitas Node.js 22.9.0 o superior y una instancia de MySQL 8.0.29 o superior, o MariaDB 10.11 o superior. [Opciones de configuración de Node.js](https://nodejs.org/download/release/v22.21.0/docs/api/cli.html#--env-file-if-existsfile)

1. Abre el cliente de la base, por ejemplo `mysql -u root -p`, desde la carpeta del proyecto. En una instancia nueva, crea la base y ejecuta los scripts en orden. Si ya usas `inventario_tecnosoluciones`, conserva esa base y ejecuta los scripts sobre ella con una cuenta autorizada.

   ```sql
   CREATE DATABASE IF NOT EXISTS inventario_tecnosoluciones
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   USE inventario_tecnosoluciones;
   SOURCE sql/01-inventario.sql;
   SOURCE sql/02-prestamos.sql;
   ```

2. Copia `.env.example` como `.env`. Completa `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD` con una cuenta de aplicación. `DB_NAME` debe coincidir con la base seleccionada en el paso anterior. Mantén `.env` fuera del repositorio.
3. Instala las dependencias y, si la base todavía carece de administrador, crea uno. El comando de administrador pide la contraseña de forma interactiva. Los administradores existentes con contraseñas Argon2 pueden iniciar sesión con su nombre de usuario.

   ```sh
   npm ci
   npm run admin -- usuario_admin
   npm start
   ```

4. Abre [http://127.0.0.1:3000](http://127.0.0.1:3000). El servidor activa la API al entregar la página y guarda los préstamos en la base configurada. Abre el sitio por esa dirección con los valores predeterminados de `HOST`, `PORT` y `APP_ORIGIN`. Ajusta las tres variables si cambias la dirección. Para un despliegue remoto, sirve el sitio por HTTPS y configura `APP_ORIGIN` con su URL pública exacta.

## Catálogo y datos

`01-inventario.sql` conserva las tablas y rutinas de inventario del archivo aportado, con instalación idempotente. `02-prestamos.sql` añade la configuración del catálogo, los perfiles de préstamo, las reservas y las sesiones. El catálogo considera los productos activos y utiliza la sede, categoría y regla de aprobación definidas en `prestamos_catalogo` cuando existe esa configuración. Los productos con varias unidades pueden atender reservas simultáneas hasta agotar su stock. Las reservas que terminan cuando comienza otra permiten reutilizar la misma unidad.

En una base de prueba vacía, puedes cargar los equipos de ejemplo después de las dos migraciones con `SOURCE sql/03-catalogo-demostracion.sql;`. Las cuentas se crean en el formulario de registro o mediante el comando de administrador.

Ejecuta las migraciones con una cuenta de instalación. Para la cuenta del servidor, concede `SELECT` sobre `roles`, `usuarios`, `productos`, `prestamos_perfiles` y `prestamos_catalogo`, `INSERT` sobre `usuarios` y `prestamos_perfiles`, `SELECT`, `INSERT` y `UPDATE` sobre `prestamos`, y `SELECT`, `INSERT` y `DELETE` sobre `prestamos_sesiones`. En MySQL concede también `UPDATE` sobre `productos` para permitir la lectura con bloqueo `FOR UPDATE`. Las reservas se escriben en `prestamos` y la plataforma consulta el stock registrado por el inventario. [Lecturas con bloqueo en MySQL](https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html)

Si el proveedor exige un certificado para TLS, configura `DB_TLS_CA_FILE` con la ruta al certificado de la entidad emisora.

El fondo de nebulosa de `public/assets/nebula.webp` fue generado para esta interfaz. Los seis tonos principales provienen de la paleta de referencia.
