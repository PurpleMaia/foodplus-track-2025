// Frontend scraping service - calls backend API endpoints
// This version doesn't import the database client

/**
 * Start the scraping process for the Hawaii State Legislature website
 * Only calls the backend API, which handles all scraping, saving, and stats logic.
 */
export const startScraping = async () => {
  try {
    const response = await fetch('/api/scrape-bills', {
      method: 'GET',
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.details || 'Failed to scrape bills');
    }
    const { bills } = await response.json();    
    return bills;
  } catch (error) {
    console.error('Error during scraping:', error);
    throw error;
  }
};

export const scrapeIndividual = async () => {
  try {
    const response = await fetch('/api/scrape-individual', {
      method: 'GET',
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.details || 'Failed to scrape individual bill');
    }
    const bill = await response.text();
    
    console.log('data from client call:', bill)

    return bill;
  } catch (error) {
    console.error('Error during scraping:', error);
    throw error;
  }
};


/**
 * Cancel the scraping process (no-op on frontend, but kept for API compatibility)
 */
export const cancelScraping = async () => {
  // Optionally, you could call a backend endpoint to cancel a running job
  // For now, this is a no-op on the frontend
};

