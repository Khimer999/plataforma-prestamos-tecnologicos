export class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

export function requireText(value, label, max, { optional = false } = {}) {
    if (value == null && optional) return '';
    if (typeof value !== 'string') throw new ApiError(400, `El campo ${label} no es válido.`);
    const text = value.trim();
    if ((!text && !optional) || text.length > max) {
        throw new ApiError(400, `Verifica el campo ${label}. El máximo es de ${max} caracteres.`);
    }
    return text;
}

export function requireId(value, label) {
    if (!['number', 'string'].includes(typeof value) || !/^[1-9]\d{0,9}$/.test(String(value)) || Number(value) > 2147483647) {
        throw new ApiError(400, `Selecciona ${label} válido.`);
    }
    return Number(value);
}

export function requirePassword(value, minimum = 12) {
    if (typeof value !== 'string' || value.length < minimum || value.length > 128) {
        throw new ApiError(400, `La contraseña debe tener entre ${minimum} y 128 caracteres.`);
    }
    return value;
}

function parseDate(value) {
    if (typeof value !== 'string') throw new ApiError(400, 'Ingresa fechas válidas con zona horaria explícita.');
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(value);
    if (!match) throw new ApiError(400, 'Ingresa fechas válidas con zona horaria explícita.');
    const [, year, month, day, hour, minute, second = '0'] = match;
    const date = new Date(value);
    const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
    if (!Number.isFinite(date.getTime()) || calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() + 1 !== Number(month)
        || calendar.getUTCDate() !== Number(day) || calendar.getUTCHours() !== Number(hour) || calendar.getUTCMinutes() !== Number(minute)
        || calendar.getUTCSeconds() !== Number(second) || date.getUTCFullYear() > 9999) {
        throw new ApiError(400, 'Ingresa fechas válidas con zona horaria explícita.');
    }
    return date;
}

export function validatePeriod(start, end, now = Date.now()) {
    const from = start instanceof Date ? start : parseDate(start);
    const to = end instanceof Date ? end : parseDate(end);
    if (!Number.isFinite(+from) || !Number.isFinite(+to)) throw new ApiError(400, 'Ingresa fechas válidas para el préstamo.');
    if (from.getTime() < now - 120_000) throw new ApiError(400, 'La fecha de inicio ya pasó.');
    if (to <= from) throw new ApiError(400, 'La entrega debe ser posterior al inicio.');
    if (to - from > 72 * 60 * 60 * 1000) throw new ApiError(400, 'El préstamo puede durar hasta 72 horas.');
    return [from, to];
}

export function hasCapacity({ start, end, reservations, stock }) {
    if (stock < 1) return false;
    const events = [];
    for (const row of reservations) {
        const from = Math.max(+row.fechaInicio, +start);
        const to = Math.min(+row.fechaFin, +end);
        if (from < to) events.push([from, 1], [to, -1]);
    }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let count = 0;
    for (const [, change] of events) {
        count += change;
        if (count >= stock) return false;
    }
    return true;
}
