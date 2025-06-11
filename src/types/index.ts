export interface Bill {
  id: string;
  bill_url: string;
  description: string;
  current_status: string;
  committee_assignment: string | null;
  bill_title: string | null;
  introducer: string | null;
  bill_number: string | null;
  created_at: string;
  updated_at: string;
}

export type ScrapingStatus = 'idle' | 'scraping' | 'error';