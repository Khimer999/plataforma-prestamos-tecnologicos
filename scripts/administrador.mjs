import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { checkSchema, createPool, provisionAdmin } from '../database.mjs';

async function readPassword() {
    const mutedOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const input = createInterface({ input: stdin, output: mutedOutput, terminal: true });
    const cancel = new AbortController();
    input.once('SIGINT', () => cancel.abort());
    try {
        stdout.write('Contraseña nueva (12–128 caracteres): ');
        const password = await input.question('', { signal: cancel.signal });
        stdout.write('\nConfirma la contraseña: ');
        const confirmation = await input.question('', { signal: cancel.signal });
        if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');
        return password;
    } finally {
        input.close();
        stdout.write('\n');
    }
}

async function main() {
    const [username, ...rest] = process.argv.slice(2);
    if (!username || rest.length || !stdin.isTTY) throw new Error('Ejecuta npm run admin -- nombreusuario desde una terminal interactiva.');
    const password = await readPassword();
    const pool = createPool();
    try {
        await checkSchema(pool);
        await provisionAdmin(pool, username, password);
        console.log('Cuenta de administrador creada.');
    } finally {
        await pool.end();
    }
}

main().catch((error) => {
    console.error(error.code === 'ER_DUP_ENTRY' ? 'Ese nombre de usuario ya existe.' : error.code || error.message);
    process.exitCode = 1;
});
