=====================================================================
  MOTOGP TELEMETRY - Performance & Prediction Lab
  Manual de uso, instalacion y despliegue
=====================================================================

1. QUE ES
---------------------------------------------------------------------
Un panel web (una sola pagina, index.html) que lee los PDF oficiales de
cronometraje de MotoGP (Official MotoGP Timing) de cada Gran Premio y:

  - depura las vueltas (out-laps, in-laps, anuladas, lentas) y calcula la
    vuelta ideal de cada piloto (suma de sus mejores sectores);
  - simula Pole (Q2), Sprint y Carrera en cinco hitos del fin de semana:
    Viernes post-PR, Sabado AM post-FP2, Sabado post-Q2, Post-Sprint y
    Post-Carrera, usando SOLO los datos conocidos en cada hito;
  - compara cada prediccion con la realidad (error de ritmo en s/vuelta,
    % de podio acertado, posiciones) y diagnostica la desviacion: desfase
    comun del campo (meteo), incidentes oficiales, no terminaron, etc.;
  - para las sesiones cuyo PDF aun no has subido, genera una SIMULACION
    limpia anclada en el ritmo real del viernes y la marca como SIMULADO.

Datos reales incluidos como ejemplo: Gran Premio de Malasia (Sepang,
2026): FP1, PR, FP2, Q1, Q2 y Sprint. La Carrera esta simulada hasta que
subas sus PDF a MALASYA/RACE/.


2. REQUISITOS
---------------------------------------------------------------------
  - Python 3.9 o superior (probado con 3.14).
  - Libreria Python  pdfplumber  (se instala sola con instalar.bat /
    instalar.sh; ver requirements.txt).
  - Un navegador moderno (Chrome, Edge, Firefox).
  - Conexion a Internet AL ABRIR el panel: React, Tailwind, Babel y
    Chart.js se cargan desde unpkg.com, cdn.tailwindcss.com y
    cdn.jsdelivr.net. Para leer los PDF no hace falta Internet.
  - ~100 MB libres. Sin base de datos ni servicios externos.


3. INSTALACION Y PUESTA EN MARCHA
---------------------------------------------------------------------
3.1 Windows  (10 / 11)

   1) Descarga o clona el proyecto y abre la carpeta.
   2) Doble clic en  instalar.bat  . El asistente:
        - comprueba que hay Python 3.9+ (si falta, ofrece instalarlo con
          winget; despues hay que cerrar la ventana y repetir);
        - pregunta si crear un entorno virtual .venv (recomendado);
        - pregunta si instalar las dependencias con pip;
        - avisa si no hay acceso a las CDN del navegador;
        - prepara las carpetas CIRCUITO\SESION vacias;
        - pregunta si generar ya index.html y si arrancar el servidor.
   3) Para los siguientes usos basta con doble clic en  iniciar.bat  :
      abre http://localhost:8000 en el navegador y deja el servidor
      corriendo. Ctrl+C en la ventana para pararlo.

3.2 Linux / macOS

   1) Descarga o clona el proyecto y abre una terminal en la carpeta.
   2) Ejecuta:    bash instalar.sh
      Hace lo mismo que instalar.bat (ofrece instalar python3/python3-venv
      con apt, dnf, pacman o brew si faltan).
   3) Siguientes usos:    ./iniciar.sh
      (si no es ejecutable:  chmod +x instalar.sh iniciar.sh)

3.3 Instalacion manual (cualquier sistema)

      python -m venv .venv
      .venv\Scripts\activate          (Linux/macOS:  source .venv/bin/activate)
      pip install -r requirements.txt
      python tools/servidor.py        ->  http://localhost:8000

3.4 Variables de entorno opcionales

      PORT=8080        puerto del servidor (por defecto 8000)
        Windows:  set PORT=8080   y luego   iniciar.bat
        Linux:    PORT=8080 ./iniciar.sh


4. ESTRUCTURA DE CARPETAS
---------------------------------------------------------------------
   index.html             panel generado (autocontenido; se reescribe solo)
   instalar.bat / .sh     verificacion de requisitos + instalacion
   iniciar.bat / .sh      arranque del servidor local
   requirements.txt       dependencias de Python
   README.txt             este manual
   tools/
     pipeline.py          lee los PDF, simula y construye los datos
     servidor.py          servidor local: reconstruye al pulsar F5
     actualizar.py        reconstruye index.html sin servidor
     engine.js            motor de analisis y prediccion
     ui.jsx, shell.jsx    interfaz (React)
     template.html        plantilla de la pagina
   MALASYA/               EJEMPLO con datos reales (Sepang, 2026)
   MANDALIKA/ PORTIMAO/ QATAR/ VALENCIA/     circuitos vacios, listos
   <CIRCUITO>/
     FP1/  PR/  FP2/  Q1/  Q2/  SPRINT/  RACE/     una carpeta por sesion

Las carpetas de sesion se crean solas si faltan (tambien lo hacen
instalar y iniciar). En git las carpetas vacias llevan un fichero
.gitkeep; puedes ignorarlo.


5. COMO CARGAR UN FIN DE SEMANA
---------------------------------------------------------------------
5.1 Que PDF subir

En la web oficial de MotoGP, apartado de resultados de cada sesion,
descarga los informes y sueltalos en la carpeta de esa sesion. Los
nombres de fichero dan igual: la sesion se identifica por la CARPETA y
cada informe por su TITULO interno.

   Informe (titulo del PDF)         Para que se usa
   -------------------------------  ------------------------------------
   Chronological Analysis (Analysis)  OBLIGATORIO: vuelta a vuelta,
                                      sectores, velocidad, neumatico
   Classification                     resultado, tabla de pilotos, meteo
                                      (aire, pista, humedad) e incidentes
   Best Partial Times                 vuelta ideal oficial
   Top Speed / Maximum Speed          velocidad maxima
   Top Speed & Average                media de las 5 mejores puntas
   Fastest Laps Sequence              evolucion de la sesion
   Starting Grid (Grid)               parrilla OFICIAL (con sanciones) y
                                      quien toma la salida
   Qualifying Results                 orden oficial de la clasificacion
   Lap Chart                          posiciones vuelta a vuelta
   Fastest Lap of each Rider          validacion cruzada
   Combined Practice Times,
   Analysis by Lap                    se reconocen y se guardan
                                      (sin uso en el modelo)

   Informes del EVENTO (no son de una sesion; valen en cualquier carpeta,
   por ejemplo SPRINT/):
   Entry List                         pilotos inscritos, novatos (r),
                                      wildcards (W) y sustitutos R(n);
                                      marca a los sustituidos como fuera
                                      del evento
   Rider Statistics (Biographical)    edad, carrera, victorias y titulos de
                                      cada piloto, puesto en el Mundial 2025
                                      y resultado en este circuito en 2025
   Circuit Information                trazado (anchura, curvas, recta mas
                                      larga), records y referencias 2025
   Event Best Maximum Speed           mejor punta de cada piloto en el fin
                                      de semana y sesion en que la logro

Tambien vale el PDF  Session.pdf  (paquete con varios informes): se
trocea por paginas. Si ademas hay informes sueltos, los sueltos ganan;
entre dos iguales gana el mas reciente.

5.2 Donde va cada cosa

   FP1/       Free Practice 1 (viernes manana)
   PR/        Practice (viernes tarde)
   FP2/       Free Practice 2 (sabado manana)
   Q1/, Q2/   Clasificacion 1 y 2.  El Grid de la CARRERA (domingo) se
              publica con Q2: ponlo en Q2/ (se reconoce solo).
   SPRINT/    Sprint, incluido su Grid (parrilla de la Sprint)
   RACE/      Carrera, y su Grid definitivo si lo hay (sustituye al
              provisional de Q2/)

Para forzar una sesion concreta tambien se puede prefijar el nombre:
FP2_analysis.pdf, Q1_classification.pdf ... (prefijos FP1 PR FP2 Q1 Q2 SPR
RAC; no lo uses con los Grid, que se asignan solos por su titulo).

5.3 Cuando se activa un circuito

Un circuito necesita como minimo el Analysis de FP1 y de PR (son la base
de las simulaciones). Hasta entonces aparece como "sin datos" con una
pantalla que indica que falta. A partir de ahi, cada sesion que subas
pasa de SIMULADO a REAL automaticamente.

5.4 Refrescar

   - Con servidor (iniciar.bat / iniciar.sh): suelta los PDF y pulsa F5.
     Solo reconstruye si cambiaron PDF o ficheros de tools/.
   - Sin servidor:   python tools/actualizar.py   y abre index.html.
     (La primera construccion con todos los circuitos tarda 30-60 s.)


6. USO DEL PANEL
---------------------------------------------------------------------
Cabecera (siempre visible al hacer scroll): selector de circuito, los 5
hitos del fin de semana y la barra de SESION con FP1, PR, FP2, Q1, Q2,
SPRINT y RACE, cada una marcada REAL o SIM. La sesion activa gobierna
Telemetria y Sim vs Real; las sesiones aun no disputadas en el hito se
muestran apagadas. Cada panel lleva junto al titulo una etiqueta con la
sesion u objetivo a que se refieren sus datos (p. ej. "FP2 - REAL",
"objetivo SPRINT", "datos hasta FP2").

Interruptor "Real si existe / Solo simulacion": muestra los datos reales
cuando los hay o fuerza la simulacion limpia de todo el fin de semana.

Pestanas:
   Resumen               Top 3 de Pole, Sprint y Domingo, con confianza,
                         ficha del circuito (records, pole y ritmo de la
                         Sprint frente a las referencias de 2025) y
                         trazabilidad de datos (que PDF y con que
                         validacion cruzada se ha leido cada sesion).
   Telemetria            vueltas depuradas, sectores, vuelta ideal,
                         velocidades punta, evolucion de la sesion y,
                         en Sprint/Carrera, direccion de carrera y salida.
   Ritmo & Simulacion    tablas de la prediccion, tandas y degradacion.
   Simulador de carrera  simulacion Monte Carlo vuelta a vuelta de la
                         Carrera (ver apartado 6.1)
   Prediccion vs         lo que se predijo en cada hito frente a la
   Realidad              realidad (real, o simulada si aun no hay PDF):
                         error por hito, tabla por piloto y diagnostico
                         de la desviacion.
   Sim vs Real           cada sesion simulada frente a su version real.

6.1 Simulador de carrera
    Parte de la prediccion de ritmo y degradacion mas reciente que aun no
    conoce la carrera (si ya hay Sprint real, esta incluida) y simula la
    carrera N veces (400 por defecto) con la parrilla oficial. Parametros:
      - Condicion: SECO, MOJADO o FLAG-TO-FLAG (seco->mojado o
        mojado->seco, con vuelta del cambio y perdida por cambio de moto).
      - Estado de pista esperado: temperatura de pista, aire y humedad.
        Botones para copiar las condiciones de FP2/Q2/Sprint y la prevision
        del Met Office (Sepang, domingo 15:00: 33 C, 20% de lluvia), y
        "Cargar prevision (Open-Meteo)" que consulta api.open-meteo.com
        desde el navegador con las coordenadas del circuito y la fecha.
        (Dos modelos pueden discrepar: en la prueba, Met Office daba 20% de
        lluvia y Open-Meteo 75% para la misma hora.) La temperatura de pista
        se estima como aire + 0,019 x radiacion solar.
      - Supuestos editables: sensibilidad a la temperatura, penalizacion y
        dispersion del mojado, tasa de caidas, incertidumbre del ritmo,
        vueltas, numero de simulaciones y semilla.
    Salida: % de victoria y podio, posicion media y P10-P90, % de abandono,
    una carrera representativa (orden final, gap al lider y posicion por
    vuelta). Los supuestos de temperatura y mojado NO estan calibrados con
    carreras reales: sirven para comparar escenarios.
    Los datos de previsión del circuito (coordenadas, fecha, enlace y
    prevision manual) se editan en la lista CIRCUITS de tools/pipeline.py.

Notas de lectura:
   - Ideal = suma de los mejores sectores aunque vengan de vueltas
     distintas. Pilotos con 4 vueltas o menos en una sesion se ignoran.
   - MAE = error medio del ritmo por vuelta. "Atipico" = piloto cuya
     desviacion destaca una vez quitado el desfase comun del campo.
   - Sprint y Carrera llevan un prior leve por el puesto de cada piloto
     en el Mundial 2025 (Rider Statistics): 0,02 s/vuelta por puesto
     respecto a la mediana, con tope de 0,25 s. Mejora el orden previsto
     pero esta ajustado con una sola Sprint real; se puede anular poniendo
     PRIOR_WC = 0 al inicio de tools/engine.js.
   - Las predicciones son simulaciones limpias: no contemplan meteo,
     caidas ni sanciones. El diagnostico solo SUGIERE causas; usa los
     datos oficiales (meteo e incidentes de la Classification) cuando
     existen.


7. DESPLIEGUE
---------------------------------------------------------------------
7.1 En tu PC (uso normal)
    iniciar.bat / iniciar.sh  -> servidor local en 127.0.0.1:PORT.
    Solo es accesible desde el propio equipo.

7.2 Como fichero estatico
    python tools/actualizar.py genera index.html autocontenido (datos
    incluidos). Puedes abrirlo con doble clic, copiarlo o publicarlo en
    cualquier hosting estatico; necesita Internet en el navegador para
    las CDN. Ojo: contiene los datos de los PDF (ver apartado 10).

7.3 En un servidor Linux
    - Instala Python 3.9+ y ejecuta  bash instalar.sh .
    - servidor.py escucha solo en 127.0.0.1. Para verlo desde otras
      maquinas usa un proxy inverso (nginx, caddy) hacia el puerto, o
      un tunel SSH:   ssh -L 8000:localhost:8000 usuario@servidor
    - Como servicio (systemd), ejemplo:
          [Service]
          WorkingDirectory=/opt/motogp-ana
          ExecStart=/opt/motogp-ana/.venv/bin/python tools/servidor.py
          Environment=PORT=8000
          Restart=on-failure
    - Alternativa sin servicio permanente: una tarea programada que
      ejecute  python tools/actualizar.py  y sirva index.html con
      nginx.

7.4 Anadir un circuito o cambiar datos del calendario
    Edita la lista CIRCUITS de tools/pipeline.py (id, carpeta, nombre,
    longitud, vueltas por defecto de Sprint y Carrera). Las vueltas se
    sustituyen por las reales en cuanto hay Grid o Classification.


8. SOLUCION DE PROBLEMAS
---------------------------------------------------------------------
   "Python no encontrado" (Windows)   Instala Python marcando "Add to
        PATH", o usa instalar.bat. Si acabas de instalarlo, abre una
        ventana nueva.
   "No module named pdfplumber"       Ejecuta instalar.bat / instalar.sh,
        o  pip install -r requirements.txt  dentro del entorno .venv.
   pip bloqueado en Linux (PEP 668)   Usa el entorno virtual .venv que
        crea instalar.sh.
   La pagina se queda en "Cargando telemetria..."   Sin Internet no
        cargan las librerias del navegador (apartado 2). Tambien puede
        ser la primera construccion (30-60 s): espera.
   Pantalla roja "Error al construir el dashboard"   Lee el mensaje; si
        es un PDF, reemplazalo por el original sin modificar.
   Una sesion sigue como SIMULADO   Falta su Analysis en esa carpeta, o
        el PDF no es el informe oficial. En la ventana del servidor
        aparecen lineas "ignorado" / "sesion no reconocida".
   Cambios en tools/*.py no se ven   Pulsa F5 (el servidor recarga el
        codigo al detectar cambios); si no, reinicialo.
   Puerto ocupado   Cambia PORT (apartado 3.4).
   Caracteres raros en la consola de Windows   No afecta al panel.


9. COMPROBACIONES QUE HACE EL PROGRAMA AL LEER
---------------------------------------------------------------------
Cruza informes entre si y lo muestra en "Trazabilidad de datos":
Classification vs Analysis, vuelta ideal oficial vs recalculada,
velocidad maxima, Fastest Lap of each Rider, Qualifying Results, tiempo
del ganador de Sprint/Carrera = suma de sus vueltas, y orden del Grid
contra el Lap Chart y los tiempos de clasificacion.


10. AVISO SOBRE LOS DATOS
---------------------------------------------------------------------
Los PDF son informes oficiales (c) MotoGP Sports Entertainment Group,
cuya reproduccion o distribucion esta restringida segun su propio pie de
pagina. Este repositorio los incluye (solo Malasya) como ejemplo para uso
privado. No publiques el repositorio ni index.html sin permiso del
titular. Las sesiones SIMULADAS son sinteticas y no representan
resultados reales.

Las predicciones del modelo usan pesos fijados a mano y todavia sin
calibrar con suficientes fines de semana reales: tomalas como orientativas.
