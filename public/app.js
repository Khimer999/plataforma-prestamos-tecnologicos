"use strict";

const MAX_HORAS_PRESTAMO = 72; // Fecha límite prudente: máximo 72 horas (3 días)

const INITIAL_DEVICES = [
    {
        id: "dev_PC-001",
        codigoUnidad: "PC-001",
        categoria: "Computador",
        modelo: "Portátil Lenovo ThinkPad i5",
        sede: "Sede Principal",
        requiereAutorizacion: false,
        estado: "Disponible"
    },
    {
        id: "dev_PC-002",
        codigoUnidad: "PC-002",
        categoria: "Computador",
        modelo: "Portátil HP ProBook i5",
        sede: "Sede Principal",
        requiereAutorizacion: false,
        estado: "Disponible"
    },
    {
        id: "dev_PC-003",
        codigoUnidad: "PC-003",
        categoria: "Computador",
        modelo: "Workstation Dell i9 Diseño/Render",
        sede: "Sede Norte",
        requiereAutorizacion: true,
        estado: "Disponible"
    },
    {
        id: "dev_TAB-001",
        codigoUnidad: "TAB-001",
        categoria: "Tablet",
        modelo: "iPad 10ª Gen 64GB",
        sede: "Sede Principal",
        requiereAutorizacion: false,
        estado: "Disponible"
    },
    {
        id: "dev_TAB-002",
        codigoUnidad: "TAB-002",
        categoria: "Tablet",
        modelo: "Samsung Galaxy Tab S9",
        sede: "Sede Norte",
        requiereAutorizacion: false,
        estado: "Disponible"
    },
    {
        id: "dev_CAM-001",
        codigoUnidad: "CAM-001",
        categoria: "Cámara",
        modelo: "Cámara Canon EOS R50 Profesional",
        sede: "Sede Principal",
        requiereAutorizacion: true,
        estado: "Disponible"
    },
    {
        id: "dev_CAM-002",
        codigoUnidad: "CAM-002",
        categoria: "Cámara",
        modelo: "Cámara Sony Alpha a6400 + Trípode",
        sede: "Sede Norte",
        requiereAutorizacion: true,
        estado: "Disponible"
    }
];

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

const DEMO_KEY = "prestamos-dispositivos-demo-v1";
const DEMO_ADMIN = {
    id: "demo-administrador",
    username: "Administrador de prueba",
    nombreCompleto: "Administrador de prueba",
    rol: "admin"
};

function createDemoRepository() {
    let temporaryData = { users: [], loans: [] };
    const read = () => {
        try {
            const raw = sessionStorage.getItem(DEMO_KEY);
            if (raw) {
                const data = JSON.parse(raw);
                if (Array.isArray(data.users) && Array.isArray(data.loans)) return data;
            }
        } catch {
            // La demo también funciona cuando el navegador bloquea el almacenamiento.
        }
        return temporaryData;
    };
    const write = (data) => {
        temporaryData = data;
        try {
            sessionStorage.setItem(DEMO_KEY, JSON.stringify(data));
        } catch {
            // Los cambios continúan disponibles mientras la página siga abierta.
        }
    };
    const profile = ({ hash, salt, ...publicFields }) => publicFields;

    async function passwordHash(password, salt) {
        if (!globalThis.crypto?.subtle) {
            throw new Error("Abre el archivo en un navegador moderno o sírvelo desde localhost para registrar cuentas de prueba.");
        }
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
        const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: Uint8Array.from(salt), iterations: 600000, hash: "SHA-256" }, key, 256);
        return Array.from(new Uint8Array(bits), (value) => value.toString(16).padStart(2, "0")).join("");
    }

    return {
        demo: true,
        currentSession: async () => null,
        loginDemo: async () => DEMO_ADMIN,
        logout: async () => {},
        async login(identificador, password) {
            const user = read().users.find((item) => item.correo === identificador);
            if (!user || await passwordHash(password, user.salt) !== user.hash) {
                throw new Error("Verifica el correo o usuario y la contraseña.");
            }
            return profile(user);
        },
        async register({ password, ...fields }) {
            if (!globalThis.crypto?.subtle) {
                throw new Error("Abre el archivo en un navegador moderno o sírvelo desde localhost para registrar cuentas de prueba.");
            }
            const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)));
            const hash = await passwordHash(password, salt);
            const data = read();
            if (data.users.some((user) => user.correo === fields.correo)) {
                throw new Error("Ya existe una cuenta registrada con ese correo.");
            }
            if (data.users.some((user) => user.numeroDocumento.toLowerCase() === fields.numeroDocumento.toLowerCase())) {
                throw new Error("Ya existe una cuenta con ese número de documento.");
            }
            data.users.push({ ...fields, hash, salt, id: crypto.randomUUID(), creadoEn: new Date().toISOString() });
            write(data);
        },
        async panel(actor) {
            const { users, loans } = read();
            const admin = actor.rol === "admin";
            const availability = loans.filter((loan) => loan.estado === "Confirmado" && new Date(loan.fechaFin) > new Date())
                .map(({ dispositivoId, fechaInicio, fechaFin }) => ({ dispositivoId, fechaInicio, fechaFin }));
            return {
                devices: INITIAL_DEVICES,
                users: admin ? [DEMO_ADMIN, ...users.map(profile)] : [],
                loans: admin ? loans : loans.filter((item) => item.usuarioId === actor.id),
                availability
            };
        },
        async createLoan(input, actor) {
            const data = read();
            const device = INITIAL_DEVICES.find((item) => item.id === input.dispositivoId);
            if (device?.estado !== "Disponible") throw new Error("El equipo seleccionado ya no está disponible.");
            const user = data.users.find((item) => item.id === (actor.rol === "admin" ? input.usuarioId : actor.id));
            if (!user) throw new Error("Selecciona un estudiante o profesor registrado.");
            const dates = validateLoanDates(input.fechaInicio, input.fechaFin);
            if (!dates.valid) throw new Error(dates.error);
            const conflict = findScheduleConflict(data.loans, device.id, input.fechaInicio, input.fechaFin);
            if (conflict) throw new Error(conflictDescription(conflict));

            const direct = actor.rol === "admin";
            const pending = !direct && device.requiereAutorizacion;
            const loan = {
                ...input,
                id: crypto.randomUUID(),
                usuarioId: user.id,
                creadoPorId: actor.id,
                creadoEn: new Date().toISOString(),
                estado: pending ? "Pendiente" : "Confirmado",
                observacionAdmin: pending ? "En espera de revisión." : direct ? "Confirmado por el administrador." : "Confirmado automáticamente por disponibilidad."
            };
            data.loans.unshift(loan);
            write(data);
            return loan;
        },
        async decideLoan(id, { estado, observacionAdmin }, actor) {
            if (actor.rol !== "admin") throw new Error("La decisión requiere una cuenta de administrador.");
            const data = read();
            const loan = data.loans.find((item) => item.id === id);
            if (loan?.estado !== "Pendiente") throw new Error("La solicitud ya fue procesada o no existe.");
            if (estado === "Confirmado") {
                const dates = validateLoanDates(loan.fechaInicio, loan.fechaFin);
                if (!dates.valid) throw new Error(dates.error);
                const device = INITIAL_DEVICES.find((item) => item.id === loan.dispositivoId);
                if (device?.estado !== "Disponible") throw new Error("El equipo ya no está disponible.");
                const conflict = findScheduleConflict(data.loans, loan.dispositivoId, loan.fechaInicio, loan.fechaFin);
                if (conflict) throw new Error(conflictDescription(conflict));
            } else if (estado !== "Rechazado" || !observacionAdmin) {
                throw new Error("Escribe el motivo del rechazo.");
            }
            const updated = Object.assign(loan, { estado, observacionAdmin });
            write(data);
            return updated;
        }
    };
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
        if (!response.ok) throw new Error(payload?.message || `El servicio no pudo completar la operación (${response.status}).`);
        if (payload === null && path !== "/auth/registro") throw new Error("El servicio devolvió una respuesta no válida.");
        return payload;
    }

    return {
        demo: false,
        currentSession: () => request("/auth/sesion", "GET", undefined, true),
        login: (identificador, password) => request("/auth/sesion", "POST", { identificador, password }),
        logout: () => request("/auth/sesion", "DELETE", undefined, true),
        register: (fields) => request("/auth/registro", "POST", fields),
        async panel(actor) {
            const admin = actor.rol === "admin";
            const [devices, loans, availability, users] = await Promise.all([
                request("/dispositivos"), request("/prestamos"),
                admin ? [] : request("/disponibilidad"), admin ? request("/usuarios") : []
            ]);
            return { devices, loans, availability, users };
        },
        createLoan: (input) => request("/prestamos", "POST", input),
        decideLoan: (id, updates) => request(`/prestamos/${encodeURIComponent(id)}`, "PATCH", updates)
    };
}

function createRepository() {
    const basePath = document.querySelector('meta[name="prestamos-api"]').content.trim();
    if (!basePath) return createDemoRepository();
    if (!/^\/[\w-]+(?:\/[\w-]+)*\/?$/.test(basePath)) {
        throw new Error("La ruta de la API debe ser relativa al mismo sitio, por ejemplo /api.");
    }
    return createApiRepository(basePath.replace(/\/$/, ""));
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

/**
 * Comprueba si un préstamo CONFIRMADO se superpone con el rango solicitado.
 * Permite franjas consecutivas exactas (nuevoInicio === existenteFin o nuevoFin === existenteInicio).
 */
function findScheduleConflict(loansList, deviceId, newStartStr, newEndStr, ignoreLoanId = null) {
    const newStart = new Date(newStartStr).getTime();
    const newEnd = new Date(newEndStr).getTime();

    return loansList.find((loan) => {
        if (loan.id === ignoreLoanId) return false;
        if (loan.dispositivoId !== deviceId) return false;
        if (loan.estado !== "Confirmado") return false;

        const existingStart = new Date(loan.fechaInicio).getTime();
        const existingEnd = new Date(loan.fechaFin).getTime();

        return newStart < existingEnd && newEnd > existingStart;
    }) || null;
}

function conflictDescription(conflict) {
    return `El equipo tiene una reserva confirmada del ${formatDateReadable(conflict.fechaInicio)} al ${formatDateReadable(conflict.fechaFin)}. Elige otro horario o equipo.`;
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

    // Catálogo con filtro por categoría
    renderCategoryFilters(availableDevices);
    const filteredDevices = state.userCategoryFilter === "Todos"
        ? availableDevices
        : availableDevices.filter((d) => d.categoria === state.userCategoryFilter);

    const nowMs = Date.now();
    const catalogTbody = document.getElementById("user-catalog-tbody");

    if (filteredDevices.length === 0) {
        catalogTbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-6 px-4 text-center text-slate-500">
                    No hay dispositivos disponibles en esta categoría.
                </td>
            </tr>
        `;
    } else {
        catalogTbody.innerHTML = filteredDevices.map((d) => {
            const activeConfirmed = state.availability
                .filter((loan) => loan.dispositivoId === d.id && new Date(loan.fechaFin).getTime() > nowMs)
                .sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));

            const occupiedHtml = activeConfirmed.length > 0
                ? activeConfirmed.map((r) => `
                    <div class="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded mb-1">
                        ${escapeHtml(formatDateReadable(r.fechaInicio))} → ${escapeHtml(formatDateReadable(r.fechaFin))}
                    </div>
                `).join("")
                : `<span class="text-xs text-emerald-700 font-medium">Sin reservas confirmadas</span>`;

            const approvalTag = d.requiereAutorizacion
                ? `<span class="inline-block px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-100 text-amber-800">Requiere autorización</span>`
                : `<span class="inline-block px-2 py-0.5 rounded-md text-xs font-semibold bg-sky-100 text-poli-azul">Automática</span>`;

            return `
                <tr class="hover:bg-slate-50 transition">
                    <td class="py-3 px-4 font-bold text-poli-azul whitespace-nowrap">${escapeHtml(d.codigoUnidad)}</td>
                    <td class="py-3 px-4 whitespace-nowrap">${escapeHtml(d.categoria)}</td>
                    <td class="py-3 px-4">${escapeHtml(d.modelo)}${Number.isInteger(d.unidades) ? `<div class="text-xs text-slate-500">${d.unidades} ${d.unidades === 1 ? "unidad" : "unidades"} en inventario</div>` : ""}</td>
                    <td class="py-3 px-4 whitespace-nowrap text-slate-600">${escapeHtml(d.sede)}</td>
                    <td class="py-3 px-4 whitespace-nowrap">${approvalTag}</td>
                    <td class="py-3 px-4 min-w-[210px]">${occupiedHtml}</td>
                    <td class="py-3 px-4 text-right whitespace-nowrap">
                        <button
                            type="button"
                            data-select-device="${escapeHtml(d.id)}"
                            class="btn-quick-select px-3 py-1.5 rounded-lg bg-poli-cian hover:bg-poli-cianHover text-white text-xs font-semibold transition cursor-pointer"
                        >
                            Solicitar
                        </button>
                    </td>
                </tr>
            `;
        }).join("");
    }

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
let repository;
let busy = false;

async function runAction(control, action) {
    if (busy) return;
    busy = true;
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
    Object.assign(state, await repository.panel(user));
    state.currentUser = user;
    switchView(user.rol === "admin" ? "admin" : "user");
}

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

el("btn-demo-admin").addEventListener("click", (event) => {
    void runAction(event.currentTarget, async () => {
        await showPanel(await repository.loginDemo());
        el("form-login").reset();
    });
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
bindFilter("admin-status-filters", ".status-filter-btn", "status", "adminStatusFilter");

for (const [id, view] of [["link-go-register", "register"], ["link-go-login", "login"], ["link-go-login-top", "login"]]) {
    el(id).addEventListener("click", () => {
        if (busy) return;
        clearNotifications();
        switchView(view);
        el(view === "register" ? "reg-nombre" : "login-identificador").focus();
    });
}

el("btn-logout").addEventListener("click", (event) => {
    void runAction(event.currentTarget, async () => {
        await repository.logout();
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
        showNotification("Sesión cerrada.", "info");
    });
});

async function start() {
    try {
        repository = createRepository();
        el("demo-access").classList.toggle("hidden", !repository.demo);
        el("demo-register-note").classList.toggle("hidden", !repository.demo);
        el("db-status-badge").textContent = repository.demo ? "Modo de prueba local" : "Conexión mediante API";
        const user = await repository.currentSession();
        if (user) await showPanel(user);
        else switchView("login");
    } catch (error) {
        switchView("login");
        if (!repository) el("form-login").querySelector('button[type="submit"]').disabled = true;
        showNotification(error.message, "error");
    } finally {
        el("loading-view").classList.add("hidden");
        el("app-main").classList.remove("hidden");
    }
}

void start();
