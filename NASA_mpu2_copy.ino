
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <WiFi.h>
#include <WebServer.h>
#include <math.h>

Adafruit_MPU6050 mpu;

// configuracion WiFi
const char* ssid = "MPU6050";
const char* password = "123456789";

WebServer server(80);

// PINES
const int boton = 10;

// Estado del boton
bool activo = false;
bool estadoAnterior = HIGH;

// variables contadoras
int movimientoLeve = 0;
int movimientoMedio = 0;
int movimientoFuerte = 0;

// variables 
float intensidad = 0;
float aceleracionAnterior = 0;

bool movimientoDetectado = false;

unsigned long tiempoEstable = 0;
unsigned long inicioMedicion = 0;


// Pagina web con el css y HTML
const char pagina[] PROGMEM = R"rawliteral(

<!DOCTYPE html>
<html lang="es">

<head>

<meta charset="UTF-8">

<meta name="viewport" content="width=device-width, initial-scale=1">

<title>Registro de los movimientos</title>

<style>

body {
  font-family: Arial, sans-serif;
  background: #101827;
  color: white;
  text-align: center;
  padding: 20px;
}

h1 {
  color: #38bdf8;
}

table {
  width: 200%;
  max-width: 1000px;
  margin: 30px auto;
  border-collapse: collapse;
  background: #1e293b;
  border-radius: 10px;
  overflow: hidden;
}

th, td {
  padding: 18px;
  border-bottom: 1px solid #334155;
}

th {
  background: #2563eb;
}

td {
  font-size: 20px;
}

.estado {
  color: #38bdf8;
  font-size: 16px;
}

.leve {
  color: #facc15;
}

.medio {
  color: #facc15;
}

.fuerte {
  color: #facc15;
}

.intensidad {
  color: #facc15;
}
</style>

</head>

<body>

<h1>Registro de los movimientos</h1>

<p class="estado" id="estado">Conectando...</p>

<table>

<tr>
  <th>Movimiento</th>
  <th>Cantidad</th>
</tr>

<tr>
  <td class="leve">Leves</td>
  <td id="leve">0</td>
</tr>

<tr>
  <td class="medio">Medios</td>
  <td id="medio">0</td>
</tr>

<tr>
  <td class="fuerte">Fuertes</td>
  <td id="fuerte">0</td>
</tr>

<tr>
  <td class="intensidad">Intensidad</td>
  <td id="intensidad">0</td>
</tr>

</table>



<script>

async function actualizarDatos() {

  try {

    const respuesta = await fetch('/datos');
    const datos = await respuesta.json();

    document.getElementById("leve").textContent = datos.leve;
    document.getElementById("medio").textContent = datos.medio;
    document.getElementById("fuerte").textContent = datos.fuerte;
    document.getElementById("intensidad").textContent = datos.intensidad;

    document.getElementById("estado").textContent =
      datos.activo ? "MEDICION ACTIVA" : "MEDICION PAUSADA";

  }

  catch(error) {

    document.getElementById("estado").textContent =
      "Error de conexion";

  }

}

setInterval(actualizarDatos, 500);

actualizarDatos();

</script>

</body>
</html>

)rawliteral";


// SETUP
void setup() {

  Serial.begin(115200);

  pinMode(boton, INPUT_PULLUP);

  // Iniciar comunicacion I2C
  Wire.begin(17, 18);

  // Iniciar WiFi
  WiFi.softAP(ssid, password);

  Serial.println("Servidor WiFi iniciado");

  Serial.print("Direccion IP: ");
  Serial.println(WiFi.softAPIP());

  // Pagina principal
  server.on("/", []() {

    server.send(200, "text/html", pagina);

  });

  // Enviar datos por json que lo coje de Arduino IDE y se los da al html
  server.on("/datos", []() {

    String json = "{";

    json += "\"leve\":" + String(movimientoLeve) + ",";
    json += "\"medio\":" + String(movimientoMedio) + ",";
    json += "\"fuerte\":" + String(movimientoFuerte) + ",";
    json += "\"intensidad\":" + String(intensidad, 2) + ",";
    json += "\"activo\":" + String(activo ? "true" : "false");

    json += "}";

    server.send(200, "application/json", json);

  });

  // Iniciar servidor web
  server.begin();

  Serial.println("Servidor web iniciado");

  // Iniciar MPU6050
  if (!mpu.begin()) {

    Serial.println("ERROR: MPU6050 no encontrado");

    while (1) {
      server.handleClient();
      delay(10);
    }

  }

  Serial.println("MPU6050 iniciado correctamente");

}


// LOOP
void loop() {

  // Atender solicitudes web
  server.handleClient();


  // Leer el boton con una booleana que determina si activo o !activo
  bool estadoBoton = digitalRead(boton);

  if (estadoBoton == LOW && estadoAnterior == HIGH) {

    activo = !activo;

    if (activo) {

      aceleracionAnterior = 0;
      movimientoDetectado = false;
      tiempoEstable = 0;
      inicioMedicion = millis();

    }

    delay(200);

  }

  estadoAnterior = estadoBoton;


  // Si esta pausado no devuelve nada
  if (!activo) {

    delay(10);
    return;

  }


  //Leer el mpu o sensor de movimiento
  sensors_event_t a, g, temp;

  mpu.getEvent(&a, &g, &temp);


  // Calcular aceleracion buscando la raiz cuadrada de cada eje sumado con los otros
  float aceleracion = sqrt(

    a.acceleration.x * a.acceleration.x +
    a.acceleration.y * a.acceleration.y +
    a.acceleration.z * a.acceleration.z

  );


  // Estabilizacion inicial a partir del inicioMedicion
  if (millis() - inicioMedicion < 1000) {

    aceleracionAnterior = aceleracion;

    delay(10);
    return;

  }


  //calcula la intensidad sacando el valor absoluto de la aceleracion - la anterior
  intensidad = fabs(aceleracion - aceleracionAnterior);


  // Booleana que determina si se mide o no segun la intensidad
  if (intensidad > 2.00 && !movimientoDetectado) {

    movimientoDetectado = true;

  }


  //Clasifica el movimiento segun la intensidad. yo lo puse en rango para que no coja medidas dobles
  if (intensidad > 2.00 && movimientoDetectado) {

    if (intensidad < 5.00) {

      movimientoLeve++;

    }

    else if (intensidad <= 13.00 && intensidad >= 5.01) {

      movimientoMedio++;

    }

    else {

      movimientoFuerte++;

    }

  }


  // Solo se estabiliza cuando la intensidad es menor a 0.15. Si esto no se da entonces no vuelve a tomar otra medida
  if (intensidad < 0.15) {

    if (tiempoEstable == 0) {

      tiempoEstable = millis();

    }

    if (millis() - tiempoEstable >= 500) {

      movimientoDetectado = false;

    }

  }

  else {

    tiempoEstable = 0;

  }
  //restablece el valor de la aceleracion

  aceleracionAnterior = aceleracion;


  //Esta  ultima parte es para mostrar el resultado en el serial y que el plotter lo grafique solo

  Serial.println(intensidad);



  delay(500);

}
