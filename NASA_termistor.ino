
int tempPin = 0;
int boton = 2;
bool activo = true;
int estadoBoton;
int estadoAnterior = HIGH;

void setup()
{
  Serial.begin(9600);
  pinMode(boton, INPUT_PULLUP);
}

void loop()
{
  estadoBoton = digitalRead(boton);

  if (estadoBoton == LOW && estadoAnterior == HIGH) {

    delay(50);

    activo = !activo;

    if (activo == true) {
      Serial.println("------------------Activado-------------------");
       Serial.println("");
    }

    if (activo == false) {
      Serial.println("-----------------Desactivado-----------------");
      Serial.println("");
    }
  }

  estadoAnterior = estadoBoton;

  if (activo == true) {

    int tempReading = analogRead(tempPin);

    // This is OK
    double tempK = log(10000.0 * ((1024.0 / tempReading - 1)));

    tempK = 1 / (0.001129148 + (0.000234125 + (0.0000000876741 * tempK * tempK )) * tempK );

    float tempC = tempK - 273.15;

    Serial.print("Temperatura: ");
    Serial.print(tempC);
    Serial.println("°C");

    delay(2000);
  }

  if (activo == false) {
    delay(10);
    return;
  }
}
