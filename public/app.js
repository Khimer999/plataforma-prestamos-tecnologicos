"use strict";

const MAX_HORAS_PRESTAMO = 72; // Fecha límite prudente: máximo 72 horas (3 días)

const state = {
    currentUser: null,
    activeView: "login",
    users: [],
    devices: [],
    loans: [],
    availability: [],
    userCategoryFilter: "Todos",
    adminStatusFilter: "Todos"
};

function evaluatePasswordStrength(password) {
    const rules = {
        length: password.length >= 12 && password.length <= 128,
        upper: /[A-Z]/.test(password),
        number: /[0-9]/.test(password),
        special: /[!@#$%^&*._\-?¿¡]/.test(password)
    };

    const missing = [];
    if (!rules.length) missing.push("entre 12 y 128 caracteres");
    if (!rules.upper) missing.push("al menos 1 letra mayúscula (A-Z)");
    if (!rules.number) missing.push("al menos 1 número (0-9)");
    if (!rules.special) missing.push("al menos 1 carácter especial (!@#$%^&*._-?¿¡)");

    return {
        rules,
        missing,
        isValid: missing.length === 0
    };
}

/**
 * Actualiza los indicadores visuales (verde cumplido / rojo faltante) en tiempo real.
 */
function updatePasswordChecklistUI() {
    const password = document.getElementById("reg-password").value;
    const confirmPassword = document.getElementById("reg-password-confirm").value;
    const { rules } = evaluatePasswordStrength(password);

    const mappings = [
        { id: "rule-length", ok: rules.length },
        { id: "rule-upper", ok: rules.upper },
        { id: "rule-number", ok: rules.number },
        { id: "rule-special", ok: rules.special }
    ];

    mappings.forEach(({ id, ok }) => {
        const el = document.getElementById(id);
        if (!el) return;
        const icon = el.querySelector(".rule-icon");
        if (ok) {
            el.className = "flex items-center gap-2 font-semibold text-emerald-700";
            if (icon) icon.textContent = "✓";
        } else {
            el.className = "flex items-center gap-2 font-medium text-red-600";
            if (icon) icon.textContent = "✗";
        }
    });

    const matchEl = document.getElementById("rule-match-feedback");
    if (!confirmPassword) {
        matchEl.classList.add("hidden");
    } else if (password === confirmPassword) {
        matchEl.className = "text-xs font-semibold pt-1.5 border-t border-slate-100 text-emerald-700";
        matchEl.textContent = "✓ Las contraseñas coinciden.";
    } else {
        matchEl.className = "text-xs font-semibold pt-1.5 border-t border-slate-100 text-red-600";
        matchEl.textContent = "✗ Las contraseñas aún no coinciden.";
    }
}

/**
 * Escapa caracteres HTML para evitar inyección de código.
 */
function escapeHtml(text) {
    if (text === null || text === undefined) return "";
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Convierte Date a formato YYYY-MM-DDTHH:MM para inputs datetime-local.
 */
const bogotaInputFormatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

function toDatetimeLocalValue(date) {
    return bogotaInputFormatter.format(date).replace(" ", "T");
}

/**
 * Formatea fecha ISO a texto legible en español.
 */
function formatDateReadable(isoStr) {
    if (!isoStr) return "-";
    const dt = new Date(isoStr);
    if (Number.isNaN(dt.getTime())) return isoStr;
    return dt.toLocaleString("es-CO", {
        timeZone: "America/Bogota",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    });
}

/**
 * Muestra notificaciones dentro de la interfaz (sin alert()).
 */
function showNotification(message, type = "info") {
    const container = document.getElementById("notification-container");
    const styles = {
        success: "bg-emerald-50 border-emerald-500 text-emerald-900",
        error: "bg-red-50 border-red-500 text-red-900",
        info: "bg-sky-50 border-poli-cian text-poli-azul"
    };

    const box = document.createElement("div");
    box.className = `flex items-start justify-between gap-3 px-4 py-3 rounded-lg border-l-4 shadow-sm text-sm font-medium ${styles[type] || styles.info}`;
    box.innerHTML = `
        <span>${escapeHtml(message)}</span>
        <button type="button" class="text-current opacity-70 hover:opacity-100 font-bold leading-none px-1 cursor-pointer" aria-label="Cerrar">&times;</button>
    `;

    box.querySelector("button").addEventListener("click", () => box.remove());
    container.prepend(box);

    setTimeout(() => {
        if (box.parentNode) box.remove();
    }, 8000);
}

function clearNotifications() {
    document.getElementById("notification-container").innerHTML = "";
}

function createApiRepository(basePath) {
    async function request(path, method = "GET", body, allowNoSession = false) {
        let response;
        try {
            response = await fetch(`${basePath}${path}`, {
                method,
                credentials: "same-origin",
                cache: "no-store",
                headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
                body: body === undefined ? undefined : JSON.stringify(body)
            });
        } catch {
            throw new Error("No se pudo acceder al servicio de préstamos. Revisa la conexión e inténtalo de nuevo.");
        }
        if (allowNoSession && response.status === 401) return null;
        if (response.status === 204) return null;
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            const error = new Error(payload?.message || `El servicio no pudo completar la operación (${response.status}).`);
            error.status = response.status;
            throw error;
        }
        if (payload === null && path !== "/auth/registro") throw new Error("El servicio devolvió una respuesta no válida.");
        return payload;
    }

    return {
        currentSession: () => request("/auth/sesion", "GET", undefined, true),
        login: (identificador, password) => request("/auth/sesion", "POST", { identificador, password }),
        logout: () => request("/auth/sesion", "DELETE", undefined, true),
        register: (fields) => request("/auth/registro", "POST", fields),
        panel: () => request("/panel"),
        updates: () => typeof EventSource === "function" ? new EventSource(`${basePath}/eventos`) : null,
        createLoan: (input) => request("/prestamos", "POST", input),
        decideLoan: (id, updates) => request(`/prestamos/${encodeURIComponent(id)}`, "PATCH", updates)
    };
}

function validateLoanDates(startStr, endStr) {
    if (!startStr || !endStr) {
        return { valid: false, error: "Debes ingresar tanto la fecha de inicio como la fecha límite de entrega." };
    }

    const startDate = new Date(startStr);
    const endDate = new Date(endStr);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        return { valid: false, error: "El formato de las fechas seleccionadas no es válido." };
    }

    const minAllowed = new Date(Date.now() - 2 * 60 * 1000);
    if (startDate < minAllowed) {
        return { valid: false, error: "La fecha y hora de inicio no pueden estar en el pasado." };
    }

    if (endDate <= startDate) {
        return { valid: false, error: "La fecha límite de entrega debe ser posterior a la fecha de inicio." };
    }

    const diffHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
    if (diffHours > MAX_HORAS_PRESTAMO) {
        return {
            valid: false,
            error: `La duración supera el plazo máximo permitido de ${MAX_HORAS_PRESTAMO} horas (3 días). Ajusta la fecha límite de entrega.`
        };
    }

    return { valid: true, startMs: startDate.getTime(), endMs: endDate.getTime() };
}

function getDeviceById(id) {
    return state.devices.find((d) => d.id === id) || null;
}

function getUserById(id) {
    return state.users.find((u) => u.id === id) || null;
}

function setDefaultDateInputs(startInputId, endInputId) {
    const startEl = document.getElementById(startInputId);
    const endEl = document.getElementById(endInputId);
    if (!startEl || !endEl) return;

    const now = new Date();
    const minStr = toDatetimeLocalValue(now);
    startEl.min = minStr;
    endEl.min = minStr;

    if (!startEl.value || startEl.value < minStr) {
        const suggestedStart = new Date(now.getTime() + 15 * 60 * 1000);
        suggestedStart.setSeconds(0, 0);
        const suggestedEnd = new Date(suggestedStart.getTime() + 2 * 60 * 60 * 1000);
        startEl.value = toDatetimeLocalValue(suggestedStart);
        endEl.value = toDatetimeLocalValue(suggestedEnd);
    }
}

// =========================================================================
// 6. NAVEGACIÓN Y RENDERIZADO DE VISTAS
// =========================================================================

function switchView(viewName) {
    state.activeView = viewName;
    document.body.dataset.view = viewName;
    window.scrollTo(0, 0);

    ["view-login", "view-register", "view-user", "view-admin"].forEach((id) => {
        document.getElementById(id).classList.add("hidden");
    });

    const targetId = {
        login: "view-login",
        register: "view-register",
        user: "view-user",
        admin: "view-admin"
    }[viewName];

    if (targetId) {
        document.getElementById(targetId).classList.remove("hidden");
    }

    const headerTitle = document.getElementById("header-title");
    const headerSubtitle = document.getElementById("header-subtitle");
    const userControls = document.getElementById("header-user-controls");

    if (state.currentUser) {
        userControls.classList.remove("hidden");
        document.getElementById("nav-user-name").textContent = state.currentUser.nombreCompleto;
        document.getElementById("nav-user-detail").textContent =
            state.currentUser.rol === "admin"
                ? state.currentUser.username
                : [state.currentUser.correo || state.currentUser.username, state.currentUser.codigoInstitucional && `Cód. ${state.currentUser.codigoInstitucional}`].filter(Boolean).join(" · ");

        const roleLabels = {
            admin: "Administrador",
            estudiante: "Estudiante",
            profesor: "Profesor",
            auxiliar: "Auxiliar"
        };
        document.getElementById("nav-user-role").textContent =
            roleLabels[state.currentUser.rol] || state.currentUser.rol;

        if (state.currentUser.rol === "admin") {
            headerTitle.textContent = "Panel de Administración de Préstamos";
            headerSubtitle.textContent = "Control de solicitudes, aprobaciones, usuarios y reservas";
        } else {
            headerTitle.textContent = "Panel de Préstamos";
            headerSubtitle.textContent = "Consulta de catálogo y gestión de solicitudes";
        }
    } else {
        userControls.classList.add("hidden");
        headerTitle.textContent = "Préstamos tecnológicos";
        headerSubtitle.textContent = "Gestión de computadores, cámaras y tablets";
    }

    if (viewName === "register") {
        updatePasswordChecklistUI();
    }

    renderActiveView();
}

function renderActiveView() {
    if (state.activeView === "user" && state.currentUser) {
        renderUserPanel();
    } else if (state.activeView === "admin" && state.currentUser && state.currentUser.rol === "admin") {
        renderAdminPanel();
    }
}

function renderStatusBadge(status) {
    const map = {
        Confirmado: "bg-emerald-100 text-emerald-800 border border-emerald-300",
        Pendiente: "bg-amber-100 text-amber-800 border border-amber-300",
        Rechazado: "bg-red-100 text-red-800 border border-red-300"
    };
    const cls = map[status] || "bg-slate-100 text-slate-700";
    return `<span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${cls}">${escapeHtml(status)}</span>`;
}

/**
 * Renderiza el panel de Estudiante / Profesor.
 */
function renderCategoryFilters(devices) {
    const container = document.getElementById("user-category-filters");
    const categories = [...new Set(devices.map((item) => item.categoria))].sort((a, b) => a.localeCompare(b, "es"));
    if (!categories.includes(state.userCategoryFilter)) state.userCategoryFilter = "Todos";
    const labels = ["Todos", ...categories.filter((label) => label !== "Todos")];
    if (container.dataset.categories === JSON.stringify(labels)) return;
    container.dataset.categories = JSON.stringify(labels);
    container.replaceChildren(...labels.map((label) => {
        const button = document.createElement("button");
        const active = label === state.userCategoryFilter;
        button.type = "button";
        button.dataset.cat = label;
        button.setAttribute("aria-pressed", String(active));
        button.className = "cat-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer " +
            (active ? "bg-poli-azul text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200");
        button.textContent = label;
        return button;
    }));
}

function freeUnitsForInterval(stock, intervals, start, end) {
    const events = [];
    for (const interval of intervals) {
        const from = Math.max(start, Date.parse(interval.fechaInicio));
        const until = Math.min(end, Date.parse(interval.fechaFin));
        if (from < until) events.push([from, 1], [until, -1]);
    }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let occupied = 0;
    let peak = 0;
    for (const [, change] of events) {
        occupied += change;
        peak = Math.max(peak, occupied);
    }
    return Math.max(0, stock - peak);
}

function renderUserCatalog() {
    const siteSelect = document.getElementById("user-catalog-site");
    const selectedSite = siteSelect.value;
    const sites = [...new Set(state.devices.map((device) => device.sede).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    if (siteSelect.dataset.sites !== JSON.stringify(sites)) {
        siteSelect.dataset.sites = JSON.stringify(sites);
        siteSelect.replaceChildren(new Option("Todas las sedes", ""), ...sites.map((site) => new Option(site, site)));
        siteSelect.value = sites.includes(selectedSite) ? selectedSite : "";
    }
    const selectedStart = document.getElementById("user-loan-start").value;
    const selectedEnd = document.getElementById("user-loan-end").value;
    const start = Date.parse(`${selectedStart}-05:00`);
    const end = Date.parse(`${selectedEnd}-05:00`);
    const validInterval = Number.isFinite(start) && end > start;
    const availableOnly = document.getElementById("user-catalog-available");
    availableOnly.disabled = !validInterval;
    document.getElementById("user-catalog-period").textContent = validInterval
        ? `Franja en hora de Bogotá: ${formatDateReadable(`${selectedStart}-05:00`)} → ${formatDateReadable(`${selectedEnd}-05:00`)}`
        : "Selecciona un inicio y una fecha límite de entrega válidos en el formulario.";

    renderCategoryFilters(state.devices);
    const matchingDevices = state.devices.filter((device) => (!siteSelect.value || device.sede === siteSelect.value)
        && (state.userCategoryFilter === "Todos" || device.categoria === state.userCategoryFilter));
    const now = Date.now();
    const intervalsByDevice = new Map();
    for (const reservation of state.availability) {
        if (Date.parse(reservation.fechaFin) <= now) continue;
        const key = String(reservation.dispositivoId);
        if (!intervalsByDevice.has(key)) intervalsByDevice.set(key, []);
        intervalsByDevice.get(key).push(reservation);
    }

    const rows = matchingDevices.map((device) => {
        const active = device.estado === "Disponible";
        const stock = Number.isInteger(device.unidades) ? Math.max(0, device.unidades) : (active ? 1 : 0);
        const reservations = intervalsByDevice.get(String(device.id)) || [];
        const free = active && validInterval ? freeUnitsForInterval(stock, reservations, start, end) : 0;
        const canRequest = active && stock > 0 && (!validInterval || free > 0);
        if (availableOnly.checked && validInterval && !canRequest) return "";

        const reservationsHtml = reservations.length
            ? [...reservations].sort((a, b) => Date.parse(a.fechaInicio) - Date.parse(b.fechaInicio)).map((reservation) => `
                <div class="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded mb-1">
                    ${escapeHtml(formatDateReadable(reservation.fechaInicio))} → ${escapeHtml(formatDateReadable(reservation.fechaFin))}
                </div>
            `).join("")
            : `<span class="text-xs text-slate-500">Sin reservas confirmadas</span>`;
        let availabilityLabel = "Fuera de servicio";
        let availabilityClass = "text-red-600";
        if (stock === 0) {
            availabilityLabel = "Sin existencias";
        } else if (active && !validInterval) {
            availabilityLabel = "Disponible para solicitar";
            availabilityClass = "text-emerald-700";
        } else if (active && free === 0) {
            availabilityLabel = "Ocupado en la franja elegida";
            availabilityClass = "text-amber-800";
        } else if (active) {
            availabilityLabel = `${free} ${free === 1 ? "unidad libre" : "unidades libres"} de ${stock}`;
            availabilityClass = "text-emerald-700";
        }
        const approval = device.requiereAutorizacion
            ? `<span class="inline-block px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-100 text-amber-800">Requiere autorización</span>`
            : `<span class="inline-block px-2 py-0.5 rounded-md text-xs font-semibold bg-sky-100 text-poli-azul">Automática</span>`;
        const action = canRequest
            ? `<button type="button" data-select-device="${escapeHtml(device.id)}"
                class="btn-quick-select px-3 py-1.5 rounded-lg bg-poli-cian hover:bg-poli-cianHover text-white text-xs font-semibold transition cursor-pointer">Solicitar</button>`
            : `<span class="text-xs text-slate-500">No disponible</span>`;

        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="py-3 px-4 font-bold text-poli-azul whitespace-nowrap">${escapeHtml(device.codigoUnidad)}</td>
                <td class="py-3 px-4 whitespace-nowrap">${escapeHtml(device.categoria)}</td>
                <td class="py-3 px-4">${escapeHtml(device.modelo)}<div class="text-xs text-slate-500">${stock} ${stock === 1 ? "unidad" : "unidades"} en inventario</div></td>
                <td class="py-3 px-4 whitespace-nowrap text-slate-600">${escapeHtml(device.sede)}</td>
                <td class="py-3 px-4 whitespace-nowrap">${approval}</td>
                <td class="py-3 px-4 min-w-[210px]"><p class="text-xs font-semibold mb-1 ${availabilityClass}">${availabilityLabel}</p>${reservationsHtml}</td>
                <td class="py-3 px-4 text-right whitespace-nowrap">${action}</td>
            </tr>
        `;
    }).join("");

    document.getElementById("user-catalog-tbody").innerHTML = rows || `
        <tr><td colspan="7" class="py-6 px-4 text-center text-slate-500">No hay dispositivos que coincidan con los filtros.</td></tr>
    `;
}

function renderUserPanel() {
    const selectDevice = document.getElementById("user-loan-device");
    const currentSelected = selectDevice.value;

    const availableDevices = state.devices.filter((d) => d.estado === "Disponible");
    selectDevice.innerHTML = `<option value="">Selecciona un dispositivo...</option>` +
        availableDevices.map((d) => {
            const authTxt = d.requiereAutorizacion ? "Requiere autorización" : "Aprobación automática";
            return `<option value="${escapeHtml(d.id)}">[${escapeHtml(d.codigoUnidad)}] ${escapeHtml(d.categoria)} - ${escapeHtml(d.modelo)} (${escapeHtml(d.sede)}) · ${authTxt}</option>`;
        }).join("");

    if (currentSelected) {
        selectDevice.value = currentSelected;
    }

    setDefaultDateInputs("user-loan-start", "user-loan-end");

    renderUserCatalog();

    // Únicamente los préstamos del usuario autenticado
    const myLoans = state.loans.filter((l) => l.usuarioId === state.currentUser.id);
    document.getElementById("user-loans-count").textContent = `${myLoans.length} ${myLoans.length === 1 ? "registro" : "registros"}`;

    const myLoansTbody = document.getElementById("user-loans-tbody");
    if (myLoans.length === 0) {
        myLoansTbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-6 px-4 text-center text-slate-500">
                    Aún no has realizado solicitudes ni préstamos.
                </td>
            </tr>
        `;
    } else {
        myLoansTbody.innerHTML = myLoans.map((loan) => {
            const dev = getDeviceById(loan.dispositivoId);
            const devCode = dev ? dev.codigoUnidad : (loan.dispositivoCodigo || "N/A");
            const devLabel = dev ? `${dev.categoria} - ${dev.modelo}` : (loan.dispositivoModelo || "");
            const devSede = dev ? dev.sede : (loan.dispositivoSede || "-");

            return `
                <tr class="hover:bg-slate-50 transition">
                    <td class="py-3 px-4">
                        <div class="font-bold text-poli-azul">${escapeHtml(devCode)}</div>
                        <div class="text-xs text-slate-500">${escapeHtml(devLabel)}</div>
                    </td>
                    <td class="py-3 px-4 whitespace-nowrap text-slate-600">${escapeHtml(devSede)}</td>
                    <td class="py-3 px-4 whitespace-nowrap text-xs">${escapeHtml(formatDateReadable(loan.fechaInicio))}</td>
                    <td class="py-3 px-4 whitespace-nowrap text-xs font-bold text-poli-azul">${escapeHtml(formatDateReadable(loan.fechaFin))}</td>
                    <td class="py-3 px-4 text-xs text-slate-700 max-w-xs">${escapeHtml(loan.motivoSolicitud || "-")}</td>
                    <td class="py-3 px-4 whitespace-nowrap">${renderStatusBadge(loan.estado)}</td>
                    <td class="py-3 px-4 text-xs text-slate-600 max-w-xs">${escapeHtml(loan.observacionAdmin || "-")}</td>
                </tr>
            `;
        }).join("");
    }
}

/**
 * Renderiza el panel del Administrador (protegido tras autenticación).
 */
function renderAdminPanel() {
    const pendingLoans = state.loans.filter((l) => l.estado === "Pendiente");
    const confirmedLoans = state.loans.filter((l) => l.estado === "Confirmado");
    const academicUsers = state.users
        .filter((u) => u.rol === "estudiante" || u.rol === "profesor")
        .sort((a, b) => (b.creadoEn || "").localeCompare(a.creadoEn || ""));

    // Métricas rápidas
    document.getElementById("stat-pending").textContent = pendingLoans.length;
    document.getElementById("stat-confirmed").textContent = confirmedLoans.length;
    document.getElementById("stat-total-loans").textContent = state.loans.length;
    document.getElementById("stat-users").textContent = academicUsers.length;

    // Aviso interno solo dentro del panel de administrador cuando aún no existen estudiantes/profesores
    const noStudentsNote = document.getElementById("admin-no-students-note");
    if (academicUsers.length === 0) {
        noStudentsNote.classList.remove("hidden");
    } else {
        noStudentsNote.classList.add("hidden");
    }

    // 1. Tabla de solicitudes pendientes
    const pendingTbody = document.getElementById("admin-pending-tbody");
    if (pendingLoans.length === 0) {
        pendingTbody.innerHTML = `
            <tr>
                <td colspan="6" class="py-6 px-4 text-center text-slate-500">
                    No hay solicitudes pendientes de autorización en este momento.
                </td>
            </tr>
        `;
    } else {
        pendingTbody.innerHTML = pendingLoans.map((loan) => {
            const usr = getUserById(loan.usuarioId);
            const dev = getDeviceById(loan.dispositivoId);
            const uName = usr ? usr.nombreCompleto : (loan.solicitanteNombre || "Usuario");
            const uRole = usr ? usr.rol : (loan.solicitanteRol || "-");
            const uCode = usr ? usr.codigoInstitucional : (loan.solicitanteCodigo || "-");
            const uEmail = usr ? (usr.correo || usr.username) : (loan.solicitanteCorreo || "-");
            const dCode = dev ? dev.codigoUnidad : (loan.dispositivoCodigo || "N/A");
            const dModel = dev ? `${dev.categoria} - ${dev.modelo}` : (loan.dispositivoModelo || "");
            const dSede = dev ? dev.sede : (loan.dispositivoSede || "");

            return `
                <tr class="hover:bg-slate-50 transition">
                    <td class="py-3 px-4">
                        <div class="font-bold text-poli-azul">${escapeHtml(uName)}</div>
                        <div class="text-xs text-slate-600 capitalize">${escapeHtml(uRole)} · Cód. ${escapeHtml(uCode)}</div>
                        <div class="text-xs text-slate-500">${escapeHtml(uEmail)}</div>
                    </td>
                    <td class="py-3 px-4">
                        <div class="font-bold text-poli-azul">${escapeHtml(dCode)}</div>
                        <div class="text-xs text-slate-600">${escapeHtml(dModel)}</div>
                        <div class="text-xs text-slate-400">${escapeHtml(dSede)}</div>
                    </td>
                    <td class="py-3 px-4 whitespace-nowrap text-xs">${escapeHtml(formatDateReadable(loan.fechaInicio))}</td>
                    <td class="py-3 px-4 whitespace-nowrap text-xs font-bold text-poli-azul">${escapeHtml(formatDateReadable(loan.fechaFin))}</td>
                    <td class="py-3 px-4 text-xs text-slate-700 max-w-xs">${escapeHtml(loan.motivoSolicitud || "-")}</td>
                    <td class="py-3 px-4">
                        <div class="space-y-2">
                            <input
                                type="text"
                                id="obs-${escapeHtml(loan.id)}"
                                placeholder="Observación (obligatoria al rechazar)"
                                class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-poli-cian"
                            >
                            <div class="flex gap-2">
                                <button
                                    type="button"
                                    data-action="aceptar"
                                    data-loan-id="${escapeHtml(loan.id)}"
                                    class="btn-admin-decide flex-1 py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition cursor-pointer"
                                >
                                    Aceptar
                                </button>
                                <button
                                    type="button"
                                    data-action="rechazar"
                                    data-loan-id="${escapeHtml(loan.id)}"
                                    class="btn-admin-decide flex-1 py-1.5 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition cursor-pointer"
                                >
                                    Rechazar
                                </button>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        }).join("");
    }

    // 2. Selectores del formulario de préstamo directo
    const userSelect = document.getElementById("admin-loan-user");
    const prevUserVal = userSelect.value;
    const sortedUsers = [...academicUsers].sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto));
    userSelect.innerHTML = sortedUsers.map((u) => {
        const roleLabel = u.rol === "profesor" ? "Profesor" : "Estudiante";
        return `<option value="${escapeHtml(u.id)}">${escapeHtml(u.nombreCompleto)} (${roleLabel} · ${escapeHtml(u.codigoInstitucional)})</option>`;
    }).join("");
    if (prevUserVal && sortedUsers.some((u) => u.id === prevUserVal)) {
        userSelect.value = prevUserVal;
    }

    const devSelect = document.getElementById("admin-loan-device");
    const prevDevVal = devSelect.value;
    const availDevices = state.devices.filter((d) => d.estado === "Disponible");
    devSelect.innerHTML = availDevices.map((d) =>
        `<option value="${escapeHtml(d.id)}">[${escapeHtml(d.codigoUnidad)}] ${escapeHtml(d.categoria)} - ${escapeHtml(d.modelo)} (${escapeHtml(d.sede)})</option>`
    ).join("");
    if (prevDevVal && availDevices.some((d) => d.id === prevDevVal)) {
        devSelect.value = prevDevVal;
    }

    setDefaultDateInputs("admin-loan-start", "admin-loan-end");

    // 3. Tabla completa de todos los préstamos
    const filteredLoans = state.adminStatusFilter === "Todos"
        ? state.loans
        : state.loans.filter((l) => l.estado === state.adminStatusFilter);

    const allLoansTbody = document.getElementById("admin-all-loans-tbody");
    if (filteredLoans.length === 0) {
        allLoansTbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-6 px-4 text-center text-slate-500">
                    No hay préstamos registrados para el filtro seleccionado.
                </td>
            </tr>
        `;
    } else {
        allLoansTbody.innerHTML = filteredLoans.map((loan) => {
            const usr = getUserById(loan.usuarioId);
            const dev = getDeviceById(loan.dispositivoId);

            const uName = usr ? usr.nombreCompleto : (loan.solicitanteNombre || "Usuario");
            const uEmail = usr ? (usr.correo || usr.username) : (loan.solicitanteCorreo || "-");
            const uRole = usr ? usr.rol : (loan.solicitanteRol || "-");
            const uDoc = usr ? `${usr.tipoDocumento} ${usr.numeroDocumento}` : (loan.solicitanteDocumento || "-");
            const uCode = usr ? usr.codigoInstitucional : (loan.solicitanteCodigo || "-");
            const uProg = usr ? usr.facultadPrograma : (loan.solicitantePrograma || "-");

            const dCode = dev ? dev.codigoUnidad : (loan.dispositivoCodigo || "N/A");
            const dModel = dev ? `${dev.categoria} - ${dev.modelo}` : (loan.dispositivoModelo || "");
            const dSede = dev ? dev.sede : (loan.dispositivoSede || "");

            return `
                <tr class="hover:bg-slate-50 transition">
                    <td class="py-3 px-4">
                        <div class="font-bold text-poli-azul">${escapeHtml(uName)}</div>
                        <div class="text-xs text-slate-500">${escapeHtml(uEmail)}</div>
                    </td>
                    <td class="py-3 px-4 text-xs text-slate-600 space-y-0.5">
                        <div><span class="font-semibold capitalize">${escapeHtml(uRole)}</span> · Cód: ${escapeHtml(uCode)}</div>
                        <div>Doc: ${escapeHtml(uDoc)}</div>
                        <div>${escapeHtml(uProg)}</div>
                    </td>
                    <td class="py-3 px-4">
                        <div class="font-bold text-poli-azul">${escapeHtml(dCode)}</div>
                        <div class="text-xs text-slate-600">${escapeHtml(dModel)}</div>
                        <div class="text-xs text-slate-400">${escapeHtml(dSede)}</div>
                    </td>
                    <td class="py-3 px-4 whitespace-nowrap text-xs">${escapeHtml(formatDateReadable(loan.fechaInicio))}</td>
                    <td class="py-3 px-4 whitespace-nowrap text-xs font-bold text-poli-azul">${escapeHtml(formatDateReadable(loan.fechaFin))}</td>
                    <td class="py-3 px-4 whitespace-nowrap">${renderStatusBadge(loan.estado)}</td>
                    <td class="py-3 px-4 text-xs text-slate-600 max-w-xs">
                        <div>${escapeHtml(loan.observacionAdmin || "-")}</div>
                        ${loan.motivoSolicitud ? `<div class="text-slate-400 mt-0.5">Motivo: ${escapeHtml(loan.motivoSolicitud)}</div>` : ""}
                    </td>
                </tr>
            `;
        }).join("");
    }

    // 4. Tabla de usuarios registrados (Estudiantes y Profesores)
    const adminCount = state.users.filter((u) => u.rol === "admin").length;
    document.getElementById("admin-users-badge").textContent =
        `${academicUsers.length} ${academicUsers.length === 1 ? "estudiante/profesor" : "estudiantes/profesores"} · ${adminCount} administrador`;

    const usersTbody = document.getElementById("admin-users-tbody");
    if (academicUsers.length === 0) {
        usersTbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-8 px-4 text-center text-slate-500">
                    Aún no se han registrado estudiantes ni profesores
                </td>
            </tr>
        `;
    } else {
        usersTbody.innerHTML = academicUsers.map((u) => {
            const roleBadge = u.rol === "profesor"
                ? `<span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-sky-100 text-poli-azul">Profesor</span>`
                : `<span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900">Estudiante</span>`;

            return `
                <tr class="hover:bg-slate-50 transition">
                    <td class="py-3 px-4 font-bold text-poli-azul">${escapeHtml(u.nombreCompleto)}</td>
                    <td class="py-3 px-4 whitespace-nowrap">${roleBadge}</td>
                    <td class="py-3 px-4 whitespace-nowrap text-xs text-slate-600">${escapeHtml(u.tipoDocumento)} ${escapeHtml(u.numeroDocumento)}</td>
                    <td class="py-3 px-4 whitespace-nowrap text-xs font-medium text-slate-700">${escapeHtml(u.codigoInstitucional)}</td>
                    <td class="py-3 px-4 text-xs text-slate-600">${escapeHtml(u.facultadPrograma)}</td>
                    <td class="py-3 px-4 text-xs text-slate-700">${escapeHtml(u.correo)}</td>
                    <td class="py-3 px-4 whitespace-nowrap text-xs text-slate-500">${escapeHtml(formatDateReadable(u.creadoEn))}</td>
                </tr>
            `;
        }).join("");
    }
}

const el = (id) => document.getElementById(id);
const value = (id) => el(id).value;
const repository = createApiRepository("/api");
let busy = false;
let panelGeneration = 0;
let refreshing = false;
let refreshTimer;
let offlinePoll;
let eventStream;

async function runAction(control, action) {
    if (busy) return;
    busy = true;
    panelGeneration += 1;
    control.disabled = true;
    clearNotifications();
    try {
        await action();
    } catch (error) {
        showNotification(error.message || "No se pudo completar la operación. Intenta nuevamente.", "error");
    } finally {
        control.disabled = false;
        busy = false;
    }
}

function onSubmit(id, action) {
    el(id).addEventListener("submit", (event) => {
        event.preventDefault();
        void runAction(event.currentTarget.querySelector('button[type="submit"]'), action);
    });
}

async function showPanel(user) {
    Object.assign(state, await repository.panel());
    state.currentUser = user;
    switchView(user.rol === "admin" ? "admin" : "user");
    startUpdates();
}

function queuePanelRefresh(delay = 150 + Math.floor(Math.random() * 650)) {
    if (!state.currentUser || document.hidden || refreshTimer !== undefined) return;
    refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void refreshPanel();
    }, delay);
}

async function refreshPanel() {
    const user = state.currentUser;
    if (!user || document.hidden) return;
    if (busy || refreshing || document.activeElement?.id.startsWith("obs-")) {
        queuePanelRefresh(600);
        return;
    }
    const generation = panelGeneration;
    refreshing = true;
    try {
        const snapshot = await repository.panel();
        if (user !== state.currentUser) return;
        if (generation !== panelGeneration || busy || document.activeElement?.id.startsWith("obs-")) {
            queuePanelRefresh(600);
            return;
        }
        const notes = [...el("admin-pending-tbody").querySelectorAll('[id^="obs-"]')].map(({ id, value }) => [id, value]);
        Object.assign(state, snapshot);
        renderActiveView();
        for (const [id, note] of notes) {
            if (el(id)) el(id).value = note;
        }
        el("db-status-badge").textContent = "Conexión mediante API";
    } catch (error) {
        if (user !== state.currentUser || generation !== panelGeneration) return;
        if (error.status === 401) clearSession("La sesión venció. Ingresa de nuevo.");
        else el("db-status-badge").textContent = "Reconectando al servidor";
    } finally {
        refreshing = false;
    }
}

function stopUpdates() {
    eventStream?.close();
    eventStream = null;
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
    clearInterval(offlinePoll);
}

function startUpdates() {
    stopUpdates();
    let version;
    eventStream = repository.updates();
    eventStream?.addEventListener("cambio", (event) => {
        if (event.data === version) return;
        version = event.data;
        queuePanelRefresh();
    });
    offlinePoll = setInterval(() => {
        if (!eventStream || eventStream.readyState !== 1) queuePanelRefresh();
    }, 12_000);
}

document.addEventListener("visibilitychange", () => queuePanelRefresh(0));

function applySavedLoan(loan) {
    state.loans = [loan, ...state.loans.filter((item) => item.id !== loan.id)]
        .sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn));
    renderActiveView();
}

onSubmit("form-login", async () => {
    const identificador = value("login-identificador").trim().toLowerCase();
    if (!identificador) throw new Error("Escribe tu correo o nombre de usuario.");
    const user = await repository.login(identificador, value("login-password"));
    await showPanel(user);
    el("form-login").reset();
    showNotification(`Bienvenido(a), ${user.nombreCompleto}.`, "success");
});

el("reg-password").addEventListener("input", updatePasswordChecklistUI);
el("reg-password-confirm").addEventListener("input", updatePasswordChecklistUI);

onSubmit("form-register", async () => {
    const fields = {
        nombreCompleto: value("reg-nombre").trim(),
        tipoDocumento: value("reg-tipo-doc"),
        numeroDocumento: value("reg-num-doc").trim(),
        codigoInstitucional: value("reg-codigo").trim(),
        facultadPrograma: value("reg-programa").trim(),
        rol: value("reg-rol"),
        correo: value("reg-correo").trim().toLowerCase(),
        password: value("reg-password")
    };
    const correoConfirm = value("reg-correo-confirm").trim().toLowerCase();
    const passwordConfirm = value("reg-password-confirm");
    if (Object.values(fields).some((field) => !field) || !correoConfirm || !passwordConfirm) {
        throw new Error("Completa todos los campos obligatorios.");
    }
    if (!["estudiante", "profesor"].includes(fields.rol)) throw new Error("Selecciona Estudiante o Profesor.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.correo)) {
        el("reg-correo").focus();
        throw new Error("Ingresa un correo institucional válido.");
    }
    if (fields.correo !== correoConfirm) {
        el("reg-correo-confirm").focus();
        throw new Error("Los correos ingresados no coinciden.");
    }
    const strength = evaluatePasswordStrength(fields.password);
    if (!strength.isValid) {
        el("reg-password").focus();
        throw new Error(`La contraseña debe incluir ${strength.missing.join(", ")}.`);
    }
    if (fields.password !== passwordConfirm) {
        el("reg-password-confirm").focus();
        throw new Error("Las contraseñas ingresadas no coinciden.");
    }
    await repository.register(fields);
    el("form-register").reset();
    switchView("login");
    el("login-identificador").value = fields.correo;
    el("login-password").focus();
    showNotification("Cuenta creada. Ya puedes iniciar sesión.", "success");
});

async function submitLoan(kind) {
    const actor = state.currentUser;
    if (!actor || (kind === "admin") !== (actor.rol === "admin")) return;
    const prefix = `${kind}-loan`;
    const start = value(`${prefix}-start`);
    const end = value(`${prefix}-end`);
    const dispositivoId = value(`${prefix}-device`);
    if (!dispositivoId) throw new Error("Selecciona un dispositivo.");
    if (!start || !end) throw new Error("Ingresa la fecha de inicio y la fecha límite de entrega.");
    const fechaInicio = `${start}-05:00`;
    const fechaFin = `${end}-05:00`;
    const dates = validateLoanDates(fechaInicio, fechaFin);
    if (!dates.valid) throw new Error(dates.error);
    const motivoSolicitud = value(`${prefix}-reason`).trim();
    if (!motivoSolicitud) throw new Error("Escribe el motivo del préstamo.");
    const fields = { dispositivoId, fechaInicio, fechaFin, motivoSolicitud };
    if (kind === "admin") {
        fields.usuarioId = value("admin-loan-user");
        if (!fields.usuarioId) throw new Error("Selecciona al usuario solicitante.");
    }

    const loan = await repository.createLoan(fields, actor);
    if (kind === "user" && loan.estado === "Confirmado") {
        state.availability.push({ dispositivoId, fechaInicio: loan.fechaInicio, fechaFin: loan.fechaFin });
    }
    applySavedLoan(loan);
    el(`${prefix}-reason`).value = "";
    const code = getDeviceById(dispositivoId)?.codigoUnidad || "el equipo";
    if (loan.estado === "Pendiente") {
        showNotification(`Solicitud registrada para ${code}. Queda pendiente de autorización.`, "info");
    } else {
        showNotification(`Préstamo confirmado para ${code}. Entrega límite ${formatDateReadable(loan.fechaFin)}.`, "success");
    }
}

onSubmit("form-user-loan", () => submitLoan("user"));
onSubmit("form-admin-loan", () => submitLoan("admin"));

el("admin-pending-tbody").addEventListener("click", (event) => {
    const button = event.target.closest(".btn-admin-decide");
    if (!button || state.currentUser?.rol !== "admin") return;
    void runAction(button, async () => {
        const approved = button.dataset.action === "aceptar";
        const input = el(`obs-${button.dataset.loanId}`);
        const note = input.value.trim();
        if (!approved && !note) {
            input.focus();
            throw new Error("Escribe una observación para rechazar la solicitud.");
        }
        const loan = await repository.decideLoan(button.dataset.loanId, {
            estado: approved ? "Confirmado" : "Rechazado",
            observacionAdmin: note || "Aprobado por el administrador."
        }, state.currentUser);
        applySavedLoan(loan);
        showNotification(approved ? "Solicitud aprobada y confirmada." : "Solicitud rechazada con el motivo registrado.", approved ? "success" : "info");
    });
});

el("user-catalog-tbody").addEventListener("click", (event) => {
    const button = event.target.closest(".btn-quick-select");
    if (!button) return;
    const select = el("user-loan-device");
    select.value = button.dataset.selectDevice;
    select.dispatchEvent(new Event("change"));
    select.focus({ preventScroll: true });
    el("user-form-card").scrollIntoView({ block: "start" });
});

el("user-loan-device").addEventListener("change", (event) => {
    const device = getDeviceById(event.target.value);
    el("user-loan-hint").textContent = !device
        ? "Selecciona un dispositivo y las fechas deseadas para validar disponibilidad."
        : device.requiereAutorizacion
            ? `${device.codigoUnidad} requiere aprobación del administrador.`
            : `${device.codigoUnidad} se confirma de inmediato si hay una unidad disponible en la franja.`;
});

function bindFilter(id, selector, dataKey, stateKey) {
    el(id).addEventListener("click", (event) => {
        const button = event.target.closest(selector);
        if (!button) return;
        state[stateKey] = button.dataset[dataKey];
        el(id).querySelectorAll(selector).forEach((item) => {
            const active = item === button;
            item.setAttribute("aria-pressed", String(active));
            item.classList.toggle("bg-poli-azul", active);
            item.classList.toggle("text-white", active);
            item.classList.toggle("bg-slate-100", !active);
            item.classList.toggle("text-slate-700", !active);
            item.classList.toggle("hover:bg-slate-200", !active);
        });
        renderActiveView();
    });
}

bindFilter("user-category-filters", ".cat-filter-btn", "cat", "userCategoryFilter");
for (const id of ["user-catalog-site", "user-catalog-available", "user-loan-start", "user-loan-end"]) {
    document.getElementById(id).addEventListener("change", renderUserCatalog);
}
bindFilter("admin-status-filters", ".status-filter-btn", "status", "adminStatusFilter");

for (const [id, view] of [["link-go-register", "register"], ["link-go-login", "login"], ["link-go-login-top", "login"]]) {
    el(id).addEventListener("click", () => {
        if (busy) return;
        clearNotifications();
        switchView(view);
        el(view === "register" ? "reg-nombre" : "login-identificador").focus();
    });
}

function clearSession(message) {
    stopUpdates();
    state.currentUser = null;
    Object.assign(state, { devices: [], users: [], loans: [], availability: [] });
    el("form-user-loan").reset();
    el("form-admin-loan").reset();
    el("user-loan-device").dispatchEvent(new Event("change"));
    for (const id of ["user-loans-tbody", "user-catalog-tbody", "admin-pending-tbody", "admin-users-tbody", "admin-all-loans-tbody"]) {
        el(id).replaceChildren();
    }
    switchView("login");
    el("login-identificador").focus();
    showNotification(message, "info");
}

el("btn-logout").addEventListener("click", (event) => {
    void runAction(event.currentTarget, async () => {
        await repository.logout();
        clearSession("Sesión cerrada.");
    });
});

function launchMessage(message, retry = false) {
    el("loading-spinner").classList.add("hidden");
    el("loading-status").textContent = message;
    el("btn-retry-launch").classList.toggle("hidden", !retry);
}

el("btn-retry-launch").addEventListener("click", () => window.location.reload());

async function start() {
    if (!["http:", "https:"].includes(window.location.protocol)) {
        launchMessage("Abre la dirección web de la plataforma para iniciar sesión y guardar datos en MariaDB.");
        el("db-status-badge").textContent = "Acceso desde el servidor";
        return;
    }
    try {
        const user = await repository.currentSession();
        if (user) await showPanel(user);
        else switchView("login");
        el("db-status-badge").textContent = "Conexión mediante API";
        el("loading-view").classList.add("hidden");
        el("app-main").classList.remove("hidden");
    } catch {
        launchMessage("La conexión al servidor está pendiente. Verifica la dirección de la plataforma e inténtalo de nuevo.", true);
        el("db-status-badge").textContent = "Conexión pendiente";
    }
}

void start();
