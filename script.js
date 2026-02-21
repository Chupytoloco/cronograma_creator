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
let animationProgress = 0;
let lastTime = 0;
const animationDuration = 800;
let taskHitboxes = [];
let projectHitboxes = [];
let addTaskHitboxes = []; // Hitboxes para los botones de 'Añadir Tarea'
let isDrawingForExport = false; // Flag para el dibujado de exportación
const resizeHandleWidth = 10; // Ancho del área de redimensión

const colorPalette = ['#4A90E2', '#8E44AD', '#E67E22', '#27AE60', '#F1C40F', '#C0392B', '#16A085', '#2980B9'];
let nextColorIndex = 0;

const months = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
let totalWeeks = 26; // Se calcula dinámicamente

const rowHeight = 35;
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
let currentTheme = 'oscuro';
const gridFont = "12px Poppins";
const projectFont = "bold 16px Poppins";
const taskFont = "14px Poppins";
const projectIconSize = 18;
const projectIconPadding = 20;

// --- INICIALIZACIÓN ---
window.addEventListener('load', () => {
    canvas = document.getElementById('ganttCanvas');
    ctx = canvas.getContext('2d');

    // El orden correcto y único de inicialización
    populateMonthSelectors();
    loadStateFromLocalStorage();

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
    document.getElementById('theme-selector').addEventListener('change', (e) => {
        applyTheme(e.target.value);
        updatePreview();
        saveToHistory();
    });

    // Listeners para guardar y cargar
    document.getElementById('save-btn').addEventListener('click', saveSchedule);
    document.getElementById('load-input').addEventListener('change', loadSchedule);
    document.getElementById('copy-btn').addEventListener('click', copyChartToClipboard);
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

    // Guardar estado inicial
    setTimeout(saveToHistory, 500); // Un pequeño retraso para asegurar que todo se cargó
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

// --- GESTIÓN DE HISTORIAL (UNDO/REDO) ---

function saveToHistory() {
    const currentState = JSON.stringify({
        title: document.getElementById('cronograma-title').value,
        startMonth: document.getElementById('start-month').value,
        endMonth: document.getElementById('end-month').value,
        theme: document.getElementById('theme-selector').value,
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

function applyState(data) {
    if (!data) return;

    if (data.title !== undefined) document.getElementById('cronograma-title').value = data.title;
    if (data.startMonth !== undefined) document.getElementById('start-month').value = data.startMonth;
    if (data.endMonth !== undefined) document.getElementById('end-month').value = data.endMonth;
    if (data.theme !== undefined) {
        document.getElementById('theme-selector').value = data.theme;
        applyTheme(data.theme);
    }

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
    } else if (theme === 'moderno') {
        textColor = '#f1f5f9';
        gridColor = '#334155';
        canvasHeaderBg = '#1e293b';
        canvasBodyBg = '#0f172a';
        canvasSidebarBg = '#1e293b';
        canvasMutedText = '#94a3b8';
        canvasHighlightBg = 'rgba(255, 255, 255, 0.05)';
        canvasMonthOverlay = 'rgba(255, 255, 255, 0.05)';
    } else if (theme === 'gris') {
        textColor = '#111827';
        gridColor = '#d1d5db';
        canvasHeaderBg = '#e5e7eb';
        canvasBodyBg = '#f9fafb';
        canvasSidebarBg = '#f3f4f6';
        canvasMutedText = '#4b5563';
        canvasHighlightBg = 'rgba(0, 0, 0, 0.05)';
        canvasMonthOverlay = 'rgba(0, 0, 0, 0.03)';
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
    const newProject = {
        name: projectData.name || `Proyecto ${projects.length + 1}`,
        color: projectData.color || colorPalette[nextColorIndex % colorPalette.length],
        tasksByRow: []
    };
    nextColorIndex++;

    // Agrupar tareas por fila (si es necesario en el futuro) o simplemente ponerlas en una
    const tasks = projectData.tasks.map(t => ({ ...t }));

    // Calcular el desfase de semanas
    const globalStartMonth = parseInt(document.getElementById('start-month').value);
    const projectStartMonth = projectData.startMonth;
    const monthDifference = projectStartMonth - globalStartMonth;
    const weeksOffset = Math.round(monthDifference * 4.33); // Aproximación

    tasks.forEach(t => {
        t.startWeek += weeksOffset;
    });

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

function saveStateToLocalStorage() {
    try {
        const state = {
            title: document.getElementById('cronograma-title').value,
            startMonth: document.getElementById('start-month').value,
            endMonth: document.getElementById('end-month').value,
            theme: document.getElementById('theme-selector').value,
            projects: projects
        };
        localStorage.setItem('ganttChartState', JSON.stringify(state));
    } catch (error) {
        console.error("No se pudo guardar el estado en localStorage:", error);
    }
}

function loadStateFromLocalStorage() {
    try {
        const savedState = localStorage.getItem('ganttChartState');
        if (savedState) {
            const data = JSON.parse(savedState);

            if (data.title) document.getElementById('cronograma-title').value = data.title;
            if (data.startMonth) document.getElementById('start-month').value = data.startMonth;
            if (data.endMonth) document.getElementById('end-month').value = data.endMonth;
            if (data.theme) {
                document.getElementById('theme-selector').value = data.theme;
                applyTheme(data.theme);
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
        projects: projects
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dataToSave, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    const fileName = (dataToSave.title || 'cronograma').replace(/\s+/g, '_');
    downloadAnchorNode.setAttribute("download", `${fileName}.json`);
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
            if (data.startMonth) {
                document.getElementById('start-month').value = data.startMonth;
            }
            if (data.endMonth) {
                document.getElementById('end-month').value = data.endMonth;
            }
            if (data.projects && Array.isArray(data.projects)) {
                // Limpiar el array actual y añadir los proyectos cargados
                projects.length = 0;
                Array.prototype.push.apply(projects, data.projects);
            }

            updatePreview();
            saveToHistory();

        } catch (error) {
            alert('Error al cargar el archivo. Asegúrate de que es un archivo de cronograma válido.');
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
    const confirmation = confirm(
        `Se han detectado ${rows.length} tareas para importar. ¿Quieres añadirlas al cronograma actual?\n\n` +
        "Las tareas existentes no se eliminarán."
    );

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
            project = {
                name: projectName,
                color: colorPalette[nextColorIndex % colorPalette.length],
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
function addTask(projectIndex, rowIndex) {
    const newWeek = Math.max(1, Math.floor(totalWeeks / 4));

    const task = {
        name: 'Nueva Tarea',
        startWeek: newWeek,
        duration: 4,
        isMilestone: false,
        textPosition: 'outside'
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

    const modal = document.getElementById('project-edit-modal');
    modal.style.display = 'flex';
    saveToHistory();

    modal.querySelector('.modal-close-icon').onclick = closeProjectEditModal;

    document.getElementById('modal-project-delete-btn').onclick = () => {
        if (confirm(`¿Estás seguro de que quieres eliminar el proyecto "${project.name}"?`)) {
            deleteProject(projectIndex);
            closeProjectEditModal();
        }
    };

    const modalInputs = ['modal-project-name', 'modal-project-color'];
    modalInputs.forEach(id => {
        const input = document.getElementById(id);
        input.removeEventListener('input', updateProjectFromModal);
        input.addEventListener('input', updateProjectFromModal);
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
    project.color = document.getElementById('modal-project-color').value;

    updatePreview();
}

// --- MODAL DE EDICIÓN DE TAREAS ---
function openTaskModal(projectIndex, rowIndex, taskIndex) {
    editingTask = { project: projectIndex, row: rowIndex, task: taskIndex };

    const task = projects[projectIndex].tasksByRow[rowIndex][taskIndex];
    if (!task) return;

    document.getElementById('modal-task-name').value = task.name;
    document.getElementById('modal-start-week').value = task.startWeek;
    document.getElementById('modal-duration').value = task.duration;
    document.getElementById('modal-task-type').value = task.isMilestone ? 'milestone' : 'normal';
    document.getElementById('modal-text-position').value = task.textPosition;
    document.getElementById('modal-task-color').value = task.color || projects[projectIndex].color;

    const modal = document.getElementById('task-modal');
    modal.style.display = 'flex';
    saveToHistory(); // Guardar estado antes de editar la tarea

    modal.querySelector('.modal-close-icon').onclick = closeTaskModal;

    const completeBtn = document.getElementById('modal-complete-btn');
    const checkmarkSVG = `<svg width="18" height="18" viewBox="0 0 22 22" style="vertical-align: middle; margin-right: 5px; margin-bottom: 2px;">
        <circle cx="11" cy="11" r="10" fill="#4CAF50" stroke="#FFFFFF" stroke-width="1.5"/>
        <path d="M6.6 11 L9.9 14.85 L15.4 7.15" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>`;
    completeBtn.innerHTML = checkmarkSVG + (task.completed ? 'Descompletar' : 'Completar');
    completeBtn.onclick = () => {
        task.completed = !task.completed;
        saveToHistory();
        updatePreview();
        closeTaskModal();
    };

    document.getElementById('modal-delete-btn').onclick = () => {
        if (confirm(`¿Estás seguro de que quieres eliminar la tarea "${task.name}"?`)) {
            deleteTask(projectIndex, rowIndex, taskIndex);
        }
    };

    document.getElementById('modal-reset-color-btn').onclick = () => {
        const taskColorInput = document.getElementById('modal-task-color');
        taskColorInput.value = projects[projectIndex].color;
        // Al resetear, eliminamos la propiedad color para que siga al proyecto
        delete projects[projectIndex].tasksByRow[rowIndex][taskIndex].color;
        updatePreview();
    };

    const modalInputs = ['modal-task-name', 'modal-start-week', 'modal-duration', 'modal-task-type', 'modal-text-position', 'modal-task-color'];
    modalInputs.forEach(id => {
        document.getElementById(id).oninput = updateTaskFromModal;
    });
}

function closeTaskModal() {
    document.getElementById('task-modal').style.display = 'none';
    editingTask = { project: -1, row: -1, task: -1 };
    saveToHistory(); // Guardar estado al finalizar la edición
}

function updateTaskFromModal() {
    const { project, row, task: taskIndex } = editingTask;
    if (project === -1) return;

    let duration = parseFloat(document.getElementById('modal-duration').value) || 1;
    if (duration < 0.5) {
        duration = 0.5;
        document.getElementById('modal-duration').value = 0.5;
    }

    let startWeek = parseInt(document.getElementById('modal-start-week').value) || 1;
    if (startWeek < 1) {
        startWeek = 1;
        document.getElementById('modal-start-week').value = 1;
    }

    const updatedTask = {
        ...projects[project].tasksByRow[row][taskIndex], // Mantener propiedades existentes como 'color' si no se cambia
        name: document.getElementById('modal-task-name').value.trim() || 'Tarea sin nombre',
        startWeek: startWeek,
        duration: duration,
        isMilestone: document.getElementById('modal-task-type').value === 'milestone',
        textPosition: document.getElementById('modal-text-position').value,
        color: document.getElementById('modal-task-color').value
    };

    projects[project].tasksByRow[row][taskIndex] = updatedTask;
    updatePreview();
}


// --- LÓGICA DE DIBUJO ---
function updatePreview() {
    if (!canvas) return;

    totalWeeks = calculateTotalWeeks();
    initCanvasSize();
    animationProgress = 0;
    lastTime = 0;
    requestAnimationFrame(animate);
    saveStateToLocalStorage();
}

function initCanvasSize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;

    let totalHeight = headerHeight;
    projects.forEach(p => {
        totalHeight += 15; // Espacio superior del proyecto
        totalHeight += p.tasksByRow.length * rowHeight;
        totalHeight += 40; // Espacio para el botón '+ Añadir Tarea' y su padding
    });

    canvas.height = (totalHeight + rowHeight) * dpr; // Un rowHeight extra para padding inferior
    ctx.scale(dpr, dpr);
}

// --- MANEJADORES DE EVENTOS DEL CANVAS ---

function handleCanvasMouseDown(e) {
    if (document.querySelector('.floating-input')) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

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
                if (task.isMilestone || (!onLeftEdge && !onRightEdge)) {
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

        // Comprobar si está sobre un icono de proyecto
        if (!onTask && newCursor === 'default' && getIconUnderCursor(x, y)) {
            newCursor = 'pointer';
        }

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
                const projectHeight = 15 + projects[i].tasksByRow.length * rowHeight + 40;
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
        const weekWidth = (canvas.width / (window.devicePixelRatio || 1) - projectLabelWidth) / totalWeeks;
        const currentWeek = Math.round((x - projectLabelWidth) / weekWidth);

        if (resizingTask.handle === 'left') {
            // Calcular siempre desde los valores originales para evitar acumulación de errores
            const originalEnd = resizingTask.originalStartWeek + resizingTask.originalDuration;
            const newDuration = originalEnd - currentWeek;
            if (newDuration >= 0.5) {
                ghostTask.startWeek = currentWeek;
                ghostTask.duration = newDuration;
            }
        } else {
            const newDuration = currentWeek - resizingTask.originalStartWeek;
            if (newDuration >= 0.5) {
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

            // Calcular la nueva semana de inicio basado en la posición del ratón
            const chartWidth = canvas.width / (window.devicePixelRatio || 1) - projectLabelWidth;
            const weekWidth = chartWidth / totalWeeks;
            let newStartWeek = Math.round((x - projectLabelWidth - draggingTask.offsetX) / weekWidth);
            newStartWeek = Math.max(0, Math.min(newStartWeek, totalWeeks - task.duration));
            task.startWeek = newStartWeek;

            // Calcular el destino potencial para el feedback visual.
            // Debe coincidir exactamente con el layout de drawProjects,
            // que inserta un placeholder que desplaza las filas siguientes.
            let projectTopY = headerHeight;
            for (let i = 0; i < projectIndex; i++) {
                projectTopY += 15 + projects[i].tasksByRow.length * rowHeight + 40;
            }
            projectTopY += 15;

            const numRows = projects[projectIndex].tasksByRow.length;

            // Determinar el destino de drop:
            // - Si el cursor cae en el tercio central de una fila existente → fusionar (merge)
            // - Si cae en el tercio superior/inferior (entre filas) → insertar nueva fila
            const projectBottomY = projectTopY + numRows * rowHeight;
            const mergeZoneFraction = 0.34; // 34% central de cada fila activa el merge

            let newDropTarget = null;

            if (y > projectTopY - rowHeight / 2 && y < projectBottomY + rowHeight / 2) {
                // Identificar en qué fila estamos
                const relY = y - projectTopY;
                const hoveredRow = Math.floor(relY / rowHeight);
                const clampedRow = Math.max(0, Math.min(hoveredRow, numRows - 1));

                if (hoveredRow >= 0 && hoveredRow < numRows) {
                    // Si el cursor está en la misma fila de origen → sameRow (solo cambia startWeek)
                    if (hoveredRow === rowIndex) {
                        newDropTarget = { projectIndex, rowIndex: hoveredRow, sameRow: true };
                    } else {
                        // Posición relativa dentro de la fila [0..1]
                        const posInRow = (relY - hoveredRow * rowHeight) / rowHeight;
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

    drawGrid();
    drawProjects();

    if (draggingTask && draggingTask.didMove) {
        drawGhostTask();
    }

    if (draggingProject && draggingProject.didMove) {
        drawGhostProject();
    }
}

function drawGrid() {
    ctx.fillStyle = canvasHeaderBg;
    ctx.fillRect(0, 0, canvas.width, headerHeight);

    const dpr = ctx.getTransform().a || 1;
    const logicalCanvasWidth = canvas.width / dpr;
    const chartWidth = logicalCanvasWidth - projectLabelWidth;
    const weekWidth = chartWidth / totalWeeks;
    const startDate = getStartDate();

    let lastMonth = -1;
    let monthStartX = projectLabelWidth;
    let weeksInCurrentMonth = 0;

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

        ctx.fillStyle = canvasMutedText;
        ctx.font = gridFont;
        ctx.textAlign = 'center';
        ctx.fillText(`S${i + 1}`, x + weekWidth / 2, headerHeight / 2 + 15);
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

function drawProjects() {
    let y = headerHeight;
    taskHitboxes = [];
    projectHitboxes = [];
    if (!isDrawingForExport) {
        addTaskHitboxes = []; // Limpiar hitboxes en cada redibujado
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

        y += 15;

        // Dibujar siempre el nombre del proyecto y sus iconos
        const projectHeight = project.tasksByRow.length * rowHeight;
        const projectCenterY = y + projectHeight / 2;
        const textMetrics = ctx.measureText(project.name);
        const textX = 20;

        // Si no hay tareas, centrar el texto en el espacio de margen superior
        const textY = (project.tasksByRow.length > 0) ? projectCenterY : y + (15 / 2);

        ctx.fillStyle = project.color;
        ctx.font = projectFont;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(project.name, textX, textY);

        const isDropTargetProject = draggingTask && draggingTask.didMove && draggingTask.dropTarget?.projectIndex === projectIndex;
        const dropRowIndex = isDropTargetProject ? draggingTask.dropTarget.rowIndex : -1;
        const isMerge = isDropTargetProject && draggingTask.dropTarget?.merge;

        const numRows = project.tasksByRow.length;
        for (let i = 0; i <= numRows; i++) {
            // Placeholder de inserción (nueva fila) — solo cuando NO es merge
            if (isDropTargetProject && !isMerge && i === dropRowIndex) {
                drawPlaceholder(y);
                y += rowHeight;
            }

            if (i < numRows) {
                // Highlight de merge — resaltar la fila destino
                if (isDropTargetProject && isMerge && i === dropRowIndex) {
                    drawMergeHighlight(y);
                }
                project.tasksByRow[i].forEach((task, taskIndex) => {
                    drawTaskBar(task, project, y + rowHeight / 2, projectIndex, i, taskIndex);
                });
                y += rowHeight;
            }
        }

        // Dibujar botón de 'Añadir Tarea'
        if (!isDrawingForExport) {
            const buttonY = y + 10;
            const buttonHeight = 25;

            ctx.fillStyle = canvasHeaderBg;
            ctx.strokeStyle = gridColor;
            ctx.lineWidth = 1;
            roundRect(ctx, projectLabelWidth, buttonY, 120, buttonHeight, 5, true, true);

            ctx.fillStyle = textColor;
            ctx.font = '13px Poppins';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('+ Añadir tarea', projectLabelWidth + 10, buttonY + buttonHeight / 2);

            addTaskHitboxes.push({
                x: projectLabelWidth,
                y: buttonY,
                width: 120,
                height: buttonHeight,
                projectIndex
            });

            y += buttonHeight + 15; // Espacio extra después del botón
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
    const chartWidth = logicalCanvasWidth - projectLabelWidth;
    const weekWidth = chartWidth / totalWeeks;
    const barHeight = 30;
    const barY = y - barHeight / 2;
    const startX = projectLabelWidth + (task.startWeek - 1) * weekWidth;
    const fullBarWidth = task.duration * weekWidth;
    let barWidth = fullBarWidth * animationProgress;

    // Si la barra está completamente fuera del rango visible del grid, no dibujar
    const taskEndX = startX + fullBarWidth;
    if (taskEndX < projectLabelWidth || startX > projectLabelWidth + chartWidth) return;

    const hitbox = { x: Math.max(startX, projectLabelWidth), y: barY, width: fullBarWidth, height: barHeight, projectIndex, rowIndex, taskIndex };

    if (task.isMilestone) {
        const diamondSize = 20;
        hitbox.width = diamondSize;
        hitbox.height = diamondSize;
        hitbox.y = y - diamondSize / 2;
    }
    taskHitboxes.push(hitbox);

    const isDragging = draggingTask && draggingTask.projectIndex === projectIndex && draggingTask.rowIndex === rowIndex && draggingTask.taskIndex === taskIndex;
    const isResizing = resizingTask && resizingTask.projectIndex === projectIndex && resizingTask.rowIndex === rowIndex && resizingTask.taskIndex === taskIndex;

    // Aplicar clipping al área del gráfico para que las barras nunca invadan la zona de etiquetas
    ctx.save();
    ctx.beginPath();
    ctx.rect(projectLabelWidth, headerHeight, chartWidth, canvas.height / dpr - headerHeight);
    ctx.clip();

    ctx.fillStyle = task.completed ? '#666666' : (task.color || project.color);
    if (isDragging) ctx.globalAlpha = 0.6;
    if (isResizing) ctx.globalAlpha = 0.4;

    if (task.isMilestone) {
        const diamondSize = 20;
        ctx.save();
        ctx.translate(startX + diamondSize / 2, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-diamondSize / 2, -diamondSize / 2, diamondSize, diamondSize);
        ctx.restore();
    } else {
        roundRect(ctx, startX, barY, barWidth, barHeight, 8, true, false);
    }
    if (isDragging || isResizing) ctx.globalAlpha = 1.0;

    if (isResizing) {
        const ghostStartX = projectLabelWidth + (ghostTask.startWeek - 1) * weekWidth;
        const ghostWidth = ghostTask.duration * weekWidth;
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#E0E0E0';
        ctx.lineWidth = 1;
        roundRect(ctx, ghostStartX, barY, ghostWidth, barHeight, 8, true, true);
        ctx.globalAlpha = 1.0;
    }

    if (!isDragging && !isResizing) {
        ctx.font = taskFont;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        let text = task.name;
        const textMetrics = ctx.measureText(text);
        const textY = y;

        if (task.isMilestone) {
            ctx.fillStyle = textColor;
            // Truncar si el texto es muy largo y choca con el borde del canvas
            let milestoneText = text;
            const maxMilestoneTextWidth = logicalCanvasWidth - (startX + 35);
            if (textMetrics.width > maxMilestoneTextWidth) {
                milestoneText = truncateText(ctx, text, maxMilestoneTextWidth);
            }
            ctx.fillText(milestoneText, startX + 25, textY);
            ctx.restore();
            return;
        }

        const textFitsInside = fullBarWidth > textMetrics.width + 30;
        if (task.textPosition === 'inside' && textFitsInside) {
            if (barWidth > textMetrics.width + 30) {
                ctx.fillStyle = '#FFFFFF';
                ctx.save();
                ctx.beginPath();
                ctx.rect(startX, barY, barWidth, barHeight);
                ctx.clip();
                ctx.fillText(text, startX + 15, textY);
                ctx.restore();
            }
        } else if (task.textPosition === 'inside') {
            // Si el texto debería ir dentro pero no cabe, truncarlo
            if (barWidth > 40) {
                ctx.fillStyle = '#FFFFFF';
                ctx.save();
                ctx.beginPath();
                ctx.rect(startX, barY, barWidth, barHeight);
                ctx.clip();
                const truncatedInsideText = truncateText(ctx, text, barWidth - 20);
                ctx.fillText(truncatedInsideText, startX + 10, textY);
                ctx.restore();
            }
        } else {
            if (animationProgress > 0.95) {
                ctx.fillStyle = textColor;
                const textX = startX + fullBarWidth + 10;
                if (textX + textMetrics.width > logicalCanvasWidth) {
                    ctx.textAlign = 'right';
                    // Límite de 150px o espacio hasta el borde izquierdo del chart
                    const maxLeftTextWidth = Math.min(150, startX - projectLabelWidth - 20);
                    const finalLeftText = (textMetrics.width > maxLeftTextWidth) ? truncateText(ctx, text, maxLeftTextWidth) : text;
                    ctx.fillText(finalLeftText, startX - 10, textY);
                } else {
                    ctx.textAlign = 'left';
                    // Límite de 200px o espacio hasta el borde derecho del canvas
                    const maxRightTextWidth = Math.min(200, logicalCanvasWidth - textX - 10);
                    const finalRightText = (textMetrics.width > maxRightTextWidth) ? truncateText(ctx, text, maxRightTextWidth) : text;
                    ctx.fillText(finalRightText, textX, textY);
                }
            }
        }
    }

    if (task.completed) {
        let centerX = task.isMilestone ? startX + 10 : startX + barWidth / 2;
        drawCheckIcon(ctx, centerX, y, 11);
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
    ctx.fillText(project.name, 20, ghostY + 10);

    ctx.globalAlpha = 1.0;
}

function drawGhostTask() {
    const { projectIndex, rowIndex, taskIndex, offsetX, offsetY } = draggingTask;
    const task = projects[projectIndex].tasksByRow[rowIndex][taskIndex];
    const project = projects[projectIndex];

    // Calcular posición y dimensiones
    const barHeight = 30;
    const barY = lastMousePosition.y - offsetY;
    const chartWidth = canvas.width / (window.devicePixelRatio || 1) - projectLabelWidth;
    const weekWidth = chartWidth / totalWeeks;
    const startX = projectLabelWidth + (task.startWeek - 1) * weekWidth;
    const barWidth = task.duration * weekWidth;

    // Dibujar con transparencia
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = task.color || project.color;

    if (task.isMilestone) {
        const diamondSize = 20;
        ctx.save();
        ctx.translate(startX + diamondSize / 2, lastMousePosition.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-diamondSize / 2, -diamondSize / 2, diamondSize, diamondSize);
        ctx.restore();
    } else {
        roundRect(ctx, startX, barY, barWidth, barHeight, 8, true, false);
    }

    // Dibujar el texto dentro del fantasma
    ctx.font = taskFont;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(task.name, startX + 15, barY + barHeight / 2);

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
    if (lastTime === 0) lastTime = currentTime;
    const elapsedTime = currentTime - lastTime;
    lastTime = currentTime;
    if (animationProgress < 1) {
        animationProgress = Math.min(1, animationProgress + elapsedTime / animationDuration);
        draw();
        requestAnimationFrame(animate);
    } else {
        draw();
    }
}

function getStartDate() {
    const selectedMonth = parseInt(document.getElementById('start-month').value);
    const date = new Date(new Date().getFullYear(), selectedMonth, 1);
    while (date.getDay() !== 1) date.setDate(date.getDate() + 1);
    return date;
}

function getEndDate() {
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
        name: 'Nueva Tarea',
        startWeek: Math.ceil(latestEndWeek), // Empezar justo después
        duration: 2, // Duración por defecto
        type: 'normal',
        textPosition: 'inside'
    };

    // Añadir la tarea a la primera fila libre o a una nueva
    // (Lógica simplificada: la añade al final)
    p.tasksByRow.push([newTask]);

    updatePreview();
    saveToHistory();
}

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
        const exportTotalWeeks = Math.ceil(Math.max(selectorWeeks, maxEndWeek)) + 1;

        const EXPORT_WEEK_WIDTH = 50;
        const exportLogicalWidth = projectLabelWidth + (exportTotalWeeks * EXPORT_WEEK_WIDTH);

        let exportLogicalHeight = headerHeight;
        projects.forEach(p => {
            exportLogicalHeight += 15;
            const projectRows = p.tasksByRow.length;
            exportLogicalHeight += (projectRows === 0 ? rowHeight : projectRows * rowHeight);
        });
        exportLogicalHeight += rowHeight;

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
                    copyFeedback.textContent = '¡Copiado!';
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

                copyFeedback.style.display = 'block';
                setTimeout(() => { copyFeedback.style.display = 'none'; }, 2000);

            } catch (err) {
                console.error('Error al copiar al portapapeles:', err);
                alert('Error al copiar la imagen. Es posible que tu navegador no lo soporte.');
            }
        }, 'image/png');

    } catch (err) {
        console.error('Error al preparar el canvas para la copia:', err);
    } finally {
        // 6. Restaurar el estado original del canvas para la vista normal
        ctx.restore(); // Restaura el contexto, eliminando la escala de exportación
        totalWeeks = originalTotalWeeks;
        isDrawingForExport = false;
        initCanvasSize(); // Re-inicializa el canvas a las dimensiones de la pantalla
        draw(); // Vuelve a dibujar la vista normal
    }
}

function createNewSchedule() {
    if (confirm("¿Estás seguro de que quieres empezar un nuevo cronograma? Se perderán todos los cambios no guardados.")) {
        // Limpiar proyectos
        projects.length = 0;

        // Resetear título
        document.getElementById('cronograma-title').value = "Mi Cronograma";

        // Resetear fechas
        populateMonthSelectors(true); // `true` para forzar el reseteo a los valores por defecto

        // Actualizar la vista
        updatePreview();
        saveToHistory();
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

function exportToExcel() {
    const wb = XLSX.utils.book_new();
    const ws_data = [];

    const totalWeeks = calculateTotalWeeks();
    if (totalWeeks <= 0) {
        alert("No hay datos en el cronograma para exportar.");
        return;
    }

    // 1. CREAR CABECERAS DE SEMANAS Y MESES
    // Fila 0 para meses, Fila 1 para semanas
    const monthRow = ['Proyecto', 'Tarea'];
    const weekRow = ['', ''];
    for (let i = 1; i <= totalWeeks; i++) {
        weekRow.push(`S${i}`);
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
        if (monthLabels.length === 0 || monthLabels[monthLabels.length - 1].month !== months[weekMonth]) {
            monthLabels.push({ month: months[weekMonth], startWeek: i }); // 0-indexed
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

    projects.forEach(p => {
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

    // 4. APLICAR COLORES A LAS BARRAS DE TAREAS
    styleMap.forEach(item => {
        // La primera semana (startWeek) corresponde a la columna de la semana + 1 (por la columna Tarea)
        const startCol = item.startWeek + 1;

        for (let w = 0; w < item.duration; w++) {
            const colIndex = startCol + w;
            if (colIndex < totalWeeks + 2) {
                const cellAddress = XLSX.utils.encode_cell({ r: item.rowIndex, c: colIndex });
                if (!ws[cellAddress]) ws[cellAddress] = { v: '' }; // Crear celda si no existe
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