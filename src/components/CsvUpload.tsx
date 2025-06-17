import React, { useState, useRef } from 'react';
import { Upload, AlertCircle, CheckCircle2 } from 'lucide-react';
import Papa from 'papaparse';
import { supabase } from '../lib/supabaseClient';
import toast from 'react-hot-toast';

interface CsvRow {
  [key: string]: string;
}

const CsvUpload: React.FC = () => {
  const [isUploading, setIsUploading] = useState(false);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [previewData, setPreviewData] = useState<CsvRow[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [rawData, setRawData] = useState<string[][]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Updated order of required fields
  const requiredFields = [
    'bill_url',
    'bill_title',
    'description',
    'current_status',
    'introducer',
    'committee_assignment'
  ];

  // Default column mappings
  const defaultColumnMappings: Record<string, number> = {
    'bill_url': 6,
    'bill_title': 9,
    'description': 10,
    'current_status': 11,
    'introducer': 12,
    'committee_assignment': 13
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset state
    setMappings({});
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
        console.log('Maximum columns detected:', maxColumns);
        
        const defaultHeaders = Array.from(
          { length: maxColumns }, 
          (_, i) => `Column ${i + 1}`
        );
        
        setCsvHeaders(defaultHeaders);
        setRawData(rawRows);

        const normalizedRows = rawRows.map(row => {
          return [...row, ...Array(maxColumns - row.length).fill('')];
        });

        const previewRows = normalizedRows.slice(0, 5).map(row => 
          Object.fromEntries(defaultHeaders.map((header, i) => [header, row[i] || '']))
        );

        setPreviewData(previewRows);

        // Set default mappings based on column availability
        const autoMappings: Record<string, string> = {};
        
        // First set the default column mappings if columns exist
        Object.entries(defaultColumnMappings).forEach(([field, columnIndex]) => {
          if (columnIndex <= maxColumns) {
            autoMappings[field] = `Column ${columnIndex}`;
          }
        });

        // Then try to detect columns based on content
        for (let i = 0; i < maxColumns; i++) {
          const columnValues = normalizedRows.map(row => String(row[i] || '').toLowerCase());
          const columnHeader = defaultHeaders[i];

          if (columnValues.some(value => value.includes('http') || value.includes('.gov'))) {
            autoMappings.bill_url = columnHeader;
          } else if (columnValues.some(value => 
            value.includes('title') || 
            value.includes('regarding')
          )) {
            autoMappings.bill_title = columnHeader;
          } else if (columnValues.some(value => 
            value.includes('status') || 
            value.includes('pending') || 
            value.includes('passed')
          )) {
            if (!autoMappings.description) {
              autoMappings.description = columnHeader;
            } else if (!autoMappings.current_status) {
              autoMappings.current_status = columnHeader;
            }
          } else if (columnValues.some(value =>
            value.includes('committee') ||
            value.includes('assigned to')
          )) {
            autoMappings.committee_assignment = columnHeader;
          } else if (columnValues.some(value =>
            value.includes('introducer') ||
            value.includes('sponsor')
          )) {
            autoMappings.introducer = columnHeader;
          }
        }

        setMappings(autoMappings);
      },
      error: (error) => {
        toast.error(`Error parsing CSV: ${error.message}`);
      }
    });
  };

  const handleMappingChange = (field: string, csvColumn: string) => {
    setMappings(prev => ({
      ...prev,
      [field]: csvColumn
    }));
  };

  const extractBillNumber = (billUrl: string): string => {
    try {
      // Create a temporary DOM element to parse the HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(billUrl, 'text/html');
      const linkText = doc.querySelector('a')?.textContent?.trim();
      return linkText || '';
    } catch (error) {
      console.error('Error extracting bill number:', error);
      return '';
    }
  };

  const processAndUploadCsv = async () => {
    if (!rawData.length) return 0;

    try {
      const maxColumns = Math.max(...rawData.map(row => row.length));
      const normalizedData = rawData.map(row => [...row, ...Array(maxColumns - row.length).fill('')]);
      
      const transformedData = normalizedData.map(row => {
        const mappedRow: Record<string, string> = {};
        Object.entries(mappings).forEach(([field, csvColumn]) => {
          const columnIndex = parseInt(csvColumn.split(' ')[1]) - 1;
          if (columnIndex >= 0 && columnIndex < row.length) {
            mappedRow[field] = row[columnIndex]?.trim() || '';
          }
        });

        // Extract bill number from bill URL if it contains HTML
        if (mappedRow.bill_url) {
          mappedRow.bill_number = extractBillNumber(mappedRow.bill_url);
        }

        return mappedRow;
      }).filter(bill => 
        bill.bill_url?.length > 0 && 
        bill.description?.length > 0 && 
        bill.current_status?.length > 0
      );

      let successCount = 0;
      const batchSize = 50;
      
      for (let i = 0; i < transformedData.length; i += batchSize) {
        const batch = transformedData.slice(i, i + batchSize);
        const timestamp = new Date().toISOString();
        
        const batchWithTimestamps = batch.map(bill => ({
          ...bill,
          created_at: timestamp,
          updated_at: timestamp
        }));

        const { error } = await supabase
          .from('bills')
          .upsert(batchWithTimestamps, {
            onConflict: 'bill_url',
            ignoreDuplicates: false
          });

        if (error) throw error;
        successCount += batch.length;
      }

      return successCount;
    } catch (error) {
      console.error('Error processing CSV:', error);
      throw error;
    }
  };

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast.error('Please select a file first');
      return;
    }

    const missingMappings = requiredFields.filter(field => !mappings[field]);
    if (missingMappings.length > 0) {
      toast.error(`Please map all required fields: ${missingMappings.join(', ')}`);
      return;
    }

    setIsUploading(true);
    const uploadToast = toast.loading('Uploading and processing CSV...');

    try {
      const successCount = await processAndUploadCsv();
      toast.success(`Successfully processed ${successCount} bills`, { id: uploadToast });
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setPreviewData([]);
      setCsvHeaders([]);
      setMappings({});
      setRawData([]);
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Error uploading CSV. Please check console for details.', { id: uploadToast });
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

      {csvHeaders.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h4 className="text-lg font-medium text-gray-800 mb-4">Column Mappings</h4>
          <div className="space-y-4">
            {requiredFields.map(field => (
              <div key={field} className="flex items-center">
                <span className="w-1/3 text-sm font-medium text-gray-700">
                  {field.replace('_', ' ').charAt(0).toUpperCase() + field.slice(1)}:
                </span>
                <select
                  value={mappings[field] || ''}
                  onChange={(e) => handleMappingChange(field, e.target.value)}
                  className="ml-2 block w-2/3 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                >
                  <option value="">Select column</option>
                  {csvHeaders.map(header => (
                    <option key={header} value={header}>{header}</option>
                  ))}
                </select>
                {mappings[field] ? (
                  <CheckCircle2 className="w-5 h-5 ml-2 text-green-500" />
                ) : (
                  <AlertCircle className="w-5 h-5 ml-2 text-amber-500" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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