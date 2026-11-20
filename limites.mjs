import { ApiError } from './reglas.mjs';

export function readLimits(env = process.env) {
    function integer(name, fallback, minimum, maximum) {
        const value = env[name] === undefined || env[name] === '' ? fallback : Number(env[name]);
        if (!Number.isInteger(value) || value < minimum || value > maximum) {
            throw new Error(`${name} debe ser un entero entre ${minimum} y ${maximum}.`);
        }
        return value;
    }
    return {
        poolSize: integer('DB_POOL_SIZE', 16, 4, 64),
        poolQueue: integer('DB_QUEUE_LIMIT', 256, 32, 2048),
        authWorkers: integer('AUTH_CONCURRENCY', 4, 1, 16),
        authQueue: integer('AUTH_QUEUE_LIMIT', 256, 1, 1024),
        authPerAddress: integer('AUTH_REQUESTS_PER_IP', 512, 40, 2000)
    };
}

export function createAdmission({ workers, queueLimit, waitMs }) {
    let active = 0;
    const queue = [];
    const busy = () => new ApiError(503, 'El servicio está ocupado. Intenta de nuevo en unos segundos.');

    async function acquire(signal) {
        signal?.throwIfAborted();
        if (active < workers) {
            active += 1;
            return;
        }
        if (queue.length >= queueLimit) throw busy();

        return new Promise((resolve, reject) => {
            const clean = () => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', cancel);
            };
            const cancel = () => {
                const position = queue.indexOf(ticket);
                if (position === -1) return;
                queue.splice(position, 1);
                clean();
                reject(signal?.aborted ? signal.reason : busy());
            };
            const ticket = () => {
                clean();
                resolve();
            };
            const timer = setTimeout(cancel, waitMs);
            queue.push(ticket);
            signal?.addEventListener('abort', cancel, { once: true });
        });
    }

    return async (signal, action) => {
        await acquire(signal);
        try {
            signal?.throwIfAborted();
            return await action();
        } finally {
            const next = queue.shift();
            if (next) next();
            else active -= 1;
        }
    };
}
