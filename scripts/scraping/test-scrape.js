import { writeFileSync } from 'fs';
import axios from 'axios';

const URL = 'https://data.capitol.hawaii.gov/session/measure_indiv.aspx?billtype=SB&billnumber=1186&year=2025'; // example endpoint: bills dataset

(async () => {
    const response = await axios.get(URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Referer': 'https://data.capitol.hawaii.gov',
      },
      timeout: 30000
    });

    console.log('First 500 chars:', response.data);
    const data = response.data;
    // console.log('✅ Data retrieved:', data.slice(0, 3)); // Preview first 3 items

    // Save to file
    writeFileSync('hawaii-data-test.html', data);
    console.log("Wrote to writeFileSync");

    console.log('✅ Data saved to hawaii-data-test.html');
  
})();
