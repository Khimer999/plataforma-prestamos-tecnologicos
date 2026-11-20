-- Catálogo ficticio opcional. Ejecutar en una base de demostración vacía
-- después de aplicar inventario.sql y 02-prestamos.sql.
START TRANSACTION;

SET @cargar_catalogo_demo := NOT EXISTS (SELECT 1 FROM productos);

INSERT INTO productos (nombre, descripcion, precio, stock, estado)
SELECT demo.nombre, 'Equipo ficticio para probar solicitudes de préstamo.', 0.00, 1, 1
FROM (
    SELECT 'Portátil de demostración' AS nombre
    UNION ALL SELECT 'Tableta de demostración'
    UNION ALL SELECT 'Cámara de demostración'
) AS demo
WHERE @cargar_catalogo_demo = 1;

INSERT INTO prestamos_catalogo (id_producto, codigo_unidad, categoria, sede, requiere_autorizacion)
SELECT p.id_producto, demo.codigo, demo.categoria, demo.sede, demo.autorizacion
FROM productos AS p
JOIN (
    SELECT 'Portátil de demostración' AS nombre, 'DEMO-PC-01' AS codigo,
        'Computador' AS categoria, 'Sede Principal' AS sede, 0 AS autorizacion
    UNION ALL SELECT 'Tableta de demostración', 'DEMO-TAB-01', 'Tablet', 'Sede Norte', 0
    UNION ALL SELECT 'Cámara de demostración', 'DEMO-CAM-01', 'Cámara', 'Sede Principal', 1
) AS demo ON demo.nombre = p.nombre
WHERE @cargar_catalogo_demo = 1;

COMMIT;
