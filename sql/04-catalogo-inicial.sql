-- Equipos ficticios opcionales para la evaluación del Incremento 1.
-- Aplicar después de 01-inventario.sql y 02-prestamos.sql en la base seleccionada.

CREATE TEMPORARY TABLE carga_catalogo_inc1 (
    codigo VARCHAR(30) NOT NULL PRIMARY KEY,
    modelo VARCHAR(100) NOT NULL,
    categoria VARCHAR(60) NOT NULL,
    sede VARCHAR(100) NOT NULL,
    autorizacion TINYINT(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO carga_catalogo_inc1 (codigo, modelo, categoria, sede, autorizacion) VALUES
    ('INC1-PC-001', 'Portátil Lenovo ThinkPad',          'Computador',     'Sede Principal', 0),
    ('INC1-PC-002', 'Portátil Lenovo ThinkPad',          'Computador',     'Sede Principal', 0),
    ('INC1-PC-003', 'Estación móvil Dell Precision',     'Computador',     'Sede Principal', 1),
    ('INC1-PC-004', 'Portátil HP ProBook',               'Computador',     'Sede Norte',     0),
    ('INC1-PC-005', 'Portátil HP ProBook',               'Computador',     'Sede Norte',     0),
    ('INC1-PC-006', 'Portátil ASUS ExpertBook',          'Computador',     'Sede Norte',     0),

    ('INC1-TAB-001', 'iPad de 10.ª generación',          'Tablet',         'Sede Principal', 0),
    ('INC1-TAB-002', 'iPad de 10.ª generación',          'Tablet',         'Sede Principal', 0),
    ('INC1-TAB-003', 'Samsung Galaxy Tab S9 FE',         'Tablet',         'Sede Principal', 0),
    ('INC1-TAB-004', 'Samsung Galaxy Tab S9 FE',         'Tablet',         'Sede Norte',     0),
    ('INC1-TAB-005', 'Lenovo Tab P12',                   'Tablet',         'Sede Norte',     0),
    ('INC1-TAB-006', 'Lenovo Tab P12',                   'Tablet',         'Sede Norte',     0),

    ('INC1-CAM-001', 'Canon EOS R50 con lente',          'Cámara',         'Sede Principal', 1),
    ('INC1-CAM-002', 'Sony Alpha a6400 con trípode',     'Cámara',         'Sede Principal', 1),
    ('INC1-CAM-003', 'Cámara de acción GoPro',           'Cámara',         'Sede Principal', 0),
    ('INC1-CAM-004', 'Canon EOS R50 con lente',          'Cámara',         'Sede Norte',     1),
    ('INC1-CAM-005', 'Panasonic Lumix G85 con lente',    'Cámara',         'Sede Norte',     1),
    ('INC1-CAM-006', 'Cámara de acción GoPro',           'Cámara',         'Sede Norte',     0),

    ('INC1-ROB-001', 'Kit Arduino con sensores',        'Kit de robótica', 'Sede Principal', 0),
    ('INC1-ROB-002', 'Kit micro:bit con actuadores',     'Kit de robótica', 'Sede Principal', 0),
    ('INC1-ROB-003', 'Kit LEGO Education SPIKE Prime',   'Kit de robótica', 'Sede Principal', 1),
    ('INC1-ROB-004', 'Kit Arduino con sensores',        'Kit de robótica', 'Sede Norte',     0),
    ('INC1-ROB-005', 'Kit LEGO Education SPIKE Prime',   'Kit de robótica', 'Sede Norte',     1),
    ('INC1-ROB-006', 'Kit Raspberry Pi con sensores',   'Kit de robótica', 'Sede Norte',     1);

START TRANSACTION;

INSERT INTO productos (nombre, descripcion, precio, stock, estado)
SELECT s.modelo, CONCAT('Unidad ficticia de demostración ', s.codigo, '.'), 0.00, 1, 1
FROM carga_catalogo_inc1 s
LEFT JOIN prestamos_catalogo c ON c.codigo_unidad = s.codigo
LEFT JOIN productos p ON p.descripcion = CONCAT('Unidad ficticia de demostración ', s.codigo, '.')
WHERE c.id_producto IS NULL AND p.id_producto IS NULL
ORDER BY s.codigo;

INSERT INTO prestamos_catalogo (id_producto, codigo_unidad, categoria, sede, requiere_autorizacion)
SELECT p.id_producto, s.codigo, s.categoria, s.sede, s.autorizacion
FROM carga_catalogo_inc1 s
JOIN productos p ON p.descripcion = CONCAT('Unidad ficticia de demostración ', s.codigo, '.')
LEFT JOIN prestamos_catalogo c ON c.codigo_unidad = s.codigo OR c.id_producto = p.id_producto
WHERE c.id_producto IS NULL
ORDER BY s.codigo;

COMMIT;

DROP TEMPORARY TABLE carga_catalogo_inc1;
