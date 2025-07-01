import { writeFileSync } from 'fs';
import axios from 'axios';

const URL = 'https://data.capitol.hawaii.gov/advreports/advreport.aspx?year=2025&report=deadline&active=true&rpt_type=&measuretype=hb&title=House%20Bills%20Introduced'; // example endpoint: bills dataset

(async () => {
  try {
    const response = await axios.get(URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
      timeout: 30000
    });

    const data = response.data;
    console.log('✅ Data retrieved:', data.slice(0, 3)); // Preview first 3 items

    // Save to file
    writeFileSync('hawaii-data.json', JSON.stringify(data, null, 2));
    console.log('✅ Data saved to hawaii-data.json');
  } catch (err) {
    console.error('❌ Error fetching data:', err.message);
  }
})();
