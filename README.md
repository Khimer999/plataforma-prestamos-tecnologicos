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

## Acceso desde varios dispositivos

Sirve la aplicación en una dirección HTTPS accesible para los dispositivos y usa esa dirección como `APP_ORIGIN`. Todos los procesos de la API deben usar la misma base MariaDB o MySQL. Las cuentas, las sesiones y los préstamos se guardan allí. Cada dispositivo inicia su propia sesión. El acceso al archivo `public/index.html` sigue siendo la demostración independiente del navegador.

La API limita el trabajo con contraseñas y la cantidad de escrituras simultáneas para conservar conexiones de lectura. Si la cola se llena o vence, responde `503` con un aviso de servicio ocupado. Al confirmar un préstamo, el bloqueo del producto en InnoDB hace que todos los procesos comprueben el stock en orden. Una franja sin unidades disponibles responde `409`.

`DB_POOL_SIZE` fija el máximo de conexiones por proceso. Cuenta las conexiones de todas las instancias al dimensionar la base. `DB_QUEUE_LIMIT` y `AUTH_QUEUE_LIMIT` acotan la espera. `AUTH_CONCURRENCY` limita las operaciones simultáneas con contraseñas y `AUTH_REQUESTS_PER_IP` admite ráfagas legítimas desde direcciones compartidas.

## Prueba de concurrencia

Inicia la aplicación con una base local de pruebas que tenga al menos un equipo estándar disponible. El script crea cuentas y préstamos ficticios en esa base y conserva los registros para poder revisarlos.

```sh
node scripts/carga.mjs --url http://127.0.0.1:3000 --confirm-isolated --users 100 --concurrency 100 --rounds 2 --panel --report carga.json
```

El informe incluye p50, p95 y p99 por operación, códigos HTTP, préstamos confirmados y persistencia en sesiones nuevas. La prueba intenta reservar el mismo equipo en una sola franja y luego crea un préstamo por usuario en franjas distintas. Agrega `--second-url http://127.0.0.1:3001` con el segundo servidor ya iniciado para repartir las reservas y verificar la persistencia desde otro proceso conectado a la misma base.

En una prueba local con MariaDB 11.4 y dos procesos, los 100 usuarios se registraron, iniciaron sesión y recuperaron sus 100 reservas individuales desde sesiones nuevas. Cuando todos solicitaron la misma unidad en el mismo horario, se confirmó una reserva y las otras 99 recibieron la respuesta de cupo agotado. El p95 fue de 4,7 s para el registro, de 4,9 a 8,8 s para el inicio de sesión bajo las dos ráfagas y de 3,2 s para guardar una reserva individual. Estos tiempos corresponden al equipo de prueba con dos CPU lógicas y 12 GiB de memoria.
