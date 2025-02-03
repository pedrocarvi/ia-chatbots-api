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
        "Sos un asistente experto en los servicios que ofrecemos en Avalian. Avalian es una prepaga argentina con 45 años de experiencia, dedicada a prestar servicios de cobertura médica. Vas a tener toda la información necesaria en el documento que te enviamos.",
      tools: [{ type: "file_search" }],
      model: "gpt-4o-mini",
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

// Endpoint para el chatbot
app.post("/chatbot-web", async (req, res) => {
  try {
    // console.log("Entra al chatbot");
    const { question } = req.body;

    const assistantDetails = await getOrCreateAssistant();

    // Leer el documento de referencia
    const documentPath = "./rag-documento-01.txt";
    let documentContent;

    try {
      documentContent = await fsPromises.readFile(documentPath, "utf8");
    } catch (error) {
      return res.status(500).send("Error leyendo el documento.");
    }

    // Crear prompt con contexto
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
    while (runStatus.status !== "completed" && runStatus.status !== "failed" && runStatus.status !== "cancelled") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    }

    if (runStatus.status !== "completed") {
      return res.status(500).send("Error: El asistente no pudo completar la respuesta.");
    }

    // Obtener la respuesta del asistente
    const messages = await openai.beta.threads.messages.list(thread.id);
    const lastMessageForRun = messages.data
      .filter((message) => message.run_id === run.id && message.role === "assistant")
      .pop();

    if (lastMessageForRun) {
      res.json({ response: lastMessageForRun.content?.[0]?.text?.value || "No response available" });
    } else {
      res.status(500).send("No se recibió respuesta del asistente.");
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Ocurrió un error en el servidor.");
  }
});

// Inicia el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});