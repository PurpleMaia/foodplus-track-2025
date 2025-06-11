import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import { startScraping, cancelScraping } from '../lib/scrapingService';
import toast from 'react-hot-toast';
import { Bill, ScrapingStatus } from '../types';

interface ScrapingContextType {
  bills: Bill[];
  isLoading: boolean;
  error: string | null;
  scrapingStatus: ScrapingStatus;
  refreshBills: () => Promise<void>;
  startScrapingJob: () => Promise<void>;
  stopScrapingJob: () => Promise<void>;
  totalBills: number;
  lastScraped: Date | null;
}

const ScrapingContext = createContext<ScrapingContextType | undefined>(undefined);

export const ScrapingProvider = ({ children }: { children: ReactNode }) => {
  const [bills, setBills] = useState<Bill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scrapingStatus, setScrapingStatus] = useState<ScrapingStatus>('idle');
  const [totalBills, setTotalBills] = useState(0);
  const [lastScraped, setLastScraped] = useState<Date | null>(null);

  const refreshBills = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Get bills count
      const { count } = await supabase
        .from('bills')
        .select('*', { count: 'exact', head: true });
      
      setTotalBills(count || 0);
      
      // Get most recent bills
      const { data, error } = await supabase
        .from('bills')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(100);
        
      if (error) throw error;
      
      setBills(data as Bill[]);
      
      // Get last scraped time
      const { data: statsData } = await supabase
        .from('scraping_stats')
        .select('last_scrape_time')
        .order('last_scrape_time', { ascending: false })
        .limit(1);
        
      if (statsData && statsData.length > 0) {
        setLastScraped(new Date(statsData[0].last_scrape_time));
      }
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
      await startScraping();
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

  const stopScrapingJob = async () => {
    if (scrapingStatus !== 'scraping') {
      return;
    }
    
    try {
      await cancelScraping();
      toast.success('Scraping job cancelled');
      setScrapingStatus('idle');
    } catch (err) {
      console.error('Error cancelling scraping job:', err);
      toast.error('Failed to cancel scraping job');
    }
  };

  useEffect(() => {
    refreshBills();
  }, []);

  return (
    <ScrapingContext.Provider
      value={{
        bills,
        isLoading,
        error,
        scrapingStatus,
        refreshBills,
        startScrapingJob,
        stopScrapingJob,
        totalBills,
        lastScraped,
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