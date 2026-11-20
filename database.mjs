import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import argon2 from 'argon2';
import mysql from 'mysql2/promise';
import { readLimits } from './limites.mjs';
import { ApiError, hasCapacity, requireId, requirePassword, requireText, validatePeriod } from './reglas.mjs';

const sessionSeconds = 8 * 60 * 60;
export { sessionSeconds };

const roleExpression = `CASE LOWER(r.nombre_rol)
    WHEN 'administrador' THEN 'admin'
    WHEN 'estudiante' THEN 'estudiante'
    WHEN 'profesor' THEN 'profesor'
    ELSE 'auxiliar'
END`;
const profileColumns = `CAST(u.id_usuario AS CHAR) AS id, u.usuario AS username,
    p.correo, COALESCE(p.nombre_completo, u.usuario) AS nombreCompleto,
    p.tipo_documento AS tipoDocumento, p.numero_documento AS numeroDocumento,
    p.codigo_institucional AS codigoInstitucional, p.facultad_programa AS facultadPrograma,
    p.creado_en AS creadoEn, ${roleExpression} AS rol`;
const profileJoin = `JOIN roles r ON r.id_rol = u.id_rol
    LEFT JOIN prestamos_perfiles p ON p.id_usuario = u.id_usuario`;
const profileTables = `usuarios u ${profileJoin}`;
const productCode = `COALESCE(c.codigo_unidad, CONCAT('EQ-', LPAD(CAST(d.id_producto AS CHAR), GREATEST(4, CHAR_LENGTH(CAST(d.id_producto AS CHAR))), '0')))`;
const loanDetails = `SELECT CAST(l.id_prestamo AS CHAR) AS id, CAST(l.id_usuario AS CHAR) AS usuarioId,
    CAST(l.id_producto AS CHAR) AS dispositivoId, l.fecha_inicio AS fechaInicio, l.fecha_fin AS fechaFin,
    l.motivo_solicitud AS motivoSolicitud, l.estado, l.observacion_admin AS observacionAdmin,
    CAST(l.creado_por AS CHAR) AS creadoPorId, l.creado_en AS creadoEn,
    COALESCE(p.nombre_completo, u.usuario) AS solicitanteNombre, ${roleExpression} AS solicitanteRol,
    p.codigo_institucional AS solicitanteCodigo, CONCAT_WS(' ', p.tipo_documento, p.numero_documento) AS solicitanteDocumento,
    p.facultad_programa AS solicitantePrograma, COALESCE(p.correo, u.usuario) AS solicitanteCorreo,
    ${productCode} AS dispositivoCodigo, d.nombre AS dispositivoModelo,
    COALESCE(c.sede, 'Sede principal') AS dispositivoSede
    FROM prestamos l JOIN usuarios u ON u.id_usuario = l.id_usuario ${profileJoin}
    JOIN productos d ON d.id_producto = l.id_producto
    LEFT JOIN prestamos_catalogo c ON c.id_producto = d.id_producto`;

export function createPool(env = process.env, limits = readLimits(env)) {
    if (!env.DB_USER) throw new Error('Configura DB_USER y DB_PASSWORD en el archivo .env.');
    const port = Number(env.DB_PORT || 3306);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('El valor de DB_PORT no es válido.');
    return mysql.createPool({
        host: env.DB_HOST || '127.0.0.1',
        port,
        database: env.DB_NAME || 'inventario_tecnosoluciones',
        user: env.DB_USER,
        password: env.DB_PASSWORD || '',
        ssl: env.DB_TLS_CA_FILE ? { ca: readFileSync(env.DB_TLS_CA_FILE), rejectUnauthorized: true, verifyIdentity: true } : undefined,
        charset: 'UTF8MB4_UNICODE_CI',
        timezone: 'Z',
        connectionLimit: limits.poolSize,
        queueLimit: limits.poolQueue,
        connectTimeout: 5000
    });
}

export async function checkSchema(pool) {
    const tables = ['roles', 'usuarios', 'productos', 'prestamos_perfiles', 'prestamos_catalogo', 'prestamos', 'prestamos_sesiones'];
    const [rows] = await pool.execute(`SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tables.map(() => '?').join(', ')})`, tables);
    if (rows.length !== tables.length || rows.some(({ engine }) => engine !== 'InnoDB')) {
        throw new Error('Importa los scripts SQL y verifica que sus tablas usen InnoDB.');
    }
}

async function transaction(pool, action) {
    const connection = await pool.getConnection();
    try {
        await connection.query('SET SESSION innodb_lock_wait_timeout = 3');
        await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        await connection.beginTransaction();
        const result = await action(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
    } finally {
        connection.release();
    }
}

function hashedToken(token) {
    return createHash('sha256').update(token).digest();
}

function hashPassword(password) {
    return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

async function addUser(connection, username, hash, roleName) {
    const [result] = await connection.execute(`INSERT INTO usuarios (usuario, password_hash, id_rol)
        SELECT ?, ?, id_rol FROM roles WHERE nombre_rol = ?`, [username, hash, roleName]);
    if (!result.insertId) throw new ApiError(503, 'El rol de la cuenta todavía no está instalado en la base de datos.');
    return result.insertId;
}

export async function provisionAdmin(pool, username, password) {
    const account = requireText(username, 'nombre de usuario', 50);
    if (!/^[\p{L}0-9_.@-]+$/u.test(account)) throw new ApiError(400, 'Usa letras, números o los signos . _ @ - para el usuario.');
    const hash = await hashPassword(requirePassword(password));
    await addUser(pool, account, hash, 'Administrador');
}

async function lockProduct(connection, id) {
    const [[product]] = await connection.execute('SELECT estado, stock FROM productos WHERE id_producto = ? FOR UPDATE', [id]);
    if (!product) throw new ApiError(404, 'El dispositivo seleccionado no existe.');
    return product;
}

async function checkAvailability(connection, { id, product, start, end }) {
    if (product.estado !== 1 || product.stock < 1) throw new ApiError(409, 'El dispositivo seleccionado ya no está disponible.');
    // El bloqueo del producto serializa las confirmaciones. Una reserva solapada dura como máximo 72 horas.
    const [reservations] = await connection.execute(`SELECT fecha_inicio AS fechaInicio, fecha_fin AS fechaFin FROM prestamos
        WHERE id_producto = ? AND estado = 'Confirmado' AND fecha_inicio < ?
          AND fecha_inicio > DATE_SUB(?, INTERVAL 72 HOUR) AND fecha_fin > ?`, [id, end, start, start]);
    if (!hasCapacity({ start, end, reservations, stock: product.stock })) {
        throw new ApiError(409, 'Todas las unidades están reservadas en ese horario. Elige otra franja o equipo.');
    }
}

export function createRepository(pool) {
    let fallbackHashPromise;

    return {
        async register(body) {
            const email = requireText(body.correo, 'correo', 254).toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Ingresa un correo válido.');
            if (!['estudiante', 'profesor'].includes(body.rol)) throw new ApiError(400, 'Elige Estudiante o Profesor.');
            const roleName = body.rol === 'profesor' ? 'Profesor' : 'Estudiante';
            const profile = [
                email,
                requireText(body.nombreCompleto, 'nombre completo', 120),
                requireText(body.tipoDocumento, 'tipo de documento', 30),
                requireText(body.numeroDocumento, 'número de documento', 40),
                requireText(body.codigoInstitucional, 'código institucional', 40),
                requireText(body.facultadPrograma, 'facultad o programa', 120)
            ];
            const hash = await hashPassword(requirePassword(body.password));
            const username = email.length <= 50 ? email : `cuenta-${randomBytes(18).toString('hex')}`;
            await transaction(pool, async (connection) => {
                const id = await addUser(connection, username, hash, roleName);
                await connection.execute(`INSERT INTO prestamos_perfiles
                    (id_usuario, correo, nombre_completo, tipo_documento, numero_documento, codigo_institucional, facultad_programa, creado_en)
                    VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`, [id, ...profile]);
            });
        },
        async login(body, previousToken) {
            const login = requireText(body.identificador, 'correo o usuario', 254);
            const password = requirePassword(body.password, 1);
            const [rows] = await pool.execute(`SELECT ${profileColumns}, u.password_hash AS hash FROM ${profileTables}
                JOIN (SELECT id_usuario FROM usuarios WHERE usuario = ?
                      UNION SELECT id_usuario FROM prestamos_perfiles WHERE correo = ?) AS matching ON matching.id_usuario = u.id_usuario
                WHERE u.estado = 1 LIMIT 2`, [login, login]);
            const { hash, ...profile } = rows.length === 1 ? rows[0] : {};
            let valid = false;
            if (typeof hash === 'string' && /^\$argon2(?:id|i|d)\$/.test(hash)) {
                valid = await argon2.verify(hash, password).catch(() => false);
            } else {
                fallbackHashPromise ??= hashPassword(randomBytes(32).toString('hex'));
                await argon2.verify(await fallbackHashPromise, password);
            }
            if (!valid) throw new ApiError(401, 'Verifica el correo o usuario y la contraseña.');
            const token = randomBytes(32).toString('base64url');
            const expiresAt = new Date(Date.now() + sessionSeconds * 1000);
            const save = (connection) => connection.execute(
                'INSERT INTO prestamos_sesiones (token_hash, id_usuario, vence_en) VALUES (?, ?, ?)',
                [hashedToken(token), profile.id, expiresAt]);
            if (previousToken) {
                await transaction(pool, async (connection) => {
                    await connection.execute('DELETE FROM prestamos_sesiones WHERE token_hash = ?', [hashedToken(previousToken)]);
                    await save(connection);
                });
            } else {
                await save(pool);
            }
            return { token, profile };
        },
        async currentUser(token) {
            if (!token) return null;
            const [[user]] = await pool.execute(`SELECT ${profileColumns} FROM ${profileTables}
                JOIN prestamos_sesiones s ON s.id_usuario = u.id_usuario
                WHERE s.token_hash = ? AND s.vence_en > UTC_TIMESTAMP(3) AND u.estado = 1`, [hashedToken(token)]);
            return user || null;
        },
        async logout(token) {
            if (token) await pool.execute('DELETE FROM prestamos_sesiones WHERE token_hash = ?', [hashedToken(token)]);
        },
        async clearExpiredSessions() {
            await pool.execute('DELETE FROM prestamos_sesiones WHERE vence_en <= UTC_TIMESTAMP(3)');
        },
        async users() {
            const [rows] = await pool.execute(`SELECT ${profileColumns} FROM ${profileTables} WHERE u.estado = 1 ORDER BY nombreCompleto`);
            return rows;
        },
        async devices() {
            const [rows] = await pool.execute(`SELECT CAST(d.id_producto AS CHAR) AS id, ${productCode} AS codigoUnidad,
                COALESCE(c.categoria, 'Otro') AS categoria, d.nombre AS modelo, d.descripcion,
                COALESCE(c.sede, 'Sede principal') AS sede, COALESCE(c.requiere_autorizacion, 0) AS requiereAutorizacion,
                CASE WHEN d.estado = 1 AND d.stock > 0 THEN 'Disponible' ELSE 'No disponible' END AS estado, d.stock AS unidades
                FROM productos d LEFT JOIN prestamos_catalogo c ON c.id_producto = d.id_producto
                ORDER BY categoria, codigoUnidad`);
            return rows.map((row) => ({ ...row, requiereAutorizacion: Boolean(row.requiereAutorizacion) }));
        },
        async loans(actor) {
            const ownFilter = actor.rol === 'admin' ? '' : 'WHERE l.id_usuario = ?';
            const [rows] = await pool.execute(`${loanDetails} ${ownFilter} ORDER BY l.creado_en DESC, l.id_prestamo DESC`,
                actor.rol === 'admin' ? [] : [actor.id]);
            return rows;
        },
        async availability() {
            const [rows] = await pool.execute(`SELECT CAST(id_producto AS CHAR) AS dispositivoId,
                fecha_inicio AS fechaInicio, fecha_fin AS fechaFin FROM prestamos
                WHERE estado = 'Confirmado' AND fecha_fin > UTC_TIMESTAMP(3) ORDER BY fecha_inicio`);
            return rows;
        },
        async createLoan(body, actor) {
            const id = requireId(body.dispositivoId, 'un dispositivo');
            const requester = actor.rol === 'admin' ? requireId(body.usuarioId, 'un usuario') : Number(actor.id);
            const reason = requireText(body.motivoSolicitud, 'motivo', 500);
            const [start, end] = validatePeriod(body.fechaInicio, body.fechaFin);

            return transaction(pool, async (connection) => {
                // Toda confirmación toma primero el mismo bloqueo InnoDB sobre el producto.
                const product = await lockProduct(connection, id);
                await checkAvailability(connection, { id, product, start, end });
                const [[user]] = await connection.execute('SELECT id_usuario FROM usuarios WHERE id_usuario = ? AND estado = 1', [requester]);
                if (!user) throw new ApiError(404, 'El usuario seleccionado no está activo.');
                const [[catalog]] = await connection.execute('SELECT requiere_autorizacion FROM prestamos_catalogo WHERE id_producto = ?', [id]);
                const pending = actor.rol !== 'admin' && Boolean(catalog?.requiere_autorizacion);
                const status = pending ? 'Pendiente' : 'Confirmado';
                let note = 'Confirmado automáticamente por disponibilidad.';
                if (pending) note = 'En espera de revisión.';
                else if (actor.rol === 'admin') note = 'Confirmado por el administrador.';

                const [result] = await connection.execute(`INSERT INTO prestamos
                    (id_usuario, id_producto, fecha_inicio, fecha_fin, motivo_solicitud, estado, observacion_admin, creado_por, creado_en)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`, [requester, id, start, end, reason, status, note, actor.id]);
                const [[loan]] = await connection.execute(`${loanDetails} WHERE l.id_prestamo = ?`, [result.insertId]);
                return loan;
            });
        },
        async decideLoan(id, body, actor) {
            if (actor.rol !== 'admin') throw new ApiError(403, 'La decisión requiere una cuenta de administrador.');
            const loanId = requireId(id, 'un préstamo');
            const status = body.estado;
            if (!['Confirmado', 'Rechazado'].includes(status)) throw new ApiError(400, 'Selecciona Aprobar o Rechazar.');
            const note = requireText(body.observacionAdmin, 'observación', 500, { optional: status === 'Confirmado' });

            return transaction(pool, async (connection) => {
                const [[reference]] = await connection.execute('SELECT id_producto FROM prestamos WHERE id_prestamo = ?', [loanId]);
                if (!reference) throw new ApiError(404, 'La solicitud no existe.');
                const productId = reference.id_producto;
                const product = await lockProduct(connection, productId);
                const [[loan]] = await connection.execute(`SELECT estado, fecha_inicio AS fechaInicio, fecha_fin AS fechaFin FROM prestamos
                    WHERE id_prestamo = ? FOR UPDATE`, [loanId]);
                if (loan?.estado !== 'Pendiente') throw new ApiError(409, 'La solicitud ya fue procesada o no existe.');
                if (status === 'Confirmado') {
                    const [start, end] = validatePeriod(loan.fechaInicio, loan.fechaFin);
                    await checkAvailability(connection, { id: productId, product, start, end });
                }
                await connection.execute(`UPDATE prestamos SET estado = ?, observacion_admin = ?, decidido_por = ?, decidido_en = UTC_TIMESTAMP(3)
                    WHERE id_prestamo = ?`, [status, note || 'Aprobado por el administrador.', actor.id, loanId]);
                const [[updated]] = await connection.execute(`${loanDetails} WHERE l.id_prestamo = ?`, [loanId]);
                return updated;
            });
        }
    };
}
