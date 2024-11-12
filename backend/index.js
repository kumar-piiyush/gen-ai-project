require('dotenv').config();

const Fastify = require('fastify');
const fastifyMultipart = require('@fastify/multipart');
const fetch = require('node-fetch');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const fastifyCors = require('@fastify/cors');
const fastifyStatic = require('@fastify/static');

const fastify = Fastify({ logger: true });
fastify.register(fastifyMultipart);
fastify.register(fastifyCors, {
  origin: 'http://localhost:3000',
});

// Register fastify-static to serve files from a directory
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fastify.register(fastifyStatic, {
  root: UPLOAD_DIR,
  prefix: '/uploads/',
});

// Function to generate prompt for missing data based on specific column values
function generatePromptForMissingData(row, missingColumn) {
  const conditions = Object.entries(row)
    .filter(([_, value]) => value !== null && value !== "")
    .map(([key, value]) => `${key} = ${value}`)
    .join(', ');

  return `If ${conditions}, then tell me what will be the value for ${missingColumn}?. Tell me the real-world value.`;
}

// Function to fetch missing data using Ollama (via HTTP API)
async function fetchMissingDataFromOllama(prompt) {
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama3.2',
      prompt: prompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch data from Ollama API');
  }

  const data = await response.json();
  
  console.log(data);

  if (data && data.response) {
    return data.response.trim();
  } else {
    throw new Error('Invalid response format from Ollama API');
  }
}


function extractIntegerFromText(text) {
  // Find all integer and decimal numbers
  const matches = text.match(/\d+(\.\d+)?/g);

  if (matches) {
    // Convert matches to numbers and round to the nearest integer
    const numbers = matches.map(match => Math.round(parseFloat(match)));

    // Return the last rounded integer
    return numbers[numbers.length - 1];
  }

  return null; // No integer found
}


// Endpoint for file upload and processing
fastify.post('/upload', async (req, reply) => {
  try {
    const parts = req.parts();
    let file;
    let prompt;

    for await (const part of parts) {
      if (part.file) {
        file = part;
      } else if (part.fieldname === 'prompt') {
        prompt = part.value;
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
    buffer = Buffer.concat(buffer);

    let dataContent;
    if (fileExtension === '.xlsx' || fileExtension === '.csv') {
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      dataContent = xlsx.utils.sheet_to_json(worksheet, { defval: "" });
    }

    let gptOutputText = '';
    for (let row of dataContent) {
      for (let key in row) {
        if (!row[key]) {
          // Generate prompt for each missing field based on other columns' data
          const promptForMissingData = generatePromptForMissingData(row, key);
          const missingDetails = await fetchMissingDataFromOllama(promptForMissingData);
          
          // Update only with integer extracted from GPT response
          const integerResult = extractIntegerFromText(missingDetails);
          row[key] = integerResult !== null ? integerResult : "";

          gptOutputText += `\nRow ${dataContent.indexOf(row) + 1} - ${key}: ${missingDetails}`;
        }
      }
    }

    // Save the updated file
    const outputFilePath = path.join(UPLOAD_DIR, 'updated_file.xlsx');
    const newWorksheet = xlsx.utils.json_to_sheet(dataContent);
    const newWorkbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(newWorkbook, newWorksheet, 'Updated Data');
    xlsx.writeFile(newWorkbook, outputFilePath);
    const backendData = dataContent.length > 0 ? dataContent.map(row => Object.values(row)) : [[]];

    reply.send({
      filePath: `http://localhost:5000/uploads/updated_file.xlsx`,
      backendData: backendData,
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
