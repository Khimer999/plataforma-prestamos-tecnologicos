export function createUpdates(repository) {
    const clients = new Set();
    let timer;
    let pending = false;

    function remove(client) {
        clients.delete(client);
        clearTimeout(client.expiry);
        if (clients.size === 0 && timer) {
            clearInterval(timer);
            timer = undefined;
        }
    }

    async function publish() {
        if (clients.size === 0 || pending) return;
        pending = true;
        try {
            const version = await repository.revision();
            if (version === null) return;
            const now = Date.now();
            for (const client of clients) {
                if (client.version !== version) {
                    client.version = version;
                    client.lastWrite = now;
                    if (!client.response.write(`event: cambio\ndata: ${version}\n\n`)) client.response.end();
                } else if (now - client.lastWrite >= 14_000) {
                    client.lastWrite = now;
                    if (!client.response.write(': conexión activa\n\n')) client.response.end();
                }
            }
        } catch (error) {
            console.error('No se pudo consultar la revisión de préstamos', error.code || error.name);
            for (const client of clients) client.response.end();
        } finally {
            pending = false;
        }
    }

    return {
        subscribe(response) {
            if (response.destroyed) return;
            response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            response.setHeader('Cache-Control', 'no-store, no-transform');
            response.setHeader('X-Accel-Buffering', 'no');
            response.flushHeaders();
            response.write(`retry: ${3500 + Math.floor(Math.random() * 1500)}\n\n`);
            const client = { response, version: null, lastWrite: Date.now() };
            client.expiry = setTimeout(() => response.end(), 90_000).unref();
            clients.add(client);
            response.once('close', () => remove(client));
            if (!timer) timer = setInterval(() => void publish(), 1200).unref();
            void publish();
        },
        close() {
            for (const client of clients) client.response.end();
        }
    };
}
