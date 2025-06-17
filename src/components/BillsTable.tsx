import React, { useState } from 'react';
import { useScrapingContext } from '../context/ScrapingContext';
import { Search, Download, ChevronDown, ExternalLink, Link as LinkIcon } from 'lucide-react';
import { format } from 'date-fns';
import { Bill } from '../types';

const BillsTable: React.FC = () => {
  const { bills, isLoading, error } = useScrapingContext();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<keyof Bill>('updated_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  // Filter bills based on search term
  const filteredBills = bills.filter(bill => 
    bill.bill_url.toLowerCase().includes(searchTerm.toLowerCase()) ||
    bill.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    bill.current_status.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (bill.committee_assignment?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
    (bill.bill_title?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
    (bill.introducer?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
    (bill.bill_number?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false)
  );

  // Sort bills based on sort field and direction
  const sortedBills = [...filteredBills].sort((a, b) => {
    let valueA = a[sortField];
    let valueB = b[sortField];
    
    // Handle dates specially
    if (sortField === 'updated_at' || sortField === 'created_at') {
      valueA = new Date(valueA as string).getTime();
      valueB = new Date(valueB as string).getTime();
    }
    
    if (valueA < valueB) return sortDirection === 'asc' ? -1 : 1;
    if (valueA > valueB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (field: keyof Bill) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Close export menu when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('#export-menu') && !target.closest('#export-button')) {
        setIsExportMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const exportData = (format: 'csv' | 'json') => {
    let data: string;
    let filename: string;
    const timestamp = new Date().toISOString().split('T')[0];
    
    if (format === 'csv') {
      // Create CSV header
      const headers = 'Bill Number,Bill Title,Bill URL,Description,Current Status,Committee Assignment,Introducer,Updated At\n';
      
      // Create CSV content
      const csvContent = filteredBills.map(bill => 
        `"${bill.bill_number || ''}","${bill.bill_title || ''}","${bill.bill_url}","${bill.description}","${bill.current_status}","${bill.committee_assignment || ''}","${bill.introducer || ''}","${bill.updated_at}"`
      ).join('\n');
      
      data = headers + csvContent;
      filename = `hawaii-bills-${timestamp}.csv`;
    } else {
      data = JSON.stringify(filteredBills, null, 2);
      filename = `hawaii-bills-${timestamp}.json`;
    }
    
    // Create download link
    const blob = new Blob([data], { type: format === 'csv' ? 'text/csv' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setIsExportMenuOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-800">Bills</h2>
        
        <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
          <div className="relative w-full md:w-64">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Search bills..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-3 py-2 w-full border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div className="relative inline-block text-left w-full md:w-auto">
            <button 
              type="button" 
              id="export-button"
              onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
              className="inline-flex justify-center w-full rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              aria-expanded={isExportMenuOpen}
              aria-haspopup="true"
            >
              <Download className="w-5 h-5 mr-2" />
              Export Data
              <ChevronDown className={`w-5 h-5 ml-2 transition-transform ${isExportMenuOpen ? 'transform rotate-180' : ''}`} />
            </button>
            
            {isExportMenuOpen && (
              <div 
                id="export-menu"
                className="origin-top-right absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-10"
              >
                <div className="py-1" role="menu" aria-orientation="vertical" aria-labelledby="export-button">
                  <button
                    onClick={() => exportData('csv')}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                    role="menuitem"
                  >
                    Export as CSV
                  </button>
                  <button
                    onClick={() => exportData('json')}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                    role="menuitem"
                  >
                    Export as JSON
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded relative">
          {error}
        </div>
      ) : (
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer w-32"
                    onClick={() => handleSort('bill_number')}
                  >
                    <div className="flex items-center">
                      Bill Number
                      {sortField === 'bill_number' && (
                        <ChevronDown 
                          className={`ml-1 w-4 h-4 ${sortDirection === 'desc' ? 'transform rotate-180' : ''}`} 
                        />
                      )}
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer w-64"
                    onClick={() => handleSort('bill_title')}
                  >
                    <div className="flex items-center">
                      Title
                      {sortField === 'bill_title' && (
                        <ChevronDown 
                          className={`ml-1 w-4 h-4 ${sortDirection === 'desc' ? 'transform rotate-180' : ''}`} 
                        />
                      )}
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer w-96"
                    onClick={() => handleSort('description')}
                  >
                    <div className="flex items-center">
                      Description
                      {sortField === 'description' && (
                        <ChevronDown 
                          className={`ml-1 w-4 h-4 ${sortDirection === 'desc' ? 'transform rotate-180' : ''}`} 
                        />
                      )}
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer w-48"
                    onClick={() => handleSort('current_status')}
                  >
                    <div className="flex items-center">
                      Current Status
                      {sortField === 'current_status' && (
                        <ChevronDown 
                          className={`ml-1 w-4 h-4 ${sortDirection === 'desc' ? 'transform rotate-180' : ''}`} 
                        />
                      )}
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer w-48"
                    onClick={() => handleSort('committee_assignment')}
                  >
                    <div className="flex items-center">
                      Committee Assignment
                      {sortField === 'committee_assignment' && (
                        <ChevronDown 
                          className={`ml-1 w-4 h-4 ${sortDirection === 'desc' ? 'transform rotate-180' : ''}`} 
                        />
                      )}
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer w-48"
                    onClick={() => handleSort('introducer')}
                  >
                    <div className="flex items-center">
                      Introducer
                      {sortField === 'introducer' && (
                        <ChevronDown 
                          className={`ml-1 w-4 h-4 ${sortDirection === 'desc' ? 'transform rotate-180' : ''}`} 
                        />
                      )}
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer w-48"
                    onClick={() => handleSort('updated_at')}
                  >
                    <div className="flex items-center">
                      Last Updated
                      {sortField === 'updated_at' && (
                        <ChevronDown 
                          className={`ml-1 w-4 h-4 ${sortDirection === 'desc' ? 'transform rotate-180' : ''}`} 
                        />
                      )}
                    </div>
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                    Links
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedBills.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-4 text-center text-gray-500">
                      No bills found. Try a different search term or start a scraping job.
                    </td>
                  </tr>
                ) : (
                  sortedBills.map((bill) => (
                    <tr key={bill.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">
                        <div className="max-w-[8rem] truncate hover:whitespace-normal hover:overflow-visible hover:bg-white hover:shadow-lg hover:z-10 hover:absolute p-1 rounded">
                          {bill.bill_number || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        <div className="max-w-[16rem] truncate hover:whitespace-normal hover:overflow-visible hover:bg-white hover:shadow-lg hover:z-10 hover:absolute p-1 rounded">
                          {bill.bill_title || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        <div className="max-w-[24rem] truncate hover:whitespace-normal hover:overflow-visible hover:bg-white hover:shadow-lg hover:z-10 hover:absolute p-1 rounded">
                          {bill.description}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <div className="max-w-[12rem] truncate hover:whitespace-normal hover:overflow-visible hover:bg-white hover:shadow-lg hover:z-10 hover:absolute p-1 rounded">
                          {bill.current_status}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <div className="max-w-[12rem] truncate hover:whitespace-normal hover:overflow-visible hover:bg-white hover:shadow-lg hover:z-10 hover:absolute p-1 rounded">
                          {bill.committee_assignment || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <div className="max-w-[12rem] truncate hover:whitespace-normal hover:overflow-visible hover:bg-white hover:shadow-lg hover:z-10 hover:absolute p-1 rounded">
                          {bill.introducer || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {format(new Date(bill.updated_at), 'MMM d, yyyy h:mm a')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex space-x-2">
                          <a
                            href={bill.bill_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-900 flex items-center"
                            title="View on Legislature Website"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                          <a
                            href={`https://data.capitol.hawaii.gov/measure_indiv.aspx?billtype=HB&billnumber=${bill.bill_number?.replace('HB', '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-900 flex items-center"
                            title="View Bill Status"
                          >
                            <LinkIcon className="w-4 h-4" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="bg-gray-50 px-6 py-3 border-t border-gray-200">
            <p className="text-sm text-gray-700">
              Showing <span className="font-medium">{sortedBills.length}</span> bills
              {searchTerm && <span> matching "<span className="font-medium">{searchTerm}</span>"</span>}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillsTable;