export const getRandomUserAgent = () => userAgents[Math.floor(Math.random() * userAgents.length)];

export const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
];


export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Timeout settings
export const MAIN_LIST_TIMEOUT = 60000; // 60s for main bill list pages
export const INDIVIDUAL_TIMEOUT = 45000; // 45s for individual bill pages
export const MAIN_LIST_MAX_RETRIES = 3;
export const MAIN_LIST_RETRY_DELAY = 5000; // 5s between retries

// Individual scraping settings
export const INDIVIDUAL_BATCH_SIZE = 5;
export const INDIVIDUAL_BATCH_DELAY = 2000; // 2s between batches
export const INDIVIDUAL_MAX_RETRIES = 3;
export const INDIVIDUAL_RETRY_DELAY = 3000; // 3s base delay, doubles each retry