// get data from the supabase and call service api
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { startScraping } from '../services/scraper.ts';
import toast from 'react-hot-toast';
import { Bill, ScrapingStatus } from '../types';
import { fetchBillsContext } from '../services/bill.ts';

interface ScrapingContextType {
  bills: Bill[];  
  foodBills: Bill[];
  isLoading: boolean;
  error: string | null;
  scrapingStatus: ScrapingStatus;
  refreshBills: () => Promise<void>;
  startScrapingJob: () => Promise<void>;
  totalBills: number;
  totalFoodBills: number;
  lastScraped: Date | null;
  individualBillContents: string;
}

const ScrapingContext = createContext<ScrapingContextType | undefined>(undefined);

export const ScrapingProvider = ({ children }: { children: ReactNode }) => {
  const [bills, setBills] = useState<Bill[]>([]);
  const [foodBills, setFoodBills] = useState<Bill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scrapingStatus, setScrapingStatus] = useState<ScrapingStatus>('idle');
  const [totalBills, setTotalBills] = useState(0);
  const [totalFoodBills, setTotalFoodBills] = useState(0);
  const [lastScraped, setLastScraped] = useState<Date | null>(null);
  const [individualBillContents, setIndividualBillContents] = useState<string>('');

  const refreshBills = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Fetch all bills and food-related bills in parallel
      const { allBills, foodBills, lastScrapeTime } = await fetchBillsContext();      
      setBills(allBills);
      setTotalBills(allBills.length);
      setFoodBills(foodBills);
      setTotalFoodBills(foodBills.length);
      setLastScraped(lastScrapeTime ? new Date(lastScrapeTime) : null);

      if (error) throw error;
      
    } catch (err) {
      console.error('Error fetching bills:', err);
      setError('Failed to load bills. Please try again later.');
      toast.error('Failed to load bills');
    } finally {
      setIsLoading(false);
    }
  };

  const startScrapingJob = async () => {
    if (scrapingStatus === 'scraping') {
      toast.error('A scraping job is already in progress');
      return;
    }
    
    setScrapingStatus('scraping');
    toast.loading('Starting scraping job...', { id: 'scraping' });
    
    try {
      const result = await startScraping();
      setIndividualBillContents(JSON.stringify(result.individualBillsData, null, 2));
      toast.success('Scraping job completed successfully', { id: 'scraping' });
      await refreshBills();
    } catch (err) {
      console.error('Error during scraping:', err);
      toast.error('Scraping job failed', { id: 'scraping' });
      setError('Failed to complete scraping job');
    } finally {
      setScrapingStatus('idle');
    }
  };  

  useEffect(() => {
    refreshBills();
  }, []);

  return (
    <ScrapingContext.Provider
      value={{
        bills,
        foodBills,
        isLoading,
        error,
        scrapingStatus,
        refreshBills,
        startScrapingJob,
        totalBills,
        totalFoodBills,
        lastScraped,
        individualBillContents
      }}
    >
      {children}
    </ScrapingContext.Provider>
  );
};

export const useScrapingContext = (): ScrapingContextType => {
  const context = useContext(ScrapingContext);
  if (context === undefined) {
    throw new Error('useScrapingContext must be used within a ScrapingProvider');
  }
  return context;
};