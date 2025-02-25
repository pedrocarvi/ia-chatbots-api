const bodyParser = require("body-parser");
const OpenAI = require("openai");
const fs = require("fs");
const fsPromises = require("fs").promises;
require("dotenv").config();
const express = require("express");
const app = express();
// Cors
const cors = require("cors");
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'PUT'], 
  credentials: true, 
  exposedHeaders: ["X-Text-Response"] 
};
app.use(cors(corsOptions));
const PORT = process.env.PORT || 5000;
const pdfParse = require("pdf-parse");

// Middleware para procesar JSON
app.use(express.json());

// Ruta de prueba
app.get("/", (req, res) => {
  res.send("ey yiou chatbot api running bruv fr bruv mad mad");
});

// Inicializo OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Función para obtener o crear el asistente
async function getOrCreateAssistant() {
  const assistantFilePath = "./web-assistant.json";
  let assistantDetails;

  try {
    const assistantData = await fsPromises.readFile(assistantFilePath, "utf8");
    assistantDetails = JSON.parse(assistantData);
  } catch (error) {
    // Si no existe, crea el asistente
    const assistantConfig = {
      name: "Asistente web Avalian",
      instructions:
        "Sos un asistente experto en los servicios que ofrecemos en Avalian. Avalian es una prepaga argentina con 45 años de experiencia, dedicada a prestar servicios de cobertura médica. Vas a tener toda la información necesaria en el documento que te enviamos. Según el documento, tenes que saber que plan tiene el asociado (puede ser Cerca, Integral, Superior, Selecta).",
      tools: [{ type: "file_search" }],
      model: "gpt-4o",
    };
    const assistant = await openai.beta.assistants.create(assistantConfig);
    assistantDetails = { assistantId: assistant.id, ...assistantConfig };

    // Guarda el asistente en un archivo
    await fsPromises.writeFile(
      assistantFilePath,
      JSON.stringify(assistantDetails, null, 2)
    );
  }

  return assistantDetails;
}

async function extractTextFromPDF(filePath) {
  try {
    const dataBuffer = await fsPromises.readFile(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (error) {
    console.error(`Error al extraer texto de ${filePath}:`, error);
    return "";
  }
}

// Endpoint para el chatbot
app.post("/chatbot-web", async (req, res) => {
  try {
    const { question, asociadoNumber } = req.body;
    const assistantDetails = await getOrCreateAssistant();

    console.log("Asociado number que llega:", asociadoNumber);

    // Mapeo de códigos a PDFs
    const pdfMap = {
      "Cerca": "./0001_0001_Diagrama-Cob_Cerca__1_.pdf",
      "Integral": "./0001_Integral.pdf",
      "Superior": "./0001_Superior.pdf",
      "Selecta": "./0001_Selecta.pdf",
      "Lead": "./0001_Lead.pdf",
    };

    // Verificar si el código es válido
    if (!pdfMap[asociadoNumber]) {
      return res.status(400).json({ error: "Código de asociado inválido." });
    }

    // Extraer el contenido del PDF correspondiente
    const documentContent = await extractTextFromPDF(pdfMap[asociadoNumber]);

    // Crear prompt con el contenido específico
    const fullPrompt = `${assistantDetails.instructions}\n\nDocumento de referencia:\n${documentContent}\n\nPregunta del usuario: ${question}`;

    // Crear un nuevo thread
    const thread = await openai.beta.threads.create();

    // Enviar el mensaje al thread
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: fullPrompt,
    });

    // Crear una ejecución para el asistente
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantDetails.assistantId,
    });

    // Revisar el estado del run
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);

    // Esperar hasta que la ejecución se complete
    while (
      runStatus.status !== "completed" &&
      runStatus.status !== "failed" &&
      runStatus.status !== "cancelled"
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    }

    if (runStatus.status !== "completed") {
      return res.status(500).json({ error: "El asistente no pudo completar la respuesta." });
    }

    // Obtener la respuesta del asistente
    const messages = await openai.beta.threads.messages.list(thread.id);
    const lastMessageForRun = messages.data
      .filter((message) => message.run_id === run.id && message.role === "assistant")
      .pop();

    if (lastMessageForRun) {
      res.json({ response: lastMessageForRun.content?.[0]?.text?.value || "No response available" });
    } else {
      res.status(500).json({ error: "No se recibió respuesta del asistente." });
    }
  } catch (error) {
    console.error("Error en chatbot-web:", error);
    res.status(500).json({ error: "Ocurrió un error en el servidor." });
  }
});


// Inicia el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});