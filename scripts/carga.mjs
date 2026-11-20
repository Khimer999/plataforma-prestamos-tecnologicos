import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
    url: { type: 'string' }, users: { type: 'string' }, concurrency: { type: 'string' },
    rounds: { type: 'string', default: '3' }, credentials: { type: 'string' },
    device: { type: 'string' }, start: { type: 'string' }, timeout: { type: 'string', default: '15000' },
    'second-url': { type: 'string' }, panel: { type: 'boolean' }, report: { type: 'string' },
    'confirm-isolated': { type: 'boolean' }, help: { type: 'boolean' }
} });

const usage = `node carga.mjs --url http://127.0.0.1:48437 --confirm-isolated [opciones]

--users N          Cuentas generadas (12) o primeras N cuentas del archivo
--concurrency N    Máximo de solicitudes simultáneas (12)
--rounds N         Consultas de catálogo y disponibilidad por sesión (3)
--credentials RUTA Arreglo JSON de perfiles de prueba ya creados {correo,password}
--device ID        Dispositivo estándar en inventario para probar el cruce
--start ISO        Inicio UTC explícito de una franja vacía de 10 minutos
--second-url URL   Segundo proceso loopback para verificar persistencia tras iniciar sesión de nuevo
--panel            Verifica también GET /api/panel con los préstamos propios
--timeout MS       Tiempo máximo de cada solicitud (15000)
--report RUTA      Copia opcional del informe JSON sin credenciales

Solo se admiten URL loopback. El servidor debe usar una base de pruebas aislada.
Las cuentas y los préstamos de prueba quedan en esa base. La prueba cierra las sesiones.`;

function integer(value, label, min, max) {
    assert.match(value, /^\d+$/, `${label} debe ser un entero`);
    const result = Number(value);
    assert.ok(result >= min && result <= max, `${label} debe estar entre ${min} y ${max}`);
    return result;
}

function testOrigin(value) {
    assert.ok(value && values['confirm-isolated'], 'Indica --url y --confirm-isolated para una instancia local de pruebas');
    const url = new URL(value);
    assert.ok(['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        && url.port && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash,
    'Usa una URL loopback con puerto y sin ruta, como http://127.0.0.1:48437');
    return url.origin;
}

function makeAccounts(count, runId) {
    return Array.from({ length: count }, (_, index) => {
        const code = `${runId}-${index + 1}`;
        return {
            correo: `carga-${code}@example.test`, password: `Prueba!Aa0-${randomBytes(16).toString('hex')}`,
            nombreCompleto: `Prueba de carga ${index + 1}`, tipoDocumento: 'C.C.', numeroDocumento: `QA-${code}`,
            codigoInstitucional: `QA-${code}`, facultadPrograma: 'Prueba de carga', rol: 'estudiante'
        };
    });
}

async function readAccounts(filename) {
    const records = JSON.parse(await readFile(filename, 'utf8'));
    assert.ok(Array.isArray(records) && records.length > 0, 'El archivo debe contener un arreglo de cuentas de prueba');
    const accounts = records.map(({ correo, password }) => {
        assert.ok(typeof correo === 'string' && /^[a-z\d._%+-]+@example\.test$/i.test(correo)
            && typeof password === 'string' && password.length >= 12 && password.length <= 128,
        'Cada cuenta debe usar @example.test y una contraseña ficticia de 12 a 128 caracteres');
        return { correo: correo.toLowerCase(), password };
    });
    assert.equal(new Set(accounts.map((item) => item.correo)).size, accounts.length, 'Los correos de prueba deben ser únicos');
    return accounts;
}

async function limited(items, concurrency, operation) {
    let nextIndex = 0;
    async function work() {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            await operation(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, work));
}

function percentile(sorted, percent) {
    if (!sorted.length) return null;
    return Math.round(sorted[Math.ceil(sorted.length * percent / 100) - 1] * 10) / 10;
}

async function main() {
    if (values.help) return console.log(usage);
    const origin = testOrigin(values.url);
    const verificationOrigin = values['second-url'] ? testOrigin(values['second-url']) : origin;
    const runId = randomUUID().replaceAll('-', '').slice(0, 12);
    const preseeded = values.credentials ? await readAccounts(values.credentials) : null;
    const users = integer(values.users || String(preseeded?.length || 12), '--users', 2, 1000);
    if (preseeded) assert.ok(users <= preseeded.length, 'Faltan cuentas de prueba en el archivo de credenciales');
    const concurrency = integer(values.concurrency || '12', '--concurrency', 2, 250);
    const rounds = integer(values.rounds, '--rounds', 1, 25);
    const timeout = integer(values.timeout, '--timeout', 1000, 120000);
    const accounts = preseeded?.slice(0, users) || makeAccounts(users, runId);
    const measurements = new Map();
    const violations = [];
    const phases = {};
    let peak = 0;
    let pending = 0;
    let bookingResult;
    let uniqueBookingResult;
    const freshSessions = [];
    const startTime = performance.now();

    async function call(label, route, { method = 'GET', session, body, ok = [200], target = origin } = {}) {
        const start = performance.now();
        pending += 1;
        peak = Math.max(peak, pending);
        let status = 'red';
        let data;
        let cookie;
        try {
            const response = await fetch(`${target}/api${route}`, {
                method, redirect: 'error', signal: AbortSignal.timeout(timeout),
                headers: { ...(method === 'GET' ? {} : { Origin: target }),
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                    ...(session ? { Cookie: session.cookie } : {}) },
                body: body ? JSON.stringify(body) : undefined
            });
            status = response.status;
            cookie = response.headers.getSetCookie()?.[0]?.split(';', 1)[0];
            const contentType = response.headers.get('content-type');
            if (contentType?.includes('application/json')) data = await response.json();
            else await response.arrayBuffer();
        } catch (error) {
            if (error.name === 'TimeoutError' || error.name === 'AbortError') status = 'timeout';
            else if (status !== 'red') status = 'respuesta_invalida';
        } finally {
            pending -= 1;
        }
        const measurement = { status, ms: performance.now() - start, expected: ok.includes(status) };
        if (!measurements.has(label)) measurements.set(label, []);
        measurements.get(label).push(measurement);
        return { status, data, cookie, expected: measurement.expected };
    }

    async function phase(label, task) {
        const start = performance.now();
        await task();
        phases[label] = Math.round(performance.now() - start);
    }

    function requireCondition(condition, message) {
        if (!condition && !violations.includes(message)) violations.push(message);
        return condition;
    }

    const ready = [];
    const sessions = [];
    if (preseeded) {
        ready.push(...accounts);
    } else {
        await phase('registro', () => limited(accounts, concurrency, async (account) => {
            const result = await call('registro', '/auth/registro', { method: 'POST', body: account, ok: [201, 204] });
            if (result.expected) ready.push(account);
        }));
    }
    try {
        await phase('inicioSesion', () => limited(ready, concurrency, async (account) => {
            const { correo, password } = account;
            const result = await call('inicioSesion', '/auth/sesion', { method: 'POST', body: { identificador: correo, password } });
            if (!result.expected) return;
            const valid = result.data?.correo?.toLowerCase() === correo && result.data?.id && result.cookie?.includes('=');
            if (requireCondition(valid, 'El servidor devolvió un perfil o una cookie de sesión inválidos.')) {
                sessions.push({ actorId: String(result.data.id), account, cookie: result.cookie, profile: result.data });
            }
        }));
        requireCondition(new Set(sessions.map(({ cookie }) => cookie)).size === sessions.length, 'Dos perfiles recibieron la misma cookie.');
        requireCondition(new Set(sessions.map(({ actorId }) => actorId)).size === sessions.length, 'Dos cuentas apuntan al mismo perfil.');
        requireCondition(sessions.length === users, `Solo ${sessions.length} de ${users} dispositivos pudieron iniciar sesión.`);

        if (sessions.length) {
            await phase('consultas', () => limited(sessions, concurrency, async (session) => {
                const who = await call('verificarSesion', '/auth/sesion', { session });
                requireCondition(who.expected && String(who.data?.id) === session.actorId && who.data?.correo?.toLowerCase() === session.account.correo,
                    'Una sesión cerró antes de tiempo o mostró el perfil de otra cuenta.');
                for (let round = 0; round < rounds; round += 1) {
                    const catalog = await call('catalogo', '/dispositivos', { session });
                    const availability = await call('disponibilidad', '/disponibilidad', { session });
                    requireCondition(catalog.expected && Array.isArray(catalog.data), 'Falló la lectura del catálogo.');
                    requireCondition(availability.expected && Array.isArray(availability.data), 'Falló la lectura de disponibilidad.');
                    if (round === 0) Object.assign(session, { catalog: catalog.data, availability: availability.data });
                }
            }));

            const snapshot = sessions.find((item) => Array.isArray(item.catalog) && Array.isArray(item.availability));
            const standard = snapshot?.catalog.filter((device) => !device.requiereAutorizacion && device.estado === 'Disponible'
                && Number.isInteger(device.unidades) && device.unidades > 0) || [];
            standard.sort((a, b) => a.unidades - b.unidades);
            const device = values.device ? standard.find((item) => String(item.id) === values.device) : standard[0];
            if (requireCondition(device, 'No hay un dispositivo estándar con existencias para probar.')) {
                const slot = chooseSlot(values.start, snapshot.availability, device.id);
                const overlap = (item) => String(item.dispositivoId) === String(device.id)
                    && Date.parse(item.fechaInicio) < +slot.end && Date.parse(item.fechaFin) > +slot.start;
                const contenders = Math.min(sessions.length, concurrency);
                requireCondition(contenders > device.unidades, `La primera tanda contiene ${contenders} dispositivos y las existencias son ${device.unidades}. Hace falta una tanda mayor para provocar sobrecupo.`);
                const confirmedIds = new Set();
                let rejected = 0;
                await phase('reservas', () => limited(sessions, concurrency, async (session, index) => {
                    const target = index % 2 === 0 ? origin : verificationOrigin;
                    const result = await call('crearPrestamo', '/prestamos', { method: 'POST', session, target, ok: [201, 409], body: {
                        dispositivoId: device.id, fechaInicio: slot.start.toISOString(), fechaFin: slot.end.toISOString(), motivoSolicitud: `Prueba de simultaneidad ${runId}`
                    } });
                    if (result.status === 409) {
                        rejected += 1;
                        return;
                    }
                    if (result.status !== 201) return;
                    const loan = result.data;
                    const valid = loan?.id && loan.estado === 'Confirmado' && String(loan.usuarioId) === session.actorId && overlap(loan)
                        && Date.parse(loan.fechaInicio) === +slot.start && Date.parse(loan.fechaFin) === +slot.end;
                    if (!requireCondition(valid, 'El préstamo nuevo tiene datos incorrectos.')) return;
                    requireCondition(!confirmedIds.has(String(loan.id)), 'La API devolvió un identificador de préstamo duplicado.');
                    confirmedIds.add(String(loan.id));
                    session.loanId = String(loan.id);
                }));
                const expected = Math.min(device.unidades, sessions.length);
                requireCondition(confirmedIds.size === expected && rejected === sessions.length - expected,
                    'El total de reservas confirmadas y conflictos no corresponde al cupo.');

                await phase('persistencia', () => limited(sessions, concurrency, async (session) => {
                    const result = await call('prestamosPersistidos', '/prestamos', { session });
                    if (!requireCondition(result.expected && Array.isArray(result.data), 'No se pudieron consultar los préstamos guardados.')) return;
                    requireCondition(result.data.every((loan) => String(loan.usuarioId) === session.actorId), 'Un dispositivo pudo ver préstamos de otra cuenta.');
                    const matching = result.data.filter(overlap);
                    const valid = session.loanId
                        ? matching.length === 1 && String(matching[0].id) === session.loanId && matching[0].estado === 'Confirmado'
                        : matching.length === 0;
                    requireCondition(valid, 'La reserva guardada no coincide con la respuesta recibida por el dispositivo.');
                }));
                const final = await call('verificarCupo', '/disponibilidad', { session: sessions[0] });
                const persisted = Array.isArray(final.data) ? final.data.filter(overlap).length : null;
                requireCondition(final.expected && persisted === expected, 'La disponibilidad posterior no coincide con el número de préstamos.');
                bookingResult = { dispositivo: String(device.id), existencias: device.unidades, intentos: sessions.length,
                    simultaneasEnPrimeraTanda: contenders, confirmados: confirmedIds.size, conflictos409: rejected,
                    persistidos: persisted, instancias: new Set([origin, verificationOrigin]).size,
                    desde: slot.start.toISOString(), hasta: slot.end.toISOString() };

                // Las franjas propias empiezan después de la contención y excluyen todo turno preexistente.
                const plan = individualSlots(slot.end, snapshot.availability, device.id, sessions.length);
                const ownLoanIds = new Set();
                await phase('reservasIndependientes', () => limited(sessions.map((session, index) => ({ session, interval: plan[index] })), concurrency,
                    async ({ session, interval }, index) => {
                        const target = index % 2 === 0 ? origin : verificationOrigin;
                        const result = await call('crearPrestamoIndependiente', '/prestamos', { method: 'POST', session, target, ok: [201], body: {
                            dispositivoId: device.id, fechaInicio: interval.start.toISOString(), fechaFin: interval.end.toISOString(),
                            motivoSolicitud: `Reserva individual de prueba ${runId}`
                        } });
                        if (!result.expected) return;
                        const loan = result.data;
                        if (!requireCondition(loan?.id && loan.estado === 'Confirmado' && String(loan.usuarioId) === session.actorId
                            && String(loan.dispositivoId) === String(device.id) && Date.parse(loan.fechaInicio) === +interval.start
                            && Date.parse(loan.fechaFin) === +interval.end, 'La reserva individual devolvió datos incorrectos.')) return;
                        requireCondition(!ownLoanIds.has(String(loan.id)), 'Las reservas independientes comparten un identificador.');
                        ownLoanIds.add(String(loan.id));
                        session.ownLoanId = String(loan.id);
                    }));
                requireCondition(ownLoanIds.size === users, `Se confirmaron ${ownLoanIds.size} de ${users} reservas independientes solicitadas.`);

                const persistedOwn = new Set();
                await phase('nuevaSesionPersistencia', () => limited(sessions, concurrency, async (session) => {
                    const { correo, password } = session.account;
                    const target = verificationOrigin;
                    const login = await call('nuevoInicioSesion', '/auth/sesion', { method: 'POST', target,
                        body: { identificador: correo, password } });
                    if (!login.expected) return;
                    if (!requireCondition(login.cookie?.includes('=') && login.cookie !== session.cookie && sameProfile(login.data, session.profile),
                        'La nueva sesión no devolvió una cookie distinta para el mismo perfil.')) return;
                    const fresh = { ...session, cookie: login.cookie };
                    freshSessions.push(fresh);
                    const who = await call('verificarNuevoPerfil', '/auth/sesion', { session: fresh, target });
                    requireCondition(who.expected && sameProfile(who.data, session.profile), 'La nueva sesión no recuperó los datos del perfil original.');
                    const loans = await call('verificarPrestamoIndependiente', '/prestamos', { session: fresh, target });
                    const own = (loan) => String(loan.usuarioId) === fresh.actorId;
                    const matching = (loan) => String(loan.id) === fresh.ownLoanId && loan.estado === 'Confirmado';
                    if (requireCondition(loans.expected && Array.isArray(loans.data) && loans.data.every(own),
                        'La nueva sesión no obtuvo sus préstamos o mostró información de otra cuenta.') && fresh.ownLoanId) {
                        if (requireCondition(loans.data.some(matching), 'El préstamo independiente no apareció al iniciar sesión de nuevo.')) {
                            persistedOwn.add(fresh.ownLoanId);
                        }
                    }
                    if (values.panel) {
                        const panel = await call('panel', '/panel', { session: fresh, target });
                        requireCondition(panel.expected && Array.isArray(panel.data?.devices) && panel.data.devices.some((item) => String(item.id) === String(device.id))
                            && Array.isArray(panel.data?.loans) && panel.data.loans.every(own) && (!fresh.ownLoanId || panel.data.loans.some(matching))
                            && Array.isArray(panel.data?.users) && panel.data.users.length === 0,
                        'El panel consolidado no incluyó el dispositivo de prueba y los préstamos propios.');
                    }
                }));
                requireCondition(freshSessions.length === users && new Set(freshSessions.map(({ cookie }) => cookie)).size === freshSessions.length,
                    'No se recuperó una sesión nueva y distinta por dispositivo.');
                requireCondition(persistedOwn.size === users, `Se recuperaron ${persistedOwn.size} de ${users} préstamos desde sesiones nuevas.`);
                uniqueBookingResult = { intentos: sessions.length, confirmados: ownLoanIds.size, verificados: persistedOwn.size,
                    desde: plan[0].start.toISOString(), hasta: plan.at(-1).end.toISOString() };
            }
        }
    } catch (error) {
        violations.push(error.message);
    } finally {
        await phase('cierreSesion', () => limited(sessions, concurrency, async (session) => {
            await call('cierreSesion', '/auth/sesion', { method: 'DELETE', session, ok: [204] });
            await call('sesionCerrada', '/auth/sesion', { session, ok: [401] });
        }));
        if (freshSessions.length) await phase('cierreNuevaSesion', () => limited(freshSessions, concurrency, async (session) => {
            await call('cierreNuevaSesion', '/auth/sesion', { method: 'DELETE', session, target: verificationOrigin, ok: [204] });
            await call('nuevaSesionCerrada', '/auth/sesion', { session, target: verificationOrigin, ok: [401] });
        }));
    }

    let totalErrors = 0;
    const metrics = Object.fromEntries([...measurements].map(([phaseName, rows]) => {
        const sorted = rows.map((row) => row.ms).sort((a, b) => a - b);
        const errors = rows.filter((row) => !row.expected).length;
        totalErrors += errors;
        const counts = {};
        for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1;
        return [phaseName, { solicitudes: rows.length, p50ms: percentile(sorted, 50), p95ms: percentile(sorted, 95),
            p99ms: percentile(sorted, 99), errores: errors, tasaErrorPct: Math.round(1000 * errors / rows.length) / 10, HTTP: counts }];
    }));
    const passed = totalErrors === 0 && violations.length === 0 && Boolean(bookingResult && uniqueBookingResult);
    const report = { prueba: runId, origen: origin, usuarios: users, cuentasDisponibles: ready.length, sesiones: sessions.length,
        origenVerificacion: verificationOrigin, sesionesNuevas: freshSessions.length,
        cuentasPreparadas: Boolean(preseeded), concurrenciaConfigurada: concurrency, picoSolicitudes: peak, rondasPorSesion: rounds,
        duracionMs: Math.round(performance.now() - startTime), fasesMs: phases, metricas: metrics, reserva: bookingResult,
        reservasIndependientes: uniqueBookingResult, errores: totalErrors,
        incidencias: violations, exito: passed };
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (values.report) await writeFile(values.report, json, { flag: 'wx' });
    process.stdout.write(json);
    if (!passed) process.exitCode = 1;
}

function sameProfile(current, previous) {
    return current != null && ['id', 'correo', 'nombreCompleto', 'codigoInstitucional', 'rol']
        .every((field) => current[field] === previous[field]);
}

function individualSlots(startAfter, existing, deviceId, count) {
    const occupied = existing.filter((item) => String(item.dispositivoId) === String(deviceId))
        .map((item) => ({ start: Date.parse(item.fechaInicio), end: Date.parse(item.fechaFin) }))
        .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end))
        .sort((a, b) => a.start - b.start);
    const duration = 10 * 60 * 1000;
    const slots = [];
    let start = +startAfter;
    for (const item of occupied) {
        if (item.end <= start) continue;
        while (slots.length < count && start + duration <= item.start) {
            slots.push({ start: new Date(start), end: new Date(start + duration) });
            start += duration;
        }
        if (slots.length === count) return slots;
        start = Math.max(start, item.end);
    }
    while (slots.length < count) {
        slots.push({ start: new Date(start), end: new Date(start + duration) });
        start += duration;
    }
    return slots;
}

function chooseSlot(input, intervals, deviceId) {
    let start = input ? new Date(input) : new Date(Date.now() + 2 * 86400000);
    if (input) assert.match(input, /T.+(?:Z|[+-]\d\d:\d\d)$/, '--start debe incluir zona horaria');
    assert.ok(Number.isFinite(+start) && +start > Date.now(), '--start debe ser una fecha futura válida');
    start.setUTCMilliseconds(0);
    for (let attempt = 0; attempt < (input ? 1 : 48); attempt += 1) {
        const end = new Date(+start + 10 * 60 * 1000);
        const busy = intervals.some((item) => String(item.dispositivoId) === String(deviceId)
            && Date.parse(item.fechaInicio) < +end && Date.parse(item.fechaFin) > +start);
        if (!busy) return { start, end };
        start = new Date(+start + 3600000);
    }
    throw new Error('El dispositivo tiene una reserva preexistente en la franja elegida.');
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
