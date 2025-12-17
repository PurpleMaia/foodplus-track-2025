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
    const { bills, individualBillsData } = await response.json();    
    return { bills, individualBillsData };
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