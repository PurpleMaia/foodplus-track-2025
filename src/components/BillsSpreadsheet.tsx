import React, { useState } from 'react';
import { useScrapingContext } from '../context/ScrapingContext';
import { Search, Download, Filter } from 'lucide-react';

interface IndividualBill {
  billTitle: string;
  description: string;
  currentReferral: string;
  introducers: string;
  measureType: string;
  statuses: Array<{
    bill_id: string;
    chamber: string;
    date: string;
    statustext: string;
  }>;
}

const BillsSpreadsheet: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showFoodOnly, setShowFoodOnly] = useState(false);
  const { individualBillContents } = useScrapingContext();

  // Food-related keywords for filtering
  const FOOD_KEYWORDS = [
    'agriculture', 'food', 'farm', 'pesticides', 'eating', 'edible', 'meal',
    'crop', 'harvest', 'organic', 'nutrition', 'diet', 'restaurant', 'cafe',
    'kitchen', 'cooking', 'beverage', 'drink', 'produce', 'vegetable', 'fruit',
    'meat', 'dairy', 'grain', 'seed', 'fertilizer', 'irrigation', 'livestock',
    'poultry', 'fishery', 'aquaculture', 'grocery', 'market', 'vendor'
  ];

  // Function to check if a bill contains food-related keywords
  const containsFoodKeywords = (bill: IndividualBill) => {
    const searchText = `${bill.billTitle || ''} ${bill.description || ''}`.toLowerCase();
    return FOOD_KEYWORDS.some(keyword => searchText.includes(keyword.toLowerCase()));
  };

  // Parse and filter bills
  const allBills = individualBillContents ? JSON.parse(individualBillContents) : [];
  const foodBills = allBills.filter((bill: IndividualBill) => containsFoodKeywords(bill));
  const displayBills = showFoodOnly ? foodBills : allBills;

  // Filter by search term
  const filteredBills = displayBills.filter((bill: IndividualBill) => 
    bill.billTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
    bill.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    bill.measureType.toLowerCase().includes(searchTerm.toLowerCase()) ||
    bill.introducers.toLowerCase().includes(searchTerm.toLowerCase()) ||
    bill.currentReferral.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Get latest status for each bill
  const getLatestStatus = (bill: IndividualBill) => {
    if (bill.statuses && bill.statuses.length > 0) {
      return bill.statuses[0]; // Assuming statuses are ordered by date
    }
    return null;
  };

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

    const csvContent = filteredBills.map((bill: IndividualBill) => {
      const latestStatus = getLatestStatus(bill);
      return [
        `"${bill.billTitle}"`,
        `"${bill.billTitle}"`,
        `"${bill.description.replace(/"/g, '""')}"`,
        `"${bill.measureType.replace(/"/g, '""')}"`,
        `"${bill.introducers}"`,
        `"${bill.currentReferral}"`,
        `"${latestStatus?.date || ''}"`,
        `"${latestStatus?.chamber || ''}"`,
        `"${latestStatus?.statustext.replace(/"/g, '""') || ''}"`
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

          {/* Food Filter */}
          <button
            onClick={() => setShowFoodOnly(!showFoodOnly)}
            className={`flex items-center px-4 py-2 rounded-md transition-colors ${
              showFoodOnly 
                ? 'bg-green-600 text-white' 
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            <Filter className="w-4 h-4 mr-2" />
            {showFoodOnly ? 'Food Only' : 'All Bills'}
          </button>

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
          <span>Total Bills: <strong>{allBills.length}</strong></span>
          <span>Food-Related Bills: <strong>{foodBills.length}</strong></span>
          <span>Currently Showing: <strong>{filteredBills.length}</strong></span>
        </div>
      </div>

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
                  Measure Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Introducers
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Current Referral
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Latest Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status Date
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredBills.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-4 text-center text-gray-500">
                    {individualBillContents ? 'No bills match your search criteria.' : 'No bills data available. Run a scraping job first.'}
                  </td>
                </tr>
              ) : (
                filteredBills.map((bill: IndividualBill, index: number) => {
                  const latestStatus = getLatestStatus(bill);
                  return (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {bill.billTitle}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                        {bill.billTitle}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-md">
                        <div className="max-h-20 overflow-y-auto">
                          {bill.description}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-xs">
                        {bill.measureType}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {bill.introducers}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {bill.currentReferral}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-xs">
                        <div className="max-h-20 overflow-y-auto">
                          {latestStatus?.statustext || 'No status'}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {latestStatus?.date || '-'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default BillsSpreadsheet; 