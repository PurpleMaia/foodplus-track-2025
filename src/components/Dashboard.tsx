import React from 'react';
import { useScrapingContext } from '../context/ScrapingContext';
import { FileText, Clock, AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import StatCard from './StatCard';

const Dashboard: React.FC = () => {
  const { 
    totalBills, 
    lastScraped, 
    isLoading, 
    scrapingStatus, 
    refreshBills, 
    startScrapingJob 
  } = useScrapingContext();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">Dashboard</h2>
        <div className="flex space-x-2">
          <button
            onClick={refreshBills}
            disabled={isLoading}
            className="flex items-center px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-blue-300"
          >
            <RefreshCw className={`w-5 h-5 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={startScrapingJob}
            disabled={scrapingStatus === 'scraping' || isLoading}
            className="flex items-center px-3 py-2 bg-amber-500 text-white rounded-md hover:bg-amber-600 transition-colors disabled:bg-amber-300"
          >
            Start Scraping
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Total Bills" 
          value={totalBills.toString()} 
          icon={<FileText className="w-8 h-8 text-blue-500" />}
          description="Total number of bills scraped"
          color="bg-blue-50 border-blue-200"
        />
        
        <StatCard 
          title="Last Updated" 
          value={lastScraped ? format(lastScraped, 'MMM d, yyyy') : 'Never'} 
          subValue={lastScraped ? format(lastScraped, 'h:mm a') : ''}
          icon={<Clock className="w-8 h-8 text-green-500" />}
          description="Last time data was scraped"
          color="bg-green-50 border-green-200"
        />
        
        <StatCard 
          title="Scraping Status" 
          value={scrapingStatus === 'scraping' ? 'Active' : 'Idle'} 
          icon={
            scrapingStatus === 'scraping' 
              ? <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
              : <Check className="w-8 h-8 text-gray-500" />
          }
          description={scrapingStatus === 'scraping' ? 'Scraping in progress' : 'Ready to scrape'}
          color={scrapingStatus === 'scraping' ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}
        />
        
        <StatCard 
          title="Warnings/Errors" 
          value="0" 
          icon={<AlertTriangle className="w-8 h-8 text-red-500" />}
          description="No current issues detected"
          color="bg-red-50 border-red-200"
        />
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-xl font-semibold mb-4 text-gray-800">About This Application</h3>
        <p className="text-gray-700 mb-3">
          This application automatically scrapes bill information from the Hawaii State Legislature website and stores it in a database for easy access and analysis.
        </p>
        <p className="text-gray-700 mb-3">
          The scraper collects information such as bill URLs, measure status, and current status for each House Bill. The data is validated, sanitized, and stored with timestamps for tracking changes over time.
        </p>
        <p className="text-gray-700">
          Use the controls tab to initiate manual scraping or configure scheduled scraping. The bills tab allows you to browse, search, and export the collected data.
        </p>
      </div>
    </div>
  );
};

export default Dashboard;