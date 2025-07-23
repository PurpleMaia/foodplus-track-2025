import React from 'react';
import { useScrapingContext } from '../context/ScrapingContext';

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

const BillsGrid: React.FC = () => {
  const { individualBillContents } = useScrapingContext();
  const bills: IndividualBill[] = individualBillContents ? JSON.parse(individualBillContents) : [];

  const getLatestStatus = (bill: IndividualBill) => {
    if (bill.statuses && bill.statuses.length > 0) {
      return bill.statuses[0]; // Assuming statuses are ordered by date
    }
    return null;
  };

  if (!bills.length) {
    return (
      <div className="text-center text-gray-500 mt-8">
        No bills data available. Run a scraping job first.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
      {bills.map((bill, idx) => {
        const latestStatus = getLatestStatus(bill);
        return (
          <div key={idx} className="bg-white rounded-lg shadow p-4 flex flex-col">
            <div className="font-bold text-lg mb-2 text-blue-900">{bill.billTitle}</div>
            <div className="text-gray-700 text-sm mb-2">{bill.description}</div>
            <div className="text-xs text-gray-500 mb-1">
              <span className="font-semibold">Type:</span> {bill.measureType}
            </div>
            <div className="text-xs text-gray-500 mb-1">
              <span className="font-semibold">Introducers:</span> {bill.introducers}
            </div>
            <div className="text-xs text-gray-500 mb-1">
              <span className="font-semibold">Current Referral:</span> {bill.currentReferral}
            </div>
            <div className="text-xs text-gray-500 mt-2">
              <span className="font-semibold">Latest Status:</span> {latestStatus?.statustext || 'No status'}
            </div>
            <div className="text-xs text-gray-400">
              <span className="font-semibold">Status Date:</span> {latestStatus?.date || '-'}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default BillsGrid; 