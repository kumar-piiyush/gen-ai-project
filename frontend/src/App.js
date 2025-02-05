import React, { useState } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import ReactMarkdown from 'react-markdown';
import './App.css';

function App() {
  const [file, setFile] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [previewData, setPreviewData] = useState([]);
  const [backendPreviewData, setBackendPreviewData] = useState([]);
  const [backendTextOutput, setBackendTextOutput] = useState('');
  const [downloadLink, setDownloadLink] = useState(null);
  const [loading, setLoading] = useState(false); // New loading state

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
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: true }); // Preserve blank rows
      setPreviewData(jsonData);
    };
    reader.readAsArrayBuffer(selectedFile);
  };

  const handlePromptChange = (e) => {
    setPrompt(e.target.value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); // Start loading
    const formData = new FormData();
    formData.append('file', file);
    formData.append('prompt', prompt);

    try {
      const response = await axios.post('http://localhost:5000/upload', formData, {
        responseType: 'json',
      });

      const { filePath, backendData, gptOutputText } = response.data || {};

      if (filePath) {
        const downloadedFile = await axios.get(filePath, { responseType: 'blob' });
        const updatedFile = new File([downloadedFile.data], 'updated_file.xlsx', {
          type: downloadedFile.data.type,
        });

        setDownloadLink(URL.createObjectURL(updatedFile));
        previewUpdatedFile(updatedFile);
      }

      setBackendPreviewData(backendData);
      setBackendTextOutput(gptOutputText || '');
    } catch (error) {
      console.error('Error uploading file:', error);
    } finally {
      setLoading(false); // Stop loading
    }
  };

  const previewUpdatedFile = (file) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: true });
      setBackendPreviewData(jsonData);
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="container">
      {loading && (
        <div className="loading-overlay">
          <div className="loading-message">
            <span>Loading updated file and response from the backend model...</span>
            <div className="spinner"></div>
          </div>
        </div>
      )}

      <div className="left-pane">
        <h1>Data Completion Tool</h1>
        <form onSubmit={handleSubmit}>
          <label className="label">Upload Excel/CSV File:</label>
          <input type="file" onChange={handleFileChange} accept=".csv, .xlsx" />

          <label className="label">Custom Prompt for Missing Data:</label>
          <textarea
            value={prompt}
            onChange={handlePromptChange}
            placeholder="Provide a prompt"
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
                        <td key={cellIndex}>{cell !== undefined ? cell : ''}</td>
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
          {Array.isArray(backendPreviewData) && backendPreviewData.length > 0 && Array.isArray(backendPreviewData[0]) ? (
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
                        <td key={cellIndex}>{cell !== undefined ? cell : ''}</td>
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
          <ReactMarkdown>{backendTextOutput}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

export default App;
