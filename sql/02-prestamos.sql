-- Ejecutar sobre la misma base de datos que contiene las tablas de inventario.
-- Las tablas originales y sus filas se conservan.

INSERT INTO roles (nombre_rol, descripcion) VALUES
  ('Estudiante', 'Solicita préstamos de equipos.'),
  ('Profesor', 'Solicita préstamos de equipos.')
ON DUPLICATE KEY UPDATE nombre_rol = VALUES(nombre_rol);

CREATE TABLE IF NOT EXISTS prestamos_perfiles (
    id_usuario INT NOT NULL PRIMARY KEY,
    correo VARCHAR(254) NOT NULL UNIQUE,
    nombre_completo VARCHAR(120) NOT NULL,
    tipo_documento VARCHAR(30) NOT NULL,
    numero_documento VARCHAR(40) NOT NULL UNIQUE,
    codigo_institucional VARCHAR(40) NOT NULL,
    facultad_programa VARCHAR(120) NOT NULL,
    creado_en DATETIME(3) NOT NULL,
    CONSTRAINT fk_prestamos_perfiles_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios (id_usuario)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prestamos_catalogo (
    id_producto INT NOT NULL PRIMARY KEY,
    codigo_unidad VARCHAR(30) NOT NULL UNIQUE,
    categoria VARCHAR(60) NOT NULL,
    sede VARCHAR(100) NOT NULL,
    requiere_autorizacion TINYINT(1) NOT NULL DEFAULT 0 CHECK (requiere_autorizacion IN (0, 1)),
    CONSTRAINT fk_prestamos_catalogo_producto FOREIGN KEY (id_producto) REFERENCES productos (id_producto)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prestamos (
    id_prestamo INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT NOT NULL,
    id_producto INT NOT NULL,
    fecha_inicio DATETIME(3) NOT NULL,
    fecha_fin DATETIME(3) NOT NULL,
    motivo_solicitud VARCHAR(500) NOT NULL,
    estado ENUM('Pendiente', 'Confirmado', 'Rechazado') NOT NULL,
    observacion_admin VARCHAR(500) NOT NULL DEFAULT '',
    creado_por INT NOT NULL,
    creado_en DATETIME(3) NOT NULL,
    decidido_por INT NULL,
    decidido_en DATETIME(3) NULL,
    CONSTRAINT fk_prestamos_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios (id_usuario),
    CONSTRAINT fk_prestamos_producto FOREIGN KEY (id_producto) REFERENCES productos (id_producto),
    CONSTRAINT fk_prestamos_creado_por FOREIGN KEY (creado_por) REFERENCES usuarios (id_usuario),
    CONSTRAINT fk_prestamos_decidido_por FOREIGN KEY (decidido_por) REFERENCES usuarios (id_usuario),
    CONSTRAINT ck_prestamos_duracion CHECK (fecha_fin > fecha_inicio AND fecha_fin <= DATE_ADD(fecha_inicio, INTERVAL 72 HOUR)),
    CONSTRAINT ck_prestamos_rechazo CHECK (estado <> 'Rechazado' OR CHAR_LENGTH(TRIM(observacion_admin)) > 0),
    INDEX idx_prestamos_disponibilidad (id_producto, estado, fecha_inicio, fecha_fin),
    INDEX idx_prestamos_usuario (id_usuario, creado_en)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prestamos_sesiones (
    token_hash BINARY(32) NOT NULL PRIMARY KEY,
    id_usuario INT NOT NULL,
    vence_en DATETIME(3) NOT NULL,
    CONSTRAINT fk_prestamos_sesiones_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
    INDEX idx_prestamos_sesiones_vencimiento (vence_en)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
