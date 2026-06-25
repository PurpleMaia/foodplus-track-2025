import React, { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import BillsSpreadsheet from './components/BillsSpreadsheet';
import ScraperControls from './components/ScraperControls';
import ClassifierTestPanel from './components/ClassifierTestPanel';
import Footer from './components/Footer';
import { ScrapingProvider } from './context/ScrapingContext';

function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'bills' | 'spreadsheet' | 'controls' | 'test'>('dashboard');

  return (
    <ScrapingProvider>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Toaster position="top-right" />
        <Header activeTab={activeTab} setActiveTab={setActiveTab} />
        
        <main className="flex-grow container mx-auto px-4 py-6">
          {activeTab === 'dashboard' && <Dashboard />}
          {activeTab === 'controls' && <ScraperControls />}
          {activeTab === 'test' && <ClassifierTestPanel />}
        </main>
        
        <Footer />
      </div>
    </ScrapingProvider>
  );
}

export default App;