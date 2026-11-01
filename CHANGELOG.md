# Historial de versiones

Cada versión añade funcionalidades sobre la anterior. La versión actual se ve en la cabecera del panel (debajo del nombre) y en `VERSION` de `tools/pipeline.py`.

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
