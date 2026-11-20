import { randomBytes } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkSchema, createPool, createRepository, provisionAdmin } from '../database.mjs';

const accountDefaults = [
    { identificador: 'admin-inicial', nombreRol: 'Administrador' },
    {
        identificador: 'estudiante.inicial@ejemplo.test', nombreRol: 'Estudiante',
        nombreCompleto: 'Estudiante de demostración', tipoDocumento: 'C.C.',
        numeroDocumento: 'DEMO-EST-01', codigoInstitucional: 'DEMO-EST-01',
        facultadPrograma: 'Programa de demostración', rol: 'estudiante'
    },
    {
        identificador: 'profesor.inicial@ejemplo.test', nombreRol: 'Profesor',
        nombreCompleto: 'Profesor de demostración', tipoDocumento: 'C.C.',
        numeroDocumento: 'DEMO-PROF-01', codigoInstitucional: 'DEMO-PROF-01',
        facultadPrograma: 'Programa de demostración', rol: 'profesor'
    }
];

class SetupError extends Error {}

async function privateFilePath(filename) {
    if (!filename) throw new SetupError('Indica una ruta privada con --archivo.');
    const destination = resolve(filename);
    const outsideDirectory = await realpath(dirname(destination));
    const filepath = resolve(outsideDirectory, basename(destination));
    const checkout = await realpath(fileURLToPath(new URL('../', import.meta.url)));
    const fromCheckout = relative(checkout, filepath);
    if (!isAbsolute(fromCheckout) && !fromCheckout.startsWith(`..${sep}`)) {
        throw new SetupError('Selecciona una carpeta privada fuera del repositorio.');
    }
    return filepath;
}

async function missingAccounts(connection, defaults) {
    const missing = [];
    for (const account of defaults) {
        const [matches] = await connection.execute(`SELECT u.estado, r.nombre_rol AS rol
            FROM usuarios u JOIN roles r ON r.id_rol = u.id_rol
            LEFT JOIN prestamos_perfiles p ON p.id_usuario = u.id_usuario
            WHERE u.usuario = ? OR p.correo = ?`, [account.identificador, account.identificador]);
        if (matches.length) {
            if (matches.length !== 1 || matches[0].estado !== 1 || matches[0].rol !== account.nombreRol) {
                throw new SetupError('Una cuenta inicial existente está inactiva o tiene otro rol. Revisa esa cuenta antes de continuar.');
            }
            continue;
        }
        if (account.numeroDocumento) {
            const [[document]] = await connection.execute('SELECT 1 FROM prestamos_perfiles WHERE numero_documento = ?', [account.numeroDocumento]);
            if (document) throw new SetupError('Un documento ficticio de inicio ya pertenece a otra cuenta.');
        }
        missing.push(account);
    }
    return missing;
}

async function createAccounts(pool, connection, filepath, defaults) {
    const missing = await missingAccounts(connection, defaults);
    if (!missing.length) {
        console.log(`Cuentas iniciales conservadas: ${defaults.length}.`);
        return;
    }

    const planned = missing.map((account) => ({
        account, password: `Aa1!${randomBytes(27).toString('base64url')}`
    }));
    const credentials = planned.map(({ account, password }) => ({
        identificador: account.identificador, rol: account.nombreRol, contraseña: password
    }));
    const file = await open(filepath, 'wx', 0o600);
    try {
        // Escribe antes de crear las cuentas para conservar las claves si el proceso se interrumpe.
        await file.writeFile(`${JSON.stringify({ cuentas: credentials }, null, 2)}\n`, 'utf8');
        await file.sync();
    } finally {
        await file.close();
    }

    const repository = createRepository(pool);
    for (const { account, password } of planned) {
        if (account.rol) await repository.register({ ...account, correo: account.identificador, password });
        else await provisionAdmin(pool, account.identificador, password);
    }
    console.log(`Cuentas creadas: ${planned.length}. Cuentas conservadas: ${defaults.length - planned.length}. Las nuevas claves están en el archivo privado.`);
}

async function main() {
    const { values } = parseArgs({ options: { archivo: { type: 'string' }, evaluacion: { type: 'boolean' } }, allowPositionals: false });
    const filepath = await privateFilePath(values.archivo);
    const defaults = values.evaluacion ? accountDefaults : accountDefaults.slice(0, 1);
    const pool = createPool();
    try {
        await checkSchema(pool);
        const connection = await pool.getConnection();
        try {
            const [[{ acquired }]] = await connection.execute("SELECT GET_LOCK(CONCAT('prestamos-cuentas-', MD5(DATABASE())), 5) AS acquired");
            if (acquired !== 1) throw new SetupError('Otra carga de cuentas iniciales está en curso.');
            try {
                await createAccounts(pool, connection, filepath, defaults);
            } finally {
                await connection.execute("DO RELEASE_LOCK(CONCAT('prestamos-cuentas-', MD5(DATABASE())))");
            }
        } finally {
            connection.release();
        }
    } finally {
        await pool.end();
    }
}

main().catch((error) => {
    let message = 'No se pudieron preparar todas las cuentas iniciales. Revisa la conexión y conserva cualquier archivo privado generado.';
    if (error instanceof SetupError) message = error.message;
    else if (error.code === 'EEXIST') message = 'Ya existe el archivo de salida. Conserva las claves anteriores y usa una ruta nueva.';
    else if (error.code === 'ENOENT' || error.code === 'EACCES') message = 'La carpeta privada debe existir y permitir escritura.';
    console.error(message);
    process.exitCode = 1;
});
