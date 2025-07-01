import axios from 'axios';

const response = await axios.get('https://data.capitol.hawaii.gov', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Referer': 'https://data.capitol.hawaii.gov',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  },
  timeout: 10000
});

console.log('Status:', response.status);
console.log('Data:', response.data.slice(0, 500)); // Print part of HTML
