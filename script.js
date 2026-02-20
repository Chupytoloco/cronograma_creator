let projects = [];
let editingTask = { project: -1, row: -1, task: -1 }; // Almacena qué tarea se está editando en el modal
let draggingTask = null;
let resizingTask = null; // { projectIndex, rowIndex, taskIndex, handle: 'left' | 'right' }
let ghostTask = null; // Copia de la tarea que se está redimensionando
let lastMousePosition = { x: 0, y: 0 }; // Rastrear la posición del ratón

let tempModalTasks = []; // Almacena temporalmente las tareas del modal de proyecto
let editingProjectId = null; // Para saber si estamos creando o editando un proyecto
let history = [];
let historyIndex = -1;
const MAX_HISTORY = 50;

let canvas, ctx;
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
const gridColor = '#444';
const textColor = '#E0E0E0';
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

    document.getElementById('add-project-btn').addEventListener('click', () => openProjectModal());
    document.getElementById('new-schedule-btn').addEventListener('click', createNewSchedule);
    document.getElementById('cronograma-title').addEventListener('input', updatePreview);
    document.getElementById('cronograma-title').addEventListener('change', saveToHistory);
    document.getElementById('start-month').addEventListener('change', () => { updatePreview(); saveToHistory(); });
    document.getElementById('end-month').addEventListener('change', () => { updatePreview(); saveToHistory(); });

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

    // Listeners para el nuevo modal de proyectos
    document.getElementById('project-modal-close-btn').addEventListener('click', closeProjectModal);
    document.getElementById('project-modal-save-btn').addEventListener('click', saveProjectFromModal);
    document.getElementById('project-modal-add-task-btn').addEventListener('click', addTemporaryTask);

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

    makeModalDraggable(document.getElementById('project-modal'));
    makeModalDraggable(document.getElementById('task-modal'));

    // Listener para cerrar modales con la tecla ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const projectModal = document.getElementById('project-modal');
            if (projectModal.style.display !== 'none') {
                closeProjectModal();
            }

            const taskModal = document.getElementById('task-modal');
            if (taskModal.style.display !== 'none') {
                closeTaskModal();
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
    const projectMonthSelect = document.getElementById('project-modal-start-month');

    // Limpiar opciones existentes para evitar duplicados
    startMonthSelect.innerHTML = '';
    endMonthSelect.innerHTML = '';
    projectMonthSelect.innerHTML = '';

    months.forEach((month, index) => {
        startMonthSelect.add(new Option(month, index));
        endMonthSelect.add(new Option(month, index));
        projectMonthSelect.add(new Option(month, index));
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

    if (data.projects && Array.isArray(data.projects)) {
        projects.length = 0;
        // Deep copy para evitar referencias circulares o problemas de mutación
        Array.prototype.push.apply(projects, JSON.parse(JSON.stringify(data.projects)));
    }

    updatePreview();
    updateHistoryButtons();
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
    if (confirm(`¿Estás seguro de que quieres eliminar "${projects[index].name}"?`)) {
        projects.splice(index, 1);
        updatePreview();
        saveToHistory();
    }
}

// --- GUARDAR Y CARGAR ---

function saveStateToLocalStorage() {
    try {
        const state = {
            title: document.getElementById('cronograma-title').value,
            startMonth: document.getElementById('start-month').value,
            endMonth: document.getElementById('end-month').value,
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

function openProjectModal(projectIndex = null) {
    editingProjectId = projectIndex;
    const modal = document.getElementById('project-modal');
    const title = document.getElementById('project-modal-title');

    if (projectIndex !== null) {
        // Lógica para editar (no implementada en este paso)
        title.textContent = 'Editar Proyecto';
        // Aquí se cargarían los datos del proyecto existente
    } else {
        // Lógica para crear
        title.textContent = 'Añadir Nuevo Proyecto';
        document.getElementById('project-modal-name').value = `Proyecto ${projects.length + 1}`;
        document.getElementById('project-modal-color').value = colorPalette[nextColorIndex % colorPalette.length];
        document.getElementById('project-modal-start-month').value = document.getElementById('start-month').value;

        tempModalTasks = [
            { id: Date.now() + 1, name: "Definición", startWeek: 1, duration: 2, isMilestone: false },
            { id: Date.now() + 2, name: "Diseño", startWeek: 3, duration: 3, isMilestone: false },
            { id: Date.now() + 3, name: "Desarrollo", startWeek: 6, duration: 5, isMilestone: false },
            { id: Date.now() + 4, name: "Pruebas", startWeek: 11, duration: 2, isMilestone: false },
            { id: Date.now() + 5, name: "Entrega", startWeek: 13, duration: 1, isMilestone: true }
        ];
        saveToHistory(); // Guardar estado antes de empezar a añadir un nuevo proyecto
    }

    renderTemporaryTasks();
    modal.style.display = 'flex';
}

function closeProjectModal() {
    document.getElementById('project-modal').style.display = 'none';
    tempModalTasks = [];
    editingProjectId = null;
}

function addTemporaryTask() {
    const newId = Date.now();
    tempModalTasks.push({
        id: newId,
        name: 'Nueva Tarea',
        startWeek: 1,
        duration: 2,
        isMilestone: false
    });
    renderTemporaryTasks();
}

function deleteTemporaryTask(taskId) {
    tempModalTasks = tempModalTasks.filter(t => t.id !== taskId);
    renderTemporaryTasks();
}

function renderTemporaryTasks() {
    const container = document.getElementById('project-modal-tasks-container');
    container.innerHTML = '';

    tempModalTasks.forEach(task => {
        const taskEl = document.createElement('div');
        taskEl.className = 'task-edit-row';
        taskEl.innerHTML = `
            <input type="text" value="${task.name}" data-task-id="${task.id}" data-property="name" placeholder="Nombre de tarea">
            <input type="number" value="${task.startWeek}" data-task-id="${task.id}" data-property="startWeek" min="1" title="Semana de inicio (relativa)">
            <input type="number" value="${task.duration}" data-task-id="${task.id}" data-property="duration" min="0.5" step="0.5" title="Duración en semanas">
            <select data-task-id="${task.id}" data-property="isMilestone">
                <option value="false" ${!task.isMilestone ? 'selected' : ''}>Normal</option>
                <option value="true" ${task.isMilestone ? 'selected' : ''}>Hito</option>
            </select>
            <button class="delete-task-btn" data-task-id="${task.id}">🗑️</button>
        `;
        container.appendChild(taskEl);
    });

    // Add event listeners for the new elements
    container.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('change', updateTemporaryTask);
    });
    container.querySelectorAll('.delete-task-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const taskId = Number(e.currentTarget.getAttribute('data-task-id'));
            deleteTemporaryTask(taskId);
        });
    });
}

function updateTemporaryTask(e) {
    const taskId = Number(e.target.getAttribute('data-task-id'));
    const property = e.target.getAttribute('data-property');
    let value = e.target.value;

    if (e.target.type === 'number') {
        value = parseFloat(value);
    } else if (property === 'isMilestone') {
        value = value === 'true';
    }

    const taskIndex = tempModalTasks.findIndex(t => t.id === taskId);
    if (taskIndex > -1) {
        tempModalTasks[taskIndex][property] = value;
    }
}

function saveProjectFromModal() {
    const projectData = {
        name: document.getElementById('project-modal-name').value,
        color: document.getElementById('project-modal-color').value,
        startMonth: parseInt(document.getElementById('project-modal-start-month').value),
        tasks: tempModalTasks.map(t => ({
            name: t.name,
            startWeek: t.startWeek,
            duration: t.duration,
            isMilestone: t.isMilestone,
            textPosition: 'outside' // Posición de texto por defecto
        }))
    };

    if (editingProjectId !== null) {
        // Lógica para actualizar proyecto (no implementada)
    } else {
        addProject(projectData);
    }

    updatePreview();
    saveToHistory();
    closeProjectModal();
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

    const modal = document.getElementById('task-modal');
    modal.style.display = 'flex';
    saveToHistory(); // Guardar estado antes de editar la tarea

    modal.querySelector('.modal-close-icon').onclick = closeTaskModal;

    document.getElementById('modal-delete-btn').onclick = () => {
        if (confirm(`¿Estás seguro de que quieres eliminar la tarea "${task.name}"?`)) {
            deleteTask(projectIndex, rowIndex, taskIndex);
        }
    };

    const modalInputs = ['modal-task-name', 'modal-start-week', 'modal-duration', 'modal-task-type', 'modal-text-position'];
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

    const updatedTask = {
        name: document.getElementById('modal-task-name').value.trim() || 'Tarea sin nombre',
        startWeek: parseInt(document.getElementById('modal-start-week').value) || 1,
        duration: parseFloat(document.getElementById('modal-duration').value) || 1,
        isMilestone: document.getElementById('modal-task-type').value === 'milestone',
        textPosition: document.getElementById('modal-text-position').value
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

    const icon = getIconUnderCursor(x, y);
    if (icon) {
        if (icon.type === 'color') {
            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.value = projects[icon.projectIndex].color;
            colorInput.style.display = 'none';
            document.body.appendChild(colorInput);
            colorInput.oninput = () => updateProjectColor(icon.projectIndex, colorInput.value);
            colorInput.onchange = () => document.body.removeChild(colorInput);
            colorInput.click();
        } else if (icon.type === 'delete') {
            deleteProject(icon.projectIndex);
        } else if (icon.type === 'move-up') {
            moveProject(icon.projectIndex, -1);
        } else if (icon.type === 'move-down') {
            moveProject(icon.projectIndex, 1);
        }
        e.preventDefault();
        return;
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
                const task = { ...project.tasksByRow[rowIndex][taskIndex] };
                const sourceIsOnlyTaskInRow = project.tasksByRow[rowIndex].length === 1;

                // Eliminar la tarea de su posición original
                project.tasksByRow[rowIndex].splice(taskIndex, 1);
                if (project.tasksByRow[rowIndex].length === 0) {
                    project.tasksByRow.splice(rowIndex, 1);
                }

                if (!dropTarget) {
                    project.tasksByRow.push([task]);
                } else {
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
            updatePreview();
            saveToHistory();
        }
    }

    // Limpiar estado y resetear cursor al finalizar cualquier acción
    if (resizingTask) resizingTask = null;
    if (ghostTask) ghostTask = null;
    if (draggingTask) draggingTask = null;
    canvas.style.cursor = 'default';


    // --- Lógica de Edición por Clic (se ejecuta si no hubo arrastre ni redimensión) ---
    if (!wasDragging && !wasResizing) {
        // Buscar si se hizo clic en los iconos de un proyecto
        const iconClicked = getIconUnderCursor(x, y);
        if (iconClicked) {
            if (iconClicked.type === 'delete') {
                deleteProject(iconClicked.projectIndex);
                return;
            } else if (iconClicked.type === 'edit') {
                openProjectModal(iconClicked.projectIndex);
                return;
            }
        }

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

        // Buscar si se hizo clic en el nombre de un proyecto para editarlo
        for (const hitbox of projectHitboxes) {
            // Solo activar si el clic es en el área del texto, no en toda la fila del proyecto
            if (x >= hitbox.x && x <= hitbox.x + projectLabelWidth && y >= hitbox.y && y <= hitbox.y + rowHeight) {
                createFloatingInput(hitbox);
                return;
            }
        }
    }
}

function handleCanvasMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // --- Lógica para cambiar el cursor al pasar por encima ---
    if (!draggingTask && !resizingTask) {
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

        // Comprobar si está sobre un icono de proyecto
        if (!onTask && newCursor === 'default' && getIconUnderCursor(x, y)) {
            newCursor = 'pointer';
        }

        canvas.style.cursor = newCursor;
        return; // Salir si no estamos arrastrando o redimensionando
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

            // Encontrar el slot más cercano al cursor iterando por los bordes
            // de las filas. Cada slot "i" representa insertar ANTES de la fila i
            // (o después de la última si i === numRows).
            // Usamos los puntos medios entre filas como umbrales.
            let bestSlot = 0;
            let slotY = projectTopY; // Y del borde superior de cada fila/slot

            for (let i = 0; i <= numRows; i++) {
                // El centro de la transición entre slot i-1 y slot i está en slotY
                if (y < slotY) {
                    break;
                }
                bestSlot = i;
                if (i < numRows) {
                    slotY += rowHeight;
                }
            }
            bestSlot = Math.max(0, Math.min(bestSlot, numRows));

            const projectBottomY = projectTopY + numRows * rowHeight;
            if (y > projectTopY - rowHeight / 2 && y < projectBottomY + rowHeight / 2) {
                draggingTask.dropTarget = { projectIndex, rowIndex: bestSlot };
            } else {
                draggingTask.dropTarget = null;
            }

            draw();
        }
    }
}

// --- FUNCIONES DE DIBUJO ---
function draw() {
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    // Dibujar el fondo principal
    ctx.fillStyle = '#252526';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawGrid();
    drawProjects();

    if (draggingTask && draggingTask.didMove) {
        drawGhostTask();
    }
}

function drawGrid() {
    ctx.fillStyle = '#1E1E1E';
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
                ctx.fillStyle = 'rgba(255,255,255,0.05)';
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

        ctx.fillStyle = '#999';
        ctx.font = gridFont;
        ctx.textAlign = 'center';
        ctx.fillText(`S${i + 1}`, x + weekWidth / 2, headerHeight / 2 + 15);
    }

    if (lastMonth !== -1) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
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

        const projectHitbox = {
            x: textX,
            y: textY - rowHeight / 2,
            width: textMetrics.width,
            height: rowHeight,
            projectIndex
        };
        projectHitboxes.push(projectHitbox);

        // El área de hover ahora incluye los iconos
        const numIcons = 4; // color, delete, move up, move down
        const iconsWidth = (projectIconSize + projectIconPadding) * numIcons;
        const hoverAreaWidth = projectHitbox.width + iconsWidth;

        const isHovering = lastMousePosition.x >= projectHitbox.x && lastMousePosition.x <= projectHitbox.x + hoverAreaWidth &&
            lastMousePosition.y >= projectHitbox.y && lastMousePosition.y <= projectHitbox.y + projectHitbox.height;

        if (isHovering && !draggingTask && !resizingTask && !isDrawingForExport) {
            drawProjectIcons(ctx, projectHitbox);
        }

        const isDropTargetProject = draggingTask && draggingTask.didMove && draggingTask.dropTarget?.projectIndex === projectIndex;
        const dropRowIndex = isDropTargetProject ? draggingTask.dropTarget.rowIndex : -1;

        const numRows = project.tasksByRow.length;
        for (let i = 0; i <= numRows; i++) {
            if (isDropTargetProject && i === dropRowIndex) {
                drawPlaceholder(y);
                y += rowHeight;
            }

            if (i < numRows) {
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
            ctx.fillStyle = '#3a3a3a';
            ctx.strokeStyle = '#555';
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
    });
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

    const hitbox = { x: startX, y: barY, width: fullBarWidth, height: barHeight, projectIndex, rowIndex, taskIndex };

    if (task.isMilestone) {
        const diamondSize = 20;
        hitbox.width = diamondSize;
        hitbox.height = diamondSize;
        hitbox.y = y - diamondSize / 2;
    }
    taskHitboxes.push(hitbox);

    const isDragging = draggingTask && draggingTask.projectIndex === projectIndex && draggingTask.rowIndex === rowIndex && draggingTask.taskIndex === taskIndex;
    const isResizing = resizingTask && resizingTask.projectIndex === projectIndex && resizingTask.rowIndex === rowIndex && resizingTask.taskIndex === taskIndex;

    ctx.fillStyle = project.color;
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
        const text = task.name;
        const textMetrics = ctx.measureText(text);
        const textY = y;

        if (task.isMilestone) {
            ctx.fillStyle = textColor;
            ctx.fillText(text, startX + 25, textY);
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
        } else {
            if (animationProgress > 0.95) {
                ctx.fillStyle = textColor;
                const textX = startX + fullBarWidth + 10;
                if (textX + textMetrics.width > canvas.width / (window.devicePixelRatio || 1)) {
                    ctx.textAlign = 'right';
                    ctx.fillText(text, startX - 10, textY);
                } else {
                    ctx.textAlign = 'left';
                    ctx.fillText(text, textX, textY);
                }
            }
        }
    }
}

function drawPlaceholder(y) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    const dpr = window.devicePixelRatio || 1;
    ctx.fillRect(projectLabelWidth, y, canvas.width / dpr - projectLabelWidth, rowHeight);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeRect(projectLabelWidth, y, canvas.width / dpr - projectLabelWidth, rowHeight);
    ctx.restore();
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
    ctx.fillStyle = project.color;

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

function drawProjectIcons(ctx, hitbox) {
    const y = hitbox.y + (hitbox.height / 2);
    const iconBaseX = hitbox.x + hitbox.width + projectIconPadding;

    // Icono de color
    ctx.fillText('🎨', iconBaseX, y);

    // Icono de editar (si es necesario)

    // Icono de eliminar
    const deleteIconX = iconBaseX + projectIconSize + projectIconPadding;
    ctx.fillText('🗑️', deleteIconX, y);

    // Iconos para mover arriba/abajo
    const moveUpIconX = deleteIconX + projectIconSize + projectIconPadding;
    ctx.fillText('🔼', moveUpIconX, y);

    const moveDownIconX = moveUpIconX + projectIconSize + projectIconPadding;
    ctx.fillText('🔽', moveDownIconX, y);
}

function getIconUnderCursor(x, y) {
    let foundIcon = null;
    projectHitboxes.forEach(hitbox => {
        const iconY = hitbox.y + (hitbox.height / 2) - (projectIconSize / 2);
        const iconBaseX = hitbox.x + hitbox.width + projectIconPadding;

        const colorIconX = iconBaseX;
        if (x >= colorIconX && x <= colorIconX + projectIconSize && y >= iconY && y <= iconY + projectIconSize) {
            foundIcon = { type: 'color', projectIndex: hitbox.projectIndex };
            return;
        }

        const deleteIconX = colorIconX + projectIconSize + projectIconPadding;
        if (x >= deleteIconX && x <= deleteIconX + projectIconSize && y >= iconY && y <= iconY + projectIconSize) {
            foundIcon = { type: 'delete', projectIndex: hitbox.projectIndex };
            return;
        }

        const moveUpIconX = deleteIconX + projectIconSize + projectIconPadding;
        if (x >= moveUpIconX && x <= moveUpIconX + projectIconSize && y >= iconY && y <= iconY + projectIconSize) {
            foundIcon = { type: 'move-up', projectIndex: hitbox.projectIndex };
            return;
        }

        const moveDownIconX = moveUpIconX + projectIconSize + projectIconPadding;
        if (x >= moveDownIconX && x <= moveDownIconX + projectIconSize && y >= iconY && y <= iconY + projectIconSize) {
            foundIcon = { type: 'move-down', projectIndex: hitbox.projectIndex };
            return;
        }
    });
    return foundIcon;
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