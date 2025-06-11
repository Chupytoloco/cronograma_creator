let projects = [];
let editingTask = { project: -1, row: -1, task: -1 }; // Almacena qué tarea se está editando en el modal
let draggingTask = null;
let resizingTask = null; // { projectIndex, rowIndex, taskIndex, handle: 'left' | 'right' }
let ghostTask = null; // Copia de la tarea que se está redimensionando
let lastMousePosition = { x: 0, y: 0 }; // Rastrear la posición del ratón

let tempModalTasks = []; // Almacena temporalmente las tareas del modal de proyecto
let editingProjectId = null; // Para saber si estamos creando o editando un proyecto

let canvas, ctx;
let animationProgress = 0;
let lastTime = 0;
const animationDuration = 800;
let taskHitboxes = [];
let projectHitboxes = [];
let addTaskHitboxes = []; // Hitboxes para los botones de 'Añadir Tarea'
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

// --- INICIALIZACIÓN ---
window.addEventListener('load', () => {
    canvas = document.getElementById('ganttCanvas');
    ctx = canvas.getContext('2d');
    
    populateMonthSelectors();
    document.getElementById('add-project-btn').addEventListener('click', () => openProjectModal());
    document.getElementById('cronograma-title').addEventListener('input', updatePreview);
    document.getElementById('start-month').addEventListener('change', updatePreview);
    document.getElementById('end-month').addEventListener('change', updatePreview);
    
    // Listeners para guardar y cargar
    document.getElementById('save-btn').addEventListener('click', saveSchedule);
    document.getElementById('load-input').addEventListener('change', loadSchedule);

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
});

function populateMonthSelectors() {
    const startMonthSelect = document.getElementById('start-month');
    const endMonthSelect = document.getElementById('end-month');
    const projectMonthSelect = document.getElementById('project-modal-start-month');
    
    months.forEach((month, index) => {
        const option1 = new Option(month, index);
        const option2 = new Option(month, index);
        const option3 = new Option(month, index);
        startMonthSelect.add(option1);
        endMonthSelect.add(option2);
        projectMonthSelect.add(option3);
    });

    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const endMonth = (currentMonth + 5) % 12;

    startMonthSelect.value = currentMonth;
    endMonthSelect.value = endMonth;
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
    const tasks = projectData.tasks.map(t => ({...t}));

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
}

function updateProjectName(index, newName) {
    if (newName.trim() !== '') {
        projects[index].name = newName.trim();
    }
    updatePreview();
}

function updateProjectColor(index, newColor) {
    projects[index].color = newColor;
    updatePreview();
}

function deleteProject(index) {
    if (confirm(`¿Estás seguro de que quieres eliminar "${projects[index].name}"?`)) {
        projects.splice(index, 1);
        updatePreview();
    }
}

// --- GUARDAR Y CARGAR ---

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
}

function loadSchedule(event) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
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
}

function deleteTask(projectIndex, rowIndex, taskIndex) {
    const row = projects[projectIndex].tasksByRow[rowIndex];
    row.splice(taskIndex, 1);

    if (row.length === 0 && projects[projectIndex].tasksByRow.length > 1) {
        projects[projectIndex].tasksByRow.splice(rowIndex, 1);
    }
    
    closeTaskModal();
    updatePreview();
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

    document.getElementById('task-modal').style.display = 'flex';

    document.getElementById('modal-close-btn').onclick = closeTaskModal;
    document.getElementById('modal-delete-btn').onclick = () => deleteTask(projectIndex, rowIndex, taskIndex);
    
    const modalInputs = ['modal-task-name', 'modal-start-week', 'modal-duration', 'modal-task-type', 'modal-text-position'];
    modalInputs.forEach(id => {
        document.getElementById(id).oninput = updateTaskFromModal;
    });
}

function closeTaskModal() {
    document.getElementById('task-modal').style.display = 'none';
    editingTask = { project: -1, row: -1, task: -1 };
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
                resizingTask = { ...hitbox, handle: onLeftEdge ? 'left' : 'right' };
                ghostTask = { ...task };
                canvas.style.cursor = 'ew-resize';
            } else {
                draggingTask = { ...hitbox, offsetX: x - hitbox.x, offsetY: y - hitbox.y, didMove: false };
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

    // --- Lógica de Edición por Clic ---
    if (!draggingTask?.didMove && !resizingTask) {
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
                openTaskModal(hitbox.projectIndex, hitbox.rowIndex, hitbox.taskIndex);
                draggingTask = null; // Prevenir cualquier acción de arrastre residual
                return;
            }
        }

        // Buscar si se hizo clic en el nombre de un proyecto
        for (const hitbox of projectHitboxes) {
            if (x >= hitbox.x && x <= hitbox.x + hitbox.width && y >= hitbox.y && y <= hitbox.y + hitbox.height) {
                createFloatingInput(hitbox);
                draggingTask = null; // Prevenir cualquier acción de arrastre residual
                return;
            }
        }
    }


    // --- Lógica de Arrastrar y Soltar ---
    if (resizingTask) {
        const { projectIndex, rowIndex, taskIndex } = resizingTask;
        let collision = false;
        for (let i = 0; i < projects[projectIndex].tasksByRow[rowIndex].length; i++) {
            if (i === taskIndex) continue;
            if (checkCollision(ghostTask, projects[projectIndex].tasksByRow[rowIndex][i])) {
                collision = true;
                break;
            }
        }
        if (!collision) {
            projects[projectIndex].tasksByRow[rowIndex][taskIndex] = ghostTask;
        }
        resizingTask = null;
        ghostTask = null;
    }

    if (draggingTask) draggingTask = null;
    
    updatePreview();
}

function handleCanvasMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (!draggingTask && !resizingTask) {
        let newCursor = 'default';
        let onTask = false;
        
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

        if (!onTask) {
            for (const hitbox of addTaskHitboxes) {
                if (x >= hitbox.x && x <= hitbox.x + hitbox.width && y >= hitbox.y && y <= hitbox.y + hitbox.height) {
                    newCursor = 'pointer';
                    break;
                }
            }
        }
        
        if (!onTask && newCursor === 'default' && getIconUnderCursor(x, y)) {
            newCursor = 'pointer';
        }

        canvas.style.cursor = newCursor;
        return;
    }

    if (resizingTask) {
        const weekWidth = (canvas.width / (window.devicePixelRatio || 1) - projectLabelWidth) / totalWeeks;
        const currentWeek = Math.round((x - projectLabelWidth) / weekWidth) + 1;
        
        if (resizingTask.handle === 'left') {
            const startDiff = ghostTask.startWeek - currentWeek;
            const newDuration = ghostTask.duration + startDiff;
            if (newDuration >= 0.5) {
                ghostTask.startWeek = currentWeek;
                ghostTask.duration = newDuration;
            }
        } else {
            const newDuration = currentWeek - ghostTask.startWeek;
            if (newDuration >= 0.5) {
                ghostTask.duration = newDuration;
            }
        }
        draw();
        return;
    }

    if (draggingTask) {
        draggingTask.didMove = true;
        const chartWidth = canvas.width / (window.devicePixelRatio || 1) - projectLabelWidth;
        const weekWidth = chartWidth / totalWeeks;
        let newStartWeek = Math.round((x - projectLabelWidth - draggingTask.offsetX) / weekWidth) + 1;
        newStartWeek = Math.max(1, Math.min(newStartWeek, totalWeeks));

        let targetProjectIndex = -1, targetRowIndex = -1;
        let currentY = headerHeight;

        for (let i = 0; i < projects.length; i++) {
            const projectStartY = currentY + 15;
            const projectContentHeight = projects[i].tasksByRow.length * rowHeight;
            const isLastProject = i === projects.length - 1;
            const droppableHeight = projectContentHeight + (isLastProject ? rowHeight : 0);

            if (y >= projectStartY && y < projectStartY + droppableHeight) {
                targetProjectIndex = i;
                targetRowIndex = Math.floor((y - projectStartY) / rowHeight);
                break;
            }
            currentY += (15 + projectContentHeight);
        }

        if (targetProjectIndex === -1) return;

        const originalTaskState = { ...draggingTask };
        const positionChanged = targetProjectIndex !== originalTaskState.projectIndex || targetRowIndex !== originalTaskState.rowIndex;
        
        const taskObject = projects[originalTaskState.projectIndex].tasksByRow[originalTaskState.rowIndex][originalTaskState.taskIndex];
        taskObject.startWeek = newStartWeek;

        if (positionChanged) {
            const [movedTask] = projects[originalTaskState.projectIndex].tasksByRow[originalTaskState.rowIndex].splice(originalTaskState.taskIndex, 1);
            const sourceRow = projects[originalTaskState.projectIndex].tasksByRow[originalTaskState.rowIndex];

            if (sourceRow && sourceRow.length === 0 && projects[originalTaskState.projectIndex].tasksByRow.length > 1) {
                projects[originalTaskState.projectIndex].tasksByRow.splice(originalTaskState.rowIndex, 1);
                if (originalTaskState.projectIndex === targetProjectIndex && originalTaskState.rowIndex < targetRowIndex) {
                    targetRowIndex--;
                }
            }
            
            let targetRow = projects[targetProjectIndex].tasksByRow[targetRowIndex];
            if (!targetRow) {
                 projects[targetProjectIndex].tasksByRow.push([movedTask]);
                 draggingTask.rowIndex = projects[targetProjectIndex].tasksByRow.length - 1;
                 draggingTask.taskIndex = 0;
            } else {
                let collision = false;
                for(const existing of targetRow) if(checkCollision(movedTask, existing)) collision = true;
                
                if (collision) {
                    projects[targetProjectIndex].tasksByRow.splice(targetRowIndex + 1, 0, [movedTask]);
                    draggingTask.rowIndex = targetRowIndex + 1;
                    draggingTask.taskIndex = 0;
                } else {
                    targetRow.push(movedTask);
                    draggingTask.rowIndex = targetRowIndex;
                    draggingTask.taskIndex = targetRow.length - 1;
                }
            }
            draggingTask.projectIndex = targetProjectIndex;
        } else {
            taskObject.startWeek = newStartWeek;
        }
        draw();
    }
}

// --- FUNCIONES DE DIBUJO ---
function draw() {
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    drawGrid();
    drawProjects();
}

function drawGrid() {
    ctx.fillStyle = '#1E1E1E';
    ctx.fillRect(0, 0, canvas.width, headerHeight);
    
    const chartWidth = canvas.width / (window.devicePixelRatio || 1) - projectLabelWidth;
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
    addTaskHitboxes = []; // Limpiar hitboxes en cada redibujado
    
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
        
        const isHovering = lastMousePosition.x >= projectHitbox.x - 10 && lastMousePosition.x <= projectHitbox.x + projectHitbox.width + 50 &&
                           lastMousePosition.y >= projectHitbox.y && lastMousePosition.y <= projectHitbox.y + projectHitbox.height;

        if (isHovering && !draggingTask && !resizingTask) {
            drawProjectIcons(ctx, projectHitbox);
        }

        project.tasksByRow.forEach((taskRow, rowIndex) => {
            taskRow.forEach((task, taskIndex) => {
                drawTaskBar(task, project, y + rowHeight / 2, projectIndex, rowIndex, taskIndex);
            });
            y += rowHeight;
        });

        // Dibujar botón de 'Añadir Tarea'
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
    });
}

function drawTaskBar(task, project, y, projectIndex, rowIndex, taskIndex) {
    const chartWidth = canvas.width / (window.devicePixelRatio || 1) - projectLabelWidth;
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
    const iconSize = 18;
    const padding = 10;
    const y = hitbox.y + (hitbox.height / 2);

    const colorIconX = hitbox.x + hitbox.width + padding;
    ctx.font = `${iconSize}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎨', colorIconX, y);

    const deleteIconX = colorIconX + iconSize + padding;
    ctx.fillText('🗑️', deleteIconX, y);
}

function getIconUnderCursor(x, y) {
    let foundIcon = null;
    projectHitboxes.forEach(hitbox => {
        const iconSize = 18;
        const padding = 10;
        const iconY = hitbox.y + (hitbox.height / 2) - (iconSize / 2);
        const colorIconX = hitbox.x + hitbox.width + padding;
        const deleteIconX = colorIconX + iconSize + padding;

        if (x >= colorIconX && x <= colorIconX + iconSize && y >= iconY && y <= iconY + iconSize) {
            foundIcon = { type: 'color', projectIndex: hitbox.projectIndex };
        }
        if (x >= deleteIconX && x <= deleteIconX + iconSize && y >= iconY && y <= iconY + iconSize) {
            foundIcon = { type: 'delete', projectIndex: hitbox.projectIndex };
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
    const startWeek = findLatestEndWeek(projectIndex);
    
    const newTask = {
        name: 'Nueva Tarea',
        startWeek: startWeek,
        duration: 2,
        isMilestone: false,
        textPosition: 'outside'
    };

    // Añadir la tarea en una nueva fila para simplicidad
    projects[projectIndex].tasksByRow.push([newTask]);
    
    updatePreview();
}