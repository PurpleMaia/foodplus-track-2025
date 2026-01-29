
export const fetchBillsContext = async () => {
    try {
        const response = await fetch('/api/all-bills-context', {
            method: 'GET',
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.details || 'Failed to fetch bills');
        }
        const { allBills, foodBills, lastScrapeTime } = await response.json();
        console.log('Fetched bills context:', { allBills, foodBills, lastScrapeTime });
        return { allBills, foodBills, lastScrapeTime };
    } catch (error) {        
        console.error('Error fetching bills:', error);
        throw error;
    }
}