let projects = [];
let editingTask = { project: -1, row: -1, task: -1 }; // Almacena qué tarea se está editando en el modal
let draggingTask = null;
let draggingProject = null;
let resizingTask = null; // { projectIndex, rowIndex, taskIndex, handle: 'left' | 'right' }
let ghostTask = null; // Copia de la tarea que se está redimensionando
let lastMousePosition = { x: 0, y: 0 }; // Rastrear la posición del ratón

let tempModalTasks = []; // Almacena temporalmente las tareas del modal de proyecto
let editingProjectId = null; // Para saber si estamos creando o editando un proyecto
let history = [];
let historyIndex = -1;
const MAX_HISTORY = 50;

let canvas, ctx;
let lastStartMonth = null; // Para detectar el cambio en el mes de inicio
let animationProgress = 1; // Animation disabled, always render fully
let lastTime = 0;
const animationDuration = 0;
let taskHitboxes = [];
let projectHitboxes = [];
let addTaskHitboxes = []; // Hitboxes para los botones de 'Añadir Tarea'
// ES: Layout cacheado de cada proyecto en el último render para que la lógica
// de drag use exactamente las mismas coordenadas que se dibujaron en pantalla.
// EN: Cached project layout from the last render so drag logic uses the exact
// same coordinates that were painted on screen.
let projectLayouts = []; // [{ startY, innerH, topPad, rowTops, rowHeights, totalTasksH }]
let isDrawingForExport = false; // Flag para el dibujado de exportación
let exportRightPadding = 0; // Píxeles extra a la derecha en exportación para que las etiquetas de hitos no se corten
const resizeHandleWidth = 15; // Ancho del área de redimensión

// Constantes del layout de cabecera de proyecto (compartidas por draw, init y exportación)
// Project header layout constants (shared by draw, init and export paths)
const PROJ_HEADER_TOP_PAD = 14;
const PROJ_HEADER_BOTTOM_PAD = 14;
const PROJ_HEADER_LINE_HEIGHT = 20;
const PROJ_HEADER_NAME_BTN_GAP = 12;
const PROJ_HEADER_BTN_HEIGHT = 26;
const PROJ_HEADER_BTN_WIDTH = 130;
const PROJ_HEADER_BOTTOM_MARGIN = 10; // pequeño aire bajo el último proyecto

// Calcula la altura interna de un proyecto reproduciendo el layout real de drawProjects.
// Si includeButton es true se reserva espacio para el botón "+ Añadir tarea" (no en exportación).
// Computes a project's inner height matching drawProjects' real layout.
function computeProjectInnerHeight(project, includeButton) {
    ctx.save();
    ctx.font = projectFont;
    const maxNameW = projectLabelWidth - 30;
    const lines = wrapText(ctx, project.name, maxNameW);
    ctx.restore();
    const nameH = lines.length * PROJ_HEADER_LINE_HEIGHT;
    const headerH = PROJ_HEADER_TOP_PAD + nameH +
        (includeButton ? PROJ_HEADER_NAME_BTN_GAP + PROJ_HEADER_BTN_HEIGHT : 0) +
        PROJ_HEADER_BOTTOM_PAD;
    let tasksH = 0;
    project.tasksByRow.forEach(row => { tasksH += getRowHeight(row); });
    const tasksBlockH = tasksH > 0 ? PROJ_HEADER_TOP_PAD + tasksH + PROJ_HEADER_BOTTOM_PAD : 0;
    return Math.max(headerH, tasksBlockH);
}

const colorPalette = ['#6C8EBF', '#9B7EB8', '#D4915E', '#6BAF7B', '#C4A95B', '#5BA8A0', '#7EA3C9', '#B07DA5', '#C4956E', '#8BB5A2'];
let nextColorIndex = 0;

let months = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
let totalWeeks = 26; // Se calcula dinámicamente

// ES: Modo de vista. 'week' = cabecera Mes/Semana (columnas = semanas).
//     'day' = cabecera Semana/Día (columnas = días, granularidad 1/7 de semana).
// EN: View mode. 'week' = Month/Week header (columns = weeks).
//     'day' = Week/Day header (columns = days, 1/7-week granularity).
let viewMode = 'week';

// Tope de semanas visibles en modo Semana/Día (paralelo al tope de 12 meses).
// Max number of weeks shown in Week/Day mode (mirrors the 12-month cap).
const MAX_DAYVIEW_WEEKS = 12;

// Último lunes de inicio (ISO) en modo día, para desplazar tareas al cambiarlo.
let lastStartWeekISO = null;

// Indica si el rango de semanas ya se fijó (por sincronización o por carga de un
// estado en modo día). Si no, al entrar en modo día se deriva del rango de meses.
let weekRangeSet = false;

function setViewMode(mode) {
    viewMode = (mode === 'day') ? 'day' : 'week';
    const sel = document.getElementById('view-mode');
    if (sel) sel.value = viewMode;

    // Alternar entre selectores de mes (modo semana) y de semana (modo día).
    const sm = document.getElementById('start-month');
    const em = document.getElementById('end-month');
    const sw = document.getElementById('start-week');
    const ew = document.getElementById('end-week');
    if (sm && em && sw && ew) {
        const isDay = viewMode === 'day';
        sm.style.display = isDay ? 'none' : '';
        em.style.display = isDay ? 'none' : '';
        sw.style.display = isDay ? '' : 'none';
        ew.style.display = isDay ? '' : 'none';
        // Al entrar en modo día sin rango fijado, derivar del rango de meses.
        if (isDay && !weekRangeSet) syncWeekSelectorsFromMonths();
    }
}

// ES: Ajusta un valor en semanas a la rejilla del modo actual: semanas enteras
//     en modo 'week', o múltiplos de 1/7 (días) en modo 'day'.
// EN: Snaps a week-valued position to the current mode's grid: whole weeks in
//     'week' mode, or 1/7 (day) increments in 'day' mode.
function snapWeeks(weeksValue) {
    if (viewMode === 'day') return Math.round(weeksValue * 7) / 7;
    return Math.round(weeksValue);
}

// Duración mínima de una tarea al redimensionar, según el modo.
// Minimum task duration while resizing, depending on the mode.
function minDurationWeeks() {
    return viewMode === 'day' ? 1 / 7 : 0.5;
}

const rowHeight = 35;
const compactRowHeight = 22;
const headerHeight = 70;
const projectLabelWidth = 200;
let gridColor = '#444';
let textColor = '#E0E0E0';
let canvasHeaderBg = '#252526';
let canvasBodyBg = '#1E1E1E';
let canvasSidebarBg = '#252526';
let canvasMutedText = '#999';
let canvasHighlightBg = 'rgba(255, 255, 255, 0.08)';
let canvasMonthOverlay = 'rgba(255, 255, 255, 0.05)';
let todayColTint = 'rgba(255, 193, 7, 0.07)';
let todayColBorder = 'rgba(255, 193, 7, 0.35)';
let todayBadgeBg = 'rgba(255, 193, 7, 0.28)';
let todayBadgeText = '#FFC107';
let todayWeekNumColor = '#FFD54F';
let currentTheme = 'claro';
const gridFont = "12px Poppins";
const projectFont = "bold 16px Poppins";
const taskFont = "14px Poppins";
const projectIconSize = 18;
const projectIconPadding = 20;
const compactTaskFont = "11px Poppins";

function getRowHeight(row) {
    if (!row || row.length === 0) return rowHeight;
    return row.every(t => t.compact) ? compactRowHeight : rowHeight;
}

function wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = words[0] || '';
    for (let i = 1; i < words.length; i++) {
        const testLine = currentLine + ' ' + words[i];
        if (ctx.measureText(testLine).width > maxWidth) {
            lines.push(currentLine);
            currentLine = words[i];
        } else {
            currentLine = testLine;
        }
    }
    lines.push(currentLine);
    return lines;
}

const translations = {
    es: {
        newBtn: "Nuevo", saveBtn: "Guardar", copyBtn: "Imagen", excelBtn: "Exportar",
        undoBtn: "Deshacer", redoBtn: "Rehacer", scheduleLabel: "Cronograma:",
        schedulePlaceholder: "Título del Cronograma", startLabel: "Inicio:",
        endLabel: "Fin:", themeLabel: "Tema:", langLabel: "Idioma:",
        viewLabel: "Vista:", viewMonthWeek: "Mes / Semana", viewWeekDay: "Semana / Día",
        weekdayInitials: ["L", "M", "X", "J", "V", "S", "D"],
        themeDark: "Oscuro", themeLight: "Claro", themeModern: "Moderno", themeGray: "Gris",
        addProjectBtn: "Añadir Proyecto", pasteExcelBtn: "Excel", loadBtn: "Cargar", loadBtnTitle: "Cargar Cronograma",
        pasteInstructions: "Pega aquí tu tabla desde Excel (Proyecto en Columna A, Tarea en Columna B).",
        editTaskTitle: "Editar Tarea", taskNameLabel: "Tarea:", taskDescriptionLabel: "Descripción:",
        taskDescriptionPlaceholder: "Notas para acordarte de cosas…", taskStartLabel: "Semana Inicio:",
        taskDurationLabel: "Duración (semanas):", taskTypeLabel: "Tipo:",
        taskTypeNormal: "Normal", taskTypeMilestone: "Hito", taskTextPositionLabel: "Posición Texto:",
        taskTextInside: "Dentro", taskTextOutside: "Fuera", taskStyleLabel: "Estilo:",
        styleBarOutside: "Barra con texto fuera", styleBarInside: "Barra con texto dentro", styleMilestoneOutside: "Hito con texto fuera",
        compactLabel: "Compacta", compactProjectLabel: "Compacto",
        taskColorLabel: "Color Tarea:",
        deleteTaskBtn: "Eliminar Tarea", completeBtn: "Completada", uncompleteBtn: "Descompletar",
        editProjectTitle: "Editar Proyecto", projectNameLabel: "Nombre:",
        projectColorLabel: "Color:", deleteProjectBtn: "Eliminar Proyecto",
        months: ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"],
        weekPrefix: "S", newProjectDefault: "Nuevo Proyecto", newTaskDefault: "Nueva Tarea",
        copying: "Copiando...", copied: "✅ Imagen copiada al portapapeles",
        confirmDeleteProject: "¿Estás seguro de que deseas eliminar este proyecto y todas sus tareas?",
        confirmDeleteTask: "¿Estás seguro de que deseas eliminar esta tarea?",
        confirmImport: "Se han detectado {0} tareas para importar. ¿Quieres añadirlas al cronograma actual?\n\nLas tareas existentes no se eliminarán.",
        newScheduleConfirm: "¿Estás seguro de crear un nuevo cronograma? Se perderán los datos no guardados.",
        exportFilename: "Cronograma.xlsx",
        newScheduleTitle: "Nuevo Cronograma", saveScheduleTitle: "Guardar Cronograma",
        copyImageTitle: "Copiar como Imagen", exportExcelTitle: "Exportar a Excel",
        undoTitle: "Deshacer (Ctrl+Z)", redoTitle: "Rehacer (Ctrl+Y)", resetColorTitle: "Restaurar color del proyecto",
        resetProjectColorTitle: "Restaurar color predeterminado del proyecto",
        copyColorTitle: "Copiar color",
        pasteColorTitle: "Pegar color",
        pasteColorNoneTitle: "No hay color copiado",
        colorCopied: "Color copiado",
        addTaskAction: "+ Añadir tarea", weekTooltipTo: " al ", acceptBtn: "Aceptar",
        todayLabel: "HOY",
        confirmChangeColor: "Esto cambiará el color de todas las tareas del proyecto. ¿Deseas continuar?",
        shareBtn: "Compartir", shareBtnTitle: "Compartir enlace", sharePopupTitle: "Compartir enlace",
        shareGenerating: "Generando enlace…",
        shareFallbackHint: "Sin conexión: enlace local (largo). Vuelve a intentarlo para obtener un enlace corto.",
        sidebarToggleTitle: "Mostrar/Ocultar panel",
        sidebarSignedOutHint: "Guarda tus cronogramas en la nube y accede desde cualquier dispositivo.",
        sidebarSignedOutListHint: "Inicia sesión para ver tus cronogramas guardados.",
        sidebarEmpty: "Aún no tienes cronogramas guardados.",
        searchPlaceholder: "Buscar…",
        cloudListTitle: "Mis Cronogramas",
        cloudNewCategory: "Nueva categoría",
        cloudUncategorized: "Sin categoría",
        cloudPromptNewCategory: "Nombre de la nueva categoría:",
        cloudPromptRenameCategory: "Nuevo nombre para la categoría:",
        cloudConfirmDeleteCategory: '¿Eliminar la categoría "{0}"? Los cronogramas que contiene quedarán sin categoría.',
        cloudRenameCategoryTitle: "Renombrar categoría",
        cloudDeleteCategoryTitle: "Eliminar categoría",
        cloudSignInGoogle: "Continuar con Google",
        cloudSignOut: "Cerrar sesión",
        cloudLoadTitle: "Cargar este cronograma",
        cloudSyncPending: "Editando…",
        cloudSyncSaving: "Guardando…",
        cloudSyncSaved: "Guardado",
        cloudSyncError: "Error al guardar",
        cloudDeleteBtn: "Eliminar",
        cloudMarkCompletedTitle: "Marcar como completado",
        cloudMarkInProgressTitle: "Mover a En proceso",
        cloudConfirmDelete: '¿Eliminar el cronograma "{0}" de la nube? Esta acción no se puede deshacer.',
        cloudSaveOk: "Cronograma guardado en la nube.",
        cloudUpdateOk: "Cronograma actualizado en la nube.",
        cloudLoadOk: 'Cronograma "{0}" cargado.',
        cloudDeleteOk: "Cronograma eliminado.",
        cloudMarkedCompleted: "Marcado como completado.",
        cloudMarkedInProgress: "Movido a En proceso.",
        cloudSectionEmpty: "—",
        cloudGenericError: "Error de conexión con la nube. Inténtalo de nuevo.",
        cloudSignInError: "No se pudo iniciar sesión.",
        cloudUnavailable: "El servicio en la nube no está disponible.",
        cloudCurrentTag: "actual"
    },
    en: {
        newBtn: "New", saveBtn: "Save", copyBtn: "Image", excelBtn: "Export",
        undoBtn: "Undo", redoBtn: "Redo", scheduleLabel: "Schedule:",
        schedulePlaceholder: "Schedule Title", startLabel: "Start:",
        endLabel: "End:", themeLabel: "Theme:", langLabel: "Language:",
        viewLabel: "View:", viewMonthWeek: "Month / Week", viewWeekDay: "Week / Day",
        weekdayInitials: ["M", "T", "W", "T", "F", "S", "S"],
        themeDark: "Dark", themeLight: "Light", themeModern: "Modern", themeGray: "Gray",
        addProjectBtn: "Add Project", pasteExcelBtn: "Excel", loadBtn: "Load", loadBtnTitle: "Load Schedule",
        pasteInstructions: "Paste your Excel table here (Project in Column A, Task in Column B).",
        editTaskTitle: "Edit Task", taskNameLabel: "Task Name:", taskDescriptionLabel: "Description:",
        taskDescriptionPlaceholder: "Notes to remember things…", taskStartLabel: "Start Week:",
        taskDurationLabel: "Duration (weeks):", taskTypeLabel: "Type:",
        taskTypeNormal: "Normal", taskTypeMilestone: "Milestone", taskTextPositionLabel: "Text Position:",
        taskTextInside: "Inside", taskTextOutside: "Outside", taskStyleLabel: "Style:",
        styleBarOutside: "Bar with text outside", styleBarInside: "Bar with text inside", styleMilestoneOutside: "Milestone with text outside",
        compactLabel: "Compact", compactProjectLabel: "Compact",
        taskColorLabel: "Task Color:",
        deleteTaskBtn: "Delete Task", completeBtn: "Completed", uncompleteBtn: "Uncomplete",
        editProjectTitle: "Edit Project", projectNameLabel: "Name:",
        projectColorLabel: "Color:", deleteProjectBtn: "Delete Project",
        months: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"],
        weekPrefix: "W", newProjectDefault: "New Project", newTaskDefault: "New Task",
        copying: "Copying...", copied: "✅ Image copied to clipboard",
        confirmDeleteProject: "Are you sure you want to delete this project and all its tasks?",
        confirmDeleteTask: "Are you sure you want to delete this task?",
        confirmImport: "{0} tasks detected for import. Do you want to add them to the current schedule?\n\nExisting tasks will not be deleted.",
        newScheduleConfirm: "Are you sure you want to create a new schedule? Unsaved data will be lost.",
        exportFilename: "Schedule.xlsx",
        newScheduleTitle: "New Schedule", saveScheduleTitle: "Save Schedule",
        copyImageTitle: "Copy as Image", exportExcelTitle: "Export to Excel",
        undoTitle: "Undo (Ctrl+Z)", redoTitle: "Redo (Ctrl+Y)", resetColorTitle: "Reset project color",
        resetProjectColorTitle: "Restore project default color",
        copyColorTitle: "Copy color",
        pasteColorTitle: "Paste color",
        pasteColorNoneTitle: "No color copied",
        colorCopied: "Color copied",
        addTaskAction: "+ Add task", weekTooltipTo: " to ", acceptBtn: "Accept",
        todayLabel: "TODAY",
        confirmChangeColor: "This will change the color of all tasks in the project. Do you want to continue?",
        shareBtn: "Share", shareBtnTitle: "Share link", sharePopupTitle: "Share link",
        shareGenerating: "Generating link…",
        shareFallbackHint: "Offline: using local link (long). Try again later to get a short link.",
        sidebarToggleTitle: "Show/Hide panel",
        sidebarSignedOutHint: "Save your schedules in the cloud and access them from any device.",
        sidebarSignedOutListHint: "Sign in to see your saved schedules.",
        sidebarEmpty: "You don't have any saved schedules yet.",
        searchPlaceholder: "Search…",
        cloudListTitle: "My Schedules",
        cloudNewCategory: "New category",
        cloudUncategorized: "Uncategorized",
        cloudPromptNewCategory: "Name of the new category:",
        cloudPromptRenameCategory: "New name for the category:",
        cloudConfirmDeleteCategory: 'Delete the category "{0}"? Schedules in it will become uncategorized.',
        cloudRenameCategoryTitle: "Rename category",
        cloudDeleteCategoryTitle: "Delete category",
        cloudSignInGoogle: "Continue with Google",
        cloudSignOut: "Sign out",
        cloudLoadTitle: "Load this schedule",
        cloudSyncPending: "Editing…",
        cloudSyncSaving: "Saving…",
        cloudSyncSaved: "Saved",
        cloudSyncError: "Save error",
        cloudDeleteBtn: "Delete",
        cloudMarkCompletedTitle: "Mark as completed",
        cloudMarkInProgressTitle: "Move to In progress",
        cloudConfirmDelete: 'Delete the schedule "{0}" from the cloud? This action cannot be undone.',
        cloudSaveOk: "Schedule saved to the cloud.",
        cloudUpdateOk: "Schedule updated in the cloud.",
        cloudLoadOk: 'Schedule "{0}" loaded.',
        cloudDeleteOk: "Schedule deleted.",
        cloudMarkedCompleted: "Marked as completed.",
        cloudMarkedInProgress: "Moved to In progress.",
        cloudSectionEmpty: "—",
        cloudGenericError: "Cloud connection error. Please try again.",
        cloudSignInError: "Could not sign in.",
        cloudUnavailable: "The cloud service is unavailable.",
        cloudCurrentTag: "current"
    }
};

function applyLanguage(lang) {
    const t = translations[lang] || translations['es'];

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) el.textContent = t[key];
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (t[key]) el.setAttribute('placeholder', t[key]);
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (t[key]) el.setAttribute('title', t[key]);
    });

    months = t.months;
    const startMonth = document.getElementById('start-month').value;
    const endMonth = document.getElementById('end-month').value;
    populateMonthSelectors();
    document.getElementById('start-month').value = startMonth;
    document.getElementById('end-month').value = endMonth;

    updatePreview();
}

function getTranslation(key) {
    const lang = document.getElementById('lang-selector')?.value || 'es';
    return (translations[lang] && translations[lang][key]) ? translations[lang][key] : (translations['es'][key] || key);
}

// --- Portapapeles de color (persistente entre sesiones) ---
// Permite copiar un color de una tarea/proyecto y pegarlo en otra.
const COLOR_CLIPBOARD_KEY = 'cronogramaColorClipboard';
let _clipboardColor = null;
try {
    const raw = localStorage.getItem(COLOR_CLIPBOARD_KEY);
    if (raw && /^#[0-9a-fA-F]{6}$/.test(raw)) _clipboardColor = raw.toLowerCase();
} catch {}

function setClipboardColor(hex) {
    if (typeof hex !== 'string') return;
    const norm = hex.trim().toLowerCase();
    if (!/^#[0-9a-fA-F]{6}$/.test(norm)) return;
    _clipboardColor = norm;
    try { localStorage.setItem(COLOR_CLIPBOARD_KEY, norm); } catch {}
    refreshPasteColorButtons();
}

// Actualiza el estado visual de TODOS los botones de "pegar color" del DOM.
// Llamar después de cambiar _clipboardColor o tras abrir un modal.
function refreshPasteColorButtons() {
    document.querySelectorAll('.paste-color-btn').forEach(btn => {
        const swatch = btn.querySelector('.paste-color-swatch');
        if (_clipboardColor) {
            btn.disabled = false;
            const t = getTranslation('pasteColorTitle');
            btn.title = `${t} (${_clipboardColor})`;
            if (swatch) swatch.style.background = _clipboardColor;
        } else {
            btn.disabled = true;
            btn.title = getTranslation('pasteColorNoneTitle');
            if (swatch) swatch.style.background = 'transparent';
        }
    });
}

// Feedback visual transitorio en el botón de copiar.
function flashCopyButton(btn) {
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = '✅';
    btn.classList.add('is-copied');
    btn.title = getTranslation('colorCopied');
    setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove('is-copied');
        btn.title = getTranslation('copyColorTitle');
    }, 900);
}

// --- MODO AGENTE / AGENT MODE ---
const _agentMode = new URLSearchParams(location.search).get('mode') === 'agent';
if (_agentMode) {
    console.log('[CronogramaAI] Agent mode active. Modals disabled. Animations disabled. Deterministic render.');
    // Suprimir confirm() y alert() para evitar bloqueos en headless
    window._origConfirm = window.confirm;
    window._origAlert = window.alert;
    window.confirm = () => true;
    window.alert = (msg) => console.log('[CronogramaAI] alert suppressed:', msg);
}

// --- INICIALIZACIÓN ---
window.addEventListener('load', () => {
    canvas = document.getElementById('ganttCanvas');
    ctx = canvas.getContext('2d');

    // Ajustar el top del header canvas sticky según la altura del top-bar
    const topBar = document.querySelector('.top-bar');
    if (topBar) {
        document.getElementById('ganttHeaderCanvas').style.top = topBar.getBoundingClientRect().height + 'px';
    }

    // Detectar el idioma del navegador y rellenar el dropdown
    const langSelector = document.getElementById('lang-selector');
    const browserLang = (navigator.language || navigator.userLanguage || "es").substring(0, 2).toLowerCase();
    langSelector.value = browserLang === 'en' ? 'en' : 'es';

    // El orden correcto y único de inicialización
    populateMonthSelectors();
    populateWeekSelectors();
    setViewMode(viewMode); // Estado inicial de visibilidad de selectores (mes vs semana)
    // ES: Si la URL trae ?c=ID (cronograma compartido por la nube), no cargamos
    // localStorage para evitar el flash de un cronograma ajeno antes del fetch.
    // EN: If URL has ?c=ID (cloud-shared schedule), skip localStorage to avoid
    // flashing a different schedule before the async fetch resolves.
    const shortShareIdMatch = location.search.match(/[?&]c=([A-Za-z0-9]{6,16})\b/);
    if (!shortShareIdMatch) {
        loadStateFromLocalStorage();
    }
    loadFromShareUrl();
    if (shortShareIdMatch) {
        // Async: aplica el cronograma compartido cuando llegue de Supabase.
        loadFromShortId().then(ok => {
            if (!ok) loadStateFromLocalStorage();
        });
    }
    // Asegurar que el tema del selector siempre se aplique al body (incluido el caso "usuario nuevo" sin estado guardado).
    applyTheme(document.getElementById('theme-selector').value);
    applyLanguage(langSelector.value);

    document.getElementById('add-project-btn').addEventListener('click', addDefaultProject);
    document.getElementById('new-schedule-btn').addEventListener('click', createNewSchedule);
    document.getElementById('cronograma-title').addEventListener('input', saveStateToLocalStorage);
    document.getElementById('cronograma-title').addEventListener('change', saveToHistory);
    lastStartMonth = parseInt(document.getElementById('start-month').value);
    document.getElementById('start-month').addEventListener('change', () => {
        const newStartMonth = parseInt(document.getElementById('start-month').value);
        if (lastStartMonth !== null && lastStartMonth !== newStartMonth) {
            // Calcular cuántas semanas se desplazó el grid entre el mes anterior y el nuevo
            const year = new Date().getFullYear();
            const oldStart = new Date(year, lastStartMonth, 1);
            while (oldStart.getDay() !== 1) oldStart.setDate(oldStart.getDate() + 1);
            const newStart = new Date(year, newStartMonth, 1);
            while (newStart.getDay() !== 1) newStart.setDate(newStart.getDate() + 1);
            const diffMs = newStart.getTime() - oldStart.getTime();
            const weeksDiff = Math.round(diffMs / (1000 * 60 * 60 * 24 * 7));

            // Compensar todas las tareas: restar el desplazamiento para que queden en el mismo sitio
            projects.forEach(project => {
                project.tasksByRow.forEach(row => {
                    row.forEach(task => {
                        task.startWeek -= weeksDiff;
                    });
                });
            });
        }
        lastStartMonth = newStartMonth;
        updatePreview();
        saveToHistory();
    });

    document.getElementById('end-month').addEventListener('change', () => {
        updatePreview();
        saveToHistory();
    });

    // Selectores de semana (modo Semana/Día)
    document.getElementById('start-week').addEventListener('change', () => {
        const sw = document.getElementById('start-week');
        // Desplazar tareas para que conserven su posición de calendario.
        if (lastStartWeekISO && lastStartWeekISO !== sw.value) {
            const oldMonday = mondayOf(parseISODate(lastStartWeekISO));
            const newMonday = mondayOf(parseISODate(sw.value));
            const weeksDiff = Math.round((newMonday - oldMonday) / (1000 * 60 * 60 * 24 * 7));
            if (weeksDiff !== 0) {
                projects.forEach(p => p.tasksByRow.forEach(r => r.forEach(t => { t.startWeek -= weeksDiff; })));
            }
        }
        clampEndWeek();
        lastStartWeekISO = sw.value;
        updatePreview();
        saveToHistory();
    });
    document.getElementById('end-week').addEventListener('change', () => {
        clampEndWeek();
        updatePreview();
        saveToHistory();
    });

    document.getElementById('theme-selector').addEventListener('change', (e) => {
        applyTheme(e.target.value);
        updatePreview();
        saveToHistory();
    });
    document.getElementById('view-mode').addEventListener('change', (e) => {
        setViewMode(e.target.value);
        updatePreview();
        saveToHistory();
    });
    document.getElementById('lang-selector').addEventListener('change', (e) => {
        applyLanguage(e.target.value);
        saveStateToLocalStorage();
        saveToHistory();
    });

    // Listeners para guardar y cargar
    document.getElementById('save-btn').addEventListener('click', saveSchedule);
    document.getElementById('load-btn').addEventListener('click', () => document.getElementById('load-input').click());
    document.getElementById('load-input').addEventListener('change', loadSchedule);
    document.getElementById('copy-btn').addEventListener('click', copyChartToClipboard);

    // Share button
    const shareBtn = document.getElementById('share-btn');
    const sharePopup = document.getElementById('share-popup');
    const shareUrlInput = document.getElementById('share-url-input');
    const shareCopyBtn = document.getElementById('share-copy-btn');
    const shareFallbackHint = document.getElementById('share-fallback-hint');

    shareBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isVisible = sharePopup.style.display !== 'none';
        if (isVisible) {
            sharePopup.style.display = 'none';
            return;
        }
        // Muestra el popup con un estado de "generando" mientras se llama al endpoint.
        shareUrlInput.value = getTranslation('shareGenerating');
        shareUrlInput.disabled = true;
        if (shareFallbackHint) shareFallbackHint.style.display = 'none';
        sharePopup.style.display = 'block';

        const { url, source } = await generateShortShareUrl();
        shareUrlInput.value = url;
        shareUrlInput.disabled = false;
        try { shareUrlInput.select(); } catch {}
        if (shareFallbackHint) {
            shareFallbackHint.style.display = source === 'fallback' ? 'block' : 'none';
        }
    });

    shareCopyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(shareUrlInput.value).then(() => {
            const orig = shareCopyBtn.textContent;
            shareCopyBtn.textContent = '✅';
            setTimeout(() => { shareCopyBtn.textContent = orig; }, 1500);
        });
    });

    document.addEventListener('click', (e) => {
        if (!document.querySelector('.share-wrapper').contains(e.target)) {
            sharePopup.style.display = 'none';
        }
    });

    document.getElementById('paste-table-btn').addEventListener('click', togglePasteArea);
    document.getElementById('export-excel-btn').addEventListener('click', exportToExcel);
    document.getElementById('undo-btn').addEventListener('click', undo);
    document.getElementById('redo-btn').addEventListener('click', redo);

    // Listeners del Canvas
    canvas.addEventListener('mousedown', handleCanvasMouseDown);
    canvas.addEventListener('mousemove', handleCanvasMouseMove);
    canvas.addEventListener('mouseup', handleCanvasMouseUp);

    // Rastrear el ratón para mostrar/ocultar elementos interactivos
    canvas.addEventListener('mousemove', e => {
        const rect = canvas.getBoundingClientRect();
        lastMousePosition = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        if (!draggingTask && !resizingTask && !document.querySelector('.floating-input')) {
            draw();
        }

    });

    // --- Tooltip de semana en el header sticky ---
    const hCanvasEl = document.getElementById('ganttHeaderCanvas');
    if (hCanvasEl) {
        hCanvasEl.addEventListener('mousemove', e => {
            const weekTooltip = document.getElementById('week-tooltip');
            const hRect = hCanvasEl.getBoundingClientRect();
            const mx = e.clientX - hRect.left;
            const my = e.clientY - hRect.top;
            const weekRow = headerHeight / 2 + 3;

            if (my > weekRow && mx > projectLabelWidth) {
                const dpr = window.devicePixelRatio || 1;
                const logicalW = hCanvasEl.width / dpr;
                const chartW = logicalW - projectLabelWidth;
                const weekW = chartW / totalWeeks;
                const startDate = getStartDate();
                const fmt = d => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');

                if (viewMode === 'day') {
                    const dayW = weekW / 7;
                    const dayIndex = Math.floor((mx - projectLabelWidth) / dayW);
                    if (dayIndex >= 0 && dayIndex < totalWeeks * 7) {
                        const day = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
                        const initials = getTranslation('weekdayInitials') || [];
                        const wdIdx = (day.getDay() + 6) % 7;
                        weekTooltip.textContent = `${initials[wdIdx] || ''} ${fmt(day)}`.trim();
                        weekTooltip.style.left = (e.clientX + 12) + 'px';
                        weekTooltip.style.top = (e.clientY + 12) + 'px';
                        weekTooltip.classList.add('visible');
                        return;
                    }
                } else {
                    const weekIndex = Math.floor((mx - projectLabelWidth) / weekW);
                    if (weekIndex >= 0 && weekIndex < totalWeeks) {
                        const weekStart = new Date(startDate.getTime() + weekIndex * 7 * 24 * 60 * 60 * 1000);
                        const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
                        weekTooltip.textContent = `${fmt(weekStart)}${getTranslation('weekTooltipTo')}${fmt(weekEnd)}`;
                        weekTooltip.style.left = (e.clientX + 12) + 'px';
                        weekTooltip.style.top = (e.clientY + 12) + 'px';
                        weekTooltip.classList.add('visible');
                        return;
                    }
                }
            }
            weekTooltip.classList.remove('visible');
        });
        hCanvasEl.addEventListener('mouseleave', () => {
            document.getElementById('week-tooltip').classList.remove('visible');
        });
    }

    // Eliminamos el proyecto que se crea por defecto
    // addProject();
    updatePreview();

    makeModalDraggable(document.getElementById('task-modal'));

    // Listener para cerrar modales con la tecla ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const taskModal = document.getElementById('task-modal');
            if (taskModal.style.display !== 'none') {
                closeTaskModal();
            }
            const projectModal = document.getElementById('project-edit-modal');
            if (projectModal && projectModal.style.display !== 'none') {
                closeProjectEditModal();
            }
        }
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            undo();
        }
        if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
            e.preventDefault();
            redo();
        }
    });

    // Actualizar canvas cuando cambia el tamaño de la ventana
    window.addEventListener('resize', updatePreview);

    // Cargar desde URL compartida si el hash cambia en la misma pestaña
    window.addEventListener('hashchange', () => {
        if (location.hash.startsWith('#s=')) {
            loadFromShareUrl();
        }
    });

    // Guardar estado inicial
    setTimeout(saveToHistory, 500); // Un pequeño retraso para asegurar que todo se cargó

    // --- AUTO-EXPORT PARA AGENTES DE IA / AI AGENT AUTO-EXPORT ---
    // ?autoexport=url   → escribe resultado JSON en #autoexport-result + muestra URL
    // ?autoexport=image → descarga PNG + escribe resultado JSON en #autoexport-result
    // ?autoexport=json  → escribe estado JSON completo en #autoexport-result
    function _writeAutoexportResult(result) {
        let el = document.getElementById('autoexport-result');
        if (!el) {
            el = document.createElement('div');
            el.id = 'autoexport-result';
            document.body.appendChild(el);
        }
        el.dataset.result = JSON.stringify(result);
        el.textContent = JSON.stringify(result);
        if (_agentMode) console.log('[CronogramaAI] autoexport result:', result);
        return el;
    }

    const _urlParams = new URLSearchParams(location.search);
    const _autoexport = _urlParams.get('autoexport');

    if (_autoexport === 'url') {
        setTimeout(() => {
            const shareUrl = generateShareUrl();
            const result = { success: true, type: 'url', data: shareUrl };
            const el = _writeAutoexportResult(result);
            el.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#0d1117;color:#58a6ff;padding:10px 16px;font-family:monospace;font-size:13px;z-index:9999;word-break:break-all;border-bottom:2px solid #58a6ff;';
            el.textContent = shareUrl;
            el.dataset.result = JSON.stringify(result);
        }, 600);

    } else if (_autoexport === 'image') {
        setTimeout(async () => {
            try {
                const dataUrl = await getImageDataUrl();
                if (!_agentMode) {
                    const a = document.createElement('a');
                    a.href = dataUrl;
                    const title = (document.getElementById('cronograma-title').value || 'cronograma')
                        .replace(/[^a-z0-9]/gi, '_').toLowerCase();
                    a.download = `${title}.png`;
                    a.click();
                }
                const el = _writeAutoexportResult({ success: true, type: 'image', data: dataUrl });
                el.style.display = 'none';
            } catch (e) {
                _writeAutoexportResult({ success: false, type: 'image', error: e.message });
            }
        }, 600);

    } else if (_autoexport === 'json') {
        setTimeout(() => {
            try {
                const state = window.CronogramaAPI.getState();
                const el = _writeAutoexportResult({ success: true, type: 'json', data: state });
                el.style.display = 'none';
            } catch (e) {
                _writeAutoexportResult({ success: false, type: 'json', error: e.message });
            }
        }, 600);
    }
});

function makeModalDraggable(modal) {
    const modalContent = modal.querySelector('.modal-content');
    const header = modal.querySelector('.modal-header');
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    // Función para obtener la transformación actual de traslación
    function getCurrentTranslate() {
        const transform = window.getComputedStyle(modalContent).transform;
        if (transform === 'none') return { x: 0, y: 0 };

        const matrix = transform.match(/matrix.*\((.+)\)/);
        if (matrix && matrix[1]) {
            const matrixValues = matrix[1].split(', ');
            return { x: parseInt(matrixValues[4], 10), y: parseInt(matrixValues[5], 10) };
        }
        return { x: 0, y: 0 };
    }

    if (header) {
        header.onmousedown = dragMouseDown;
    }

    function dragMouseDown(e) {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;

        const currentPos = getCurrentTranslate();

        modalContent.style.transform = `translate(${currentPos.x - pos1}px, ${currentPos.y - pos2}px)`;
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

function populateMonthSelectors(forceReset = false) {
    const startMonthSelect = document.getElementById('start-month');
    const endMonthSelect = document.getElementById('end-month');

    // Limpiar opciones existentes para evitar duplicados
    startMonthSelect.innerHTML = '';
    endMonthSelect.innerHTML = '';

    months.forEach((month, index) => {
        startMonthSelect.add(new Option(month, index));
        endMonthSelect.add(new Option(month, index));
    });

    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const endMonth = (currentMonth + 5) % 12;

    // Siempre establece los valores por defecto. `loadStateFromLocalStorage` los sobreescribirá si es necesario.
    startMonthSelect.value = currentMonth;
    endMonthSelect.value = endMonth;

    // Si se fuerza un reseteo (botón 'Nuevo'), también se aplican los valores por defecto.
    if (forceReset) {
        startMonthSelect.value = currentMonth;
        endMonthSelect.value = endMonth;
    }
}

// --- SELECTORES DE SEMANA (modo Semana/Día) ---

// Devuelve el lunes (00:00) de la semana que contiene la fecha dada.
function mondayOf(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay(); // 0 = domingo
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
}

function toISODate(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseISODate(s) {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

function weekOptionLabel(d) {
    const monthNames = getTranslation('months') || months;
    return `${d.getDate()} ${monthNames[d.getMonth()]} '${String(d.getFullYear()).slice(-2)}`;
}

// Asigna una fecha (lunes) a un selector de semana, creando la opción si no existe.
function setWeekSelectValue(sel, mondayDate) {
    if (!sel) return;
    const iso = toISODate(mondayDate);
    if (!Array.from(sel.options).some(o => o.value === iso)) {
        sel.add(new Option(weekOptionLabel(mondayDate), iso));
    }
    sel.value = iso;
}

// Asigna el lunes de inicio y recuerda su valor (para no desplazar tareas al sincronizar).
function setStartWeekValue(iso) {
    const sw = document.getElementById('start-week');
    if (!sw) return;
    setWeekSelectValue(sw, mondayOf(parseISODate(iso)));
    lastStartWeekISO = sw.value;
    // Solo se llama con un valor real (estados guardados en modo día).
    weekRangeSet = true;
}

// Rellena los selectores de semana con los lunes de un horizonte amplio
// (desde enero del año actual, ~60 semanas), etiquetados con su fecha real.
function populateWeekSelectors() {
    const startWeekSelect = document.getElementById('start-week');
    const endWeekSelect = document.getElementById('end-week');
    if (!startWeekSelect || !endWeekSelect) return;
    startWeekSelect.innerHTML = '';
    endWeekSelect.innerHTML = '';

    const firstMonday = mondayOf(new Date(new Date().getFullYear(), 0, 1));
    const WEEKS = 60;
    for (let i = 0; i < WEEKS; i++) {
        const d = new Date(firstMonday.getTime() + i * 7 * 24 * 60 * 60 * 1000);
        const label = weekOptionLabel(d);
        const iso = toISODate(d);
        startWeekSelect.add(new Option(label, iso));
        endWeekSelect.add(new Option(label, iso));
    }
}

// Garantiza que el fin esté dentro de [inicio, inicio + (MAX-1) semanas].
function clampEndWeek() {
    const sw = document.getElementById('start-week');
    const ew = document.getElementById('end-week');
    if (!sw || !ew || !sw.value || !ew.value) return;
    const startMonday = mondayOf(parseISODate(sw.value));
    let endMonday = mondayOf(parseISODate(ew.value));
    const maxEndMonday = new Date(startMonday.getTime() + (MAX_DAYVIEW_WEEKS - 1) * 7 * 24 * 60 * 60 * 1000);
    if (endMonday.getTime() < startMonday.getTime()) endMonday = new Date(startMonday);
    if (endMonday.getTime() > maxEndMonday.getTime()) endMonday = maxEndMonday;
    setWeekSelectValue(ew, endMonday);
}

// Ajusta los selectores de semana al rango derivado de los meses, con tope de 12 semanas.
function syncWeekSelectorsFromMonths() {
    const sw = document.getElementById('start-week');
    const ew = document.getElementById('end-week');
    if (!sw || !ew) return;

    const sMonth = parseInt(document.getElementById('start-month').value) || 0;
    const eMonthRaw = parseInt(document.getElementById('end-month').value);
    const eMonth = isNaN(eMonthRaw) ? sMonth : eMonthRaw;
    const year = new Date().getFullYear();
    // Primer lunes en/ tras el día 1 (igual que el modo mes), para que al
    // alternar entre vistas no se desplacen las tareas.
    const startMonday = new Date(year, sMonth, 1);
    while (startMonday.getDay() !== 1) startMonday.setDate(startMonday.getDate() + 1);
    const endYear = eMonth < sMonth ? year + 1 : year;
    let endMonday = mondayOf(new Date(endYear, eMonth + 1, 0));

    const maxEndMonday = new Date(startMonday.getTime() + (MAX_DAYVIEW_WEEKS - 1) * 7 * 24 * 60 * 60 * 1000);
    if (endMonday.getTime() < startMonday.getTime()) endMonday = new Date(startMonday);
    if (endMonday.getTime() > maxEndMonday.getTime()) endMonday = maxEndMonday;

    setWeekSelectValue(sw, startMonday);
    setWeekSelectValue(ew, endMonday);
    lastStartWeekISO = sw.value;
    weekRangeSet = true;
}

// --- GESTIÓN DE HISTORIAL (UNDO/REDO) ---

function saveToHistory() {
    const currentState = JSON.stringify({
        title: document.getElementById('cronograma-title').value,
        startMonth: document.getElementById('start-month').value,
        endMonth: document.getElementById('end-month').value,
        theme: document.getElementById('theme-selector').value,
        viewMode: viewMode,
        weekStart: viewMode === 'day' ? document.getElementById('start-week').value : '',
        weekEnd: viewMode === 'day' ? document.getElementById('end-week').value : '',
        projects: projects
    });

    // Si el estado no ha cambiado respecto al actual, no guardar
    if (historyIndex >= 0 && history[historyIndex] === currentState) return;

    // Si estamos en medio de un undo y hacemos un cambio, cortamos la rama futura
    if (historyIndex < history.length - 1) {
        history = history.slice(0, historyIndex + 1);
    }

    history.push(currentState);
    if (history.length > MAX_HISTORY) {
        history.shift();
    } else {
        historyIndex++;
    }
    updateHistoryButtons();
}

function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        applyState(JSON.parse(history[historyIndex]));
    }
}

function redo() {
    if (historyIndex < history.length - 1) {
        historyIndex++;
        applyState(JSON.parse(history[historyIndex]));
    }
}

// ES: Limpia el historial de undo/redo y lo deja con el estado actual como única entrada.
// Se llama al cambiar de cronograma (cloud, archivo, share, "Nuevo") para que deshacer
// no rebote a un cronograma distinto.
// EN: Reset undo/redo history; called when switching schedules.
function resetHistory() {
    history = [];
    historyIndex = -1;
    saveToHistory();
}
window.resetHistory = resetHistory;

function applyState(data) {
    if (!data) return;

    if (data.title !== undefined) document.getElementById('cronograma-title').value = data.title;
    if (data.startMonth !== undefined) document.getElementById('start-month').value = data.startMonth;
    if (data.endMonth !== undefined) document.getElementById('end-month').value = data.endMonth;
    if (data.theme !== undefined) {
        document.getElementById('theme-selector').value = data.theme;
        applyTheme(data.theme);
    }
    if (data.viewMode !== undefined) setViewMode(data.viewMode);
    if (data.weekStart) setStartWeekValue(data.weekStart);
    if (data.weekEnd) setWeekSelectValue(document.getElementById('end-week'), mondayOf(parseISODate(data.weekEnd)));

    if (data.projects && Array.isArray(data.projects)) {
        projects.length = 0;
        // Deep copy para evitar referencias circulares o problemas de mutación
        Array.prototype.push.apply(projects, JSON.parse(JSON.stringify(data.projects)));
    }

    updatePreview();
    updateHistoryButtons();
}

function applyTheme(theme) {
    document.body.classList.remove('theme-claro', 'theme-moderno', 'theme-gris');
    if (theme !== 'oscuro') {
        document.body.classList.add(`theme-${theme}`);
    }

    // Actualizar colores para el Canvas
    if (theme === 'claro') {
        textColor = '#333333';
        gridColor = '#dddddd';
        canvasHeaderBg = '#f1f3f4';
        canvasBodyBg = '#ffffff';
        canvasSidebarBg = '#f8f9fa';
        canvasMutedText = '#666';
        canvasHighlightBg = 'rgba(0, 0, 0, 0.05)';
        canvasMonthOverlay = 'rgba(0, 0, 0, 0.02)';
        todayColTint = 'rgba(245, 158, 11, 0.09)';
        todayColBorder = 'rgba(245, 158, 11, 0.50)';
        todayBadgeBg = 'rgba(245, 158, 11, 0.20)';
        todayBadgeText = '#92400E';
        todayWeekNumColor = '#B45309';
    } else if (theme === 'moderno') {
        textColor = '#f1f5f9';
        gridColor = '#334155';
        canvasHeaderBg = '#1e293b';
        canvasBodyBg = '#0f172a';
        canvasSidebarBg = '#1e293b';
        canvasMutedText = '#94a3b8';
        canvasHighlightBg = 'rgba(255, 255, 255, 0.05)';
        canvasMonthOverlay = 'rgba(255, 255, 255, 0.05)';
        todayColTint = 'rgba(56, 189, 248, 0.07)';
        todayColBorder = 'rgba(56, 189, 248, 0.35)';
        todayBadgeBg = 'rgba(56, 189, 248, 0.20)';
        todayBadgeText = '#38BDF8';
        todayWeekNumColor = '#7DD3FC';
    } else if (theme === 'gris') {
        textColor = '#111827';
        gridColor = '#d1d5db';
        canvasHeaderBg = '#e5e7eb';
        canvasBodyBg = '#f9fafb';
        canvasSidebarBg = '#f3f4f6';
        canvasMutedText = '#4b5563';
        canvasHighlightBg = 'rgba(0, 0, 0, 0.05)';
        canvasMonthOverlay = 'rgba(0, 0, 0, 0.03)';
        todayColTint = 'rgba(79, 70, 229, 0.07)';
        todayColBorder = 'rgba(79, 70, 229, 0.40)';
        todayBadgeBg = 'rgba(79, 70, 229, 0.15)';
        todayBadgeText = '#3730A3';
        todayWeekNumColor = '#4338CA';
    } else {
        // Oscuro (Default)
        textColor = '#E0E0E0';
        gridColor = '#444';
        canvasHeaderBg = '#252526';
        canvasBodyBg = '#1E1E1E';
        canvasSidebarBg = '#252526';
        canvasMutedText = '#999';
        canvasHighlightBg = 'rgba(255, 255, 255, 0.08)';
        canvasMonthOverlay = 'rgba(255, 255, 255, 0.05)';
        todayColTint = 'rgba(255, 193, 7, 0.07)';
        todayColBorder = 'rgba(255, 193, 7, 0.35)';
        todayBadgeBg = 'rgba(255, 193, 7, 0.28)';
        todayBadgeText = '#FFC107';
        todayWeekNumColor = '#FFD54F';
    }
}


function updateHistoryButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');

    if (undoBtn) undoBtn.disabled = historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = historyIndex >= history.length - 1;

    // Estilo visual si está deshabilitado
    if (undoBtn) undoBtn.style.opacity = historyIndex <= 0 ? '0.5' : '1';
    if (redoBtn) redoBtn.style.opacity = historyIndex >= history.length - 1 ? '0.5' : '1';
}


// --- MANEJO DE PROYECTOS ---

function addProject(projectData) {
    const defaultColor = colorPalette[nextColorIndex % colorPalette.length];
    const newProject = {
        name: projectData.name || `Proyecto ${projects.length + 1}`,
        color: projectData.color || defaultColor,
        defaultColor: defaultColor,
        tasksByRow: []
    };
    nextColorIndex++;

    // Agrupar tareas por fila (si es necesario en el futuro) o simplemente ponerlas en una
    const tasks = projectData.tasks.map(t => ({ ...t }));

    // Calcular el desfase de semanas (solo si el proyecto trae un mes de inicio;
    // en modo día las tareas ya vienen posicionadas en días desde la semana 1).
    const projectStartMonth = projectData.startMonth;
    if (projectStartMonth !== undefined && !isNaN(projectStartMonth)) {
        const globalStartMonth = parseInt(document.getElementById('start-month').value);
        const monthDifference = projectStartMonth - globalStartMonth;
        const weeksOffset = Math.round(monthDifference * 4.33); // Aproximación
        tasks.forEach(t => {
            t.startWeek += weeksOffset;
        });
    }

    // Por ahora, cada tarea en su propia fila para evitar colisiones visuales iniciales
    newProject.tasksByRow = tasks.map(t => [t]);

    projects.push(newProject);
    updatePreview();
    saveToHistory();
}

function updateProjectName(index, newName) {
    if (newName.trim() !== '') {
        projects[index].name = newName.trim();
    }
    updatePreview();
    saveToHistory();
}

function updateProjectColor(index, newColor) {
    projects[index].color = newColor;
    updatePreview();
    saveToHistory();
}

function deleteProject(index) {
    projects.splice(index, 1);
    updatePreview();
    saveToHistory();
}

// --- GUARDAR Y CARGAR ---

function generateShareUrl() {
    const state = {
        title: document.getElementById('cronograma-title').value,
        startMonth: document.getElementById('start-month').value,
        endMonth: document.getElementById('end-month').value,
        theme: document.getElementById('theme-selector').value,
        viewMode: viewMode,
        weekStart: viewMode === 'day' ? document.getElementById('start-week').value : '',
        weekEnd: viewMode === 'day' ? document.getElementById('end-week').value : '',
        lang: document.getElementById('lang-selector').value,
        projects: projects
    };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
    return `${location.origin}${location.pathname}#s=${encoded}`;
}

// Caché en memoria del último share corto, indexado por hash del estado.
// Evita crear filas duplicadas en shared_schedules si el usuario abre el popup
// varias veces sin cambiar nada.
const _shortShareCache = { hash: null, url: null };

function _hashStateForShare(s) {
    // FNV-1a 32-bit. Suficiente para detectar cambios en el state.
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
}

// ES: Genera (o reutiliza) una URL corta llamando al endpoint create-share.
// EN: Builds (or reuses) a short share URL via the create-share endpoint.
// Devuelve { url, source: 'remote' | 'cache' | 'fallback' }.
async function generateShortShareUrl() {
    const state = {
        title: document.getElementById('cronograma-title').value,
        startMonth: document.getElementById('start-month').value,
        endMonth: document.getElementById('end-month').value,
        theme: document.getElementById('theme-selector').value,
        viewMode: viewMode,
        weekStart: viewMode === 'day' ? document.getElementById('start-week').value : '',
        weekEnd: viewMode === 'day' ? document.getElementById('end-week').value : '',
        lang: document.getElementById('lang-selector').value,
        projects: projects
    };
    const stateJson = JSON.stringify(state);
    const hash = _hashStateForShare(stateJson);
    if (_shortShareCache.hash === hash && _shortShareCache.url) {
        return { url: _shortShareCache.url, source: 'cache' };
    }

    const cfg = window.__SUPABASE_CONFIG__;
    const base = (cfg && cfg.url) ? cfg.url : 'https://odnysrjhbxwjnwrsrqpw.supabase.co';
    const endpoint = `${base}/functions/v1/create-share`;

    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10000);
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: state.title, state }),
            signal: ctrl.signal
        });
        clearTimeout(t);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!json || !json.url) throw new Error('respuesta inválida');
        _shortShareCache.hash = hash;
        _shortShareCache.url = json.url;
        return { url: json.url, source: 'remote' };
    } catch (err) {
        console.warn('[share] URL corta no disponible, usando enlace local:', err);
        return { url: generateShareUrl(), source: 'fallback' };
    }
}
window.generateShortShareUrl = generateShortShareUrl;

function loadFromShareUrl() {
    const hash = location.hash;
    if (!hash.startsWith('#s=')) return;
    try {
        const encoded = hash.slice(3);
        const data = JSON.parse(decodeURIComponent(escape(atob(encoded))));
        if (data.title) document.getElementById('cronograma-title').value = data.title;
        if (data.startMonth !== undefined) document.getElementById('start-month').value = data.startMonth;
        if (data.endMonth !== undefined) document.getElementById('end-month').value = data.endMonth;
        if (data.theme) {
            document.getElementById('theme-selector').value = data.theme;
            applyTheme(data.theme);
        }
        if (data.viewMode) setViewMode(data.viewMode);
        if (data.weekStart) setStartWeekValue(data.weekStart);
        if (data.weekEnd) setWeekSelectValue(document.getElementById('end-week'), mondayOf(parseISODate(data.weekEnd)));
        if (data.lang) {
            document.getElementById('lang-selector').value = data.lang;
            applyLanguage(data.lang);
        }
        if (data.projects && Array.isArray(data.projects)) {
            projects.length = 0;
            Array.prototype.push.apply(projects, data.projects);
        }
        window.history.replaceState(null, '', location.pathname);
        updatePreview();
        resetHistory();
        _onSharedScheduleLoaded();
    } catch (e) {
        console.error('Error al cargar desde URL compartida:', e);
    }
}

// ES: Hook común al cargar un cronograma compartido (?c= o #s=). Resetea el
// vínculo con el cronograma en la nube del usuario (para que el autosave
// forkee como nueva entrada en lugar de sobrescribir el anterior) y dispara
// un save vía saveStateToLocalStorage.
// EN: Common hook after loading a shared schedule (?c= or #s=). Resets the
// cloud link so autosave creates a new row instead of overwriting the user's
// previous one, then triggers a save through saveStateToLocalStorage.
function _onSharedScheduleLoaded() {
    if (typeof window.__cloudResetCurrent === 'function') {
        window.__cloudResetCurrent();
    }
    saveStateToLocalStorage();
}

// ES: Carga un cronograma público desde Supabase por ID corto (?c=XXXX).
// EN: Loads a publicly-shared schedule from Supabase by short ID (?c=XXXX).
// Usado por agentes IA y enlaces cortos generados por la Edge Function create-share.
async function loadFromShortId() {
    const params = new URLSearchParams(location.search);
    const id = params.get('c');
    if (!id || !/^[A-Za-z0-9]{6,16}$/.test(id)) return false;

    const cfg = window.__SUPABASE_CONFIG__;
    if (!cfg || !cfg.url || !cfg.publishableKey || typeof window.supabase === 'undefined') {
        console.warn('[share] Supabase no disponible para cargar cronograma:', id);
        return false;
    }

    try {
        const supa = window.supabase.createClient(cfg.url, cfg.publishableKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
        const { data, error } = await supa
            .from('shared_schedules')
            .select('title, state')
            .eq('id', id)
            .maybeSingle();
        if (error) throw error;
        if (!data) {
            console.warn('[share] Cronograma no encontrado o expirado:', id);
            return false;
        }
        const stateObj = (data.state && typeof data.state === 'object') ? { ...data.state } : {};
        if (data.title && !stateObj.title) stateObj.title = data.title;
        // El cronograma compartido no debe sobrescribir tema/idioma del visitante.
        delete stateObj.theme;
        delete stateObj.lang;
        applyState(stateObj);
        resetHistory();
        // Limpia el query param para que recargar (F5) no vuelva a forzar el fetch.
        const cleanUrl = location.origin + location.pathname + location.hash;
        window.history.replaceState(null, '', cleanUrl);
        _onSharedScheduleLoaded();
        return true;
    } catch (e) {
        console.error('[share] Error al cargar cronograma compartido:', e);
        return false;
    }
}
window.loadFromShortId = loadFromShortId;

function saveStateToLocalStorage() {
    try {
        const state = {
            title: document.getElementById('cronograma-title').value,
            startMonth: document.getElementById('start-month').value,
            endMonth: document.getElementById('end-month').value,
            theme: document.getElementById('theme-selector').value,
            viewMode: viewMode,
            weekStart: viewMode === 'day' ? document.getElementById('start-week').value : '',
            weekEnd: viewMode === 'day' ? document.getElementById('end-week').value : '',
            lang: document.getElementById('lang-selector').value,
            projects: projects
        };
        localStorage.setItem('ganttChartState', JSON.stringify(state));
    } catch (error) {
        console.error("No se pudo guardar el estado en localStorage:", error);
    }
    // ES: Notifica al módulo de nube para autosave (si existe).
    // EN: Notify the cloud module for autosave (if present).
    if (typeof window.__onStateChanged === 'function') window.__onStateChanged();
}

function loadStateFromLocalStorage() {
    try {
        const savedState = localStorage.getItem('ganttChartState');
        if (savedState) {
            const data = JSON.parse(savedState);

            if (data.title) document.getElementById('cronograma-title').value = data.title;
            if (data.startMonth !== undefined) document.getElementById('start-month').value = data.startMonth;
            if (data.endMonth !== undefined) document.getElementById('end-month').value = data.endMonth;
            if (data.theme) {
                document.getElementById('theme-selector').value = data.theme;
                applyTheme(data.theme);
            }
            if (data.viewMode) setViewMode(data.viewMode);
            if (data.weekStart) setStartWeekValue(data.weekStart);
            if (data.weekEnd) setWeekSelectValue(document.getElementById('end-week'), mondayOf(parseISODate(data.weekEnd)));
            if (data.lang) {
                document.getElementById('lang-selector').value = data.lang;
            }

            if (data.projects && Array.isArray(data.projects)) {
                projects.length = 0;
                Array.prototype.push.apply(projects, data.projects);
            }
        }
    } catch (error) {
        console.error("No se pudo cargar el estado desde localStorage:", error);
        localStorage.removeItem('ganttChartState'); // Limpiar estado corrupto
    }
}

function saveSchedule() {
    const dataToSave = {
        title: document.getElementById('cronograma-title').value,
        startMonth: document.getElementById('start-month').value,
        endMonth: document.getElementById('end-month').value,
        theme: document.getElementById('theme-selector').value,
        viewMode: viewMode,
        weekStart: viewMode === 'day' ? document.getElementById('start-week').value : '',
        weekEnd: viewMode === 'day' ? document.getElementById('end-week').value : '',
        projects: projects
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dataToSave, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const datePrefix = `${String(now.getFullYear()).slice(-2)}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const lang = document.getElementById('lang-selector').value;
    const scheduleWord = lang === 'en' ? 'Schedule' : 'Cronograma';
    const fileName = (dataToSave.title || scheduleWord).replace(/\s+/g, '_');
    downloadAnchorNode.setAttribute("download", `${datePrefix}_${scheduleWord}_${fileName}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    saveStateToLocalStorage();
}

function loadSchedule(event) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);

            if (data.title) {
                document.getElementById('cronograma-title').value = data.title;
            }
            if (data.startMonth !== undefined) {
                document.getElementById('start-month').value = data.startMonth;
            }
            if (data.endMonth !== undefined) {
                document.getElementById('end-month').value = data.endMonth;
            }
            if (data.viewMode) setViewMode(data.viewMode);
            if (data.weekStart) setStartWeekValue(data.weekStart);
            if (data.weekEnd) setWeekSelectValue(document.getElementById('end-week'), mondayOf(parseISODate(data.weekEnd)));
            if (data.projects && Array.isArray(data.projects)) {
                // Limpiar el array actual y añadir los proyectos cargados
                projects.length = 0;
                Array.prototype.push.apply(projects, data.projects);
            }

            updatePreview();
            resetHistory();

        } catch (error) {
            alert(getTranslation('Error al cargar el archivo. Asegúrate de que es un archivo de cronograma válido.'));
            console.error("Error parsing JSON:", error);
        } finally {
            // Resetear el valor del input para permitir cargar el mismo archivo de nuevo
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}

// --- IMPORTAR DESDE TABLA ---

function togglePasteArea() {
    const pasteContainer = document.getElementById('paste-area-container');
    const isVisible = pasteContainer.style.display !== 'none';

    if (isVisible) {
        pasteContainer.style.display = 'none';
        document.removeEventListener('click', handleClickOutsidePasteArea, true);
    } else {
        pasteContainer.style.display = 'block';
        document.getElementById('paste-textarea').focus();
        // Añadir listener para el pegado
        document.getElementById('paste-textarea').addEventListener('paste', handlePaste);
        // Añadir listener para cerrar al hacer clic fuera
        setTimeout(() => document.addEventListener('click', handleClickOutsidePasteArea, true), 0);
    }
}

function handleClickOutsidePasteArea(event) {
    const pasteContainer = document.getElementById('paste-area-container');
    const pasteButton = document.getElementById('paste-table-btn');
    if (!pasteContainer.contains(event.target) && event.target !== pasteButton) {
        togglePasteArea(); // Cierra el área de pegado
    }
}

function handlePaste(event) {
    // Evitar la acción de pegado por defecto
    event.preventDefault();

    // Obtener texto del portapapeles
    const pastedText = (event.clipboardData || window.clipboardData).getData('text');

    // Procesar el texto
    processPastedData(pastedText);

    // Limpiar y ocultar el área de pegado
    document.getElementById('paste-textarea').value = '';
    togglePasteArea();
}

function processPastedData(text) {
    const rows = text.trim().split('\n');
    if (rows.length === 0) return;

    // Pedir confirmación al usuario
    const confirmMessage = getTranslation('confirmImport').replace('{0}', rows.length);
    const confirmation = confirm(confirmMessage);

    if (!confirmation) return;

    const newTasksByProject = {};

    rows.forEach(row => {
        const columns = row.split('\t'); // Separado por tabulaciones
        if (columns.length < 2) return;

        const projectName = columns[0].trim();
        const taskName = columns[1].trim();

        if (!projectName || !taskName) return;

        if (!newTasksByProject[projectName]) {
            newTasksByProject[projectName] = [];
        }

        newTasksByProject[projectName].push({
            name: taskName,
            duration: 2, // Duración por defecto
            isMilestone: false,
            textPosition: 'outside'
        });
    });

    // Añadir los nuevos proyectos y tareas
    for (const projectName in newTasksByProject) {
        let project = projects.find(p => p.name.toLowerCase() === projectName.toLowerCase());

        // Si el proyecto no existe, crearlo
        if (!project) {
            const defaultColor = colorPalette[nextColorIndex % colorPalette.length];
            project = {
                name: projectName,
                color: defaultColor,
                defaultColor: defaultColor,
                tasksByRow: []
            };
            projects.push(project);
            nextColorIndex++;
        }

        // Añadir las tareas al proyecto
        newTasksByProject[projectName].forEach(newTaskData => {
            const startWeek = findLatestEndWeek(projects.indexOf(project));
            project.tasksByRow.push([{ ...newTaskData, startWeek: startWeek }]);
        });
    }

    updatePreview();
    saveToHistory();
}

// --- MANEJO DE TAREAS ---
// Devuelve true si todas las tareas existentes del proyecto son compactas
// (criterio que el modal del proyecto usa para considerar el proyecto compacto)
// Returns true if every existing task in the project is compact
// (matches the project-modal criterion for "project is compact")
function isProjectCompact(projectIndex) {
    const project = projects[projectIndex];
    if (!project) return false;
    const allTasks = project.tasksByRow.flat();
    return allTasks.length > 0 && allTasks.every(t => !!t.compact);
}

function addTask(projectIndex, rowIndex) {
    const newWeek = Math.max(1, Math.floor(totalWeeks / 4));

    const task = {
        name: getTranslation('newTaskDefault'),
        startWeek: newWeek,
        duration: 4,
        isMilestone: false,
        textPosition: 'outside',
        compact: isProjectCompact(projectIndex)
    };

    const targetRow = projects[projectIndex].tasksByRow[rowIndex];

    let collision = false;
    for (const existingTask of targetRow) {
        if (checkCollision(task, existingTask)) {
            collision = true;
            break;
        }
    }

    if (collision) {
        projects[projectIndex].tasksByRow.splice(rowIndex + 1, 0, [task]);
        openTaskModal(projectIndex, rowIndex + 1, 0);
    } else {
        targetRow.push(task);
        openTaskModal(projectIndex, rowIndex, targetRow.length - 1);
    }

    updatePreview();
    saveToHistory();
}

function deleteTask(projectIndex, rowIndex, taskIndex) {
    const row = projects[projectIndex].tasksByRow[rowIndex];
    row.splice(taskIndex, 1);

    if (row.length === 0 && projects[projectIndex].tasksByRow.length > 1) {
        projects[projectIndex].tasksByRow.splice(rowIndex, 1);
    }

    closeTaskModal();
    updatePreview();
    saveToHistory();
}

// --- MODAL DE PROYECTO ---
function addDefaultProject() {
    // En modo Semana/Día las barras se miden en DÍAS para que el proyecto de
    // ejemplo quepa entero en el rango visible (p. ej. 2 semanas).
    if (viewMode === 'day') {
        const totalDays = calculateTotalWeeks() * 7;
        let plan = [
            { name: "Definición", days: 2, isMilestone: false },
            { name: "Diseño", days: 3, isMilestone: false },
            { name: "Desarrollo", days: 4, isMilestone: false },
            { name: "Pruebas", days: 2, isMilestone: false },
            { name: "Entrega", days: 1, isMilestone: true }
        ];
        const span = plan.reduce((s, p) => s + p.days, 0);
        if (totalDays > 0 && span > totalDays) {
            const f = totalDays / span;
            plan = plan.map(p => ({ ...p, days: Math.max(1, Math.round(p.days * f)) }));
        }
        let dayCursor = 0;
        const tasks = plan.map(p => {
            const startWeek = 1 + dayCursor / 7;
            const duration = (p.isMilestone ? 1 : p.days) / 7;
            dayCursor += p.days;
            return { name: p.name, startWeek, duration, isMilestone: p.isMilestone, textPosition: 'outside' };
        });
        addProject({
            name: `Proyecto ${projects.length + 1}`,
            color: colorPalette[nextColorIndex % colorPalette.length],
            tasks
        });
        return;
    }

    const projectData = {
        name: `Proyecto ${projects.length + 1}`,
        color: colorPalette[nextColorIndex % colorPalette.length],
        startMonth: parseInt(document.getElementById('start-month').value),
        tasks: [
            { name: "Definición", startWeek: 1, duration: 2, isMilestone: false, textPosition: 'outside' },
            { name: "Diseño", startWeek: 3, duration: 3, isMilestone: false, textPosition: 'outside' },
            { name: "Desarrollo", startWeek: 6, duration: 5, isMilestone: false, textPosition: 'outside' },
            { name: "Pruebas", startWeek: 11, duration: 2, isMilestone: false, textPosition: 'outside' },
            { name: "Entrega", startWeek: 13, duration: 1, isMilestone: true, textPosition: 'outside' }
        ]
    };
    addProject(projectData);
}


function openProjectEditModal(projectIndex) {
    editingProjectId = projectIndex;
    const project = projects[projectIndex];
    if (!project) return;

    document.getElementById('modal-project-name').value = project.name;
    document.getElementById('modal-project-color').value = project.color;

    // Estado del checkbox compacto: marcado si TODAS las tareas son compactas
    const allTasks = project.tasksByRow.flat();
    const allCompact = allTasks.length > 0 && allTasks.every(t => !!t.compact);
    document.getElementById('modal-project-compact').checked = allCompact;

    const modal = document.getElementById('project-edit-modal');
    modal.style.display = 'flex';
    saveToHistory();

    modal.querySelector('.modal-close-icon').onclick = closeProjectEditModal;

    document.getElementById('modal-project-delete-btn').onclick = () => {
        if (confirm(getTranslation('confirmDeleteProject') + `\n\n"${project.name}"`)) {
            deleteProject(projectIndex);
            closeProjectEditModal();
        }
    };
    document.getElementById('modal-project-accept-btn').onclick = closeProjectEditModal;

    document.getElementById('modal-project-reset-color-btn').onclick = () => {
        const defaultColor = project.defaultColor || colorPalette[projectIndex % colorPalette.length];
        document.getElementById('modal-project-color').value = defaultColor;
        project.color = defaultColor;
        project.tasksByRow.forEach(row => row.forEach(task => { delete task.color; }));
        updatePreview();
    };

    const projectCopyBtn = document.getElementById('modal-project-copy-color-btn');
    const projectPasteBtn = document.getElementById('modal-project-paste-color-btn');
    if (projectCopyBtn) {
        projectCopyBtn.onclick = () => {
            const colorEl = document.getElementById('modal-project-color');
            setClipboardColor(colorEl.value);
            flashCopyButton(projectCopyBtn);
        };
    }
    if (projectPasteBtn) {
        projectPasteBtn.onclick = () => {
            if (!_clipboardColor) return;
            document.getElementById('modal-project-color').value = _clipboardColor;
            project.color = _clipboardColor;
            updatePreview();
            saveToHistory();
        };
    }
    refreshPasteColorButtons();

    const compactCheckbox = document.getElementById('modal-project-compact');
    const projectCompactToggle = document.querySelector('#project-edit-modal .compact-toggle');
    if (projectCompactToggle) {
        projectCompactToggle.classList.toggle('active', allCompact);
    }
    compactCheckbox.onchange = () => {
        const isCompact = compactCheckbox.checked;
        project.tasksByRow.forEach(row => row.forEach(task => { task.compact = isCompact; }));
        if (projectCompactToggle) projectCompactToggle.classList.toggle('active', isCompact);
        updatePreview();
    };

    const modalInputs = ['modal-project-name', 'modal-project-color'];
    modalInputs.forEach(id => {
        const input = document.getElementById(id);
        input.removeEventListener('input', updateProjectFromModal);
        input.addEventListener('input', updateProjectFromModal);
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                closeProjectEditModal();
            }
        };
    });
}

function closeProjectEditModal() {
    const modal = document.getElementById('project-edit-modal');
    if (modal) modal.style.display = 'none';
    editingProjectId = null;
    saveToHistory();
}

function updateProjectFromModal() {
    if (editingProjectId === null || editingProjectId === undefined) return;
    const project = projects[editingProjectId];
    if (!project) return;

    project.name = document.getElementById('modal-project-name').value.trim() || 'Proyecto sin nombre';
    const oldColor = project.color;
    const newColor = document.getElementById('modal-project-color').value;
    if (oldColor !== newColor) {
        project.color = newColor;
        // Limpiar color explícito de todas las tareas para que hereden el nuevo color
        project.tasksByRow.forEach(row => {
            row.forEach(task => {
                delete task.color;
            });
        });
    }

    updatePreview();
}

// --- MODAL DE EDICIÓN DE TAREAS ---
function openTaskModal(projectIndex, rowIndex, taskIndex) {
    editingTask = { project: projectIndex, row: rowIndex, task: taskIndex };

    const task = projects[projectIndex].tasksByRow[rowIndex][taskIndex];
    if (!task) return;

    document.getElementById('modal-task-name').value = task.name;
    document.getElementById('modal-task-description').value = task.description || '';
    document.getElementById('modal-task-type').value = task.isMilestone ? 'milestone' : 'normal';
    document.getElementById('modal-text-position').value = task.textPosition;
    document.getElementById('modal-task-compact').checked = !!task.compact;
    document.getElementById('modal-task-color').value = task.color || projects[projectIndex].color;
    document.getElementById('modal-task-completed').checked = !!task.completed;

    // Sincronizar botones gráficos de estilo
    updateStylePickerSelection();

    const modal = document.getElementById('task-modal');
    modal.style.display = 'flex';
    saveToHistory(); // Guardar estado antes de editar la tarea

    modal.querySelector('.modal-close-icon').onclick = closeTaskModal;

    document.getElementById('modal-delete-btn').onclick = () => {
        if (confirm(getTranslation('confirmDeleteTask') + `\n\n"${task.name}"`)) {
            deleteTask(projectIndex, rowIndex, taskIndex);
        }
    };
    document.getElementById('modal-accept-btn').onclick = closeTaskModal;

    document.getElementById('modal-reset-color-btn').onclick = () => {
        const taskColorInput = document.getElementById('modal-task-color');
        taskColorInput.value = projects[projectIndex].color;
        // Al resetear, eliminamos la propiedad color para que siga al proyecto
        delete projects[projectIndex].tasksByRow[rowIndex][taskIndex].color;
        updatePreview();
    };

    const taskCopyBtn = document.getElementById('modal-copy-color-btn');
    const taskPasteBtn = document.getElementById('modal-paste-color-btn');
    if (taskCopyBtn) {
        taskCopyBtn.onclick = () => {
            const colorEl = document.getElementById('modal-task-color');
            setClipboardColor(colorEl.value);
            flashCopyButton(taskCopyBtn);
        };
    }
    if (taskPasteBtn) {
        taskPasteBtn.onclick = () => {
            if (!_clipboardColor) return;
            const taskColorInput = document.getElementById('modal-task-color');
            taskColorInput.value = _clipboardColor;
            projects[projectIndex].tasksByRow[rowIndex][taskIndex].color = _clipboardColor;
            updatePreview();
            saveToHistory();
        };
    }
    refreshPasteColorButtons();

    const modalInputs = ['modal-task-name', 'modal-task-type', 'modal-text-position', 'modal-task-compact', 'modal-task-color', 'modal-task-completed'];
    modalInputs.forEach(id => {
        const el = document.getElementById(id);
        const isCheckbox = id === 'modal-task-completed' || id === 'modal-task-compact';
        el.onchange = isCheckbox ? () => { updateTaskFromModal(); saveToHistory(); } : updateTaskFromModal;
        if (!isCheckbox) el.oninput = updateTaskFromModal;
        el.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                closeTaskModal();
            }
        };
    });

    // Textarea de descripción: Enter inserta salto de línea (no cierra el modal).
    const descEl = document.getElementById('modal-task-description');
    descEl.oninput = updateTaskFromModal;
    descEl.onchange = () => { updateTaskFromModal(); saveToHistory(); };
    descEl.onkeydown = (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            closeTaskModal();
        }
    };
}

function updateStylePickerSelection() {
    const type = document.getElementById('modal-task-type').value;
    const text = document.getElementById('modal-text-position').value;
    document.querySelectorAll('.task-style-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === type && btn.dataset.text === text);
    });
    const compactToggle = document.querySelector('#task-modal .compact-toggle');
    if (compactToggle) {
        compactToggle.classList.toggle('active', document.getElementById('modal-task-compact').checked);
    }
    const completedToggle = document.getElementById('task-completed-toggle');
    if (completedToggle) {
        completedToggle.classList.toggle('active', document.getElementById('modal-task-completed').checked);
    }
}

// Inicializar listeners de los botones de estilo
document.querySelectorAll('.task-style-option').forEach(btn => {
    btn.addEventListener('click', () => {
        document.getElementById('modal-task-type').value = btn.dataset.type;
        document.getElementById('modal-text-position').value = btn.dataset.text;
        updateStylePickerSelection();
        updateTaskFromModal();
    });
});

document.querySelector('#task-modal .style-toggles-right .compact-toggle').addEventListener('click', (e) => {
    e.preventDefault();
    const cb = document.getElementById('modal-task-compact');
    cb.checked = !cb.checked;
    updateStylePickerSelection();
    updateTaskFromModal();
    saveToHistory();
});

document.getElementById('task-completed-toggle').addEventListener('click', (e) => {
    e.preventDefault();
    const cb = document.getElementById('modal-task-completed');
    cb.checked = !cb.checked;
    updateStylePickerSelection();
    updateTaskFromModal();
    saveToHistory();
});

document.querySelector('#project-edit-modal .compact-toggle').addEventListener('click', (e) => {
    e.preventDefault();
    const cb = document.getElementById('modal-project-compact');
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change'));
    saveToHistory();
});

function closeTaskModal() {
    document.getElementById('task-modal').style.display = 'none';
    editingTask = { project: -1, row: -1, task: -1 };
    saveToHistory(); // Guardar estado al finalizar la edición
}

function updateTaskFromModal() {
    const { project, row, task: taskIndex } = editingTask;
    if (project === -1) return;

    const descriptionValue = document.getElementById('modal-task-description').value.trim();
    const updatedTask = {
        ...projects[project].tasksByRow[row][taskIndex], // Mantener propiedades existentes como 'color' si no se cambia
        name: document.getElementById('modal-task-name').value.trim() || 'Tarea sin nombre',
        description: descriptionValue || undefined,
        isMilestone: document.getElementById('modal-task-type').value === 'milestone',
        textPosition: document.getElementById('modal-text-position').value,
        compact: document.getElementById('modal-task-compact').checked,
        color: document.getElementById('modal-task-color').value === projects[project].color ? undefined : document.getElementById('modal-task-color').value,
        completed: document.getElementById('modal-task-completed').checked
    };

    projects[project].tasksByRow[row][taskIndex] = updatedTask;
    updatePreview();
}


// --- LÓGICA DE DIBUJO
function updatePreview() {
    if (!canvas) return;

    totalWeeks = calculateTotalWeeks();
    initCanvasSize();
    animationProgress = 1;
    lastTime = 0;
    requestAnimationFrame(animate);
    saveStateToLocalStorage();
}

function initCanvasSize() {
    const dpr = window.devicePixelRatio || 1;

    let totalHeight = headerHeight;
    projects.forEach(p => {
        totalHeight += computeProjectInnerHeight(p, true); // incluye botón "+ Añadir tarea"
    });

    const finalHeight = totalHeight + PROJ_HEADER_BOTTOM_MARGIN;
    // Forzar el estilo CSS primero para que el documento muestre la barra de scroll si es necesaria
    canvas.style.height = `${finalHeight}px`;

    // Leer el ancho real (se actualizará si apareció el scrollbar)
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = finalHeight * dpr; // Un rowHeight extra para padding inferior

    ctx.scale(dpr, dpr);

    // Sincronizar tamaño del canvas del header sticky
    const hCanvas = document.getElementById('ganttHeaderCanvas');
    if (hCanvas) {
        hCanvas.style.height = `${headerHeight}px`;
        hCanvas.style.marginBottom = `-${headerHeight}px`;
        hCanvas.width = canvas.width;
        hCanvas.height = headerHeight * dpr;
    }
}

// --- MANEJADORES DE EVENTOS DEL CANVAS ---

function handleCanvasMouseDown(e) {
    if (document.querySelector('.floating-input')) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Si el clic cae sobre el botón "+ Añadir tarea", no iniciar el arrastre del proyecto:
    // se gestiona como acción de añadir tarea en mouseup.
    // If the click lands on the "+ Add task" button, do not start the project drag:
    // it is handled as an add-task action on mouseup.
    const onAddTaskBtn = addTaskHitboxes.some(hb =>
        x >= hb.x && x <= hb.x + hb.width && y >= hb.y && y <= hb.y + hb.height
    );

    if (!onAddTaskBtn) {
        for (const hitbox of projectHitboxes) {
            if (x >= hitbox.x && x <= hitbox.x + hitbox.width && y >= hitbox.y && y <= hitbox.y + hitbox.height) {
                draggingProject = {
                    projectIndex: hitbox.projectIndex,
                    offsetY: y - hitbox.y,
                    startY: y,
                    didMove: false,
                    targetIndex: hitbox.projectIndex
                };
                canvas.style.cursor = 'grabbing';
                e.preventDefault();
                return;
            }
        }
    }

    for (const hitbox of taskHitboxes) {
        if (x >= hitbox.x && x <= hitbox.x + hitbox.width && y >= hitbox.y && y <= hitbox.y + hitbox.height) {
            const task = projects[hitbox.projectIndex].tasksByRow[hitbox.rowIndex][hitbox.taskIndex];
            const onLeftEdge = x < hitbox.x + resizeHandleWidth;
            const onRightEdge = x > hitbox.x + hitbox.width - resizeHandleWidth;

            if (!task.isMilestone && (onLeftEdge || onRightEdge)) {
                resizingTask = { ...hitbox, handle: onLeftEdge ? 'left' : 'right', originalStartWeek: task.startWeek, originalDuration: task.duration };
                ghostTask = { ...task };
                canvas.style.cursor = 'ew-resize';
            } else {
                draggingTask = {
                    projectIndex: hitbox.projectIndex,
                    rowIndex: hitbox.rowIndex,
                    taskIndex: hitbox.taskIndex,
                    offsetX: x - hitbox.x,
                    offsetY: y - hitbox.y,
                    didMove: false,
                    startX: x, // Guardar X inicial
                    startY: y  // Guardar Y inicial
                };
                canvas.style.cursor = 'grabbing';
            }
            e.preventDefault();
            return;
        }
    }
}

function handleCanvasMouseUp(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const wasDragging = draggingTask?.didMove;
    const wasDraggingProject = draggingProject?.didMove;
    const wasResizing = !!resizingTask;

    // --- Finalizar Redimensión ---
    if (resizingTask) {
        projects[resizingTask.projectIndex].tasksByRow[resizingTask.rowIndex][resizingTask.taskIndex] = ghostTask;
        updatePreview();
        saveToHistory();
    }

    // --- Finalizar Arrastre ---
    if (draggingTask) {
        if (wasDragging) {
            const { projectIndex, rowIndex, taskIndex, dropTarget } = draggingTask;
            const project = projects[projectIndex];

            if (project && project.tasksByRow[rowIndex] && project.tasksByRow[rowIndex][taskIndex]) {
                // sameRow: solo cambió startWeek (ya actualizado en vivo), no reorganizar filas
                if (dropTarget && dropTarget.sameRow) {
                    // Nada que reorganizar, la tarea ya está en su sitio
                } else {
                    const task = { ...project.tasksByRow[rowIndex][taskIndex] };
                    const sourceIsOnlyTaskInRow = project.tasksByRow[rowIndex].length === 1;

                    // Eliminar la tarea de su posición original
                    project.tasksByRow[rowIndex].splice(taskIndex, 1);
                    if (project.tasksByRow[rowIndex].length === 0) {
                        project.tasksByRow.splice(rowIndex, 1);
                    }

                    if (!dropTarget) {
                        // Sin destino → nueva fila al final
                        project.tasksByRow.push([task]);
                    } else if (dropTarget.merge) {
                        // Fusionar con la fila existente
                        let mergeIndex = dropTarget.rowIndex;
                        // Ajustar índice si la fila original se elimina antes de la fila destino
                        if (sourceIsOnlyTaskInRow && mergeIndex > rowIndex) {
                            mergeIndex--;
                        }
                        mergeIndex = Math.max(0, Math.min(mergeIndex, project.tasksByRow.length - 1));
                        project.tasksByRow[mergeIndex].push(task);
                    } else {
                        // Insertar nueva fila
                        let insertIndex = dropTarget.rowIndex;

                        if (sourceIsOnlyTaskInRow) {
                            if (insertIndex > rowIndex) {
                                insertIndex--;
                            }
                        }

                        insertIndex = Math.max(0, Math.min(insertIndex, project.tasksByRow.length));
                        project.tasksByRow.splice(insertIndex, 0, [task]);
                    }
                }
            }
            updatePreview();
            saveToHistory();
        }
    }

    if (draggingProject) {
        if (wasDraggingProject) {
            const { projectIndex, targetIndex } = draggingProject;
            if (projectIndex !== targetIndex) {
                const projectNode = projects.splice(projectIndex, 1)[0];
                let insertIndex = targetIndex;
                if (projectIndex < targetIndex) {
                    insertIndex -= 1;
                }
                projects.splice(insertIndex, 0, projectNode);
                updatePreview();
                saveToHistory();
            }
        } else {
            openProjectEditModal(draggingProject.projectIndex);
        }
    }

    // Limpiar estado y resetear cursor al finalizar cualquier acción
    if (resizingTask) resizingTask = null;
    if (ghostTask) ghostTask = null;
    if (draggingTask) draggingTask = null;
    if (draggingProject) draggingProject = null;
    canvas.style.cursor = 'default';


    // --- Lógica de Edición por Clic (se ejecuta si no hubo arrastre ni redimensión) ---
    if (!wasDragging && !wasResizing && !wasDraggingProject) {
        // Buscar si se hizo clic en el botón '+' para añadir tarea
        for (const hitbox of addTaskHitboxes) {
            if (x >= hitbox.x && x <= hitbox.x + hitbox.width && y >= hitbox.y && y <= hitbox.y + hitbox.height) {
                addSimpleTask(hitbox.projectIndex);
                return; // Acción completada
            }
        }

        // Buscar si se hizo clic en una tarea
        for (const hitbox of taskHitboxes) {
            if (x >= hitbox.x && x <= hitbox.x + hitbox.width && y >= hitbox.y && y <= hitbox.y + hitbox.height) {
                // El clic está dentro de la tarea. Ahora comprobamos si está en los bordes para redimensionar.
                const task = projects[hitbox.projectIndex].tasksByRow[hitbox.rowIndex][hitbox.taskIndex];

                const onLeftEdge = x < hitbox.x + resizeHandleWidth;
                const onRightEdge = x > hitbox.x + hitbox.width - resizeHandleWidth;

                // Abrir el modal solo si es un hito (que no se redimensiona) o si el clic
                // no fue en ninguno de los bordes de redimensión.
                if (!wasResizing && (task.isMilestone || (!onLeftEdge && !onRightEdge))) {
                    // Solo abrimos el modal si realmente NO estábamos justo terminando
                    // una redimensión o arrastre (la variable 'wasResizing' arriba ya cubre esto parcialmente,
                    // pero si se hace clic rapidísimo en el borde sin mover el ratón se lanzaba esto).
                    openTaskModal(hitbox.projectIndex, hitbox.rowIndex, hitbox.taskIndex);
                    return;
                }
            }
        }
    }
}

function handleCanvasMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // --- Lógica para cambiar el cursor al pasar por encima ---
    if (!draggingTask && !resizingTask && !draggingProject) {
        let newCursor = 'default';
        let onTask = false;

        // Comprobar si está sobre una tarea (y si es redimensionable)
        for (const hitbox of taskHitboxes) {
            if (x >= hitbox.x && x <= hitbox.x + hitbox.width && y >= hitbox.y && y <= hitbox.y + hitbox.height) {
                onTask = true;
                const task = projects[hitbox.projectIndex].tasksByRow[hitbox.rowIndex][hitbox.taskIndex];
                const onLeftEdge = x < hitbox.x + resizeHandleWidth;
                const onRightEdge = x > hitbox.x + hitbox.width - resizeHandleWidth;
                if (!task.isMilestone && (onLeftEdge || onRightEdge)) {
                    newCursor = 'ew-resize';
                } else {
                    newCursor = 'grab';
                }
                break;
            }
        }

        // Comprobar si está sobre el botón '+'
        if (!onTask) {
            for (const hitbox of addTaskHitboxes) {
                if (x >= hitbox.x && x <= hitbox.x + hitbox.width && y >= hitbox.y && y <= hitbox.y + hitbox.height) {
                    newCursor = 'pointer';
                    break;
                }
            }
        }

        // Comprobar si está sobre el área de proyecto (etiqueta lateral)
        if (!onTask && newCursor === 'default') {
            for (const hitbox of projectHitboxes) {
                if (x >= hitbox.x && x <= hitbox.x + hitbox.width && y >= hitbox.y && y <= hitbox.y + hitbox.height) {
                    newCursor = 'grab';
                    break;
                }
            }
        }

        // Comprobar si está sobre un icono de proyecto (función eliminada o no implementada)
        // if (!onTask && newCursor === 'default' && getIconUnderCursor(x, y)) {
        //     newCursor = 'pointer';
        // }

        canvas.style.cursor = newCursor;
        return; // Salir si no estamos arrastrando o redimensionando
    }

    // --- Lógica de Arrastre de Proyecto ---
    if (draggingProject) {
        if (!draggingProject.didMove) {
            const dy = y - draggingProject.startY;
            if (Math.abs(dy) > 5) {
                draggingProject.didMove = true;
            }
        }

        if (draggingProject.didMove) {
            let currentY = headerHeight;
            let newTargetIndex = projects.length;

            for (let i = 0; i < projects.length; i++) {
                let ph = 0;
                projects[i].tasksByRow.forEach(r => { ph += getRowHeight(r); });
                const projectHeight = 15 + ph + 40;
                if (y < currentY + projectHeight / 2) {
                    newTargetIndex = i;
                    break;
                }
                currentY += projectHeight;
            }
            draggingProject.targetIndex = newTargetIndex;
            draw();
        }
        return;
    }

    // --- Lógica de Redimensión ---
    if (resizingTask) {
        const dpr = ctx.getTransform().a || 1;
        const weekWidth = (canvas.width / dpr - projectLabelWidth) / totalWeeks;
        // Ajuste a la rejilla del modo actual (semanas o días).
        const currentWeek = snapWeeks((x - projectLabelWidth) / weekWidth);
        const minDur = minDurationWeeks();

        if (resizingTask.handle === 'left') {
            // Calcular siempre desde los valores originales para evitar acumulación de errores
            const originalEndGrid = (resizingTask.originalStartWeek - 1) + resizingTask.originalDuration;
            const newDuration = originalEndGrid - currentWeek;
            if (newDuration >= minDur) {
                ghostTask.startWeek = currentWeek + 1;
                ghostTask.duration = newDuration;
            }
        } else {
            const newDuration = currentWeek - (resizingTask.originalStartWeek - 1);
            if (newDuration >= minDur) {
                ghostTask.startWeek = resizingTask.originalStartWeek;
                ghostTask.duration = newDuration;
            }
        }
        draw(); // Redibujar para mostrar la tarea "fantasma"
        return;
    }

    // --- Lógica de Arrastre ---
    if (draggingTask) {
        // Solo marcar como arrastre si se supera el umbral
        if (!draggingTask.didMove) {
            const dx = x - draggingTask.startX;
            const dy = y - draggingTask.startY;
            if (Math.sqrt(dx * dx + dy * dy) > 5) { // Umbral de 5px
                draggingTask.didMove = true;
            }
        }

        // Si es un arrastre confirmado, ejecutar la lógica
        if (draggingTask.didMove) {
            const { projectIndex, rowIndex, taskIndex } = draggingTask;
            const task = projects[projectIndex].tasksByRow[rowIndex][taskIndex];

            // Calcular la nueva semana de inicio basado en la posición del ratón.
            // Usar el DPR real del contexto (no window.devicePixelRatio) para evitar
            // desincronizaciones cuando hay zoom del browser o escala del sistema.
            const dpr = ctx.getTransform().a || 1;
            const chartWidth = canvas.width / dpr - projectLabelWidth;
            const weekWidth = chartWidth / totalWeeks;
            // Ajuste a la rejilla del modo actual (semanas o días).
            let newStartWeek = snapWeeks((x - projectLabelWidth - draggingTask.offsetX) / weekWidth);
            newStartWeek = Math.max(0, Math.min(newStartWeek, totalWeeks - task.duration));
            task.startWeek = newStartWeek + 1;

            // Calcular el destino potencial para el feedback visual usando el
            // layout cacheado del último render. Evita divergencias entre la
            // posición visual y la posición lógica del cursor.
            const layout = projectLayouts[projectIndex];
            let projectTopY, totalProjectHeight, rowTops, numRows;
            if (layout) {
                projectTopY = layout.startY + layout.topPad;
                totalProjectHeight = layout.totalTasksH;
                rowTops = layout.rowTops;
                numRows = layout.rowHeights.length;
            } else {
                // Fallback defensivo: si por alguna razón no hay layout cacheado.
                projectTopY = headerHeight;
                numRows = projects[projectIndex].tasksByRow.length;
                rowTops = [];
                let accY = 0;
                for (let i = 0; i < numRows; i++) {
                    rowTops.push(accY);
                    accY += getRowHeight(projects[projectIndex].tasksByRow[i]);
                }
                totalProjectHeight = accY;
            }

            // Determinar el destino de drop:
            // - Si el cursor cae en el tercio central de una fila existente → fusionar (merge)
            // - Si cae en el tercio superior/inferior (entre filas) → insertar nueva fila
            const projectBottomY = projectTopY + totalProjectHeight;
            const mergeZoneFraction = 0.34; // 34% central de cada fila activa el merge

            let newDropTarget = null;

            if (y > projectTopY - rowHeight / 2 && y < projectBottomY + rowHeight / 2) {
                // Identificar en qué fila estamos
                const relY = y - projectTopY;
                let hoveredRow = numRows - 1;
                for (let i = 0; i < numRows; i++) {
                    if (relY < rowTops[i] + getRowHeight(projects[projectIndex].tasksByRow[i])) {
                        hoveredRow = i;
                        break;
                    }
                }
                if (relY < 0) hoveredRow = -1;
                else if (relY >= totalProjectHeight) hoveredRow = numRows;
                const clampedRow = Math.max(0, Math.min(hoveredRow, numRows - 1));

                if (hoveredRow >= 0 && hoveredRow < numRows) {
                    const curRowHeight = getRowHeight(projects[projectIndex].tasksByRow[hoveredRow]);
                    // Si el cursor está en la misma fila de origen → sameRow (solo cambia startWeek)
                    if (hoveredRow === rowIndex) {
                        newDropTarget = { projectIndex, rowIndex: hoveredRow, sameRow: true };
                    } else {
                        // Posición relativa dentro de la fila [0..1]
                        const posInRow = (relY - rowTops[hoveredRow]) / curRowHeight;
                        const mergeMin = (1 - mergeZoneFraction) / 2;
                        const mergeMax = 1 - mergeMin;

                        if (posInRow >= mergeMin && posInRow <= mergeMax) {
                            // Zona central → merge con la fila existente
                            newDropTarget = { projectIndex, rowIndex: clampedRow, merge: true };
                        } else {
                            // Zona de borde → insertar nueva fila
                            const insertBefore = posInRow < mergeMin;
                            newDropTarget = { projectIndex, rowIndex: insertBefore ? hoveredRow : hoveredRow + 1, merge: false };
                        }
                    }
                } else {
                    // Por encima o por debajo de todas las filas
                    const insertSlot = hoveredRow < 0 ? 0 : numRows;
                    newDropTarget = { projectIndex, rowIndex: insertSlot, merge: false };
                }

            }

            draggingTask.dropTarget = newDropTarget;

            draw();
        }
    }
}

// --- FUNCIONES DE DIBUJO ---
function draw() {
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    // Dibujar el fondo principal (área del gráfico)
    ctx.fillStyle = canvasBodyBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Dibujar el fondo de la columna de proyectos (sidebar)
    ctx.fillStyle = canvasSidebarBg;
    const dprVal = window.devicePixelRatio || 1;
    ctx.fillRect(0, 0, projectLabelWidth, canvas.height / dprVal);

    // Columna actual (semana o día según el modo) con fondo sutil sobre las tareas.
    const _todayForDraw = new Date();
    const _startDateForDraw = getStartDate();
    const _daysDiff = (_todayForDraw - _startDateForDraw) / (1000 * 60 * 60 * 24);
    const _dpr = ctx.getTransform().a || 1;
    const _logicalW = canvas.width / _dpr;
    const _logicalH = canvas.height / _dpr;
    const _chartW = _logicalW - projectLabelWidth -
        (isDrawingForExport ? exportRightPadding : 0);
    const _weekW = _chartW / totalWeeks;
    if (viewMode === 'day') {
        const todayDayIndex = Math.floor(_daysDiff);
        if (todayDayIndex >= 0 && todayDayIndex < totalWeeks * 7) {
            const _dayW = _weekW / 7;
            const _dayX = projectLabelWidth + todayDayIndex * _dayW;
            ctx.fillStyle = todayColTint;
            ctx.fillRect(_dayX, headerHeight, _dayW, _logicalH - headerHeight);
        }
    } else {
        const todayWeekIndex = Math.floor(_daysDiff / 7);
        if (todayWeekIndex >= 0 && todayWeekIndex < totalWeeks) {
            const _weekX = projectLabelWidth + todayWeekIndex * _weekW;
            ctx.fillStyle = todayColTint;
            ctx.fillRect(_weekX, headerHeight, _weekW, _logicalH - headerHeight);
        }
    }

    drawGrid();
    drawProjects();

    if (draggingTask && draggingTask.didMove) {
        drawGhostTask();
    }

    if (draggingProject && draggingProject.didMove) {
        drawGhostProject();
    }

    const testStateEl = document.getElementById('app-test-state');
    if (testStateEl) {
        const currentState = {
            title: document.getElementById('cronograma-title').value,
            startMonth: document.getElementById('start-month').value,
            endMonth: document.getElementById('end-month').value,
            theme: document.getElementById('theme-selector').value,
            viewMode: viewMode,
            weekStart: viewMode === 'day' ? document.getElementById('start-week').value : '',
            weekEnd: viewMode === 'day' ? document.getElementById('end-week').value : '',
            lang: document.getElementById('lang-selector').value,
            projects: projects
        };
        const shareUrl = generateShareUrl();
        testStateEl.dataset.shareUrl = shareUrl;
        testStateEl.dataset.state = JSON.stringify(currentState);
        testStateEl.dataset.imageReady = 'true';
        testStateEl.innerText = JSON.stringify({ state: currentState, shareUrl, imageReady: true });
    }

    // Copiar la región del header al canvas sticky
    const hCanvas = document.getElementById('ganttHeaderCanvas');
    if (hCanvas && hCanvas.width > 0) {
        const hCtx = hCanvas.getContext('2d');
        hCtx.fillStyle = canvasHeaderBg;
        hCtx.fillRect(0, 0, hCanvas.width, hCanvas.height);
        hCtx.drawImage(canvas, 0, 0, canvas.width, hCanvas.height, 0, 0, hCanvas.width, hCanvas.height);
    }
}

function drawGrid() {
    ctx.fillStyle = canvasHeaderBg;
    ctx.fillRect(0, 0, canvas.width, headerHeight);

    const dpr = ctx.getTransform().a || 1;
    const logicalCanvasWidth = canvas.width / dpr;
    // En exportación reservamos un margen extra a la derecha para etiquetas de hitos
    // que NO debe contar como ancho del chart ni alterar el weekWidth.
    // In export we reserve extra right margin for milestone labels that must NOT
    // count toward chart width nor affect weekWidth.
    const chartWidth = logicalCanvasWidth - projectLabelWidth -
        (isDrawingForExport ? exportRightPadding : 0);
    const weekWidth = chartWidth / totalWeeks;
    const startDate = getStartDate();

    // Modo Semana/Día: cabecera con semanas arriba y días abajo.
    // Week/Day mode: header with weeks on top and days below.
    if (viewMode === 'day') {
        drawGridDays(chartWidth, weekWidth, startDate);
        return;
    }

    let lastMonth = -1;
    let monthStartX = projectLabelWidth;
    let weeksInCurrentMonth = 0;

    // Calcular índice de semana actual
    const todayGrid = new Date();
    const gridDaysDiff = (todayGrid - startDate) / (1000 * 60 * 60 * 24);
    const gridTodayWeekIndex = Math.floor(gridDaysDiff / 7);

    for (let i = 0; i < totalWeeks; i++) {
        const weekDate = new Date(startDate.getTime() + (i * 7 + 3) * 24 * 60 * 60 * 1000);
        const currentMonth = weekDate.getMonth();
        if (currentMonth !== lastMonth) {
            if (lastMonth !== -1) {
                ctx.fillStyle = canvasMonthOverlay;
                ctx.fillRect(monthStartX, 0, weeksInCurrentMonth * weekWidth, headerHeight);
                ctx.fillStyle = textColor;
                ctx.font = "bold 14px Poppins";
                ctx.textAlign = 'center';
                const prevWeekDate = new Date(startDate.getTime() + ((i - 1) * 7 + 3) * 24 * 60 * 60 * 1000);
                const monthWithYear = months[lastMonth].toUpperCase() + "'" + prevWeekDate.getFullYear().toString().substr(-2);
                ctx.fillText(monthWithYear, monthStartX + (weeksInCurrentMonth * weekWidth) / 2, headerHeight / 2 - 10);
            }
            lastMonth = currentMonth;
            monthStartX = projectLabelWidth + i * weekWidth;
            weeksInCurrentMonth = 0;
        }
        weeksInCurrentMonth++;

        const x = projectLabelWidth + i * weekWidth;
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, headerHeight);
        ctx.lineTo(x, canvas.height / (window.devicePixelRatio || 1));
        ctx.stroke();

        if (i === gridTodayWeekIndex) {
            // Fondo de acento en la celda de semana actual
            ctx.fillStyle = todayBadgeBg;
            ctx.fillRect(x, headerHeight / 2, weekWidth, headerHeight / 2);
            // Badge "HOY" / "TODAY"
            ctx.fillStyle = todayBadgeText;
            ctx.font = 'bold 8px Poppins';
            ctx.textAlign = 'center';
            ctx.fillText(getTranslation('todayLabel'), x + weekWidth / 2, headerHeight / 2 + 9);
            // Número de semana con acento
            ctx.fillStyle = todayWeekNumColor;
            ctx.font = 'bold ' + gridFont;
            ctx.textAlign = 'center';
            ctx.fillText(`${getTranslation('weekPrefix')}${i + 1}`, x + weekWidth / 2, headerHeight / 2 + 22);
        } else {
            ctx.fillStyle = canvasMutedText;
            ctx.font = gridFont;
            ctx.textAlign = 'center';
            ctx.fillText(`${getTranslation('weekPrefix')}${i + 1}`, x + weekWidth / 2, headerHeight / 2 + 15);
        }
    }

    if (lastMonth !== -1) {
        ctx.fillStyle = canvasMonthOverlay;
        ctx.fillRect(monthStartX, 0, weeksInCurrentMonth * weekWidth, headerHeight);
        ctx.fillStyle = textColor;
        ctx.font = "bold 14px Poppins";
        ctx.textAlign = 'center';
        const lastWeekDate = new Date(startDate.getTime() + ((totalWeeks - 1) * 7 + 3) * 24 * 60 * 60 * 1000);
        const monthWithYear = months[lastMonth].toUpperCase() + "'" + lastWeekDate.getFullYear().toString().substr(-2);
        ctx.fillText(monthWithYear, monthStartX + (weeksInCurrentMonth * weekWidth) / 2, headerHeight / 2 - 10);
    }

    ctx.strokeStyle = gridColor;
    ctx.beginPath();
    ctx.moveTo(0, headerHeight);
    ctx.lineTo(canvas.width, headerHeight);
    ctx.stroke();
}

// ES: Cuadrícula del modo Semana/Día. Cada semana se subdivide en 7 días.
//     La cabecera muestra las semanas arriba (S1, S2…) y los días abajo (número
//     y, si hay espacio, la inicial del día). El ancho de columna es 1/7 del de
//     una semana, por lo que la geometría de las barras no cambia respecto al
//     modo Mes/Semana.
// EN: Week/Day grid. Each week is split into 7 days. The header shows weeks on
//     top (W1, W2…) and days below (day number, plus the weekday initial when it
//     fits). Column width is 1/7 of a week, so task-bar geometry is identical to
//     Month/Week mode.
function drawGridDays(chartWidth, weekWidth, startDate) {
    const dpr = ctx.getTransform().a || 1;
    const bottomY = canvas.height / dpr;
    const dayWidth = weekWidth / 7;
    const totalDays = totalWeeks * 7;
    const midY = headerHeight / 2;

    const weekdayInitials = getTranslation('weekdayInitials') || [];

    // Índice del día de hoy respecto al lunes inicial.
    const todayGrid = new Date();
    const todayDayIndex = Math.floor((todayGrid - startDate) / (1000 * 60 * 60 * 24));

    const showDayNumber = dayWidth >= 13;
    const showWeekdayInitial = dayWidth >= 26;

    // 1) Bandas alternas por semana en la cabecera (ayuda a agrupar visualmente).
    for (let w = 0; w < totalWeeks; w++) {
        if (w % 2 === 1) {
            const wx = projectLabelWidth + w * weekWidth;
            ctx.fillStyle = canvasMonthOverlay;
            ctx.fillRect(wx, 0, weekWidth, headerHeight);
        }
    }

    // 2) Líneas de día (tenues) en la fila de días y el cuerpo.
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    for (let d = 1; d < totalDays; d++) {
        if (d % 7 === 0) continue; // las fronteras de semana se dibujan más marcadas después
        const dx = projectLabelWidth + d * dayWidth;
        ctx.beginPath();
        ctx.moveTo(dx, midY);
        ctx.lineTo(dx, bottomY);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 3) Resaltado de hoy en la cabecera (celda del día actual).
    if (todayDayIndex >= 0 && todayDayIndex < totalDays) {
        const tx = projectLabelWidth + todayDayIndex * dayWidth;
        ctx.fillStyle = todayBadgeBg;
        ctx.fillRect(tx, midY, dayWidth, midY);
    }

    // 4) Etiquetas y números de día.
    for (let d = 0; d < totalDays; d++) {
        const dx = projectLabelWidth + d * dayWidth;
        const dayDate = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
        const isToday = d === todayDayIndex;
        const cx = dx + dayWidth / 2;
        const wdIdx = (dayDate.getDay() + 6) % 7; // 0 = lunes

        if (showWeekdayInitial) {
            ctx.fillStyle = isToday ? todayWeekNumColor : canvasMutedText;
            ctx.font = '9px Poppins';
            ctx.textAlign = 'center';
            ctx.fillText(weekdayInitials[wdIdx] || '', cx, midY + 6);
        }
        if (showDayNumber) {
            ctx.fillStyle = isToday ? todayWeekNumColor : canvasMutedText;
            ctx.font = (isToday ? 'bold ' : '') + (dayWidth >= 22 ? gridFont : '10px Poppins');
            ctx.textAlign = 'center';
            const numY = showWeekdayInitial ? midY + 20 : midY + 15;
            ctx.fillText(String(dayDate.getDate()), cx, numY);
        }
    }

    // 5) Fronteras de semana (marcadas) en cabecera y cuerpo + etiqueta de semana.
    for (let w = 0; w <= totalWeeks; w++) {
        const x = projectLabelWidth + w * weekWidth;
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, bottomY);
        ctx.stroke();

        if (w < totalWeeks) {
            // Etiqueta de semana = fecha real del lunes (no "S1, S2…"), para
            // que se entienda dónde se está. Se añade el año en la 1ª semana o
            // al cambiar de año (p. ej. dic → ene).
            const monthNames = getTranslation('months') || months;
            const monday = new Date(startDate.getTime() + w * 7 * 24 * 60 * 60 * 1000);
            let label = `${monday.getDate()} ${monthNames[monday.getMonth()]}`;
            if (w === 0 || monday.getMonth() === 0) {
                label += ` '${String(monday.getFullYear()).slice(-2)}`;
            }
            ctx.fillStyle = textColor;
            ctx.font = 'bold 13px Poppins';
            ctx.textAlign = 'center';
            ctx.fillText(label, x + weekWidth / 2, midY - 10);
        }
    }

    // 6) Separadores horizontales: entre fila de semanas/días y bajo la cabecera.
    ctx.strokeStyle = gridColor;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(projectLabelWidth, midY);
    ctx.lineTo(canvas.width, midY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.moveTo(0, headerHeight);
    ctx.lineTo(canvas.width, headerHeight);
    ctx.stroke();
}

function drawProjects() {
    let y = headerHeight;
    taskHitboxes = [];
    projectHitboxes = [];
    if (!isDrawingForExport) {
        addTaskHitboxes = []; // Limpiar hitboxes en cada redibujado
        projectLayouts = [];
    }

    projects.forEach((project, projectIndex) => {
        if (draggingProject && draggingProject.didMove && draggingProject.targetIndex === projectIndex) {
            drawProjectDropLine(y);
        }

        const projectStartY = y;

        const isDraggingThisProject = draggingProject && draggingProject.didMove && draggingProject.projectIndex === projectIndex;
        if (isDraggingThisProject) {
            ctx.globalAlpha = 0.3;
        }

        // --- Layout del proyecto: cabecera (nombre + botón) en columna izquierda,
        //     tareas en la columna derecha. La altura del proyecto = max(cabecera, tareas).
        // --- Project layout: header (name + button) on left column, tasks on right.
        //     Project height = max(headerBlock, tasksBlock).
        const textX = 20;
        const maxTextWidth = projectLabelWidth - textX - 10;
        const topPad = 14;
        const bottomPad = 14;
        const lineHeight = 20;
        const nameToBtnGap = 12;
        const buttonHeight = 26;
        const buttonWidth = 130;

        ctx.font = projectFont;
        const lines = wrapText(ctx, project.name, maxTextWidth);
        const nameBlockH = lines.length * lineHeight;

        const includeButton = !isDrawingForExport;
        const headerBlockH = topPad + nameBlockH +
            (includeButton ? nameToBtnGap + buttonHeight : 0) + bottomPad;

        const rowHeights = project.tasksByRow.map(row => getRowHeight(row));
        let tasksTotalH = 0;
        rowHeights.forEach(h => { tasksTotalH += h; });
        const tasksBlockH = tasksTotalH > 0 ? topPad + tasksTotalH + bottomPad : 0;

        const projectInnerH = Math.max(headerBlockH, tasksBlockH);

        // Guardar el layout para que la lógica de drag use exactamente las
        // mismas coordenadas que el render. Solo durante render interactivo
        // (no durante exportación a imagen).
        if (!isDrawingForExport) {
            const rowTops = [];
            let accRow = 0;
            for (let i = 0; i < rowHeights.length; i++) {
                rowTops.push(accRow);
                accRow += rowHeights[i];
            }
            projectLayouts[projectIndex] = {
                startY: projectStartY,
                innerH: projectInnerH,
                topPad,
                rowTops,
                rowHeights,
                totalTasksH: tasksTotalH
            };
        }

        // Fondo tintado de la columna izquierda con el color del proyecto
        // Tinted background for the left column using the project color
        ctx.fillStyle = hexToRgba(project.color, 0.07);
        ctx.fillRect(0, projectStartY, projectLabelWidth, projectInnerH);

        // Nombre del proyecto centrado horizontal y verticalmente en la columna izquierda
        // Project name centered horizontally and vertically in the left column
        const headerContentH = nameBlockH +
            (includeButton ? nameToBtnGap + buttonHeight : 0);
        const headerContentY = projectStartY + (projectInnerH - headerContentH) / 2;

        ctx.fillStyle = project.color;
        ctx.font = projectFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const nameY = headerContentY;
        const centerX = projectLabelWidth / 2;
        lines.forEach((line, i) => {
            ctx.fillText(line, centerX, nameY + i * lineHeight);
        });

        // Botón "+ Añadir tarea" centrado debajo del nombre
        // "+ Add task" button centered below the name
        if (includeButton) {
            const btnY = nameY + nameBlockH + nameToBtnGap;
            const btnX = (projectLabelWidth - buttonWidth) / 2;
            ctx.fillStyle = canvasBodyBg;
            ctx.strokeStyle = hexToRgba(project.color, 0.35);
            ctx.lineWidth = 1;
            roundRect(ctx, btnX, btnY, buttonWidth, buttonHeight, 13, true, true);

            ctx.fillStyle = textColor;
            ctx.font = '12px Poppins';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(getTranslation('addTaskAction'), btnX + buttonWidth / 2, btnY + buttonHeight / 2);

            addTaskHitboxes.push({
                x: btnX,
                y: btnY,
                width: buttonWidth,
                height: buttonHeight,
                projectIndex
            });
        }

        // Dibujar las filas de tareas en la columna derecha, alineadas al top del proyecto
        // Draw task rows on the right column, aligned to the top of the project
        const isDropTargetProject = draggingTask && draggingTask.didMove && draggingTask.dropTarget?.projectIndex === projectIndex;
        const dropRowIndex = isDropTargetProject ? draggingTask.dropTarget.rowIndex : -1;
        const isMerge = isDropTargetProject && draggingTask.dropTarget?.merge;

        let rowY = projectStartY + topPad;
        const numRows = project.tasksByRow.length;
        for (let i = 0; i <= numRows; i++) {
            // Placeholder de inserción (nueva fila) — solo cuando NO es merge
            if (isDropTargetProject && !isMerge && i === dropRowIndex) {
                drawPlaceholder(rowY);
                rowY += rowHeight;
            }

            if (i < numRows) {
                const currentRowHeight = getRowHeight(project.tasksByRow[i]);
                // Highlight de merge — resaltar la fila destino
                if (isDropTargetProject && isMerge && i === dropRowIndex) {
                    drawMergeHighlight(rowY);
                }
                project.tasksByRow[i].forEach((task, taskIndex) => {
                    drawTaskBar(task, project, rowY + currentRowHeight / 2, projectIndex, i, taskIndex);
                });
                rowY += currentRowHeight;
            }
        }

        // Avanzar y al final del proyecto (la mayor entre cabecera y bloque de tareas)
        // Advance y to the end of the project (max of header and tasks block)
        y = projectStartY + projectInnerH;

        // Línea fina divisoria entre proyectos (no después del último)
        // Thin divider line between projects (skipped after the last one)
        if (projectIndex < projects.length - 1) {
            const dpr = ctx.getTransform().a || 1;
            const logicalCanvasWidth = canvas.width / dpr;
            ctx.save();
            ctx.strokeStyle = gridColor;
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.moveTo(0, y + 0.5);
            ctx.lineTo(logicalCanvasWidth, y + 0.5);
            ctx.stroke();
            ctx.restore();
        }

        const projectHitbox = {
            x: 0,
            y: projectStartY,
            width: projectLabelWidth,
            height: y - projectStartY,
            projectIndex
        };
        projectHitboxes.push(projectHitbox);

        if (isDraggingThisProject) {
            ctx.globalAlpha = 1.0;
        }
    });

    if (draggingProject && draggingProject.didMove && draggingProject.targetIndex === projects.length) {
        drawProjectDropLine(y);
    }
}

function drawProjectDropLine(y) {
    ctx.save();
    ctx.strokeStyle = '#4A90E2';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(projectLabelWidth, y);
    ctx.stroke();
    ctx.restore();
}

function drawTaskBar(task, project, y, projectIndex, rowIndex, taskIndex) {
    const isDraggingThisTask = draggingTask && draggingTask.projectIndex === projectIndex && draggingTask.rowIndex === rowIndex && draggingTask.taskIndex === taskIndex;
    if (isDraggingThisTask) {
        return; // El "fantasma" se dibujará por separado para que siga al cursor
    }

    const dpr = ctx.getTransform().a || 1;
    const logicalCanvasWidth = canvas.width / dpr;
    // En exportación reservamos un margen a la derecha para etiquetas de hitos
    // que NO debe afectar al ancho del chart ni al weekWidth.
    // In export we reserve a right margin for milestone labels that must NOT
    // affect chart width nor weekWidth.
    const exportPad = isDrawingForExport ? exportRightPadding : 0;
    const chartWidth = logicalCanvasWidth - projectLabelWidth - exportPad;
    const weekWidth = chartWidth / totalWeeks;
    const isCompact = !!task.compact;
    const barHeight = isCompact ? 14 : 30;
    const barY = y - barHeight / 2;
    const startX = projectLabelWidth + (task.startWeek - 1) * weekWidth;
    const fullBarWidth = task.duration * weekWidth;
    let barWidth = fullBarWidth * animationProgress;

    // Si la barra está completamente fuera del rango visible del grid, no dibujar
    const taskEndX = startX + fullBarWidth;
    if (taskEndX < projectLabelWidth || startX > projectLabelWidth + chartWidth) return;

    const hitbox = { x: Math.max(startX, projectLabelWidth), y: barY, width: barWidth, height: barHeight, projectIndex, rowIndex, taskIndex };

    if (task.isMilestone) {
        const diamondSize = isCompact ? 12 : 20;
        hitbox.width = diamondSize;
        hitbox.height = diamondSize;
        hitbox.y = y - diamondSize / 2;
    }
    taskHitboxes.push(hitbox);

    const isDragging = draggingTask && draggingTask.projectIndex === projectIndex && draggingTask.rowIndex === rowIndex && draggingTask.taskIndex === taskIndex;
    const isResizing = resizingTask && resizingTask.projectIndex === projectIndex && resizingTask.rowIndex === rowIndex && resizingTask.taskIndex === taskIndex;

    // Clip al área del gráfico (incluyendo el margen extra de exportación, donde
    // pueden extenderse las etiquetas de hitos), evitando invadir la zona de etiquetas izquierda.
    // Clip to the chart area (including the export right margin where milestone labels
    // may extend), preventing bleed into the left label column.
    ctx.save();
    ctx.beginPath();
    ctx.rect(projectLabelWidth, headerHeight, chartWidth + exportPad, canvas.height / dpr - headerHeight);
    ctx.clip();

    ctx.fillStyle = task.completed ? '#666666' : (task.color || project.color);
    if (isDragging) ctx.globalAlpha = 0.6;
    if (isResizing) ctx.globalAlpha = 0.4;

    if (task.isMilestone) {
        const diamondSize = isCompact ? 12 : 20;
        ctx.save();
        ctx.translate(startX + diamondSize / 2, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-diamondSize / 2, -diamondSize / 2, diamondSize, diamondSize);
        ctx.restore();
    } else {
        const barRadius = isCompact ? 4 : 8;
        roundRect(ctx, startX, barY, barWidth, barHeight, barRadius, true, false);
    }
    if (isDragging || isResizing) ctx.globalAlpha = 1.0;

    if (isResizing) {
        const ghostStartX = projectLabelWidth + (ghostTask.startWeek - 1) * weekWidth;
        const ghostWidth = ghostTask.duration * weekWidth;
        const ghostBarRadius = isCompact ? 4 : 8;
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#E0E0E0';
        ctx.lineWidth = 1;
        roundRect(ctx, ghostStartX, barY, ghostWidth, barHeight, ghostBarRadius, true, true);
        ctx.globalAlpha = 1.0;
    }

    if (!isDragging && !isResizing) {
        ctx.font = isCompact ? compactTaskFont : taskFont;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        let text = task.name;
        const textMetrics = ctx.measureText(text);
        const textY = y;

        if (task.isMilestone) {
            const diamondSize = isCompact ? 12 : 20;
            ctx.fillStyle = textColor;
            // Truncar si el texto es muy largo y choca con el borde del canvas
            let milestoneText = text;
            const textOffsetX = diamondSize + 5;
            const maxMilestoneTextWidth = logicalCanvasWidth - (startX + textOffsetX + 10);
            if (textMetrics.width > maxMilestoneTextWidth) {
                milestoneText = truncateText(ctx, text, maxMilestoneTextWidth);
            }
            ctx.fillText(milestoneText, startX + textOffsetX, textY);
            ctx.restore();
            return;
        }

        const textPad = isCompact ? 16 : 30;
        const textPadInner = isCompact ? 6 : 15;
        const textFitsInside = fullBarWidth > textMetrics.width + textPad;
        if (task.textPosition === 'inside' && textFitsInside) {
            if (barWidth > textMetrics.width + textPad) {
                ctx.fillStyle = '#FFFFFF';
                ctx.save();
                ctx.beginPath();
                ctx.rect(startX, barY, barWidth, barHeight);
                ctx.clip();
                ctx.fillText(text, startX + textPadInner, textY);
                ctx.restore();
            }
        } else if (task.textPosition === 'inside') {
            // Si el texto debería ir dentro pero no cabe, truncarlo
            const minBarForText = isCompact ? 24 : 40;
            if (barWidth > minBarForText) {
                ctx.fillStyle = '#FFFFFF';
                ctx.save();
                ctx.beginPath();
                ctx.rect(startX, barY, barWidth, barHeight);
                ctx.clip();
                const truncatedInsideText = truncateText(ctx, text, barWidth - (isCompact ? 12 : 20));
                ctx.fillText(truncatedInsideText, startX + (isCompact ? 6 : 10), textY);
                ctx.restore();
            }
        } else {
            if (animationProgress > 0.95) {
                ctx.fillStyle = textColor;
                const textX = startX + fullBarWidth + 10;
                if (textX + textMetrics.width > logicalCanvasWidth) {
                    ctx.textAlign = 'right';
                    ctx.fillText(text, startX - 10, textY);
                } else {
                    ctx.textAlign = 'left';
                    ctx.fillText(text, textX, textY);
                }
            }
        }
    }

    if (task.completed) {
        let centerX = task.isMilestone ? startX + (isCompact ? 6 : 10) : startX + barWidth / 2;
        drawCheckIcon(ctx, centerX, y, isCompact ? 6 : 11);
    }

    ctx.restore(); // Restaurar el clipping del área del gráfico
}

function drawPlaceholder(y) {
    ctx.save();
    const dpr = window.devicePixelRatio || 1;
    ctx.fillStyle = canvasHighlightBg;
    ctx.fillRect(projectLabelWidth, y, canvas.width / dpr - projectLabelWidth, rowHeight);
    ctx.strokeStyle = textColor;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeRect(projectLabelWidth, y, canvas.width / dpr - projectLabelWidth, rowHeight);
    ctx.restore();
}

function drawMergeHighlight(y) {
    ctx.save();
    const dpr = window.devicePixelRatio || 1;
    ctx.fillStyle = 'rgba(100, 200, 255, 0.12)';
    ctx.fillRect(projectLabelWidth, y, canvas.width / dpr - projectLabelWidth, rowHeight);
    ctx.strokeStyle = 'rgba(100, 200, 255, 0.7)';
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(projectLabelWidth, y, canvas.width / dpr - projectLabelWidth, rowHeight);
    ctx.restore();
}

function drawGhostProject() {
    if (!draggingProject || !draggingProject.didMove) return;
    const project = projects[draggingProject.projectIndex];
    if (!project) return;

    const ghostY = lastMousePosition.y - draggingProject.offsetY;

    ctx.globalAlpha = 0.8;
    ctx.fillStyle = canvasSidebarBg;
    ctx.fillRect(0, ghostY - 10, projectLabelWidth, 40);

    ctx.fillStyle = project.color;
    ctx.font = projectFont;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const ghostMaxWidth = projectLabelWidth - 30;
    const ghostLines = wrapText(ctx, project.name, ghostMaxWidth);
    const ghostLineHeight = 18;
    const ghostBaseY = ghostY + 10 - (ghostLines.length - 1) * ghostLineHeight / 2;
    ghostLines.forEach((line, i) => {
        ctx.fillText(line, 20, ghostBaseY + i * ghostLineHeight);
    });

    ctx.globalAlpha = 1.0;
}

function drawGhostTask() {
    const { projectIndex, rowIndex, taskIndex, offsetX, offsetY } = draggingTask;
    const task = projects[projectIndex].tasksByRow[rowIndex][taskIndex];
    const project = projects[projectIndex];

    // Calcular posición y dimensiones
    const isCompact = !!task.compact;
    const barHeight = isCompact ? 14 : 30;
    const barY = lastMousePosition.y - offsetY;
    const dpr = ctx.getTransform().a || 1;
    const chartWidth = canvas.width / dpr - projectLabelWidth;
    const weekWidth = chartWidth / totalWeeks;
    const startX = projectLabelWidth + (task.startWeek - 1) * weekWidth;
    const barWidth = task.duration * weekWidth;

    // Dibujar con transparencia
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = task.color || project.color;

    if (task.isMilestone) {
        const diamondSize = isCompact ? 12 : 20;
        ctx.save();
        ctx.translate(startX + diamondSize / 2, lastMousePosition.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-diamondSize / 2, -diamondSize / 2, diamondSize, diamondSize);
        ctx.restore();
    } else {
        const barRadius = isCompact ? 4 : 8;
        roundRect(ctx, startX, barY, barWidth, barHeight, barRadius, true, false);
    }

    // Dibujar el texto dentro del fantasma
    ctx.font = isCompact ? compactTaskFont : taskFont;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(task.name, startX + (isCompact ? 6 : 15), barY + barHeight / 2);

    ctx.globalAlpha = 1.0;
}

// --- FUNCIONES AUXILIARES ---
function createFloatingInput(hitbox) {
    const existingInput = document.querySelector('.floating-input');
    if (existingInput) existingInput.remove();

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'floating-input';
    input.value = projects[hitbox.projectIndex].name;

    const canvasContainer = document.getElementById('canvas-container');
    if (getComputedStyle(canvasContainer).position !== 'relative') {
        canvasContainer.style.position = 'relative';
    }

    const dpr = window.devicePixelRatio || 1;
    input.style.left = `${hitbox.x}px`;
    input.style.top = `${hitbox.y}px`;
    input.style.width = `${hitbox.width + 20}px`;
    input.style.height = `${hitbox.height}px`;
    input.style.font = projectFont;

    canvasContainer.appendChild(input);
    input.focus();
    input.select();

    const saveAndRemove = () => {
        updateProjectName(hitbox.projectIndex, input.value);
        if (input.parentElement) input.parentElement.removeChild(input);
        document.removeEventListener('mousedown', handleClickOutside, true);
        input.removeEventListener('keydown', handleKeyDown);
    };
    const handleKeyDown = e => {
        if (e.key === 'Enter') saveAndRemove();
        else if (e.key === 'Escape') {
            if (input.parentElement) input.parentElement.removeChild(input);
            document.removeEventListener('mousedown', handleClickOutside, true);
            input.removeEventListener('keydown', handleKeyDown);
            updatePreview();
        }
    };
    const handleClickOutside = e => {
        if (!input.contains(e.target)) saveAndRemove();
    };
    setTimeout(() => {
        input.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handleClickOutside, true);
    }, 100);
}

// Removido drawProjectIcons y getIconUnderCursor porque ya no se usan

// --- UTILIDADES ---
function truncateText(ctx, text, maxWidth) {
    if (maxWidth < 10) return "";
    let width = ctx.measureText(text).width;
    if (width <= maxWidth) return text;

    let truncated = text;
    while (width > maxWidth && truncated.length > 0) {
        truncated = truncated.slice(0, -1);
        width = ctx.measureText(truncated + "...").width;
    }
    return truncated + "...";
}

// Convierte un color (hex #RRGGBB / #RGB / rgb / nombre css) a rgba con alfa dado.
// Converts a color (hex #RRGGBB / #RGB / rgb / css name) to rgba with given alpha.
function hexToRgba(color, alpha) {
    if (!color) return `rgba(128,128,128,${alpha})`;
    let c = String(color).trim();
    if (c.startsWith('rgb')) {
        const nums = c.match(/[\d.]+/g);
        if (nums && nums.length >= 3) {
            return `rgba(${nums[0]}, ${nums[1]}, ${nums[2]}, ${alpha})`;
        }
        return c;
    }
    if (c.startsWith('#')) c = c.slice(1);
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    if (c.length !== 6) return `rgba(128,128,128,${alpha})`;
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
}

function drawCheckIcon(ctx, x, y, radius) {
    ctx.save();
    // Círculo verde de fondo
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#4CAF50';
    ctx.fill();
    // Borde blanco
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();

    // Visto blanco
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.4, y);
    ctx.lineTo(x - radius * 0.1, y + radius * 0.35);
    ctx.lineTo(x + radius * 0.4, y - radius * 0.35);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
}

function animate(currentTime) {
    draw();
}

function getStartDate() {
    if (viewMode === 'day') {
        const sw = document.getElementById('start-week');
        if (sw && sw.value) return mondayOf(parseISODate(sw.value));
    }
    const selectedMonth = parseInt(document.getElementById('start-month').value);
    const date = new Date(new Date().getFullYear(), selectedMonth, 1);
    while (date.getDay() !== 1) date.setDate(date.getDate() + 1);
    return date;
}

function getEndDate() {
    if (viewMode === 'day') {
        const sw = document.getElementById('start-week');
        const ew = document.getElementById('end-week');
        if (sw && sw.value && ew && ew.value) {
            const startMonday = mondayOf(parseISODate(sw.value));
            let endMonday = mondayOf(parseISODate(ew.value));
            const maxEndMonday = new Date(startMonday.getTime() + (MAX_DAYVIEW_WEEKS - 1) * 7 * 24 * 60 * 60 * 1000);
            if (endMonday.getTime() < startMonday.getTime()) endMonday = new Date(startMonday);
            if (endMonday.getTime() > maxEndMonday.getTime()) endMonday = maxEndMonday;
            // Domingo de la semana final para incluirla completa.
            return new Date(endMonday.getTime() + 6 * 24 * 60 * 60 * 1000);
        }
    }
    const selectedMonth = parseInt(document.getElementById('end-month').value);
    const startDate = getStartDate();
    let year = startDate.getFullYear();
    if (selectedMonth < startDate.getMonth()) year++;
    return new Date(year, selectedMonth + 1, 0);
}

function calculateTotalWeeks() {
    const startDate = getStartDate();
    const endDate = getEndDate();
    const diffTime = endDate.getTime() - startDate.getTime();
    const diffWeeks = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 7));
    // En modo día permitimos rangos cortos (mínimo 1 semana) y topamos a 12.
    if (viewMode === 'day') return Math.min(MAX_DAYVIEW_WEEKS, Math.max(1, diffWeeks));
    return Math.max(4, diffWeeks);
}

function checkCollision(taskA, taskB) {
    const endA = taskA.startWeek + taskA.duration;
    const endB = taskB.startWeek + taskB.duration;
    return (endA > taskB.startWeek && taskA.startWeek < endB);
}

function findLatestEndWeek(projectIndex) {
    let latestEnd = 0;
    const project = projects[projectIndex];
    if (!project) return 1;

    project.tasksByRow.forEach(row => {
        row.forEach(task => {
            const endWeek = task.startWeek + task.duration;
            if (endWeek > latestEnd) {
                latestEnd = endWeek;
            }
        });
    });
    // Si no hay tareas, empezar en la semana 1. Si las hay, empezar después de la última.
    return latestEnd === 0 ? 1 : latestEnd;
}

function addSimpleTask(projectIndex) {
    const p = projects[projectIndex];
    if (!p) return;

    // Encontrar la última semana para este proyecto para que la nueva tarea empiece después
    const latestEndWeek = findLatestEndWeek(projectIndex);

    const newTask = {
        name: getTranslation('newTaskDefault'),
        startWeek: Math.min(Math.ceil(latestEndWeek), totalWeeks), // No pasar de la última semana visible
        duration: 1, // Duración por defecto
        type: 'normal',
        isMilestone: false,
        textPosition: 'outside',
        compact: isProjectCompact(projectIndex)
    };

    // Añadir la tarea a la primera fila libre o a una nueva
    // (Lógica simplificada: la añade al final)
    p.tasksByRow.push([newTask]);

    updatePreview();
    saveToHistory();
}

// --- API PARA AGENTES DE IA / AI AGENT API ---

/**
 * Genera una imagen del cronograma completo y la devuelve como data URL (base64 PNG).
 * Returns the full schedule as a base64 PNG data URL.
 */
async function getImageDataUrl() {
    if (document.activeElement) document.activeElement.blur();
    await new Promise(resolve => setTimeout(resolve, 50));

    const originalTotalWeeks = totalWeeks;
    ctx.save();

    try {
        let maxEndWeek = 0;
        projects.forEach(p => {
            p.tasksByRow.forEach(row => {
                row.forEach(task => {
                    maxEndWeek = Math.max(maxEndWeek, task.startWeek + task.duration);
                });
            });
        });

        const selectorWeeks = calculateTotalWeeks();
        const exportTotalWeeks = selectorWeeks;
        // En modo día ampliamos la columna de semana (7 días) para que los días
        // y las etiquetas de fecha de la cabecera no se solapen.
        const EXPORT_WEEK_WIDTH = viewMode === 'day' ? 7 * 28 : 50;
        const chartLogicalWidth = exportTotalWeeks * EXPORT_WEEK_WIDTH;

        // Calcular margen extra a la derecha para que las etiquetas de hitos
        // (textPosition='outside') no queden cortadas en el borde del chart.
        // Compute extra right margin so milestone labels do not get clipped at chart edge.
        exportRightPadding = computeExportRightPadding(exportTotalWeeks, EXPORT_WEEK_WIDTH);

        const exportLogicalWidth = projectLabelWidth + chartLogicalWidth + exportRightPadding;

        // Altura proyecto a proyecto reproduciendo el layout real (sin botón en exportación)
        // Per-project height matching the real layout (no button in export)
        let exportLogicalHeight = headerHeight;
        projects.forEach(p => { exportLogicalHeight += computeProjectInnerHeight(p, false); });
        exportLogicalHeight += PROJ_HEADER_BOTTOM_MARGIN;

        const EXPORT_DPR = 2;
        canvas.width = exportLogicalWidth * EXPORT_DPR;
        canvas.height = exportLogicalHeight * EXPORT_DPR;
        ctx.scale(EXPORT_DPR, EXPORT_DPR);

        totalWeeks = exportTotalWeeks;
        isDrawingForExport = true;
        draw();

        return canvas.toDataURL('image/png');
    } finally {
        ctx.restore();
        totalWeeks = originalTotalWeeks;
        isDrawingForExport = false;
        exportRightPadding = 0;
        initCanvasSize();
        draw();
    }
}

// Calcula cuánto sobresalen las etiquetas de hitos (textPosition='outside') más allá
// del último día del chart, devolviendo el margen extra necesario en píxeles lógicos.
// Computes how much milestone labels (textPosition='outside') overflow past the chart
// right edge, returning the extra logical-pixel margin needed.
function computeExportRightPadding(exportTotalWeeks, weekW) {
    const chartLimit = exportTotalWeeks * weekW;
    let maxOverflow = 0;
    ctx.save();
    projects.forEach(p => {
        p.tasksByRow.forEach(row => {
            row.forEach(task => {
                if (!task.isMilestone) return;
                const isCompact = !!task.compact;
                ctx.font = isCompact ? compactTaskFont : taskFont;
                const diamondSize = isCompact ? 12 : 20;
                const textW = ctx.measureText(task.name).width;
                const labelStartX = (task.startWeek - 1) * weekW + diamondSize + 5;
                const labelEndX = labelStartX + textW;
                const overflow = labelEndX - chartLimit;
                if (overflow > maxOverflow) maxOverflow = overflow;
            });
        });
    });
    ctx.restore();
    return maxOverflow > 0 ? Math.ceil(maxOverflow + 12) : 0;
}

/**
 * API global para interacción programática / headless.
 * Global API object for programmatic and headless interaction.
 *
 * Methods:
 *   getState()            → current state object
 *   setState(obj)          → load state from object
 *   createFromJSON(str)    → load state from JSON string or object
 *   loadFromJSON(str)      → alias for createFromJSON
 *   getShareUrl()          → URL with #s= hash
 *   exportAsURL()          → alias for getShareUrl
 *   getImageDataUrl()      → Promise<string> PNG data URL
 *   exportAsImage()        → alias for getImageDataUrl
 *   validateState(obj)     → { valid: boolean, errors: string[] }
 *   selfTest()             → Promise<object> run full self-test
 */
window.CronogramaAPI = {
    version: '3.0',
    agentMode: _agentMode,

    getState() {
        return {
            title: document.getElementById('cronograma-title').value,
            startMonth: document.getElementById('start-month').value,
            endMonth: document.getElementById('end-month').value,
            theme: document.getElementById('theme-selector').value,
            lang: document.getElementById('lang-selector').value,
            projects: JSON.parse(JSON.stringify(projects))
        };
    },

    setState(stateObj) {
        applyState(stateObj);
        saveToHistory();
        if (_agentMode) console.log('[CronogramaAI] setState applied.');
    },

    createFromJSON(jsonOrStr) {
        const data = typeof jsonOrStr === 'string' ? JSON.parse(jsonOrStr) : jsonOrStr;
        applyState(data);
        saveToHistory();
        if (_agentMode) console.log('[CronogramaAI] createFromJSON applied.');
    },

    loadFromJSON(jsonOrStr) {
        return this.createFromJSON(jsonOrStr);
    },

    getShareUrl() {
        return generateShareUrl();
    },

    exportAsURL() {
        return this.getShareUrl();
    },

    async getImageDataUrl() {
        return await getImageDataUrl();
    },

    async exportAsImage() {
        return await this.getImageDataUrl();
    },

    validateState(stateObj) {
        const errors = [];
        if (!stateObj || typeof stateObj !== 'object') {
            return { valid: false, errors: ['State must be a non-null object'] };
        }
        if (typeof stateObj.title !== 'string') errors.push('title must be a string');
        const sm = parseInt(stateObj.startMonth);
        if (isNaN(sm) || sm < 0 || sm > 11) errors.push('startMonth must be 0–11');
        const em = parseInt(stateObj.endMonth);
        if (isNaN(em) || em < 0 || em > 11) errors.push('endMonth must be 0–11');
        if (!['oscuro', 'claro', 'moderno', 'gris'].includes(stateObj.theme)) errors.push('theme must be one of: oscuro, claro, moderno, gris');
        if (!['es', 'en'].includes(stateObj.lang)) errors.push('lang must be "es" or "en"');
        if (!Array.isArray(stateObj.projects)) {
            errors.push('projects must be an array');
        } else {
            stateObj.projects.forEach((p, pi) => {
                if (typeof p.name !== 'string') errors.push(`projects[${pi}].name must be a string`);
                if (typeof p.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(p.color)) errors.push(`projects[${pi}].color must be a hex color like #5B8CC8`);
                if (!Array.isArray(p.tasksByRow)) {
                    errors.push(`projects[${pi}].tasksByRow must be an array`);
                } else {
                    p.tasksByRow.forEach((row, ri) => {
                        if (!Array.isArray(row)) { errors.push(`projects[${pi}].tasksByRow[${ri}] must be an array`); return; }
                        row.forEach((t, ti) => {
                            if (typeof t.name !== 'string') errors.push(`projects[${pi}].tasksByRow[${ri}][${ti}].name must be a string`);
                            if (typeof t.startWeek !== 'number' || !isFinite(t.startWeek) || t.startWeek < 1) errors.push(`projects[${pi}].tasksByRow[${ri}][${ti}].startWeek must be a number >= 1`);
                            if (typeof t.duration !== 'number' || !isFinite(t.duration) || t.duration <= 0) errors.push(`projects[${pi}].tasksByRow[${ri}][${ti}].duration must be a number > 0`);
                        });
                    });
                }
            });
        }
        return { valid: errors.length === 0, errors };
    },

    async selfTest() {
        const results = { passed: [], failed: [], success: false };
        const log = (label, ok, detail) => {
            (ok ? results.passed : results.failed).push({ test: label, detail });
            if (_agentMode) console.log(`[CronogramaAI] selfTest [${ok ? 'PASS' : 'FAIL'}] ${label}`, detail || '');
        };

        // Test: cargar estado de ejemplo
        const exampleState = {
            title: 'Self Test Schedule', startMonth: '0', endMonth: '5',
            theme: 'oscuro', lang: 'en',
            projects: [{
                name: 'Test Project', color: '#5B8CC8',
                tasksByRow: [[{ name: 'Task A', startWeek: 1, duration: 4, isMilestone: false, textPosition: 'outside', compact: false, completed: false, color: null }]]
            }]
        };
        try {
            this.createFromJSON(exampleState);
            log('createFromJSON', true);
        } catch (e) { log('createFromJSON', false, e.message); }

        // Test: getState
        try {
            const s = this.getState();
            log('getState', s && s.title === 'Self Test Schedule', s ? s.title : 'null');
        } catch (e) { log('getState', false, e.message); }

        // Test: validateState (valid)
        try {
            const v = this.validateState(exampleState);
            log('validateState (valid)', v.valid, v.errors);
        } catch (e) { log('validateState (valid)', false, e.message); }

        // Test: validateState (invalid)
        try {
            const v = this.validateState({ title: 123, startMonth: 99, endMonth: -1, theme: 'x', lang: 'fr', projects: 'nope' });
            log('validateState (detects errors)', v.errors.length >= 5, `${v.errors.length} errors found`);
        } catch (e) { log('validateState (detects errors)', false, e.message); }

        // Test: getShareUrl
        try {
            const url = this.getShareUrl();
            log('getShareUrl', typeof url === 'string' && url.includes('#s='), url.substring(0, 60) + '...');
        } catch (e) { log('getShareUrl', false, e.message); }

        // Test: exportAsURL alias
        try {
            const url = this.exportAsURL();
            log('exportAsURL (alias)', typeof url === 'string' && url.includes('#s='));
        } catch (e) { log('exportAsURL (alias)', false, e.message); }

        // Test: getImageDataUrl
        try {
            const img = await this.getImageDataUrl();
            log('getImageDataUrl', typeof img === 'string' && img.startsWith('data:image/png;base64,'), `length=${img.length}`);
        } catch (e) { log('getImageDataUrl', false, e.message); }

        // Test: exportAsImage alias
        try {
            const img = await this.exportAsImage();
            log('exportAsImage (alias)', typeof img === 'string' && img.startsWith('data:image/png'));
        } catch (e) { log('exportAsImage (alias)', false, e.message); }

        // Test: #app-test-state
        try {
            const el = document.getElementById('app-test-state');
            log('#app-test-state has data-share-url', el && !!el.dataset.shareUrl);
            log('#app-test-state has data-state', el && !!el.dataset.state);
            log('#app-test-state data-image-ready', el && el.dataset.imageReady === 'true');
        } catch (e) { log('#app-test-state', false, e.message); }

        results.success = results.failed.length === 0;
        results.summary = `${results.passed.length} passed, ${results.failed.length} failed`;
        console.log('[CronogramaAI] selfTest complete:', results.summary);
        return results;
    }
};

// --- FUNCIONALIDAD DE COPIAR IMAGEN ---

async function copyChartToClipboard() {
    console.log("Iniciando copia al portapapeles...");

    // 1. Quitar foco para que no salgan inputs en la captura
    if (document.activeElement) {
        document.activeElement.blur();
    }
    await new Promise(resolve => setTimeout(resolve, 50));

    // Guardar estado original
    const originalTotalWeeks = totalWeeks;
    ctx.save(); // Guarda el estado del contexto actual (transformaciones, etc.)

    try {
        // 2. Calcular las dimensiones lógicas finales para la exportación
        let maxEndWeek = 0;
        projects.forEach(p => {
            p.tasksByRow.forEach(row => {
                row.forEach(task => {
                    maxEndWeek = Math.max(maxEndWeek, task.startWeek + task.duration);
                });
            });
        });

        const selectorWeeks = calculateTotalWeeks();
        const exportTotalWeeks = selectorWeeks;

        // En modo día ampliamos la columna de semana (7 días) para que los días
        // y las etiquetas de fecha de la cabecera no se solapen.
        const EXPORT_WEEK_WIDTH = viewMode === 'day' ? 7 * 28 : 50;
        const chartLogicalWidth = exportTotalWeeks * EXPORT_WEEK_WIDTH;

        // Margen extra a la derecha para que las etiquetas de hitos no se corten.
        // Extra right margin so milestone labels do not get clipped.
        exportRightPadding = computeExportRightPadding(exportTotalWeeks, EXPORT_WEEK_WIDTH);
        const exportLogicalWidth = projectLabelWidth + chartLogicalWidth + exportRightPadding;

        // Altura usando el layout real (sin botón en exportación)
        // Height using the real layout (no button in export)
        let exportLogicalHeight = headerHeight;
        projects.forEach(p => { exportLogicalHeight += computeProjectInnerHeight(p, false); });
        exportLogicalHeight += PROJ_HEADER_BOTTOM_MARGIN;

        // 3. Preparar el canvas para la exportación en alta resolución (DPR=2)
        const EXPORT_DPR = 2;
        canvas.width = exportLogicalWidth * EXPORT_DPR;
        canvas.height = exportLogicalHeight * EXPORT_DPR;
        ctx.scale(EXPORT_DPR, EXPORT_DPR);

        totalWeeks = exportTotalWeeks;
        isDrawingForExport = true;

        // 4. Dibujar el cronograma en el canvas de exportación
        draw();

        // 5. Convertir el canvas a Blob y copiar al portapapeles
        canvas.toBlob(async (blob) => {
            if (!blob) {
                console.error("No se pudo generar el blob del canvas.");
                return;
            }
            try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                console.log('¡Cronograma copiado como imagen!');

                const feedbackId = 'copy-feedback';
                let copyFeedback = document.getElementById(feedbackId);
                if (!copyFeedback) {
                    copyFeedback = document.createElement('div');
                    copyFeedback.id = feedbackId;
                    copyFeedback.textContent = getTranslation('copied');
                    copyFeedback.style.position = 'fixed';
                    copyFeedback.style.top = '20px';
                    copyFeedback.style.left = '50%';
                    copyFeedback.style.transform = 'translateX(-50%)';
                    copyFeedback.style.padding = '10px 20px';
                    copyFeedback.style.background = '#28a745';
                    copyFeedback.style.color = 'white';
                    copyFeedback.style.borderRadius = '5px';
                    copyFeedback.style.zIndex = '1001';
                    document.body.appendChild(copyFeedback);
                }

                copyFeedback.textContent = getTranslation('copied');
                copyFeedback.style.display = 'block';
                setTimeout(() => { copyFeedback.style.display = 'none'; }, 2500);

            } catch (err) {
                console.error('Error al copiar al portapapeles:', err);
                alert(getTranslation('Error al copiar la imagen. Es posible que tu navegador no lo soporte.'));
            }
        }, 'image/png');

    } catch (err) {
        console.error('Error al preparar el canvas para la copia:', err);
    } finally {
        // 6. Restaurar el estado original del canvas para la vista normal
        ctx.restore(); // Restaura el contexto, eliminando la escala de exportación
        totalWeeks = originalTotalWeeks;
        isDrawingForExport = false;
        exportRightPadding = 0;
        initCanvasSize(); // Re-inicializa el canvas a las dimensiones de la pantalla
        draw(); // Vuelve a dibujar la vista normal
    }
}

function createNewSchedule() {
    // Si hay sesión en la nube, los cambios ya están autoguardados → sin confirm.
    const skipConfirm = !!window.__cloudIsLoggedIn;
    if (skipConfirm || confirm(getTranslation('newScheduleConfirm'))) {
        // Limpiar proyectos
        projects.length = 0;

        // Resetear título
        document.getElementById('cronograma-title').value = "Mi Cronograma";

        // Resetear fechas. Se mantiene el modo de vista actual (no se fuerza).
        populateMonthSelectors(true); // `true` para forzar el reseteo a los valores por defecto

        if (viewMode === 'day') {
            // En modo Semana/Día, por defecto: semana actual y la siguiente.
            const todayMonday = mondayOf(new Date());
            const nextMonday = new Date(todayMonday.getTime() + 7 * 24 * 60 * 60 * 1000);
            setStartWeekValue(toISODate(todayMonday));
            setWeekSelectValue(document.getElementById('end-week'), nextMonday);
        } else {
            // En modo Mes/Semana, dejar el rango de semanas coherente por si se cambia luego.
            syncWeekSelectorsFromMonths();
        }

        // Actualizar la vista
        updatePreview();
        resetHistory();
    }
}

function moveProject(projectIndex, direction) {
    if (direction === -1 && projectIndex > 0) {
        // Mover arriba
        [projects[projectIndex], projects[projectIndex - 1]] = [projects[projectIndex - 1], projects[projectIndex]];
    } else if (direction === 1 && projectIndex < projects.length - 1) {
        // Mover abajo
        [projects[projectIndex], projects[projectIndex + 1]] = [projects[projectIndex + 1], projects[projectIndex]];
    }
    updatePreview();
    saveToHistory();
}

// Exportación a Excel en modo Semana/Día: columnas por día, cabecera de semanas
// (fecha del lunes, fusionada sobre sus 7 días) y fila de días (inicial + número).
function exportToExcelDays() {
    const wb = XLSX.utils.book_new();
    const ws_data = [];

    const weeks = calculateTotalWeeks();
    const totalDays = weeks * 7;
    if (totalDays <= 0) {
        alert(getTranslation("No hay datos en el cronograma para exportar."));
        return;
    }
    const startDate = getStartDate();
    const monthNames = getTranslation('months') || months;
    const weekdayInitials = getTranslation('weekdayInitials') || [];

    // Fila 0: semanas (fusionadas). Fila 1: días.
    const weekHeaderRow = ['Proyecto', 'Tarea'];
    const dayHeaderRow = ['', ''];
    for (let d = 0; d < totalDays; d++) {
        const dayDate = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
        const wdIdx = (dayDate.getDay() + 6) % 7;
        weekHeaderRow.push('');
        dayHeaderRow.push(`${weekdayInitials[wdIdx] || ''}${dayDate.getDate()}`);
    }
    ws_data.push(weekHeaderRow);
    ws_data.push(dayHeaderRow);

    // Merges de la fila de semanas (cada semana ocupa 7 columnas de día).
    const merges = [];
    for (let w = 0; w < weeks; w++) {
        const monday = new Date(startDate.getTime() + w * 7 * 24 * 60 * 60 * 1000);
        const label = `${monday.getDate()} ${monthNames[monday.getMonth()]} '${String(monday.getFullYear()).slice(-2)}`;
        const startCol = 2 + w * 7;
        ws_data[0][startCol] = label;
        merges.push({ s: { r: 0, c: startCol }, e: { r: 0, c: startCol + 6 } });
    }

    // Filas de tareas + estilos.
    const styleMap = [];
    let excelRowIndex = 2;
    projects.forEach((p, index) => {
        if (index > 0) { ws_data.push(Array(totalDays + 2).fill('')); excelRowIndex++; }
        p.tasksByRow.flat().forEach(task => {
            const taskRow = Array(totalDays + 2).fill('');
            taskRow[0] = p.name;
            taskRow[1] = task.name;
            ws_data.push(taskRow);
            styleMap.push({
                rowIndex: excelRowIndex,
                startDay0: Math.max(0, Math.round((task.startWeek - 1) * 7)),
                durationDays: Math.max(1, Math.round(task.duration * 7)),
                color: p.color
            });
            excelRowIndex++;
        });
    });

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    ws['!merges'] = merges;

    // Negrita en cabeceras (filas 0 y 1).
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let c = 0; c <= range.e.c; c++) {
        for (let r = 0; r <= 1; r++) {
            const a = XLSX.utils.encode_cell({ r, c });
            if (!ws[a]) continue;
            if (!ws[a].s) ws[a].s = {};
            if (!ws[a].s.font) ws[a].s.font = {};
            ws[a].s.font.bold = true;
        }
    }

    // Colorear los días que ocupa cada tarea.
    styleMap.forEach(item => {
        const startCol = item.startDay0 + 2;
        for (let k = 0; k < item.durationDays; k++) {
            const colIndex = startCol + k;
            if (colIndex < totalDays + 2) {
                const a = XLSX.utils.encode_cell({ r: item.rowIndex, c: colIndex });
                if (!ws[a]) ws[a] = { v: '', t: 's' };
                else ws[a].v = '';
                ws[a].s = { fill: { fgColor: { rgb: item.color.replace('#', '') } } };
            }
        }
    });

    // Anchos de columna.
    ws['!cols'] = [{ wch: 30 }, { wch: 40 }];
    for (let d = 0; d < totalDays; d++) ws['!cols'].push({ wch: 4 });

    XLSX.utils.book_append_sheet(wb, ws, "Cronograma");
    const cronogramaTitle = document.getElementById('cronograma-title').value || 'cronograma';
    const filename = `${cronogramaTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.xlsx`;
    XLSX.writeFile(wb, filename);
}

function exportToExcel() {
    // En modo Semana/Día exportamos columnas por día con cabecera de semanas.
    if (viewMode === 'day') { exportToExcelDays(); return; }

    const wb = XLSX.utils.book_new();
    const ws_data = [];

    const totalWeeks = calculateTotalWeeks();
    if (totalWeeks <= 0) {
        alert(getTranslation("No hay datos en el cronograma para exportar."));
        return;
    }

    // 1. CREAR CABECERAS DE SEMANAS Y MESES
    // Fila 0 para meses, Fila 1 para semanas
    const monthRow = ['Proyecto', 'Tarea'];
    const weekRow = ['', ''];
    for (let i = 1; i <= totalWeeks; i++) {
        weekRow.push(`${getTranslation('weekPrefix')}${i}`);
        monthRow.push(''); // Relleno que se completará con los nombres de los meses
    }
    ws_data.push(monthRow);
    ws_data.push(weekRow);

    // 2. CALCULAR MERGES PARA LA CABECERA DE MESES
    const merges = [];
    const monthLabels = [];
    let scanDate = new Date(getStartDate());
    scanDate.setDate(scanDate.getDate() - (scanDate.getDay() === 0 ? 6 : scanDate.getDay() - 1));

    for (let i = 0; i < totalWeeks; i++) {
        const weekMonth = scanDate.getMonth();
        const shortYear = scanDate.getFullYear().toString().slice(-2);
        const monthYearLabel = `${months[weekMonth]} '${shortYear}`;

        if (monthLabels.length === 0 || monthLabels[monthLabels.length - 1].month !== monthYearLabel) {
            monthLabels.push({ month: monthYearLabel, startWeek: i }); // 0-indexed
        }
        scanDate.setDate(scanDate.getDate() + 7);
    }

    monthLabels.forEach((label, index) => {
        const startCol = label.startWeek + 2; // +2 por las columnas Proyecto y Tarea
        const endWeek = (index + 1 < monthLabels.length) ? monthLabels[index + 1].startWeek : totalWeeks;
        const endCol = endWeek + 1;

        ws_data[0][startCol] = label.month;
        if (endCol > startCol) {
            merges.push({ s: { r: 0, c: startCol }, e: { r: 0, c: endCol } });
        }
    });

    // 3. AÑADIR FILAS DE TAREAS Y MAPEAR ESTILOS
    const styleMap = []; // Guardará la info para colorear celdas
    let excelRowIndex = 2; // Empezamos después de las 2 cabeceras

    projects.forEach((p, index) => {
        // Añadir una fila vacía separadora entre proyectos (excepto antes del primero)
        if (index > 0) {
            ws_data.push(Array(totalWeeks + 2).fill(''));
            excelRowIndex++;
        }

        p.tasksByRow.flat().forEach(task => {
            const taskRow = Array(totalWeeks + 2).fill('');
            taskRow[0] = p.name;
            taskRow[1] = task.name;
            ws_data.push(taskRow);

            // Guardamos la información para colorear la barra de esta tarea
            styleMap.push({
                rowIndex: excelRowIndex,
                startWeek: task.startWeek, // 1-indexed
                duration: task.duration,
                color: p.color
            });
            excelRowIndex++;
        });
    });

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    ws['!merges'] = merges;

    // Aplicar negrita a las cabeceras (filas 0 y 1)
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let c = 0; c <= range.e.c; c++) {
        for (let r = 0; r <= 1; r++) { // Filas 0 y 1 son cabeceras
            const cellAddress = XLSX.utils.encode_cell({ r: r, c: c });
            if (!ws[cellAddress]) continue;

            // Asegurarnos de mantener cualquier estilo existente
            if (!ws[cellAddress].s) ws[cellAddress].s = {};
            if (!ws[cellAddress].s.font) ws[cellAddress].s.font = {};

            ws[cellAddress].s.font.bold = true;
        }
    }

    // 4. APLICAR COLORES A LAS BARRAS DE TAREAS
    styleMap.forEach(item => {
        // El Excel es semanal: redondeamos posición y duración a semanas enteras
        // (en modo Semana/Día las tareas pueden tener fracciones de semana).
        const startWeekIdx0 = Math.max(0, Math.round(item.startWeek - 1)); // 0-indexed
        const durationWeeks = Math.max(1, Math.round(item.duration));
        const startCol = startWeekIdx0 + 2; // +2 por las columnas Proyecto y Tarea

        for (let w = 0; w < durationWeeks; w++) {
            const colIndex = startCol + w;
            if (colIndex < totalWeeks + 2) {
                const cellAddress = XLSX.utils.encode_cell({ r: item.rowIndex, c: colIndex });
                if (!ws[cellAddress]) ws[cellAddress] = { v: '', t: 's' }; // Crear celda vacía
                else ws[cellAddress].v = ''; // Vaciar si existía algo

                ws[cellAddress].s = {
                    fill: { fgColor: { rgb: item.color.replace('#', '') } }
                };
            }
        }
    });

    // 5. AJUSTAR ANCHO DE COLUMNAS
    ws['!cols'] = [
        { wch: 30 }, // Columna Proyecto
        { wch: 40 }  // Columna Tarea
    ];
    for (let i = 0; i < totalWeeks; i++) {
        ws['!cols'].push({ wch: 4 }); // Ancho para las columnas de semanas
    }

    // 6. GENERAR Y DESCARGAR EL ARCHIVO
    XLSX.utils.book_append_sheet(wb, ws, "Cronograma");
    const cronogramaTitle = document.getElementById('cronograma-title').value || 'cronograma';
    const filename = `${cronogramaTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.xlsx`;
    XLSX.writeFile(wb, filename);
}

// =====================================================================
// CLOUD / AUTH (Supabase) — sidebar lateral, opcional, no afecta sin sesión.
// EN: Optional cloud/auth sidebar. App keeps working fully without login.
// =====================================================================
(function setupCloud() {
    const cfg = window.__SUPABASE_CONFIG__;
    const sidebar = document.getElementById('cloud-sidebar');
    if (!sidebar) return;

    const sdkAvailable = typeof window.supabase !== 'undefined' && cfg && cfg.url && cfg.publishableKey;
    let supa = null;
    if (sdkAvailable) {
        supa = window.supabase.createClient(cfg.url, cfg.publishableKey, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                flowType: 'pkce'
            }
        });
    }

    // Estado local
    let currentCloudId = null;
    let currentSession = null;
    let sessionResolved = false;
    let allRows = [];
    let categories = []; // [{id, name, position}]
    let searchTerm = '';
    let lastSavedHash = null;
    let isSaving = false;
    let autoSaveTimer = null;
    const AUTOSAVE_DEBOUNCE_MS = 1200;
    const UNCATEGORIZED_KEY = '__uncategorized__';
    const collapsed = {}; // { [categoryId|UNCATEGORIZED_KEY]: bool }

    // Persistencia entre recargas para no duplicar filas en cada F5.
    const CLOUD_LS_KEY = 'cronogramaCloudState';
    let persistedUserId = null;
    function persistCloudState() {
        try {
            localStorage.setItem(CLOUD_LS_KEY, JSON.stringify({
                userId: currentSession?.user?.id || persistedUserId || null,
                currentCloudId,
                lastSavedHash
            }));
        } catch {}
    }
    function restoreCloudState() {
        try {
            const raw = localStorage.getItem(CLOUD_LS_KEY);
            if (!raw) return;
            const obj = JSON.parse(raw) || {};
            persistedUserId = obj.userId || null;
            currentCloudId = obj.currentCloudId || null;
            lastSavedHash = obj.lastSavedHash || null;
        } catch {}
    }
    function clearCloudState() {
        currentCloudId = null;
        lastSavedHash = null;
        persistedUserId = null;
        try { localStorage.removeItem(CLOUD_LS_KEY); } catch {}
    }
    restoreCloudState();

    const $ = (id) => document.getElementById(id);
    const signedOutEl = $('cloud-signed-out');
    const signedInEl = $('cloud-signed-in');
    const userAvatar = $('cloud-user-avatar');
    const userAvatarFallback = $('cloud-user-avatar-fallback');
    const userName = $('cloud-user-name');
    const userEmail = $('cloud-user-email');

    // Si la imagen de Google falla (rate-limit, 429, política), mostramos inicial
    function showAvatarFallback(label) {
        if (userAvatar) {
            userAvatar.removeAttribute('src');
            userAvatar.style.display = 'none';
        }
        if (userAvatarFallback) {
            userAvatarFallback.textContent = (label || '?').trim().charAt(0).toUpperCase();
            userAvatarFallback.style.display = 'flex';
        }
    }
    userAvatar?.addEventListener('error', () => {
        showAvatarFallback(userName?.textContent || userEmail?.textContent);
    });
    const feedbackEl = $('cloud-feedback');
    const signinBtn = $('cloud-google-signin');
    const signoutBtn = $('cloud-signout-btn');
    const searchInput = $('cloud-search');
    const sidebarToggle = $('cloud-sidebar-toggle');
    const emptyState = $('sidebar-empty-state');
    const sidebarLists = $('sidebar-lists');
    const btnNewCategory = $('btn-new-category');
    const syncFlashEl = $('cloud-sync-flash');

    function showFeedback(msg, isError) {
        feedbackEl.textContent = msg;
        feedbackEl.className = 'cloud-feedback' + (isError ? ' is-error' : ' is-ok');
        feedbackEl.style.display = 'block';
        clearTimeout(showFeedback._t);
        showFeedback._t = setTimeout(hideFeedback, 4000);
    }
    function hideFeedback() {
        feedbackEl.style.display = 'none';
        feedbackEl.textContent = '';
    }

    // Estados internos no visibles: pending, saving. Solo flash en "saved" / "error".
    function setSyncStatus(state) {
        if (!syncFlashEl) return;
        if (state === 'saved') {
            flashSync(getTranslation('cloudSyncSaved'), 'ok');
        } else if (state === 'error') {
            flashSync(getTranslation('cloudSyncError'), 'error');
        }
    }
    function flashSync(text, kind) {
        if (!syncFlashEl) return;
        syncFlashEl.textContent = text;
        syncFlashEl.dataset.kind = kind || 'ok';
        // Reinicia animación: quita y reañade la clase
        syncFlashEl.classList.remove('is-flash');
        // Forzar reflow para reiniciar animación
        void syncFlashEl.offsetWidth;
        syncFlashEl.classList.add('is-flash');
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function formatDate(iso) {
        try {
            const d = new Date(iso);
            const lang = document.getElementById('lang-selector')?.value || 'es';
            return d.toLocaleString(lang === 'en' ? 'en-US' : 'es-ES', {
                year: 'numeric', month: 'short', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });
        } catch { return iso; }
    }

    function renderSignedIn(session) {
        currentSession = session;
        window.__cloudIsLoggedIn = true;
        const u = session?.user;
        const meta = u?.user_metadata || {};
        const name = meta.full_name || meta.name || (u?.email ? u.email.split('@')[0] : '');
        const avatar = meta.avatar_url || meta.picture || '';
        const email = u?.email || '';

        // Si el usuario logueado no es el que persistió el currentCloudId, lo descartamos.
        if (persistedUserId && persistedUserId !== u?.id) {
            clearCloudState();
        }
        // Persistir el userId actual aunque no haya cambiado nada más
        persistedUserId = u?.id || null;
        persistCloudState();

        signedOutEl.style.display = 'none';
        signedInEl.style.display = 'flex';
        userName.textContent = name;
        userEmail.textContent = email;
        if (avatar) {
            userAvatar.style.display = 'block';
            userAvatarFallback.style.display = 'none';
            userAvatar.src = avatar;
        } else {
            showAvatarFallback(name || email);
        }
        refreshList();

        // ES: Si el usuario abrió un enlace compartido (?c= o #s=) antes de
        // que la sesión estuviera resuelta, el autosave no pudo dispararse
        // todavía. Ahora que hay sesión, forzamos un save inmediato para
        // forkear el cronograma compartido como una nueva entrada en la nube.
        if (pendingSharedSave) {
            pendingSharedSave = false;
            scheduleAutoSave();
        }
    }

    let pendingSharedSave = false;

    // ES: Marca que se acaba de cargar un cronograma compartido externo.
    // Si hay sesión activa, el autosave dispara solo (vía saveStateToLocalStorage).
    // Si la sesión aún no se ha resuelto, renderSignedIn() disparará el save
    // en cuanto Supabase devuelva la sesión.
    window.__cloudResetCurrent = function () {
        currentCloudId = null;
        lastSavedHash = null;
        persistCloudState();
        setSyncStatus('');
        renderLists();
        pendingSharedSave = true;
    };

    function renderSignedOut() {
        currentSession = null;
        window.__cloudIsLoggedIn = false;
        allRows = [];
        clearCloudState();
        signedOutEl.style.display = 'block';
        signedInEl.style.display = 'none';
        setSyncStatus('');
        renderLists();
    }

    // Estado que se persiste en la nube. Se omiten preferencias globales del usuario
    // (theme, lang), que pertenecen al perfil de uso, no al cronograma.
    function getCurrentState() {
        return {
            title: document.getElementById('cronograma-title').value,
            startMonth: document.getElementById('start-month').value,
            endMonth: document.getElementById('end-month').value,
            viewMode: typeof viewMode !== 'undefined' ? viewMode : 'week',
            weekStart: viewMode === 'day' ? document.getElementById('start-week').value : '',
            weekEnd: viewMode === 'day' ? document.getElementById('end-week').value : '',
            projects: JSON.parse(JSON.stringify(typeof projects !== 'undefined' ? projects : []))
        };
    }

    function buildItemHtml(row) {
        const tagCurrent = getTranslation('cloudCurrentTag');
        const titleAttrLoad = getTranslation('cloudLoadTitle');
        const titleAttrDel = getTranslation('cloudDeleteBtn');
        const isCurrent = row.id === currentCloudId;
        const cat = row.category_id || '';
        return `
            <div class="cron-item${isCurrent ? ' is-current' : ''}" data-id="${escapeHtml(row.id)}" data-category-id="${escapeHtml(cat)}" draggable="true">
                <button class="cron-item-load" type="button" data-action="load" data-id="${escapeHtml(row.id)}" title="${escapeHtml(titleAttrLoad)}">
                    <div class="cron-item-title">
                        ${escapeHtml(row.title || '')}
                        ${isCurrent ? `<span class="cron-current-tag">${escapeHtml(tagCurrent)}</span>` : ''}
                    </div>
                    <div class="cron-item-date">${escapeHtml(formatDate(row.updated_at))}</div>
                </button>
                <div class="cron-item-actions">
                    <button class="cron-item-icon-btn cron-item-delete" type="button" data-action="delete" data-id="${escapeHtml(row.id)}" data-title="${escapeHtml(row.title || '')}" title="${escapeHtml(titleAttrDel)}" aria-label="${escapeHtml(titleAttrDel)}">
                        <svg viewBox="0 0 18 18" width="14" height="14" aria-hidden="true">
                            <path d="M4 5 H14 M6 5 V3 H12 V5 M6 8 V14 M9 8 V14 M12 8 V14 M5 5 L6 16 H12 L13 5"
                                  stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }

    function buildSectionHtml(section) {
        // section = { key, name, isUncat, count, items }
        const isCollapsed = !!collapsed[section.key];
        const dataKey = section.key;
        const editable = !section.isUncat;
        const renameTitle = getTranslation('cloudRenameCategoryTitle');
        const deleteTitle = getTranslation('cloudDeleteCategoryTitle');
        return `
            <div class="sidebar-section${isCollapsed ? ' is-collapsed' : ''}${section.isUncat ? ' is-uncategorized' : ''}" data-category-key="${escapeHtml(dataKey)}">
                <div class="sidebar-section-header-row">
                    <button class="sidebar-section-header" type="button" data-toggle="${escapeHtml(dataKey)}" aria-expanded="${isCollapsed ? 'false' : 'true'}">
                        <svg class="sidebar-section-caret" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                            <path d="M3 4 L6 8 L9 4" stroke="currentColor" stroke-width="2"
                                  fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        <span class="sidebar-section-label">${escapeHtml(section.name)}</span>
                        <span class="sidebar-section-count">${section.count}</span>
                    </button>
                    ${editable ? `
                        <div class="sidebar-section-actions">
                            <button class="sidebar-section-icon-btn" type="button" data-action="rename-category" data-id="${escapeHtml(section.key)}" title="${escapeHtml(renameTitle)}" aria-label="${escapeHtml(renameTitle)}">
                                <svg viewBox="0 0 18 18" width="13" height="13" aria-hidden="true">
                                    <path d="M3 13 L3 15 L5 15 L13 7 L11 5 Z M11 5 L13 3 L15 5 L13 7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </button>
                            <button class="sidebar-section-icon-btn" type="button" data-action="delete-category" data-id="${escapeHtml(section.key)}" data-name="${escapeHtml(section.name)}" title="${escapeHtml(deleteTitle)}" aria-label="${escapeHtml(deleteTitle)}">
                                <svg viewBox="0 0 18 18" width="13" height="13" aria-hidden="true">
                                    <path d="M4 5 H14 M6 5 V3 H12 V5 M6 8 V14 M9 8 V14 M12 8 V14 M5 5 L6 16 H12 L13 5"
                                          stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </button>
                        </div>` : ''}
                </div>
                <div class="sidebar-section-list" data-category-list="${escapeHtml(dataKey)}">
                    ${section.items.length
                        ? section.items.map(buildItemHtml).join('')
                        : `<div class="cron-empty-row">${escapeHtml(getTranslation('cloudSectionEmpty'))}</div>`}
                </div>
            </div>
        `;
    }

    function renderLists() {
        const term = (searchTerm || '').trim().toLowerCase();
        const sortedRows = allRows.slice().sort((a, b) => (a.position || 0) - (b.position || 0));
        const filteredRows = term
            ? sortedRows.filter(r => (r.title || '').toLowerCase().includes(term))
            : sortedRows;

        const sortedCats = categories.slice().sort((a, b) => (a.position || 0) - (b.position || 0));
        const sections = [];
        for (const cat of sortedCats) {
            const items = filteredRows.filter(r => r.category_id === cat.id);
            sections.push({
                key: cat.id,
                name: cat.name,
                isUncat: false,
                count: items.length,
                items
            });
        }
        const uncatItems = filteredRows.filter(r => !r.category_id);
        // Solo mostrar "Sin categoría" si tiene items (para no contaminar la UI)
        if (uncatItems.length > 0 || categories.length === 0) {
            sections.push({
                key: UNCATEGORIZED_KEY,
                name: getTranslation('cloudUncategorized'),
                isUncat: true,
                count: uncatItems.length,
                items: uncatItems
            });
        }

        // Render: dejamos el empty-state al inicio y luego pintamos las secciones
        const emptyHtml = emptyState.outerHTML;
        sidebarLists.innerHTML = emptyHtml + sections.map(buildSectionHtml).join('');

        // Estado vacío
        const empty = $('sidebar-empty-state');
        if (!currentSession) {
            empty.style.display = 'block';
            empty.querySelector('span').textContent = getTranslation('sidebarSignedOutListHint');
        } else if (allRows.length === 0 && categories.length === 0) {
            empty.style.display = 'block';
            empty.querySelector('span').textContent = getTranslation('sidebarEmpty');
        } else {
            empty.style.display = 'none';
        }
    }

    async function refreshList() {
        if (!supa || !currentSession) return;
        const [rowsRes, catsRes] = await Promise.all([
            supa.from('cronogramas')
                .select('id, title, updated_at, created_at, position, category_id')
                .order('position', { ascending: true })
                .order('updated_at', { ascending: false }),
            supa.from('categories')
                .select('id, name, position')
                .order('position', { ascending: true })
                .order('created_at', { ascending: true })
        ]);

        if (rowsRes.error) {
            console.error('[cloud] list error:', rowsRes.error);
            showFeedback(getTranslation('cloudGenericError'), true);
            return;
        }
        if (catsRes.error) {
            console.error('[cloud] categories error:', catsRes.error);
        }
        allRows = rowsRes.data || [];
        categories = catsRes.data || [];
        if (currentCloudId && !allRows.some(r => r.id === currentCloudId)) {
            currentCloudId = null;
            lastSavedHash = null;
            persistCloudState();
        }
        renderLists();
    }

    async function createCategory() {
        if (!supa || !currentSession) return;
        const name = (prompt(getTranslation('cloudPromptNewCategory')) || '').trim();
        if (!name) return;
        const maxPos = categories.reduce((m, c) => Math.max(m, c.position || 0), 0);
        try {
            const { data, error } = await supa
                .from('categories')
                .insert({ user_id: currentSession.user.id, name, position: maxPos + 1 })
                .select('id, name, position')
                .single();
            if (error) throw error;
            categories.push(data);
            renderLists();
        } catch (err) {
            console.error('[cloud] create category error:', err);
            setSyncStatus('error');
        }
    }

    async function renameCategory(id) {
        if (!supa || !currentSession) return;
        const cat = categories.find(c => c.id === id);
        if (!cat) return;
        const name = (prompt(getTranslation('cloudPromptRenameCategory'), cat.name) || '').trim();
        if (!name || name === cat.name) return;
        const prev = cat.name;
        cat.name = name;
        renderLists();
        try {
            const { error } = await supa
                .from('categories')
                .update({ name })
                .eq('id', id);
            if (error) throw error;
        } catch (err) {
            console.error('[cloud] rename category error:', err);
            cat.name = prev;
            renderLists();
            setSyncStatus('error');
        }
    }

    async function deleteCategory(id, name) {
        if (!supa || !currentSession) return;
        const msg = getTranslation('cloudConfirmDeleteCategory').replace('{0}', name || '');
        if (!confirm(msg)) return;
        try {
            const { error } = await supa.from('categories').delete().eq('id', id);
            if (error) throw error;
            // Los cronogramas pasan a category_id = null por la FK on delete set null
            categories = categories.filter(c => c.id !== id);
            allRows.forEach(r => { if (r.category_id === id) r.category_id = null; });
            renderLists();
        } catch (err) {
            console.error('[cloud] delete category error:', err);
            setSyncStatus('error');
        }
    }

    function scheduleAutoSave() {
        if (!supa || !currentSession || !sessionResolved) return;
        setSyncStatus('pending');
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(doAutoSave, AUTOSAVE_DEBOUNCE_MS);
    }

    async function doAutoSave() {
        if (!supa || !currentSession) return;
        if (isSaving) {
            // Reintenta tras la operación en curso
            autoSaveTimer = setTimeout(doAutoSave, 500);
            return;
        }
        const state = getCurrentState();
        const title = state.title || 'Mi Cronograma';
        const hash = JSON.stringify({ title, state });
        if (hash === lastSavedHash) {
            setSyncStatus('saved');
            return;
        }
        isSaving = true;
        setSyncStatus('saving');
        try {
            if (currentCloudId) {
                const { error } = await supa
                    .from('cronogramas')
                    .update({ title, state })
                    .eq('id', currentCloudId);
                if (error) throw error;
            } else {
                // ES: Antes de insertar, comprobamos si el usuario ya tiene un
                // cronograma con exactamente este contenido (por ejemplo al
                // abrir un ?c= que es un share de algo que ya está en su
                // cuenta). Si lo hay, adoptamos su id en lugar de duplicar.
                // EN: Before inserting, check if the user already has a
                // cronograma with this exact content (e.g. opening a ?c= that
                // shares something already in their account). If so, adopt
                // its id instead of duplicating.
                const existingId = await findMatchingCronogramaId(title, state);
                if (existingId) {
                    currentCloudId = existingId;
                } else {
                    const { data, error } = await supa
                        .from('cronogramas')
                        .insert({ user_id: currentSession.user.id, title, state, completed: false })
                        .select('id')
                        .single();
                    if (error) throw error;
                    currentCloudId = data.id;
                }
            }
            lastSavedHash = hash;
            persistCloudState();
            setSyncStatus('saved');
            refreshList();
        } catch (err) {
            console.error('[cloud] autosave error:', err);
            setSyncStatus('error');
        } finally {
            isSaving = false;
        }
    }

    // ES: Serialización canónica (claves ordenadas) para comparar estados.
    // Postgres jsonb puede devolver objetos con orden de claves distinto al
    // que se envió, así que JSON.stringify directo daría falsos negativos.
    function _canonical(v) {
        if (v === null || typeof v !== 'object') return v;
        if (Array.isArray(v)) return v.map(_canonical);
        const out = {};
        Object.keys(v).sort().forEach(k => { out[k] = _canonical(v[k]); });
        return out;
    }
    function _canonicalJson(v) { return JSON.stringify(_canonical(v)); }

    async function findMatchingCronogramaId(title, state) {
        if (!supa || !currentSession) return null;
        const wanted = _canonicalJson({ title: title || '', state });
        try {
            const { data, error } = await supa
                .from('cronogramas')
                .select('id, title, state')
                .eq('user_id', currentSession.user.id);
            if (error || !Array.isArray(data)) return null;
            for (const row of data) {
                const rowCanon = _canonicalJson({ title: row.title || '', state: row.state });
                if (rowCanon === wanted) return row.id;
            }
        } catch (err) {
            console.warn('[cloud] dedupe lookup failed:', err);
        }
        return null;
    }

    async function loadFromCloud(id) {
        if (!supa || !currentSession) return;
        try {
            const { data, error } = await supa
                .from('cronogramas')
                .select('id, title, state')
                .eq('id', id)
                .single();
            if (error) throw error;
            const stateObj = data.state || {};
            if (data.title && !stateObj.title) stateObj.title = data.title;
            // Las preferencias globales no se restauran desde el cronograma
            delete stateObj.theme;
            delete stateObj.lang;

            currentCloudId = data.id;
            persistCloudState();

            applyState(stateObj);
            resetHistory();
            // Marcamos como "ya guardado" usando el estado realmente aplicado, para
            // que no dispare un autosave redundante (espeja el hash de doAutoSave).
            const appliedState = getCurrentState();
            lastSavedHash = JSON.stringify({ title: appliedState.title || 'Mi Cronograma', state: appliedState });
            renderLists();
        } catch (err) {
            console.error('[cloud] load error:', err);
            setSyncStatus('error');
        }
    }

    async function deleteFromCloud(id, title) {
        if (!supa || !currentSession) return;
        const msg = getTranslation('cloudConfirmDelete').replace('{0}', title || '');
        if (!confirm(msg)) return;
        try {
            const { error } = await supa.from('cronogramas').delete().eq('id', id);
            if (error) throw error;
            if (currentCloudId === id) {
                currentCloudId = null;
                lastSavedHash = null;
                persistCloudState();
                setSyncStatus('');
            }
            allRows = allRows.filter(r => r.id !== id);
            renderLists();
            showFeedback(getTranslation('cloudDeleteOk'));
        } catch (err) {
            console.error('[cloud] delete error:', err);
            showFeedback(getTranslation('cloudGenericError'), true);
        }
    }

    async function signInWithGoogle() {
        if (!supa) {
            showFeedback(getTranslation('cloudUnavailable'), true);
            return;
        }
        try {
            const { error } = await supa.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: window.location.origin + window.location.pathname }
            });
            if (error) throw error;
        } catch (err) {
            console.error('[cloud] signin error:', err);
            showFeedback(getTranslation('cloudSignInError'), true);
        }
    }

    async function signOut() {
        if (!supa) return;
        await supa.auth.signOut();
        renderSignedOut();
    }

    // --- Listeners ---
    signinBtn?.addEventListener('click', signInWithGoogle);
    signoutBtn?.addEventListener('click', signOut);

    searchInput?.addEventListener('input', (e) => {
        searchTerm = e.target.value;
        renderLists();
    });

    // Hook: cualquier cambio en el estado dispara autosave (saveStateToLocalStorage lo invoca)
    window.__onStateChanged = scheduleAutoSave;

    // Hook: pulsar "Nuevo" → resetear currentCloudId para que el próximo autosave cree entrada nueva
    if (typeof window.createNewSchedule === 'function') {
        const origCreateNew = window.createNewSchedule;
        window.createNewSchedule = function () {
            const before = (typeof projects !== 'undefined') ? projects.length : -1;
            const r = origCreateNew.apply(this, arguments);
            const after = (typeof projects !== 'undefined') ? projects.length : -1;
            // Si realmente se creó uno nuevo (proyectos quedaron vacíos)
            if (after === 0 && before !== 0) {
                currentCloudId = null;
                lastSavedHash = null;
                persistCloudState();
                setSyncStatus('');
                renderLists();
            }
            return r;
        };
    }

    // Hook: cargar JSON desde archivo → resetear (creará entrada nueva en la nube)
    if (typeof window.loadSchedule === 'function') {
        const origLoadSchedule = window.loadSchedule;
        window.loadSchedule = function (event) {
            const fileChosen = !!(event?.target?.files && event.target.files[0]);
            if (fileChosen) {
                currentCloudId = null;
                lastSavedHash = null;
                persistCloudState();
                setSyncStatus('');
            }
            return origLoadSchedule.apply(this, arguments);
        };
    }

    // Toggle plegado de secciones + acciones de items y categorías
    sidebar.addEventListener('click', (e) => {
        // Acción de botón (con data-action) tiene prioridad sobre el toggle de la cabecera
        const btn = e.target.closest('button[data-action]');
        if (btn) {
            e.stopPropagation();
            const id = btn.dataset.id;
            const action = btn.dataset.action;
            if (action === 'load') loadFromCloud(id);
            else if (action === 'delete') deleteFromCloud(id, btn.dataset.title || '');
            else if (action === 'rename-category') renameCategory(id);
            else if (action === 'delete-category') deleteCategory(id, btn.dataset.name || '');
            return;
        }
        const header = e.target.closest('.sidebar-section-header');
        if (header) {
            const key = header.dataset.toggle;
            collapsed[key] = !collapsed[key];
            const section = header.closest('.sidebar-section');
            section.classList.toggle('is-collapsed', collapsed[key]);
            header.setAttribute('aria-expanded', String(!collapsed[key]));
        }
    });

    btnNewCategory?.addEventListener('click', createCategory);

    // Plegar/desplegar el sidebar entero
    sidebarToggle?.addEventListener('click', () => {
        document.body.classList.toggle('sidebar-collapsed');
    });

    // --- Drag & Drop: reordenar dentro de la sección y mover entre secciones ---
    let draggingId = null;

    function clearDropMarkers() {
        sidebar.querySelectorAll('.cron-item.is-drop-before, .cron-item.is-drop-after')
            .forEach(el => el.classList.remove('is-drop-before', 'is-drop-after'));
        sidebar.querySelectorAll('.sidebar-section.is-drop-target')
            .forEach(el => el.classList.remove('is-drop-target'));
    }

    // Mueve un cronograma a otra categoría y/o reordena dentro de su sección.
    // targetCategoryId: uuid de la categoría, o null para "Sin categoría".
    async function moveItem(id, targetCategoryId, targetIndexInSection) {
        if (!supa || !currentSession) return;
        const moved = allRows.find(r => r.id === id);
        if (!moved) return;

        const prev = { category_id: moved.category_id, position: moved.position };

        const sectionRows = allRows
            .filter(r => r.id !== id && (r.category_id || null) === (targetCategoryId || null))
            .sort((a, b) => (a.position || 0) - (b.position || 0));

        const idx = Math.max(0, Math.min(targetIndexInSection, sectionRows.length));
        sectionRows.splice(idx, 0, moved);

        moved.category_id = targetCategoryId || null;
        sectionRows.forEach((row, i) => { row.position = i + 1; });

        renderLists();

        try {
            const updates = sectionRows.map(row => {
                const payload = { position: row.position };
                if (row.id === id && prev.category_id !== (targetCategoryId || null)) {
                    payload.category_id = targetCategoryId || null;
                }
                return supa.from('cronogramas').update(payload).eq('id', row.id);
            });
            const results = await Promise.all(updates);
            const firstErr = results.find(r => r.error);
            if (firstErr) throw firstErr.error;
        } catch (err) {
            console.error('[cloud] reorder/move error:', err);
            moved.category_id = prev.category_id;
            moved.position = prev.position;
            setSyncStatus('error');
            refreshList();
        }
    }

    sidebar.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.cron-item');
        if (!item) return;
        draggingId = item.dataset.id;
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', draggingId); } catch {}
        requestAnimationFrame(() => item.classList.add('is-dragging'));
    });

    sidebar.addEventListener('dragend', () => {
        draggingId = null;
        sidebar.querySelectorAll('.cron-item.is-dragging')
            .forEach(el => el.classList.remove('is-dragging'));
        clearDropMarkers();
    });

    sidebarLists.addEventListener('dragover', (e) => {
        if (!draggingId) return;
        const list = e.target.closest('[data-category-list]');
        if (!list) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const section = list.closest('.sidebar-section');
        if (section.classList.contains('is-collapsed')) {
            const key = section.dataset.categoryKey;
            collapsed[key] = false;
            section.classList.remove('is-collapsed');
            section.querySelector('.sidebar-section-header')
                ?.setAttribute('aria-expanded', 'true');
        }

        clearDropMarkers();

        const items = [...list.querySelectorAll('.cron-item:not(.is-dragging)')];
        if (items.length === 0) {
            section.classList.add('is-drop-target');
            return;
        }
        let placed = false;
        for (const it of items) {
            const rect = it.getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            if (e.clientY < mid) {
                it.classList.add('is-drop-before');
                placed = true;
                break;
            }
        }
        if (!placed) items[items.length - 1].classList.add('is-drop-after');
    });

    sidebarLists.addEventListener('dragleave', (e) => {
        const list = e.target.closest('[data-category-list]');
        if (list && !list.contains(e.relatedTarget)) {
            clearDropMarkers();
        }
    });

    sidebarLists.addEventListener('drop', (e) => {
        if (!draggingId) return;
        const list = e.target.closest('[data-category-list]');
        if (!list) return;
        e.preventDefault();
        const id = draggingId || e.dataTransfer.getData('text/plain');
        if (!id) { clearDropMarkers(); return; }

        const key = list.dataset.categoryList;
        const targetCategoryId = key === UNCATEGORIZED_KEY ? null : key;

        const items = [...list.querySelectorAll('.cron-item:not(.is-dragging)')];
        let targetIdx = items.length;
        const before = list.querySelector('.cron-item.is-drop-before');
        if (before) targetIdx = items.indexOf(before);

        clearDropMarkers();
        moveItem(id, targetCategoryId, targetIdx);
    });

    if (sdkAvailable) {
        supa.auth.getSession().then(({ data }) => {
            sessionResolved = true;
            if (data?.session) renderSignedIn(data.session);
            else renderSignedOut();
        });
        supa.auth.onAuthStateChange((_event, session) => {
            sessionResolved = true;
            if (session) renderSignedIn(session);
            else renderSignedOut();
        });
    } else {
        sessionResolved = true;
        renderSignedOut();
    }
})();