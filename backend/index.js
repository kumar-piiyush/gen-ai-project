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

function extractRelevantTextFromResponse(text, columnName, columnType) {
  // Check for "approximately" and extract the value after it, rounding properly
  const approxMatch = text.match(/\bapproximately\b[:\s]*([\d\.]+)/i);
  if (approxMatch) {
    return Math.round(parseFloat(approxMatch[1])); // Round the value
  }

  // Check for "is around" and extract the value after it, rounding properly
  const aroundMatch = text.match(/\bis around\b[:\s]*([\d\.]+)/i);
  if (aroundMatch) {
    return Math.round(parseFloat(aroundMatch[1])); // Round the value
  }

  // Check for the "≈" symbol and extract the value after it, rounding properly
  const approxSymbolMatch = text.match(/\b≈\s*([\d\.]+)/i);
  if (approxSymbolMatch) {
    return Math.round(parseFloat(approxSymbolMatch[1])); // Round the value
  }

  // Split the text into sentences to handle each sentence individually
  const sentences = text.split(/[.!?]/); // Split based on sentence-ending punctuation marks

  // Iterate through each sentence to check for the columnName and its value
  for (let sentence of sentences) {
    // Define patterns for "column = value", "column: value", "column is value", and "column ≈ value"
    const regex = new RegExp(`\\b${columnName}\\b.*?\\s*(=|:|is|≈)\\s*([\\d\\.]+)`, 'i');
    const match = sentence.match(regex);

    if (match) {
      const value = match[2]; // Extract the value following "=", ":", "is", or "≈"

      // If column type is 'number', parse the value and round it to the nearest integer
      if (columnType === 'number') {
        const parsedValue = parseFloat(value);
        return !isNaN(parsedValue) ? Math.round(parsedValue) : null; // Round to nearest integer
      }

      return value; // Return the text value directly for text-type columns
    }
  }

  // If no matching value is found in any sentence, return the original text
  return text;
}






// Determine the column type based on the data content in each column
function getColumnType(data, columnName) {
  for (const row of data) {
    if (row[columnName] && !isNaN(row[columnName])) {
      return 'number';
    } else if (row[columnName] && typeof row[columnName] === 'string') {
      return 'text';
    }
  }
  return 'text'; // Default to text if no other match
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

          // Determine the column type (number, integer, text) for correct extraction
          const columnType = getColumnType(dataContent, key);
          const relevantValue = extractRelevantTextFromResponse(missingDetails, columnType);
          row[key] = relevantValue !== null ? relevantValue : "";

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
