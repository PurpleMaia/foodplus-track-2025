import { writeFileSync } from 'fs';
import axios from 'axios';

const URL = 'https://data.capitol.hawaii.gov/session/measure_indiv.aspx?billtype=SB&billnumber=1186&year=2025'; // example endpoint: bills dataset

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
    writeFileSync('hawaii-data-test.json', JSON.stringify(data, null, 2));
    console.log('✅ Data saved to hawaii-data-test.json');
  } catch (err) {
    console.error('❌ Error fetching data:', err.message);
  }
})();
