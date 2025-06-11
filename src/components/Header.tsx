import React from 'react';
import { FileText, BarChart2, Settings } from 'lucide-react';

interface HeaderProps {
  activeTab: 'dashboard' | 'bills' | 'controls';
  setActiveTab: (tab: 'dashboard' | 'bills' | 'controls') => void;
}

const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab }) => {
  return (
    <header className="bg-blue-900 text-white shadow-md">
      <div className="container mx-auto px-4 py-4">
        <div className="flex flex-col md:flex-row justify-between items-center">
          <div className="flex items-center mb-4 md:mb-0">
            <FileText className="w-8 h-8 mr-2 text-amber-400" />
            <h1 className="text-2xl font-bold">Hawaii Legislature Scraper</h1>
          </div>
          
          <nav className="flex space-x-1 bg-blue-800 rounded-lg p-1 w-full md:w-auto">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center px-4 py-2 rounded-md transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-amber-500 text-white'
                  : 'text-white/80 hover:bg-blue-700'
              }`}
            >
              <BarChart2 className="w-5 h-5 mr-2" />
              Dashboard
            </button>
            
            <button
              onClick={() => setActiveTab('bills')}
              className={`flex items-center px-4 py-2 rounded-md transition-all ${
                activeTab === 'bills'
                  ? 'bg-amber-500 text-white'
                  : 'text-white/80 hover:bg-blue-700'
              }`}
            >
              <FileText className="w-5 h-5 mr-2" />
              Bills
            </button>
            
            <button
              onClick={() => setActiveTab('controls')}
              className={`flex items-center px-4 py-2 rounded-md transition-all ${
                activeTab === 'controls'
                  ? 'bg-amber-500 text-white'
                  : 'text-white/80 hover:bg-blue-700'
              }`}
            >
              <Settings className="w-5 h-5 mr-2" />
              Controls
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
};

export default Header;