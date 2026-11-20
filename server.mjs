import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { checkSchema, createPool, createRepository, sessionSeconds } from './database.mjs';
import { createAdmission, readLimits } from './limites.mjs';
import { ApiError } from './reglas.mjs';

const staticFiles = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/app.css', ['app.css', 'text/css; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/assets/nebula.webp', ['assets/nebula.webp', 'image/webp']]
]);
const maxBodySize = 16_384;
const cookieName = 'prestamos_sesion';

function send(response, status, payload) {
    response.statusCode = status;
    if (payload === undefined) return response.end();
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(payload));
}

function sessionToken(request) {
    const value = (request.headers.cookie || '').split(';').find((part) => part.trimStart().startsWith(`${cookieName}=`));
    const token = value?.trim().slice(cookieName.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(token || '') ? token : undefined;
}

function setSessionCookie(response, token, secure) {
    const age = token ? sessionSeconds : 0;
    response.setHeader('Set-Cookie', `${cookieName}=${token || ''}; HttpOnly; SameSite=Lax; Path=/api; Max-Age=${age}${secure ? '; Secure' : ''}`);
}

function readBody(request) {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
        request.resume();
        throw new ApiError(415, 'El servicio espera un cuerpo en formato JSON.');
    }
    if (Number(request.headers['content-length']) > maxBodySize) {
        request.resume();
        throw new ApiError(413, 'El contenido de la solicitud es demasiado grande.');
    }
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        request.on('error', reject);
        request.on('aborted', () => reject(new ApiError(400, 'La solicitud no se completó.')));
        request.on('data', (chunk) => {
            size += chunk.length;
            if (size <= maxBodySize) chunks.push(chunk);
        });
        request.on('end', () => {
            if (size > maxBodySize) return reject(new ApiError(413, 'El contenido de la solicitud es demasiado grande.'));
            try {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error();
                resolve(body);
            } catch {
                reject(new ApiError(400, 'El contenido JSON de la solicitud no es válido.'));
            }
        });
    });
}

function createAuthThrottle() {
    const attempts = new Map();
    const windowMs = 10 * 60 * 1000;
    let pruneAt = 0;
    return (key, maximum, response) => {
        const now = Date.now();
        if (now >= pruneAt) {
            for (const [id, attempt] of attempts) if (attempt.until <= now) attempts.delete(id);
            pruneAt = now + 30_000;
        }
        let attempt = attempts.get(key);
        if (!attempt || attempt.until <= now) {
            if (!attempt && attempts.size >= 8192) throw new ApiError(503, 'El servicio de acceso está ocupado.');
            attempt = { count: 0, until: now + windowMs };
            attempts.set(key, attempt);
        }
        attempt.count += 1;
        if (attempt.count <= maximum) return;
        response.setHeader('Retry-After', Math.ceil((attempt.until - now) / 1000));
        throw new ApiError(429, 'Demasiados intentos. Intenta de nuevo en unos minutos.');
    };
}

async function sendAsset(request, response, pathname, root, cache) {
    const item = staticFiles.get(pathname);
    if (!item || !['GET', 'HEAD'].includes(request.method)) throw new ApiError(404, 'Página no encontrada.');
    const [file, contentType] = item;
    if (!cache.has(file)) {
        const load = readFile(new URL(file, root)).then((content) => file === 'index.html'
            ? Buffer.from(content.toString('utf8').replace(/(<meta\s+name="prestamos-api"\s+content=")[^"]*(")/, '$1/api$2'))
            : content).catch((error) => {
            cache.delete(file);
            throw error;
        });
        cache.set(file, load);
    }
    const content = await cache.get(file);
    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Length', content.length);
    response.setHeader('Cache-Control', file === 'index.html' ? 'no-store' : 'public, max-age=300');
    response.end(request.method === 'HEAD' ? undefined : content);
}

async function serveApi(request, response, pathname, repository, configuration, signal) {
    const method = request.method;
    const token = sessionToken(request);
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(method) && request.headers.origin !== configuration.origin) {
        throw new ApiError(403, 'La solicitud debe enviarse desde la aplicación.');
    }

    if (method === 'POST' && ['/api/auth/registro', '/api/auth/sesion'].includes(pathname)) {
        const registering = pathname === '/api/auth/registro';
        const address = request.socket.remoteAddress;
        configuration.throttle(`${pathname}|${address}`, configuration.limits.authPerAddress, response);
        const body = await readBody(request);
        const login = body[registering ? 'correo' : 'identificador'];
        if (typeof login === 'string' && login.trim()) {
            const key = login.trim().toLowerCase().slice(0, 254);
            configuration.throttle(`${pathname}|${address}|${key}`, 12, response);
        }
        if (registering) {
            await configuration.authenticate(signal, () => repository.register(body));
            return send(response, 204);
        }
        const { profile, token: newToken } = await configuration.authenticate(signal, () => repository.login(body, token));
        setSessionCookie(response, newToken, configuration.secure);
        return send(response, 200, profile);
    }
    if (method === 'DELETE' && pathname === '/api/auth/sesion') {
        await repository.logout(token);
        setSessionCookie(response, undefined, configuration.secure);
        return send(response, 204);
    }

    const actor = await repository.currentUser(token);
    if (!actor) throw new ApiError(401, 'Inicia sesión para continuar.');
    if (method === 'GET') {
        switch (pathname) {
            case '/api/auth/sesion': return send(response, 200, actor);
            case '/api/panel': {
                const admin = actor.rol === 'admin';
                const devices = await repository.devices();
                const loans = await repository.loans(actor);
                const availability = admin ? [] : await repository.availability();
                const users = admin ? await repository.users() : [];
                return send(response, 200, { devices, loans, availability, users });
            }
            case '/api/dispositivos': return send(response, 200, await repository.devices());
            case '/api/disponibilidad': return send(response, 200, await repository.availability());
            case '/api/prestamos': return send(response, 200, await repository.loans(actor));
            case '/api/usuarios':
                if (actor.rol !== 'admin') throw new ApiError(403, 'Esta consulta requiere una cuenta de administrador.');
                return send(response, 200, await repository.users());
        }
    }
    if (method === 'POST' && pathname === '/api/prestamos') {
        const body = await readBody(request);
        return send(response, 201, await configuration.book(signal, () => repository.createLoan(body, actor)));
    }
    const loanRoute = /^\/api\/prestamos\/([^/]+)$/.exec(pathname);
    if (method === 'PATCH' && loanRoute) {
        if (actor.rol !== 'admin') throw new ApiError(403, 'La decisión requiere una cuenta de administrador.');
        const body = await readBody(request);
        const loan = await configuration.book(signal, () => repository.decideLoan(loanRoute[1], body, actor));
        return send(response, 200, loan);
    }
    throw new ApiError(404, 'Ruta del servicio no encontrada.');
}

function handleError(response, error) {
    if (response.destroyed) return;
    if (error instanceof ApiError) {
        if (error.status === 503) response.setHeader('Retry-After', '2');
        return send(response, error.status, { message: error.message });
    }
    if (error.code === 'ER_DUP_ENTRY') return send(response, 409, { message: 'El correo, usuario o documento ya está registrado.' });
    if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_CON_COUNT_ERROR'].includes(error.code)
        || error.message === 'Queue limit reached.') {
        response.setHeader('Retry-After', '2');
        return send(response, 503, { message: 'El servicio está ocupado. Intenta de nuevo en unos segundos.' });
    }
    if (['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'EPIPE'].includes(error.code)) {
        return send(response, 503, { message: 'La base de datos no responde. Consulta tus registros al recuperar la conexión.' });
    }
    if (error.code === 'ENOENT') return send(response, 404, { message: 'Archivo de la aplicación no encontrado.' });
    console.error('Error interno del servicio', error.code || error.name);
    return send(response, 500, { message: 'Ocurrió un error en el servicio. Intenta de nuevo.' });
}

export function buildServer(repository, {
    origin,
    publicRoot = new URL('./public/', import.meta.url),
    limits = readLimits({})
}) {
    const configuration = {
        origin, limits, secure: new URL(origin).protocol === 'https:', throttle: createAuthThrottle(),
        authenticate: createAdmission({ workers: limits.authWorkers, queueLimit: limits.authQueue, waitMs: 15_000 }),
        book: createAdmission({ workers: Math.min(8, Math.floor(limits.poolSize / 2)), queueLimit: limits.poolQueue, waitMs: 8_000 })
    };
    const assets = new Map();
    return createServer({ requestTimeout: 30_000, headersTimeout: 15_000 }, async (request, response) => {
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        response.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'");
        try {
            const pathname = new URL(request.url, configuration.origin).pathname;
            if (pathname.startsWith('/api/')) {
                const client = new AbortController();
                response.once('close', () => {
                    if (!response.writableFinished) client.abort();
                });
                await serveApi(request, response, pathname, repository, configuration, client.signal);
            } else await sendAsset(request, response, pathname, publicRoot, assets);
        } catch (error) {
            handleError(response, error);
        }
    });
}

async function start(env = process.env) {
    const host = env.HOST || '127.0.0.1';
    const port = Number(env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('El valor de PORT no es válido.');
    const pageOrigin = new URL(env.APP_ORIGIN || `http://127.0.0.1:${port}`);
    if (!['http:', 'https:'].includes(pageOrigin.protocol) || pageOrigin.username || pageOrigin.password
        || pageOrigin.pathname !== '/' || pageOrigin.search || pageOrigin.hash) {
        throw new Error('APP_ORIGIN debe ser una URL http o https del sitio, sin ruta ni parámetros.');
    }

    const limits = readLimits(env);
    const pool = createPool(env, limits);
    try {
        await checkSchema(pool);
        const repository = createRepository(pool);
        await repository.clearExpiredSessions();
        const server = buildServer(repository, { origin: pageOrigin.origin, limits });
        const cleanup = setInterval(() => repository.clearExpiredSessions().catch((error) => {
            console.error('No se pudieron limpiar las sesiones caducadas', error.code || error.name);
        }), 60 * 60 * 1000).unref();
        server.once('close', () => clearInterval(cleanup));
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, host, resolve);
        });
        console.log(`Plataforma de préstamos disponible en ${pageOrigin.origin}`);
        const shutdown = () => server.close(() => void pool.end());
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
    } catch (error) {
        await pool.end();
        throw error;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    start().catch((error) => {
        console.error('No se pudo iniciar la plataforma.', error.code || error.message);
        process.exitCode = 1;
    });
}
