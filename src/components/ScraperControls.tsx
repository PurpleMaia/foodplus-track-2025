import React, { useState } from 'react';
import { useScrapingContext } from '../context/ScrapingContext';
import { Play, StopCircle, RefreshCw, Clock, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import CsvUpload from './CsvUpload';

const ScraperControls: React.FC = () => {
  const { 
    scrapingStatus, 
    startScrapingJob, 
    stopScrapingJob, 
    lastScraped 
  } = useScrapingContext();
  
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleTime, setScheduleTime] = useState('');
  const [requestDelay, setRequestDelay] = useState(2000);

  const handleStartScraping = () => {
    startScrapingJob();
  };

  const handleStopScraping = () => {
    stopScrapingJob();
  };

  const handleScheduleToggle = () => {
    if (!scheduleEnabled && !scheduleTime) {
      toast.error('Please set a schedule time first');
      return;
    }
    setScheduleEnabled(!scheduleEnabled);
    toast.success(scheduleEnabled 
      ? 'Scheduled scraping disabled' 
      : `Scheduled scraping enabled for ${scheduleTime}`
    );
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Scraper Controls</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-xl font-semibold mb-4 text-gray-800 flex items-center">
            <Play className="w-5 h-5 mr-2 text-green-500" />
            Manual Scraping
          </h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Request Delay (ms)
              </label>
              <input
                type="number"
                min="500"
                max="10000"
                step="100"
                value={requestDelay}
                onChange={(e) => setRequestDelay(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-sm text-gray-500">
                Delay between requests to avoid overloading the server.
              </p>
            </div>
            
            <div className="flex space-x-3">
              <button
                onClick={handleStartScraping}
                disabled={scrapingStatus === 'scraping'}
                className="flex-1 flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-300"
              >
                {scrapingStatus === 'scraping' ? (
                  <>
                    <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                    Scraping...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 mr-2" />
                    Start Scraping
                  </>
                )}
              </button>
              
              <button
                onClick={handleStopScraping}
                disabled={scrapingStatus !== 'scraping'}
                className="flex-1 flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:bg-red-300"
              >
                <StopCircle className="w-5 h-5 mr-2" />
                Stop Scraping
              </button>
            </div>
            
            {scrapingStatus === 'scraping' && (
              <div className="mt-4">
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div className="bg-blue-600 h-2.5 rounded-full w-[45%]"></div>
                </div>
                <p className="text-sm text-gray-600 mt-2">
                  Scraping in progress. This may take several minutes...
                </p>
              </div>
            )}
            
            <div className="text-sm text-gray-600">
              {lastScraped ? (
                <p>
                  Last scraped: {lastScraped.toLocaleString()}
                </p>
              ) : (
                <p>No previous scraping data available.</p>
              )}
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-xl font-semibold mb-4 text-gray-800 flex items-center">
            <Clock className="w-5 h-5 mr-2 text-blue-500" />
            Scheduled Scraping
          </h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Schedule Time
              </label>
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-sm text-gray-500">
                Set a daily time to automatically run the scraper.
              </p>
            </div>
            
            <div className="flex items-center">
              <button
                onClick={handleScheduleToggle}
                className={`relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                  scheduleEnabled ? 'bg-blue-600' : 'bg-gray-200'
                }`}
                role="switch"
                aria-checked={scheduleEnabled}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200 ${
                    scheduleEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className="ml-3 text-sm font-medium text-gray-700">
                {scheduleEnabled ? 'Scheduled scraping enabled' : 'Scheduled scraping disabled'}
              </span>
            </div>
            
            <div className="bg-amber-50 border-l-4 border-amber-400 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                </div>
                <div className="ml-3">
                  <p className="text-sm text-amber-700">
                    Note: Scheduled scraping requires the application to remain open. For production use, consider setting up a server-side cron job.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <CsvUpload />
      </div>
      
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-xl font-semibold mb-4 text-gray-800">Advanced Settings</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max Items to Scrape
            </label>
            <input
              type="number"
              defaultValue="500"
              min="10"
              max="1000"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-sm text-gray-500">
              Limit the number of items to scrape per job.
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              User Agent
            </label>
            <input
              type="text"
              defaultValue="Hawaii Legislature Scraper (Educational Project)"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-sm text-gray-500">
              Identify your scraper to the website.
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Retry Attempts
            </label>
            <input
              type="number"
              defaultValue="3"
              min="1"
              max="10"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-sm text-gray-500">
              Number of times to retry a failed request.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScraperControls;
