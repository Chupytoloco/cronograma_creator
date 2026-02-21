# 🗂️ Árbol de Funcionalidades — Cronograma Interactivo

## 📌 ¿Qué puedo hacer?

```
Cronograma Interactivo
│
├── 📋 Gestión del Cronograma
│   ├── 📄 Nuevo Cronograma            → Botón "Nuevo" (arriba izq.) — Reinicia todo el estado
│   ├── 💾 Guardar Cronograma          → Botón "Guardar" — Descarga un archivo .json con todos los datos
│   ├── 📂 Importar Cronograma         → Botón "Importar" (abajo) — Carga un .json guardado anteriormente
│   ├── 📋 Copiar como Imagen          → Botón "Copiar" — Copia el Gantt al portapapeles como PNG
│   └── 📊 Exportar a Excel            → Botón "Excel" (arriba) — Descarga los datos en formato .xlsx
│
├── 🔤 Título del Cronograma
│   └── Editar nombre                  → Campo de texto "Mi Cronograma" en la barra superior
│
├── 📅 Rango de Fechas
│   ├── Mes de inicio                  → Desplegable "Inicio:" — Seleccionar de ENE a DIC
│   └── Mes de fin                     → Desplegable "Fin:" — Seleccionar de ENE a DIC
│
├── 🎨 Apariencia
│   └── Cambiar tema visual            → Desplegable "Tema:" — Opciones: Oscuro, Claro, Moderno, Gris
│
├── ↩️ Historial de Cambios
│   ├── Deshacer                       → Botón "↶ Deshacer" / Atajo Ctrl+Z
│   └── Rehacer                        → Botón "↷ Rehacer" / Atajo Ctrl+Y (o Ctrl+Shift+Z)
│
├── 📁 Proyectos
│   ├── ➕ Añadir Proyecto              → Botón "Añadir Proyecto" (parte inferior)
│   ├── ✏️ Editar Proyecto (modal)      → Clic en el nombre del proyecto en el lado izquierdo del Gantt
│   │   ├── Cambiar nombre del proyecto
│   │   ├── Cambiar color del proyecto → Afecta a todas las tareas sin color personalizado
│   │   └── Eliminar proyecto          → Elimina el proyecto y todas sus tareas (pide confirmación)
│   └── 🔀 Reordenar Proyectos         → Arrastrar el nombre del proyecto arriba o abajo
│
├── 📌 Tareas
│   ├── ➕ Añadir Tarea                 → Clic en "+ Añadir tarea" debajo de cada proyecto en el Gantt
│   ├── ✏️ Editar Tarea (modal)         → Clic en la barra de una tarea
│   │   ├── Cambiar nombre de la tarea
│   │   ├── Cambiar semana de inicio
│   │   ├── Cambiar duración (en semanas; mín. 0.5)
│   │   ├── Cambiar tipo
│   │   │   ├── Normal                 → Barra rectangular redondeada
│   │   │   └── Hito                   → Forma de diamante (no redimensionable)
│   │   ├── Cambiar posición del texto
│   │   │   ├── Dentro                 → El nombre aparece dentro de la barra
│   │   │   └── Fuera                  → El nombre aparece a la derecha de la barra
│   │   ├── Cambiar color de la tarea  → Color individual que sobreescribe el del proyecto
│   │   ├── 🔄 Restaurar color         → Botón "🔄" — Borra el color individual y usa el del proyecto
│   │   ├── ✅ Completar / Descompletar → Alterna el estado de completado (icono ✔ verde en el Gantt)
│   │   └── 🗑️ Eliminar Tarea          → Elimina la tarea (pide confirmación)
│   ├── ↔️ Redimensionar Tarea         → Arrastrar desde el borde izquierdo o derecho de la barra
│   └── 🔀 Mover Tarea (drag & drop)   → Arrastrar la barra a otra fila:
│       ├── Zona central de una fila   → Fusiona con esa fila (comparten misma fila del Gantt)
│       └── Borde superior/inferior    → Crea una nueva fila separada
│
└── 📥 Importación masiva desde Excel
    └── Pegar tabla                    → Botón "Excel" — Abre área de pegado
        ├── Pegar datos con Ctrl+V     → Formato: Columna A = Proyecto, Columna B = Tarea
        └── Se cierran al pegar o clic fuera
```

---

## ⌨️ Atajos de Teclado

| Atajo | Acción |
|---|---|
| `Ctrl+Z` | Deshacer último cambio |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Rehacer cambio deshecho |
| `Escape` | Cierra cualquier modal o campo de edición abierto |

---

## 💡 Comportamientos automáticos

- **Auto-guardado local**: El estado se guarda automáticamente en el almacenamiento del navegador (LocalStorage) entre sesiones.
- **Animación de entrada**: Las barras se dibujan con una animación al renderizarse.
- **Adaptación de texto**: Si el nombre de una tarea no cabe dentro de la barra, se trunca o se mueve automáticamente.
- **Cursor contextual**: El cursor cambia según la zona (redimensionar, arrastrar, clic normal).
