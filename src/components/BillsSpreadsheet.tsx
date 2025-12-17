import React, { useState } from 'react';
import { useScrapingContext } from '../context/ScrapingContext';
import { Search, Download } from 'lucide-react';
import { Bill } from '../types';

const BillsSpreadsheet: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const { bills, foodBills } = useScrapingContext();

  // Export to CSV
  const exportToCSV = () => {
    const headers = [
      'Bill Number',
      'Bill Title', 
      'Description',
      'Measure Type',
      'Introducers',
      'Current Referral',
      'Latest Status Date',
      'Latest Status Chamber',
      'Latest Status Text'
    ].join(',');

    const csvContent = bills.map((bill: Bill) => {
      return [
        `"${bill.bill_number}"`,
        `"${bill.bill_title}"`,
        `"${bill.current_status_string}"`,
        `"${bill.description.replace(/"/g, '""')}"`,
        `"${bill.introducer}"`,
        `"${bill.committee_assignment}"`,
        `"FoodRelated ? ${bill.food_related}"`,
      ].join(',');
    }).join('\n');

    const csv = headers + '\n' + csvContent;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bills-spreadsheet-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-800">Bills Spreadsheet</h2>
        
        <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
          {/* Search */}
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

          {/* Export */}
          <button
            onClick={exportToCSV}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap gap-4 text-sm text-gray-600">
          <span>Total Bills: <strong>{bills.length}</strong></span>
          <span>Food-Related Bills: <strong>{foodBills.length}</strong></span>          
        </div>
      </div>

      <pre>
        {JSON.stringify(bills, null, 2)}
      </pre>      

      {/* Spreadsheet Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Bill Number
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Bill Title
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Description
                </th>                
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Introducers
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Committees
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Latest Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Updated 
                </th>
              </tr>
            </thead>
            {/* <tbody className="bg-white divide-y divide-gray-200">
              {bills.map((bill: Bill) => {
                return (
                  <tr key={bill.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {bill.bill_number}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                      {bill.bill_title}
                    </td>
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-md">
                        <div className="max-h-20 overflow-y-auto">
                          {bill.description}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {bill.introducer}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {bill.committee_assignment}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-xs">
                        <div className="max-h-20 overflow-y-auto">
                          {bill.current_status_string || 'No status'}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {bill.updated_at.toDateString() || '-'}
                      </td>
                    </tr>
                  );
                })}              
            </tbody> */}
          </table>
        </div>
      </div>
    </div>
  );
};

export default BillsSpreadsheet; 