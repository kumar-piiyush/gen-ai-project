import React, { useState } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import './App.css';

function App() {
  const [file, setFile] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [previewData, setPreviewData] = useState([]);
  const [backendPreviewData, setBackendPreviewData] = useState([]);
  const [backendTextOutput, setBackendTextOutput] = useState('');
  const [downloadLink, setDownloadLink] = useState(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);

    // Preview the uploaded Excel file
    const reader = new FileReader();
    reader.onload = (event) => {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      setPreviewData(jsonData);
    };
    reader.readAsArrayBuffer(selectedFile);
  };

  const handlePromptChange = (e) => {
    setPrompt(e.target.value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('prompt', prompt);

    try {
      const response = await axios.post('http://localhost:5000/upload', formData, {
        responseType: 'json',
      });

      const { filePath, backendData, gptOutputText } = response.data || {};

      if (filePath) {
        // Download the file programmatically and store it in updated_files folder
        const downloadedFile = await axios.get(filePath, { responseType: 'blob' });
        const updatedFile = new File([downloadedFile.data], 'updated_file.xlsx', {
          type: downloadedFile.data.type,
        });

        // Set download link to trigger download (optional)
        setDownloadLink(URL.createObjectURL(updatedFile));

        // Preview the updated file in Backend Data Preview
        previewUpdatedFile(updatedFile);
      }

      if (Array.isArray(backendData) && backendData.length > 0 && Array.isArray(backendData[0])) {
        setBackendPreviewData(backendData);
      } else {
        console.error('Expected backendData to be a non-empty array of arrays', backendData);
        setBackendPreviewData([]);
      }

      setBackendTextOutput(gptOutputText || '');
    } catch (error) {
      console.error('Error uploading file:', error);
    }
  };

  // Function to preview the updated file in the backend preview section
  const previewUpdatedFile = (file) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      setBackendPreviewData(jsonData);
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="container">
      <div className="left-pane">
        <h1>Data Completion Tool</h1>
        <form onSubmit={handleSubmit}>
          <label className="label">Upload Excel/CSV File:</label>
          <input type="file" onChange={handleFileChange} accept=".csv, .xlsx" />

          <label className="label">Custom Prompt for Missing Data:</label>
          <textarea
            value={prompt}
            onChange={handlePromptChange}
            placeholder="Provide a prompt to guide Llama in filling the missing data"
          />

          <button type="submit">Upload and Process</button>
        </form>

        {downloadLink && (
          <a href={downloadLink} download="updated_file.xlsx" className="download-link">
            Download Updated File
          </a>
        )}
      </div>

      <div className="right-pane">
        <div className="preview-container">
          <h2 className="preview-header">File Preview</h2>
          {previewData.length > 0 ? (
            <div className="preview-table-container">
              <table className="preview-table">
                <thead>
                  <tr>
                    {previewData[0].map((col, index) => (
                      <th key={index}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.slice(1).map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No file preview available.</p>
          )}
        </div>

        <div className="preview-container">
          <h2 className="preview-header">Backend Data Preview</h2>
          {backendPreviewData.length > 0 ? (
            <div className="backend-table-container">
              <table className="backend-table">
                <thead>
                  <tr>
                    {backendPreviewData[0].map((col, index) => (
                      <th key={index}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {backendPreviewData.slice(1).map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No backend data available or data format is incorrect.</p>
          )}
        </div>

        <div className="preview-container">
          <h2 className="preview-header">GPT Text Output</h2>
          <p>{backendTextOutput}</p>
        </div>
      </div>
    </div>
  );
}

export default App;
