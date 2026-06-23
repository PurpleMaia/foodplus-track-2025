import React, { useState, useRef } from 'react';
import { Upload } from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';

interface CsvRow {
  [key: string]: string;
}

interface CsvUploadProps {
  // Optional logged-in user id. When provided the backend runs in "tracker"
  // mode (inserts missing bills + creates org tracking connections). When
  // omitted it runs in "scraper" mode (dedup + insert only).
  userId?: string;
}

const CsvUpload: React.FC<CsvUploadProps> = ({ userId }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [previewData, setPreviewData] = useState<CsvRow[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [rawData, setRawData] = useState<string[][]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset state
    setPreviewData([]);
    setCsvHeaders([]);
    setRawData([]);

    Papa.parse(file, {
      delimiter: ',',
      skipEmptyLines: 'greedy',
      complete: (results) => {
        const rawRows = results.data as string[][];
        if (rawRows.length === 0) {
          toast.error('CSV file is empty');
          return;
        }

        const maxColumns = Math.max(...rawRows.map(row => row.length));

        const defaultHeaders = Array.from(
          { length: maxColumns },
          (_, i) => `Column ${i + 1}`
        );

        setCsvHeaders(defaultHeaders);
        // Send the raw rows to the backend — it strips HTML, extracts the real
        // bill URL + fields, validates, dedups and (optionally) connects.
        setRawData(rawRows);

        const previewRows = rawRows.slice(0, 5).map(row =>
          Object.fromEntries(defaultHeaders.map((header, i) => [header, row[i] || '']))
        );

        setPreviewData(previewRows);
      },
      error: (error) => {
        toast.error(`Error parsing CSV: ${error.message}`);
      }
    });
  };

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast.error('Please select a file first');
      return;
    }
    if (!rawData.length) {
      toast.error('No rows to upload');
      return;
    }

    setIsUploading(true);
    const uploadToast = toast.loading('Uploading and processing CSV...');

    try {
      const response = await fetch('/api/upload-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send raw rows; the backend cleans, validates, dedups and connects.
        // userId is optional — when present the backend also creates org
        // tracking connections (tracker mode).
        body: JSON.stringify({ rows: rawData, user_id: userId }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || err.details || 'Failed to upload CSV');
      }

      const result = await response.json();
      const invalidCount = result.invalidRows?.length ?? 0;

      const summary =
        result.mode === 'track'
          ? `${result.insertedBills} new, ${result.existingBills} existing, ${result.connectionsCreated} tracked`
          : `${result.insertedBills} inserted, ${result.duplicateBills} duplicates`;

      toast.success(
        `${summary}${invalidCount > 0 ? ` (${invalidCount} invalid rows skipped)` : ''}`,
        { id: uploadToast }
      );

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setPreviewData([]);
      setCsvHeaders([]);
      setRawData([]);
    } catch (error) {
      console.error('Upload error:', error);
      toast.error(
        error instanceof Error ? error.message : 'Error uploading CSV',
        { id: uploadToast }
      );
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-gray-800">CSV Upload</h3>
        <div className="flex items-center space-x-4">
          <button
            onClick={handleUpload}
            disabled={isUploading || !fileInputRef.current?.files?.length}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-blue-300"
          >
            <Upload className="w-5 h-5 mr-2" />
            {isUploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>

      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
        <input
          type="file"
          ref={fileInputRef}
          accept=".csv"
          onChange={handleFileSelect}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
      </div>

      {previewData.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <h4 className="text-lg font-medium text-gray-800 p-6 pb-4">Preview</h4>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {csvHeaders.map(header => (
                    <th
                      key={header}
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {previewData.map((row, i) => (
                  <tr key={i}>
                    {csvHeaders.map(header => (
                      <td key={header} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {row[header]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default CsvUpload;