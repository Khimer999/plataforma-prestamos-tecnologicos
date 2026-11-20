CREATE DATABASE IF NOT EXISTS inventario_tecnosoluciones
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;
USE inventario_tecnosoluciones;

CREATE TABLE IF NOT EXISTS roles (
    id_rol       INT          NOT NULL AUTO_INCREMENT,
    nombre_rol   VARCHAR(30)  NOT NULL,
    descripcion  VARCHAR(150) NOT NULL,
    CONSTRAINT pk_roles PRIMARY KEY (id_rol),
    CONSTRAINT uq_roles_nombre UNIQUE (nombre_rol)
);

CREATE TABLE IF NOT EXISTS usuarios (
    id_usuario     INT          NOT NULL AUTO_INCREMENT,
    usuario        VARCHAR(50)  NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,          -- solo el hash Argon2, nunca la clave
    id_rol         INT          NOT NULL,
    estado         TINYINT(1)   NOT NULL DEFAULT 1, -- 1 = activo, 0 = inactivo
    CONSTRAINT pk_usuarios PRIMARY KEY (id_usuario),
    CONSTRAINT uq_usuarios_usuario UNIQUE (usuario),
    CONSTRAINT fk_usuarios_roles FOREIGN KEY (id_rol) REFERENCES roles (id_rol),
    CONSTRAINT ck_usuarios_estado CHECK (estado IN (0, 1))
);

CREATE TABLE IF NOT EXISTS productos (
    id_producto  INT           NOT NULL AUTO_INCREMENT,
    nombre       VARCHAR(100)  NOT NULL,
    descripcion  VARCHAR(255)  NULL,
    precio       DECIMAL(12,2) NOT NULL,
    stock        INT           NOT NULL DEFAULT 0,
    estado       TINYINT(1)    NOT NULL DEFAULT 1, -- 1 = activo, 0 = inactivo
    CONSTRAINT pk_productos PRIMARY KEY (id_producto),
    CONSTRAINT ck_productos_precio CHECK (precio >= 0),
    CONSTRAINT ck_productos_stock  CHECK (stock >= 0),
    CONSTRAINT ck_productos_estado CHECK (estado IN (0, 1))
);

CREATE TABLE IF NOT EXISTS movimientos (
    id_movimiento    INT          NOT NULL AUTO_INCREMENT,
    id_producto      INT          NOT NULL,
    id_usuario       INT          NOT NULL,
    tipo_movimiento  VARCHAR(10)  NOT NULL,
    cantidad         INT          NOT NULL,
    fecha            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    observacion      VARCHAR(255) NULL,
    CONSTRAINT pk_movimientos PRIMARY KEY (id_movimiento),
    CONSTRAINT fk_mov_producto FOREIGN KEY (id_producto) REFERENCES productos (id_producto),
    CONSTRAINT fk_mov_usuario  FOREIGN KEY (id_usuario)  REFERENCES usuarios (id_usuario),
    CONSTRAINT ck_mov_tipo     CHECK (tipo_movimiento IN ('ENTRADA', 'SALIDA')),
    CONSTRAINT ck_mov_cantidad CHECK (cantidad > 0)
);

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_registrar_roles_iniciales$$
CREATE PROCEDURE sp_registrar_roles_iniciales()
BEGIN
    INSERT IGNORE INTO roles (nombre_rol, descripcion) VALUES
        ('Administrador', 'Registra usuarios, administra productos y registra movimientos.'),
        ('Auxiliar',      'Consulta productos y registra entradas y salidas.');
    SELECT id_rol, nombre_rol, descripcion FROM roles ORDER BY id_rol;
END$$

DROP PROCEDURE IF EXISTS sp_listar_roles$$
CREATE PROCEDURE sp_listar_roles()
BEGIN
    SELECT id_rol, nombre_rol, descripcion FROM roles ORDER BY id_rol;
END$$

DROP PROCEDURE IF EXISTS sp_registrar_usuario$$
CREATE PROCEDURE sp_registrar_usuario(
    IN p_usuario VARCHAR(50),
    IN p_hash    VARCHAR(255),
    IN p_id_rol  INT
)
BEGIN
    IF p_usuario IS NULL OR TRIM(p_usuario) = '' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El nombre de usuario es obligatorio.';
    END IF;
    IF p_hash IS NULL OR TRIM(p_hash) = '' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El hash de la contraseña es obligatorio.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM roles WHERE id_rol = p_id_rol) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El rol indicado no existe.';
    END IF;
    IF EXISTS (SELECT 1 FROM usuarios WHERE usuario = TRIM(p_usuario)) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El nombre de usuario ya está registrado.';
    END IF;

    INSERT INTO usuarios (usuario, password_hash, id_rol, estado)
    VALUES (TRIM(p_usuario), p_hash, p_id_rol, 1);

    SELECT LAST_INSERT_ID() AS id_usuario,
           'Usuario registrado correctamente.' AS mensaje;
END$$

DROP PROCEDURE IF EXISTS sp_obtener_credenciales$$
CREATE PROCEDURE sp_obtener_credenciales(IN p_usuario VARCHAR(50))
BEGIN
    SELECT u.id_usuario,
           u.usuario,
           u.password_hash,
           u.estado,
           r.id_rol,
           r.nombre_rol
    FROM usuarios u
    JOIN roles r ON r.id_rol = u.id_rol
    WHERE u.usuario = p_usuario;
END$$

DROP PROCEDURE IF EXISTS sp_listar_usuarios$$
CREATE PROCEDURE sp_listar_usuarios()
BEGIN
    SELECT u.id_usuario, u.usuario, r.nombre_rol AS rol,
           IF(u.estado = 1, 'Activo', 'Inactivo') AS estado
    FROM usuarios u
    JOIN roles r ON r.id_rol = u.id_rol
    ORDER BY u.id_usuario;
END$$

DROP PROCEDURE IF EXISTS sp_cambiar_estado_usuario$$
CREATE PROCEDURE sp_cambiar_estado_usuario(IN p_id_usuario INT, IN p_estado TINYINT)
BEGIN
    IF p_estado IS NULL OR p_estado NOT IN (0, 1) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El estado debe ser 1 (activo) o 0 (inactivo).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id_usuario = p_id_usuario) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El usuario no existe.';
    END IF;

    UPDATE usuarios SET estado = p_estado WHERE id_usuario = p_id_usuario;

    SELECT IF(p_estado = 1, 'Usuario activado.', 'Usuario inactivado.') AS mensaje;
END$$

-- ===== PRODUCTOS =====

DROP PROCEDURE IF EXISTS sp_registrar_producto$$
CREATE PROCEDURE sp_registrar_producto(
    IN p_nombre      VARCHAR(100),
    IN p_descripcion VARCHAR(255),
    IN p_precio      DECIMAL(12,2),
    IN p_stock       INT
)
BEGIN
    IF p_nombre IS NULL OR TRIM(p_nombre) = '' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El nombre del producto es obligatorio.';
    END IF;
    IF p_precio IS NULL OR p_precio < 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El precio debe ser mayor o igual a cero.';
    END IF;
    IF p_stock IS NULL OR p_stock < 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El stock inicial debe ser mayor o igual a cero.';
    END IF;

    INSERT INTO productos (nombre, descripcion, precio, stock, estado)
    VALUES (TRIM(p_nombre), p_descripcion, p_precio, p_stock, 1);

    SELECT LAST_INSERT_ID() AS id_producto,
           'Producto registrado correctamente.' AS mensaje;
END$$

DROP PROCEDURE IF EXISTS sp_listar_productos$$
CREATE PROCEDURE sp_listar_productos()
BEGIN
    SELECT id_producto, nombre, descripcion, precio, stock,
           IF(estado = 1, 'Activo', 'Inactivo') AS estado
    FROM productos
    ORDER BY id_producto;
END$$

DROP PROCEDURE IF EXISTS sp_consultar_producto$$
CREATE PROCEDURE sp_consultar_producto(IN p_id_producto INT)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM productos WHERE id_producto = p_id_producto) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El producto no existe.';
    END IF;

    SELECT id_producto, nombre, descripcion, precio, stock,
           IF(estado = 1, 'Activo', 'Inactivo') AS estado
    FROM productos
    WHERE id_producto = p_id_producto;
END$$

DROP PROCEDURE IF EXISTS sp_buscar_productos_nombre$$
CREATE PROCEDURE sp_buscar_productos_nombre(IN p_nombre VARCHAR(100))
BEGIN
    SELECT id_producto, nombre, descripcion, precio, stock,
           IF(estado = 1, 'Activo', 'Inactivo') AS estado
    FROM productos
    WHERE nombre LIKE CONCAT('%', IFNULL(p_nombre, ''), '%')
    ORDER BY nombre;
END$$

DROP PROCEDURE IF EXISTS sp_actualizar_producto$$
CREATE PROCEDURE sp_actualizar_producto(
    IN p_id_producto INT,
    IN p_nombre      VARCHAR(100),
    IN p_descripcion VARCHAR(255),
    IN p_precio      DECIMAL(12,2)
)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM productos WHERE id_producto = p_id_producto) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El producto no existe.';
    END IF;
    IF p_nombre IS NULL OR TRIM(p_nombre) = '' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El nombre del producto es obligatorio.';
    END IF;
    IF p_precio IS NULL OR p_precio < 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El precio debe ser mayor o igual a cero.';
    END IF;

    UPDATE productos
    SET nombre = TRIM(p_nombre), descripcion = p_descripcion, precio = p_precio
    WHERE id_producto = p_id_producto;

    SELECT 'Producto actualizado correctamente.' AS mensaje;
END$$

DROP PROCEDURE IF EXISTS sp_cambiar_estado_producto$$
CREATE PROCEDURE sp_cambiar_estado_producto(IN p_id_producto INT, IN p_estado TINYINT)
BEGIN
    IF p_estado IS NULL OR p_estado NOT IN (0, 1) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El estado debe ser 1 (activo) o 0 (inactivo).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM productos WHERE id_producto = p_id_producto) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El producto no existe.';
    END IF;

    UPDATE productos SET estado = p_estado WHERE id_producto = p_id_producto;

    SELECT IF(p_estado = 1, 'Producto activado.', 'Producto inactivado.') AS mensaje;
END$$

DROP PROCEDURE IF EXISTS sp_registrar_movimiento$$
CREATE PROCEDURE sp_registrar_movimiento(
    IN p_id_producto INT,
    IN p_id_usuario  INT,
    IN p_tipo        VARCHAR(10),
    IN p_cantidad    INT,
    IN p_observacion VARCHAR(255)
)
BEGIN
    DECLARE v_tipo         VARCHAR(10);
    DECLARE v_stock        INT;
    DECLARE v_estado_prod  TINYINT;
    DECLARE v_estado_usr   TINYINT;
    DECLARE v_nuevo_stock  INT;
    DECLARE v_id_mov       INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    SET v_tipo = UPPER(TRIM(IFNULL(p_tipo, '')));

    IF v_tipo NOT IN ('ENTRADA', 'SALIDA') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El tipo de movimiento debe ser ENTRADA o SALIDA.';
    END IF;
    IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La cantidad debe ser mayor que cero.';
    END IF;

    START TRANSACTION;

    SELECT estado INTO v_estado_usr
    FROM usuarios WHERE id_usuario = p_id_usuario;
    IF v_estado_usr IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El usuario no existe.';
    END IF;
    IF v_estado_usr = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El usuario está inactivo y no puede registrar movimientos.';
    END IF;

    SELECT stock, estado INTO v_stock, v_estado_prod
    FROM productos WHERE id_producto = p_id_producto
    FOR UPDATE;
    IF v_stock IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El producto no existe.';
    END IF;
    IF v_estado_prod = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El producto está inactivo.';
    END IF;

    IF v_tipo = 'SALIDA' AND v_stock < p_cantidad THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Stock insuficiente: la salida supera las existencias disponibles.';
    END IF;

    IF v_tipo = 'ENTRADA' THEN
        SET v_nuevo_stock = v_stock + p_cantidad;
    ELSE
        SET v_nuevo_stock = v_stock - p_cantidad;
    END IF;

    INSERT INTO movimientos (id_producto, id_usuario, tipo_movimiento, cantidad, fecha, observacion)
    VALUES (p_id_producto, p_id_usuario, v_tipo, p_cantidad, NOW(), p_observacion);
    SET v_id_mov = LAST_INSERT_ID();

    UPDATE productos SET stock = v_nuevo_stock WHERE id_producto = p_id_producto;

    COMMIT;

    SELECT v_id_mov        AS id_movimiento,
           v_tipo          AS tipo_movimiento,
           p_cantidad      AS cantidad,
           v_nuevo_stock   AS stock_actual,
           'Movimiento registrado correctamente.' AS mensaje;
END$$

DROP PROCEDURE IF EXISTS sp_historial_producto$$
CREATE PROCEDURE sp_historial_producto(IN p_id_producto INT)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM productos WHERE id_producto = p_id_producto) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El producto no existe.';
    END IF;

    SELECT m.id_movimiento, m.tipo_movimiento, m.cantidad, m.fecha,
           u.usuario AS registrado_por, m.observacion
    FROM movimientos m
    JOIN usuarios u ON u.id_usuario = m.id_usuario
    WHERE m.id_producto = p_id_producto
    ORDER BY m.fecha DESC, m.id_movimiento DESC;
END$$

DROP PROCEDURE IF EXISTS sp_movimientos_usuario$$
CREATE PROCEDURE sp_movimientos_usuario(IN p_id_usuario INT)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id_usuario = p_id_usuario) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El usuario no existe.';
    END IF;

    SELECT m.id_movimiento, p.nombre AS producto, m.tipo_movimiento, m.cantidad,
           m.fecha, m.observacion
    FROM movimientos m
    JOIN productos p ON p.id_producto = m.id_producto
    WHERE m.id_usuario = p_id_usuario
    ORDER BY m.fecha DESC, m.id_movimiento DESC;
END$$

DELIMITER ;

CALL sp_registrar_roles_iniciales();

CREATE USER IF NOT EXISTS 'app_inventario'@'localhost' IDENTIFIED BY 'App_Inv#2026';
GRANT EXECUTE ON inventario_tecnosoluciones.* TO 'app_inventario'@'localhost';
FLUSH PRIVILEGES;