
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// CONFIGURACION OLED
#define ANCHO 128
#define ALTO 64

Adafruit_SSD1306 display(ANCHO, ALTO, &Wire, -1);

// PINES
int tempPin = 0;
int boton = 2;

bool activo = true;
int estadoBoton;
int estadoAnterior = HIGH;

void setup()
{
  Serial.begin(9600);

  pinMode(boton, INPUT_PULLUP);

  // Inicializar comunicacion I2C
  Wire.begin(); // SDA, SCL

  // Inicializar pantalla
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("Error al iniciar OLED");
    while (true);
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(2);
  display.setCursor(15, 20);
  display.println("TERMOMETRO");

  display.setTextSize(1);
  display.setCursor(30, 45);
  display.println("Iniciando...");

  display.display();

  delay(1500);
}

void loop()
{
  estadoBoton = digitalRead(boton);

  if (estadoBoton == LOW && estadoAnterior == HIGH) {

    delay(50);

    activo = !activo;

    if (activo == true) {
      Serial.println("Activado");
    }

    if (activo == false) {
      Serial.println("Desactivado");
    }
  }

  estadoAnterior = estadoBoton;

  if (activo == true) {

  int tempReading = analogRead(tempPin);
  // This is OK
  double tempK = log(10000.0 * ((1024.0 / tempReading - 1)));
  tempK = 1 / (0.001129148 + (0.000234125 + (0.0000000876741 * tempK * tempK )) * tempK );       //  Temp Kelvin
  float tempC = tempK - 273.15;            // Convert Kelvin to Celcius
  float tempF = (tempC * 9.0)/ 5.0 + 32.0;

    // MONITOR SERIAL
    Serial.println("Temperatura en Celsius:");
    Serial.println(tempC);

    // PANTALLA OLED
    display.clearDisplay();

    display.setTextSize(1);
    display.setCursor(15, 5);
    display.println("TEMPERATURA");

    display.drawLine(0, 17, 128, 17, SSD1306_WHITE);

    display.setTextSize(2);
    display.setCursor(15, 27);
    display.print(tempC, 2);

    display.print(" C");

    display.setTextSize(1);
    display.setCursor(25, 53);
    display.println("Sistema ACTIVO");

    display.display();

    delay(2000);
  }

  if (activo == false) {

    display.clearDisplay();

    display.setTextSize(2);
    display.setCursor(15, 15);
    display.println("SISTEMA");

    display.setCursor(15, 35);
    display.println("PAUSADO");

    display.display();

    delay(10);
    return;
  }
}
