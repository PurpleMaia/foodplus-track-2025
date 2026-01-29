export interface Bill {
  id: string;
  bill_url: string;
  bill_number: string | null;
  bill_title: string | null;
  current_status_string: string;
  committee_assignment: string | null;
  description: string;
  introducer: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  food_related: boolean | null;
}

export type ScrapingStatus = 'idle' | 'scraping' | 'error';