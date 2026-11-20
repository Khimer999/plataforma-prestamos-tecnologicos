# Publicación en alwaysdata Free

El plan gratuito admite un sitio Node.js y una base MariaDB bajo la cuenta. Está pensado para uso sin fines lucrativos. Usa el dominio `CUENTA.alwaysdata.net`. El plan dispone de 1 GB de espacio total, 256 MB de RAM y ¼ de CPU. El rendimiento de pruebas locales no determina la capacidad del plan. [Plan Free](https://www.alwaysdata.com/en/offers/) · [Detalles del plan](https://help.alwaysdata.com/en/admin-billing/billing/public-cloud-prices/)

## Acceso y código

1. El titular crea y verifica su cuenta Free, activa segundo factor y usa una cuenta de alojamiento dedicada al proyecto. Para el acceso por terminal, añade desde su panel una clave pública Ed25519 en **Remote access → SSH/SFTP → SSH Keys**. La clave privada permanece en el equipo donde se generó. Compara la huella del servidor que muestra el panel antes de aceptar la conexión. Si se solicita una contraseña al entrar por primera vez, el titular la introduce directamente. Un usuario SSH adicional tiene acceso a toda la cuenta de alojamiento. Si se habilita una clave temporal para publicar, el titular la retira al terminar. [Acceso por SSH](https://help.alwaysdata.com/en/docs/web-hosting/remote-access/ssh/) · [Claves SSH](https://help.alwaysdata.com/en/docs/web-hosting/remote-access/ssh/use-keys/)
2. Conecta por SSH a `ssh-CUENTA.alwaysdata.net` y copia el código autorizado a `/home/CUENTA/prestamos`. Puedes transferir el ZIP de la entrega por SFTP y extraerlo en esa carpeta, o clonar el repositorio si ya tienes acceso. Instala las dependencias desde esa carpeta con `NODEJS_VERSION=22 npm ci --omit=dev`. [Node.js en alwaysdata](https://help.alwaysdata.com/en/docs/web-hosting/languages/nodejs/configuration/)

## MariaDB

1. En **Databases → MySQL**, crea una base exclusiva para el proyecto y anota el host, el nombre completo de la base y el puerto que aparecen en el panel. Crea un usuario de instalación con permisos completos únicamente sobre esa base y otro usuario para la aplicación. Importa `04-catalogo-inicial.sql` para disponer de las 24 unidades ficticias del incremento 1.

   ```sh
   cd /home/CUENTA/prestamos
   mysql -h mysql-CUENTA.alwaysdata.net -u CUENTA_instalador -p CUENTA_prestamos < sql/01-inventario.sql
   mysql -h mysql-CUENTA.alwaysdata.net -u CUENTA_instalador -p CUENTA_prestamos < sql/02-prestamos.sql
   mysql -h mysql-CUENTA.alwaysdata.net -u CUENTA_instalador -p CUENTA_prestamos < sql/04-catalogo-inicial.sql
   ```

2. Concede al usuario de ejecución acceso a las tablas que indica el README del repositorio. El panel ofrece acceso completo, de lectura o sin acceso por base. Si se pueden aplicar permisos por tabla mediante SQL, compruébalos con `SHOW GRANTS` desde el usuario de ejecución. El panel o la API pueden reemplazar permisos personalizados al guardar. Cuando solo sea posible configurar permisos completos desde el panel, limítalos a la base exclusiva del sitio. Reserva el usuario de instalación para mantenimiento. [MariaDB y permisos en alwaysdata](https://help.alwaysdata.com/en/docs/web-hosting/databases/mariadb/)
3. En el servidor, prepara un `.env` con permisos `600` mediante `touch .env && chmod 600 .env` y completa los valores en un editor dentro de la sesión SSH. Usa la contraseña del usuario de ejecución. Conserva el archivo en el servidor.

   ```dotenv
   DB_HOST=mysql-CUENTA.alwaysdata.net
   DB_PORT=3306
   DB_NAME=CUENTA_prestamos
   DB_USER=CUENTA_aplicacion
   DB_PASSWORD=
   APP_ORIGIN=https://CUENTA.alwaysdata.net
   DB_POOL_SIZE=4
   DB_QUEUE_LIMIT=32
   AUTH_CONCURRENCY=1
   AUTH_QUEUE_LIMIT=24
   ```

4. Desde `/home/CUENTA/prestamos`, ejecuta `NODEJS_VERSION=22 npm run cuentas -- --evaluacion --archivo ../accesos-iniciales.json` para preparar el administrador y las dos cuentas de evaluación. Conserva y comparte sus claves por un canal privado. Las cuentas de la plataforma son distintas de los usuarios de MariaDB.

## Sitio web

1. En **Web → Sites**, configura el sitio de tipo **Node.js**, directorio de trabajo `/home/CUENTA/prestamos`, dominio `CUENTA.alwaysdata.net` y Node.js 22. Usa el comando `HOST="$IP" NODEJS_VERSION=22 node --env-file-if-exists=.env server.mjs`. El proceso escucha en la IP y el `PORT` que entrega el proveedor. Activa la redirección de HTTP a HTTPS y deja desactivada la caché HTTP del proveedor para el sitio. [Creación del sitio](https://help.alwaysdata.com/en/docs/web-hosting/sites/add-a-site/) · [HTTPS](https://help.alwaysdata.com/en/docs/web-hosting/sites/ssl-tls/lets-encrypt/)
2. En dos navegadores, verifica inicio de sesión, registro ficticio y una reserva compartida. Solicita la misma franja para un producto con una unidad de stock y comprueba que solo se confirme una reserva. Comprueba que la actualización llegue a la otra pantalla y que los datos permanezcan después de reiniciar el sitio. [Proxy HTTP](https://help.alwaysdata.com/en/docs/web-hosting/sites/http-stack/)
3. Conserva un solo proceso Node para comenzar y observa tiempos de inicio de sesión, latencias de escritura y respuestas `503` durante la prueba de uso real. El máximo documentado de 40 conexiones MariaDB por usuario se refiere a conexiones SQL, mientras el pool propuesto utiliza cuatro. Mide la concurrencia de visitantes por separado. [Límite de conexiones MariaDB](https://help.alwaysdata.com/en/docs/web-hosting/databases/mariadb/)
