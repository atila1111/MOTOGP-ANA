# Historial de versiones

Cada versión añade funcionalidades sobre la anterior. La versión actual se ve en la cabecera del panel (debajo del nombre) y en `VERSION` de `tools/pipeline.py`.

## 0.8.1 · 8 nov 2026 · Banco de pruebas de calibración

- **`tools/calibrar.py` y `tools/calibrar.js`** (herramienta de mantenimiento, necesita Node.js): prueba variantes del modelo de ritmo de carrera (tanda elegida —la más larga o la más rápida—, peso de la Sprint, offset de tanda corta, prior del Mundial) contra todas las Carreras reales del repositorio y compara el error de ritmo, la correlación de posiciones y el podio acertado. No cambia nada por sí solo: sirve para decidir con datos, y solo debe adoptarse lo que mejore en todas las carreras.
- Motivo: el modelo daba un 2 % de victoria a Bezzecchi en Catar porque estimaba su ritmo con su tanda de práctica más larga y no con la más rápida, y sin Sprint propia; una variante cambia al favorito, así que hace falta contrastarla con más de una carrera.

## 0.8.0 · 8 nov 2026 · Bajas del domingo y WUP

- **Panel «Bajas y WUP del domingo»** en el simulador de carrera: marca los pilotos que no toman la salida y se recalcula la Carrera simulada (Top 3 de Domingo, simulador, comparativas) sin ellos; los que van detrás suben un puesto en la parrilla. Se guarda en `<CIRCUITO>/bajas.json` (con el servidor en marcha; sin él, se puede escribir a mano `{"RAC": [63]}`).
- **WUP del domingo:** el descargador baja la sesión de calentamiento a `<CIRCUITO>/WUP/` y el panel muestra quién rodó, mejor tiempo, vueltas, neumático delantero/trasero y punta, con las condiciones de pista. No entra en la predicción de ritmo (son 4–6 vueltas sin carga de carrera), pero **detecta posibles bajas**: un piloto que no aparece en el WUP se propone como baja con un clic.
- **Panel «WUP del domingo · índice de preparación»** (pestaña Resumen): mejor vuelta, gap, vueltas dadas y válidas, consistencia, neumático, evolución respecto al sábado (gap al mejor de FP2, que cancela la mejora de pista común a todos), puestos que sube o baja, un **índice experimental 0–100** (50 % ritmo, 30 % evolución, 20 % consistencia) y una lectura (Mejora, Consistente, Investigar). Después de la carrera añade el resultado real. Contrastado con Malasia (14 pilotos): el puesto en el WUP correlaciona 0,80 con el resultado, igual que FP2 (0,81), y el índice compuesto sale peor (0,37), así que es informativo y **no entra en la predicción**.
- **Distribución por puesto en el simulador de carrera:** tabla con el % de las simulaciones que acaba cada piloto en cada posición (P1…Pn y abandono), además del % de victoria y podio.
- **Previsión de Open-Meteo calibrada de noche:** si la carrera es a la misma hora que la Sprint real y no hay sol, la temperatura de pista estimada usa el calor residual que midió la Sprint en lugar de la fórmula con radiación solar (en Catar daba 31° frente a los 33° medidos).
- La previsión de Open-Meteo se pide siempre para el circuito activo, con sus coordenadas y la fecha y hora de la carrera que da la API.

## 0.7.1 · 6 nov 2026 · Catar y lectura de los PDF de Lusail

- **Corrección:** los PDF de Lusail (Catar) empiezan con etiquetas sueltas antes del título y no se reconocían, así que el circuito seguía «pendiente» aunque estuvieran descargados. Ahora se detectan y Catar se activa con FP1 y PR reales (también se reconocen los PDF antiguos de Mandalika).
- **Histórico del circuito:** ya no incluye la fila de una edición del año en curso que aún no tiene carrera.
- Catar: 18 pilotos en las sesiones oficiales (la API también clasifica solo a 18).

## 0.7.0 · 2 nov 2026 · Flujo de carrera

- **Nueva pestaña «Flujo de carrera»** para la Carrera y la Sprint reales (TOP 7 o TOP 10 a elegir):
  - **Hueco con el líder vuelta a vuelta**, con el adelantamiento marcado en la gráfica, y **ritmo vuelta a vuelta frente al líder**.
  - **Tabla de adelantamientos** entre los primeros: vuelta, quién pasa a quién y qué pasó con el hueco del que adelanta y del adelantado en las vueltas siguientes.
  - **Ranking TOP 10 del más rápido al más lento**: ritmo (mediana), mejor vuelta, ritmo por tramos, desgaste, segundos que pierde con el líder en cada cuarto de carrera, punta máxima y punta media, con su puesto.
  - **Veredicto «¿se escapó el líder por culpa de los adelantamientos de detrás?»**: en cuántas vueltas creció su ventaja sobre el 2º, cuántos adelantamientos hubo y, sobre todo, si ir pegado a otro piloto (<1 s) costaba tiempo respecto al ritmo propio, que es la señal medible que dejaría un piloto que tapona. Mide tiempos, no intenciones.
- Función `raceFlow` en `tools/engine.js`; todo sale del tiempo acumulado en meta, y el hueco final coincide con la Classification oficial.

## 0.6.0 · 1 nov 2026 · Recuperar resultados de MotoGP

- **Botón «Recuperar resultados MotoGP»** en la cabecera (con el servidor en marcha): en un solo paso baja los PDF nuevos y los datos de la API pública de motogp.com y recarga el panel. Al lado se ve siempre la **fecha y hora de la última actualización** (también sin servidor, guardada en `API/estado.json`).
- **Todos los PDF de la web:** además de los de sesión, baja los de *Event Results* (Circuit Information, Entry, Entry Biographical, Event Maximum Speed) y los de *Championship Results* (Season Statistics, Nations Statistics, Riders Performance, Pole Positions, Podiums, Riders All Time) a `<CIRCUITO>/CAMPEONATO/`, y la clasificación del Mundial de cada sesión (`worldstanding.pdf`).
- **Respaldo con Session.pdf:** si la API lista informes sueltos que el servidor todavía no ha publicado (suele pasar unas horas después de la carrera), se baja el `Session.pdf` completo y de él se leen Lap Chart, Fastest Lap Sequence, etc.
- **Datos de la API que no vienen en PDF** (`API/`): clasificación del Mundial y calendario, estadísticas de temporada y carrera de cada piloto con su resultado en cada GP, y el **histórico de las últimas ediciones de cada circuito** (podio, pole, vuelta rápida, tiempo del ganador, vueltas, temperatura de pista, aire y humedad, récord de vuelta).
- **Panel «Histórico del circuito»** y **«Palmarés en este circuito y forma 2026»** (puesto y puntos antes del GP, resultados por año en carrera y sprint) en la pestaña Resumen.
- **Simulador de carrera:** botón «Media histórica» con las condiciones de las carreras en seco anteriores y referencia del ritmo medio del ganador.
- **Siguientes circuitos preparados** (Mandalika, Portimão, Lusail, Valencia): fecha del GP, vueltas reales de Sprint y Carrera, récord de pista e histórico se rellenan solos desde la API y se ven en la pantalla del circuito aunque aún no haya PDF.
- **Corrección:** el panel «Evolución cronológica (Fastest Laps Sequence)» salía vacío en Sprint y Carrera porque sus filas llevan delante el número de vuelta; ahora se lee.
- **Capturas de pantalla** en `docs/capturas/` y `tools/capturas.py` para regenerarlas; `README.md` con la lista completa de funcionalidades.

## 0.5.0 · 31 oct 2026 · Descarga automática de PDF

- `tools/descargar.py`: baja los PDF oficiales desde la API pública de motogp.com a `<CIRCUITO>/<SESION>/` con el nombre de la web; salta lo ya descargado (aunque tenga otro nombre), sustituye lo que cambió de tamaño y conserva lo local si la web ya no lo sirve.
- Informes del evento a `<CIRCUITO>/EVENTO/` y calendario en `evento.json` (de ahí salen la fecha y hora de la Carrera).
- Opciones: `--circuito`, `--todos`, `--año` (temporadas anteriores a `HISTORICO/`), `--simular`, `--bundle`.
- Endpoint del servidor local y botón en la cabecera.

## 0.4.0 · 31 oct 2026 · Fotos, neumáticos y degradación

- Foto de cada piloto (descargadas con `tools/fotos.py` e incrustadas en el panel) en el Top 3 y las tablas.
- Neumático delantero/trasero usado en cada tanda y en la mejor vuelta.
- Gráfica de degradación «proyectada vs real» también después de la Sprint.
- Corrección de los compuestos reales (Soft/Medium/Hard) en la normalización del ritmo.
- Análisis local de la degradación proyectada frente a la real (sin aplicar al modelo).

## 0.3.0 · 31 oct 2026 · Simulador de carrera y cabecera con sesiones

- **Simulador de carrera** Monte Carlo vuelta a vuelta: seco, mojado y flag-to-flag, estado de pista editable, previsión de Open-Meteo y enlace al Met Office.
- Etiqueta con la sesión en el título de cada panel.
- Cabecera fija con los hitos y la barra de sesiones (FP1 … RACE, marcadas REAL o SIM).
- Calibración de la carrera simulada con el ritmo real de la Sprint.

## 0.2.0 · 31 oct 2026 · Informes del evento

- Lectura de Entry List, Rider Statistics (Biographical), Circuit Information y Event Best Maximum Speed.
- Ficha del circuito (récords, pole y ritmo de la Sprint frente a 2025) y prior suave por clasificación del Mundial 2025.
- Parrillas oficiales (Grid) como nuevo factor de la Sprint y la Carrera.

## 0.1.0 · 31 oct 2026 · Primera versión

- Lectura de los PDF oficiales de cronometraje (Analysis, Classification, Best Partial Times, Maximum Speed, Top Speed & Average, Fastest Laps Sequence, Qualifying Results, Lap Chart, Fastest Lap of each Rider) con validación cruzada.
- Depuración de vueltas, vuelta ideal por sectores, velocidades punta.
- Predicción de Pole, Sprint y Carrera en cinco hitos del fin de semana usando solo lo conocido en cada uno.
- Pestaña «Predicción vs Realidad» con error de ritmo, podio acertado y diagnóstico de la desviación.
- Sesiones sin PDF simuladas y marcadas como SIMULADO.
- Cinco circuitos (Malasia con datos reales de ejemplo), instaladores para Windows y Linux, servidor local con recarga en F5 y manual `README.txt`.
