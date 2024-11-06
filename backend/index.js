require('dotenv').config();

const Fastify = require('fastify');
const fastifyMultipart = require('@fastify/multipart');
const fetch = require('node-fetch'); // Use fetch to call Hugging Face API
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const fastifyCors = require('@fastify/cors');
const fastifyStatic = require('@fastify/static'); // Import fastify-static

const fastify = Fastify({ logger: true });
fastify.register(fastifyMultipart);
fastify.register(fastifyCors, {
  origin: 'http://localhost:3000', // Replace with your frontend origin
});

// Register fastify-static to serve files from a directory
const UPLOAD_DIR = path.join(__dirname, 'uploads'); // Directory for uploaded files
fs.mkdirSync(UPLOAD_DIR, { recursive: true }); // Ensure the directory exists
fastify.register(fastifyStatic, {
  root: UPLOAD_DIR,
  prefix: '/uploads/', // Serve files from this prefix
});

// Function to generate prompt for missing data
function generatePromptForMissingData(prompt, availableData) {
  const details = Object.entries(availableData)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');
  return `${prompt}\nBased on the following details, fill in the missing fields:\n${details}.`;
}

// Function to call Hugging Face API for missing data completion
async function fetchMissingDataFromHuggingFace(prompt, availableData) {
  const fullPrompt = generatePromptForMissingData(prompt, availableData);

  // Make a POST request to Hugging Face Inference API
  const response = await fetch("https://api-inference.huggingface.co/models/gpt2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HUGGING_FACE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ inputs: fullPrompt })
  });

  const result = await response.json();
  
  // Handle potential errors from Hugging Face API response
  if (result.error) {
    throw new Error(`Hugging Face API error: ${result.error}`);
  }

  return result[0]?.generated_text.trim() || "No response generated.";
}

// Endpoint for file upload and processing
fastify.post('/upload', async (req, reply) => {
  try {
    const parts = req.parts();
    let file;
    let prompt;

    for await (const part of parts) {
      if (part.file) {
        file = part; // This is the uploaded file stream
      } else if (part.fieldname === 'prompt') {
        prompt = part.value; // Get the prompt value
      }
    }

    if (!file) {
      reply.status(400).send({ error: "File upload failed or file not found." });
      return;
    }
    if (!prompt) {
      reply.status(400).send({ error: "Missing 'prompt' in the request." });
      return;
    }

    const fileExtension = path.extname(file.filename).toLowerCase();
    if (!fileExtension || (fileExtension !== '.xlsx' && fileExtension !== '.csv')) {
      reply.status(415).send({ error: "Unsupported file type. Only .xlsx and .csv files are allowed." });
      return;
    }

    let buffer = [];
    for await (const chunk of file.file) {
      buffer.push(chunk);
    }
    buffer = Buffer.concat(buffer); // Convert chunks to a single buffer

    let dataContent;
    if (fileExtension === '.xlsx' || fileExtension === '.csv') {
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      dataContent = xlsx.utils.sheet_to_json(worksheet, { defval: "" });
    }

    let gptOutputText = '';
    for (let row of dataContent) {
      const availableData = Object.fromEntries(
        Object.entries(row).filter(([_, value]) => value !== null && value !== "")
      );

      if (Object.values(row).includes(null) || Object.values(row).includes("")) {
        const missingDetails = await fetchMissingDataFromHuggingFace(prompt, availableData);
        gptOutputText += `\nRow ${dataContent.indexOf(row) + 1}: ${missingDetails}`;

        for (let key in row) {
          if (!row[key]) {
            row[key] = missingDetails;
          }
        }
      }
    }

    // Create and save the updated file in the uploads directory
    const outputFilePath = path.join(UPLOAD_DIR, 'updated_file.xlsx'); // Save to uploads directory
    const newWorksheet = xlsx.utils.json_to_sheet(dataContent);
    const newWorkbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(newWorkbook, newWorksheet, 'Updated Data');
    xlsx.writeFile(newWorkbook, outputFilePath);

    reply.send({
      filePath: `http://localhost:5000/uploads/updated_file.xlsx`, // Full URL path
      backendData: dataContent,
      gptOutputText: gptOutputText.trim()
    });
    
  } catch (error) {
    fastify.log.error(error);
    reply.status(500).send({ error: "Internal server error." });
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 5000, host: '0.0.0.0' });
    console.log(`Server is running on http://localhost:5000`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
